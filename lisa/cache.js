/* ===================================================================================
   Lisa 离线缓存（页面侧）：让「下载过一次的东西，永远留在本机」
   -----------------------------------------------------------------------------------
   和 ./sw.js（Service Worker）配合，解决「每次打开网页都在重新下载」。
   本页是**部署在 GitHub Pages**（https://<用户>.github.io/<仓库>/）的，所以这里的设计
   是照 Pages 的特点来的：

   · Pages 是 https → 安全上下文，Service Worker / 持久化存储 / 麦克风全都可用 ✓
   · Pages 不能自定义响应头（只有 `Cache-Control: max-age=600`）→ 长期缓存只能靠
     Cache Storage（也就是这个文件 + sw.js），不能指望 HTTP 缓存
   · Pages 有 100GB/月的软流量限制，而「全新一次访问」≈345MB → 预下载默认要等
     **用户第一次点击 / 按键**（页面上的 [CLICK] TO START）才开始，爬虫与路人不会触发
   · Pages 是子目录部署 → 缓存按「地址 + 目录」隔离：仓库改名 / 换部署路径 = 重下一遍
     （这里会检测并提示）
   · 非 localhost 的站点首次通常拿不到「持久化存储」授权（浏览器按站点参与度给）→
     会给出可操作建议（安装为应用 / 站点设置），iPad / iPhone 上还会提醒「7 天没访问会被清」
   · 每台设备、每个浏览器各存一份（手机与电脑不共享），这是浏览器的隔离规则，不是 bug

   对外接口：window.lisaOffline.state() / .precache() / .clear() / .estimate()
             / .config（可改参数）/ .assets()（看看清单里有什么）
   事件：window 上的 'lisa-offline' —— { type: 'progress' | 'done' | 'state' | 'error', … }
   =================================================================================== */
(function () {
    'use strict';

    /* ------------------------------------------------------------------ 可调参数
       （部署在 GitHub Pages 上时：每次「全新」访问大约要传 345MB，
         所以 autoPrecache 默认是 'gesture' —— 只有真正用的人点了页面才开始下载） */
    var CFG = {
        swUrl: './sw.js',
        enabled: true,              /* false = 不用 Service Worker（退回浏览器自己的缓存机制） */
        /* 预下载什么时候开始：
           'gesture'（默认）= 用户第一次点击 / 按键（也就是页面上的 [CLICK] TO START）之后再等一会儿开始
                              —— Pages 上爬虫 / 路人不会触发，省流量；
                                每台设备、每个浏览器各下一次，之后就是 0 下载
           'now'             = 打开页面就开始（本地自建服务 / 内网很合适）
           false             = 完全不自动预下载，只认面板的「预下载全部」或 lisaOffline.precache() */
        autoPrecache: 'gesture',
        autoPrecacheDelayMs: 4000,      /* 'now' 模式下的延迟（避开开场动画 / 模型预热） */
        precacheGestureDelayMs: 3000,   /* 'gesture' 模式下，手势之后再等这么久开始 */
        cacheWeights: true,         /* 是否把大模型权重（约 276MB）也收进离线缓存：
                                       true  = 万无一失（WebLLM 自己的 IndexedDB 被清掉也能本地取）
                                       false = 少占一份磁盘，权重只靠 WebLLM 的 IndexedDB */
        cacheVosk: true,            /* 是否把离线语音模型（约 49MB）也收进离线缓存 */
        /* 一定会缓存的本地文件（3D / 声音 / 图标 / 字体；脚本与样式会自动从页面里读） */
        always: ['./lisa.glb', './envmap.exr', './running_code.mp4', './ambient.mp3',
            './favicon-32x32.png', './HelveticaNowDisplay-Regular.woff2', './PPLocomotiveNew-Light.woff2'],
        extra: [],                  /* 想额外缓存的相对路径写这里 */
        /* 记住上次的「地址 + 目录」：GitHub Pages 上仓库改名 / 换部署目录都会让缓存对不上，
           那种情况下会重新下载一次，这里负责提示（本地 127.0.0.1 与局域网 IP 之间切换同理） */
        scopeKey: 'lisa-offline-scope',
        storageKey: 'lisa-offline-v1'       /* 缓存状态快照（面板上显示的小字） */
    };


    /* ------------------------------------------------------------------ DOM */
    var elBar = null;                       /* 进度条（脚本建，用完就藏） */
    var elInfo = document.getElementById('lisa-offline-info');
    var elBtnNow = document.getElementById('lisa-offline-precache');
    var elBtnClear = document.getElementById('lisa-offline-clear');
    var elTip = document.getElementById('lisa-voice-tip');

    /* ------------------------------------------------------------------ 状态 */
    var off = {
        secure: window.isSecureContext !== false,
        supported: ('serviceWorker' in navigator) && (window.isSecureContext !== false),
        reg: null, precaching: false,
        done: 0, total: 0, bytes: 0, bytesTotal: 0,
        entries: 0, cachedBytes: 0, version: '', failed: [],
        persistent: null, quota: 0, usage: 0, lastError: '', warned: false, persistWarned: false
    };

    /* 现在是哪种部署环境（用来决定提示话术）：
       'pages' = GitHub Pages（https://<用户>.github.io/<仓库>/）
       'local' = 本机 http://localhost / http://127.0.0.1
       'other' = 自建服务器 / 内网 IP / file:// 等 */
    function deployKind() {
        var h = location.hostname || '';
        if (/(^|\.)github\.io$/i.test(h)) return 'pages';
        if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]') return 'local';
        return 'other';
    }

    /* iOS / iPadOS 的 Safari：7 天不访问会清掉脚本可写存储（Cache Storage / IndexedDB），
       「添加到主屏」装成 Web App 之后才不受这条策略影响 —— 值得提醒一句 */
    function isIOS() {
        var ua = navigator.userAgent || '';
        return /iPad|iPhone|iPod/.test(ua) ||
            (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);   /* iPadOS 13+ 伪装成 Mac */
    }

    function isStandalone() {
        try {
            return !!(window.navigator.standalone || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches));
        } catch (e) { return false; }
    }

    /* 缓存是「按 地址 + 目录」存的：GitHub Pages 上仓库改名 / 换目录，本地在 127.0.0.1 与局域网 IP
       之间切换，都会对不上 —— 那就等于重新下一次，这里把当前这一份记下来用于提示 */
    function scopeNow() {
        var dir = location.pathname.replace(/[^/]*$/, '');
        return location.origin + dir;
    }

    /* ------------------------------------------------------------------ 小工具 */
    function fire(type, detail) {
        detail = detail || {};
        detail.type = type;
        try {
            var ev;
            if (window.CustomEvent) ev = new CustomEvent('lisa-offline', { detail: detail });
            else {
                ev = document.createEvent('CustomEvent');
                ev.initCustomEvent('lisa-offline', false, false, detail);
            }
            window.dispatchEvent(ev);
        } catch (e) { }
    }

    function tip(html) {
        if (!elTip) { console.warn('[offline]', String(html).replace(/<[^>]+>/g, '')); return; }
        elTip.innerHTML = '<b>离线缓存</b><br>' + html +
            '<span class="c-lisa_voice-tip-close">✕</span>';
        elTip.classList.add('is-show');
        elTip.onclick = function () { elTip.classList.remove('is-show'); };
    }

    function abs(p) {
        try { return new URL(p, location.href).href; } catch (e) { return p; }
    }

    function mb(bytes) {
        var n = Number(bytes) || 0;
        if (n >= 1024 * 1024 * 1024) return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
        return (n / 1024 / 1024).toFixed(1) + ' MB';
    }

    function uniq(list) {
        var seen = {}, out = [], i;
        for (i = 0; i < list.length; i++) {
            if (!list[i] || seen[list[i]]) continue;
            seen[list[i]] = 1;
            out.push(list[i]);
        }
        return out;
    }

    function sameOrigin(u) {
        try { return new URL(u, location.href).origin === location.origin; } catch (e) { return false; }
    }

    /* ------------------------------------------------------------------ 进度条（页面上那条小提示） */
    function bar() {
        if (elBar) return elBar;
        elBar = document.createElement('div');
        elBar.id = 'lisa-offline-bar';
        elBar.style.cssText = 'position:fixed;left:50%;bottom:196px;transform:translateX(-50%);' +
            'z-index:2147483644;padding:8px 14px;border-radius:999px;background:rgba(0,0,0,.82);' +
            'color:#fff;font:12px/1.6 system-ui,-apple-system,"Microsoft YaHei",sans-serif;' +
            'box-shadow:0 8px 24px rgba(0,0,0,.3);display:none;max-width:84vw;text-align:center';
        document.body.appendChild(elBar);
        return elBar;
    }

    function showBar(text) {
        var el = bar();
        el.textContent = text;
        el.style.display = 'block';
    }

    function hideBar() { if (elBar) elBar.style.display = 'none'; }

    /* ------------------------------------------------------------------ 面板上那行小字 */
    function refreshInfo() {
        if (!elInfo) return;
        var s = off.supported
            ? ('已缓存 ' + off.entries + ' 个文件 / ' + mb(off.cachedBytes) +
                (off.precaching ? '（正在预下载 ' + off.done + '/' + off.total + '）' : '') +
                (off.persistent === true ? '　·　已持久化'
                    : (off.persistent === false ? '　·　未持久化（磁盘紧张时可能被清）' : '')))
            : (off.secure ? '这台浏览器不支持 Service Worker' :
                '当前地址不是安全上下文（用 https 或 127.0.0.1 打开才有离线缓存）');
        elInfo.textContent = '离线缓存：' + s;
    }

    function save() {
        try {
            window.localStorage.setItem(CFG.storageKey, JSON.stringify({
                entries: off.entries, bytes: off.cachedBytes, version: off.version, at: Date.now()
            }));
        } catch (e) { }
    }

    /* ==================================================================================
       资源清单：这个页面用到的所有同源文件
         · 脚本 / 样式：直接读 DOM（?v= 版本号是多少就缓存多少，绝不错过）
         · LLM：引擎、WebGPU 计算库、分词器、模型权重分片（从模型自带的
           mlc-chat-config.json / tensor-cache.json 自动枚举，以后换模型不用改这里）
         · 离线语音：vosk.js + 中文模型
       ================================================================================== */
    var sizes = {};            /* url -> 字节数（进度条用；权重取 tensor-cache 里的真实值） */

    function headSize(u) {
        return fetch(u, { method: 'HEAD', credentials: 'same-origin' }).then(function (r) {
            var n = parseInt(r.headers.get('content-length') || '0', 10) || 0;
            if (n) sizes[u] = n;
            return n;
        }, function () { return 0; });
    }

    function llmAssets() {
        var L = window.lisaLLM && window.lisaLLM.config;
        if (!L) return Promise.resolve([]);
        var out = [abs(L.engine), abs(L.modelLib)];       /* web-llm.js + *.wasm 计算库 */
        var base = abs(L.modelUrl);                       /* 已含 resolve/<段>/ */
        var cfgUrl = base + 'mlc-chat-config.json';
        var tcUrl = base + 'tensor-cache.json';
        var jobs = [];

        jobs.push(fetch(cfgUrl, { cache: 'no-store' }).then(function (r) { return r.json(); })
            .then(function (j) {
                out.push(cfgUrl);
                var tf = (j && j.tokenizer_files) || [];
                for (var i = 0; i < tf.length; i++) out.push(base + tf[i]);
            }, function () { out.push(cfgUrl); }));

        jobs.push(fetch(tcUrl, { cache: 'no-store' }).then(function (r) { return r.json(); })
            .then(function (j) {
                out.push(tcUrl);
                var maps = {}, i, recs = (j && j.records) || [];
                for (i = 0; i < recs.length; i++) {           /* 同一分片有多条记录，字节数要累加 */
                    var dp = recs[i] && recs[i].dataPath;
                    if (!dp) continue;
                    maps[dp] = (maps[dp] || 0) + (recs[i].nbytes || 0);
                }
                for (var k in maps) {
                    if (!Object.prototype.hasOwnProperty.call(maps, k)) continue;
                    sizes[base + k] = maps[k];
                    if (CFG.cacheWeights) out.push(base + k);      /* 关掉就等于不缓存权重 */
                }
            }, function () { }));

        return Promise.all(jobs).then(function () { return out; });
    }

    function voskAssets() {
        var V = window.lisaVoice && window.lisaVoice.config;
        if (!V || !CFG.cacheVosk) return [];
        return [abs(V.voskScript), abs(V.voskModel)];
    }

    function assets() {
        var list = [], i;
        var nodes = document.querySelectorAll('script[src], link[rel=stylesheet][href]');
        for (i = 0; i < nodes.length; i++) {
            var u = nodes[i].src || nodes[i].href;
            if (u) list.push(u);
        }
        list = list.concat(CFG.always.map(abs), CFG.extra.map(abs), voskAssets());
        return llmAssets().then(function (llmList) {
            list = list.concat(llmList || []);
            return uniq(list.filter(sameOrigin));
        });
    }

    /* ==================================================================================
       和 Service Worker 通信
       ================================================================================== */
    function ensureSW() {
        if (!off.supported || !CFG.enabled) return Promise.resolve(null);
        if (off.reg && off.reg.active) return Promise.resolve(off.reg.active);
        if (!off.reg) {
            off.reg = navigator.serviceWorker.register(CFG.swUrl, { scope: './', updateViaCache: 'none' })
                .catch(function (err) {
                    off.reg = null;
                    off.lastError = (err && err.message) || String(err);
                    console.warn('[offline] Service Worker 注册失败：', off.lastError);
                    return null;
                });
        }
        return Promise.resolve(off.reg).then(function (reg) {
            if (!reg) return null;
            return navigator.serviceWorker.ready.then(function () { return reg.active; });
        });
    }

    function post2sw(msg) {
        return ensureSW().then(function (sw) {
            if (!sw) return false;
            sw.postMessage(msg);
            return true;
        });
    }

    function onSWMessage(e) {
        var d = e.data || {};
        if (d.type === 'precache-start') {
            off.precaching = true;
            off.done = 0; off.total = d.total || 0; off.bytes = 0;
            off.bytesTotal = d.bytesTotal || off.bytesTotal;
            showBar('离线缓存：开始把所有资源存到本机…');
            refreshInfo();
            return;
        }
        if (d.type === 'precache-progress') {
            off.done = d.done || 0;
            off.total = d.total || off.total;
            off.bytes = d.bytes || 0;
            off.bytesTotal = d.bytesTotal || off.bytesTotal;
            showBar('离线缓存：' + off.done + '/' + off.total +
                '　已缓存 ' + mb(off.bytes) + ' / ' + mb(off.bytesTotal) +
                (d.cached ? '　（本地已有，跳过）' : (d.failed ? '　（这个没取到，已跳过）' : '')));
            refreshInfo();
            fire('progress', {
                done: off.done, total: off.total, bytes: off.bytes,
                bytesTotal: off.bytesTotal, url: d.url, cached: !!d.cached, failed: !!d.failed
            });
            return;
        }
        if (d.type === 'precache-done') {
            off.precaching = false;
            off.failed = d.failed || [];
            off.bytes = d.bytes || off.bytes;
            showBar('离线缓存完成：' + (d.done || 0) + ' 个文件 / ' + mb(d.bytes) + '　—— 以后打开不再下载');
            window.setTimeout(hideBar, 5000);
            refreshInfo();
            fire('done', {
                done: d.done, total: d.total, bytes: d.bytes,
                bytesTotal: d.bytesTotal, failed: off.failed
            });
            if (off.failed.length) {
                tip('有 ' + off.failed.length + ' 个文件没缓存成功（不影响正常使用，多半是那个文件本来就不存在）：<br>' +
                    off.failed.slice(0, 3).join('<br>'));
            } else {
                persistAdvice();      /* 下好了才提醒「浏览器可能清理、怎么让它更稳」 */
            }
            return;
        }
        if (d.type === 'cleared') {
            off.entries = 0;
            off.cachedBytes = 0;
            refreshInfo();
            fire('cleared', {});
            return;
        }
        if (d.type === 'state') {
            off.entries = d.entries || 0;
            off.cachedBytes = d.bytes || 0;
            off.version = d.version || '';
            refreshInfo();
            save();
            fire('state', d);
        }
    }

    /* ==================================================================================
       预下载：把清单里的资源全部拉到本机（已经有的直接跳过，不会重复下载）
       ================================================================================== */
    function precache(force) {
        if (!off.supported || !CFG.enabled) {
            if (!off.warned) {
                off.warned = true;
                tip(off.secure
                    ? '这台浏览器不支持 Service Worker，离线缓存用不了；模型仍会走浏览器自身的缓存（HTTP / IndexedDB），第二次打开一般也不会重下。'
                    : '当前地址不是「安全上下文」，浏览器不允许注册 Service Worker：<br>' +
                    '· 本机请用 <code>http://127.0.0.1:8000/human.html</code>（或者 https）<br>' +
                    '· 手机用局域网 IP（http://192.168.x.x:8000）时没有离线缓存，模型只能靠浏览器自身缓存');
            }
            return Promise.resolve(false);
        }
        if (off.precaching) return Promise.resolve(false);

        return post2sw({ type: 'state' }).then(function () {
            return assets();
        }).then(function (urls) {
            /* 未知大小的（脚本 / 媒体）逐个 HEAD 问一下 Content-Length，进度条才准 */
            var need = urls.filter(function (u) { return !sizes[u]; });
            return Promise.all(need.map(headSize)).then(function () {
                var list = urls.map(function (u) { return { url: u, bytes: sizes[u] || 0 }; });
                off.precaching = true;
                off.done = 0;
                off.total = list.length;
                off.bytes = 0;
                off.bytesTotal = list.reduce(function (s, it) { return s + (it.bytes || 0); }, 0);
                off.failed = [];
                showBar('离线缓存：共 ' + list.length + ' 个文件 / 约 ' + mb(off.bytesTotal) + '，开始下载…');
                refreshInfo();
                fire('start', { total: off.total, bytesTotal: off.bytesTotal, force: !!force });
                return post2sw({ type: 'precache', list: list });
            });
        });
    }

    function clearCache() {
        return post2sw({ type: 'clear' }).then(function (ok) {
            if (!ok) return false;
            tip('已清空离线缓存。<br>下次打开会重新下载一遍（模型权重 276MB、离线语音 49MB 都在里面）。');
            return true;
        });
    }

    /* ==================================================================================
       持久化存储 / 用量估算
       ================================================================================== */
    /* 没拿到「持久化存储」授权时给一条可操作的建议。
       GitHub Pages 这类「非 localhost 的 https 站点」首次几乎都拿不到 —— 浏览器是按
       「站点参与度」给的：多来几次、或者把页面装成应用之后就会给。 */
    function deployModeText() {
        var k = deployKind();
        if (k === 'pages') return 'GitHub Pages 这类站点首次访问通常如此';
        if (k === 'local') return 'localhost 首次也常见';
        return '非 localhost 的 http 站点常见';
    }

    function persistAdvice() {
        if (off.persistWarned) return;
        off.persistWarned = true;
        if (isIOS() && !isStandalone()) {
            tip('<b>iPad / iPhone 上请注意</b>：Safari 会把「7 天没访问过」的站点的网页存储清掉，' +
                '这里缓存的 345MB 模型也在其中。<br>想长期保留：用分享菜单里的「<b>添加到主屏幕</b>」，' +
                '以后从主屏图标打开（装成 Web App 后不受这条策略影响）。');
            return;
        }
        if (off.persistent === false) {
            tip('浏览器这次没给「持久化存储」授权（' + deployModeText() + '）：缓存不会被主动清理，' +
                '但系统磁盘紧张时可能被清掉，被清就得重新下 345MB。<br>' +
                '想更稳：把页面「安装为应用 / 添加到主屏」，或在站点设置里允许持久化存储；' +
                '也可以在控制台执行 <code>lisaOffline.persist()</code> 再试一次。');
        }
    }

    function persist() {
        if (!navigator.storage || !navigator.storage.persist) { refreshInfo(); return Promise.resolve(null); }
        return navigator.storage.persisted().then(function (already) {
            if (already) { off.persistent = true; refreshInfo(); return true; }
            return navigator.storage.persist().then(function (ok) {
                off.persistent = !!ok;
                refreshInfo();
                if (!off.persistent) persistAdvice();
                return off.persistent;
            }, function () { off.persistent = false; refreshInfo(); return false; });
        }, function () { return null; });
    }

    function estimate() {
        if (!navigator.storage || !navigator.storage.estimate) return Promise.resolve(null);
        return navigator.storage.estimate().then(function (e) {
            off.quota = (e && e.quota) || 0;
            off.usage = (e && e.usage) || 0;
            console.log('[offline] 本机存储占用 ' + mb(off.usage) + ' / 配额 ' + mb(off.quota) +
                '（含模型权重、离线语音、页面缓存）');
            refreshInfo();
            return e;
        }, function () { return null; });
    }

    /* ==================================================================================
       换了「地址 + 目录」就提醒：缓存按这个组合隔离 —— GitHub Pages 上仓库改名 / 换部署目录、
       本地在 127.0.0.1 与局域网 IP 之间切换，都会让缓存对不上，等于重新下一次
       ================================================================================== */
    function scopeCheck() {
        var now = scopeNow(), last = null;
        try { last = window.localStorage.getItem(CFG.scopeKey); } catch (e) { }
        try { window.localStorage.setItem(CFG.scopeKey, now); } catch (e) { }
        if (last && last !== now) {
            var sameHost = last.split('/')[2] === now.split('/')[2];
            tip('你换了访问地址：<b>' + last + '</b> → <b>' + now + '</b><br>' +
                '浏览器缓存是按「地址 + 目录」隔离的，所以这次要重新下载一次模型（约 276MB、含语音共约 345MB）。<br>' +
                (sameHost
                    ? '同一个域名下换目录（比如仓库改名 / 换部署路径）也会这样 —— 固定用一个地址最省事。'
                    : (deployKind() === 'pages'
                        ? '建议统一用 GitHub Pages 那个 https 地址打开。'
                        : '推荐固定用 <code>http://127.0.0.1:8000/human.html</code>；手机用局域网 IP 时属于另一套缓存，两边各下一次。')));
            return false;
        }
        return true;
    }

    /* ==================================================================================
       对外接口
       ================================================================================== */
    window.lisaOffline = {
        config: CFG,
        supported: off.supported,
        assets: assets,                       /* 当前会缓存哪些文件（数组） */
        precache: precache,                   /* lisaOffline.precache(true) 手动重新预下载 */
        clear: clearCache,                    /* 清空离线缓存（下次会重新下） */
        cancel: function () { return post2sw({ type: 'cancel' }); },
        state: function () {
            return {
                supported: off.supported, secure: off.secure, version: off.version,
                deploy: deployKind(), scope: scopeNow(), standalone: isStandalone(),
                autoPrecache: CFG.autoPrecache,
                precaching: off.precaching, done: off.done, total: off.total,
                bytes: off.bytes, bytesTotal: off.bytesTotal,
                entries: off.entries, cachedBytes: off.cachedBytes,
                failed: off.failed, persistent: off.persistent,
                quota: off.quota, usage: off.usage, lastError: off.lastError,
                ios: isIOS(), origin: location.origin
            };
        },
        estimate: estimate,
        persist: persist,
        sw: function () { return off.reg; }
    };

    /* ==================================================================================
       初始化
       ================================================================================== */
    if (off.supported) {
        try { navigator.serviceWorker.addEventListener('message', onSWMessage); } catch (e) { }
    }
    scopeCheck();
    persist().then(estimate);
    refreshInfo();

    if (elBtnNow) elBtnNow.onclick = function () { precache(true); };
    if (elBtnClear) elBtnClear.onclick = function () { clearCache(); };

    /* 预下载什么时候开始（CFG.autoPrecache）：
       'gesture'（默认）= 等用户第一次点击 / 按键 —— GitHub Pages 上每次全新访问就是 345MB 流量，
                          只有真正用的人才会触发，爬虫 / 路人不会；
       'now'             = 打开就下（本地自建服务合适）；
       false             = 不自动下，只认面板按钮 / lisaOffline.precache() */
    function armAutoPrecache() {
        if (!CFG.autoPrecache) return;
        if (CFG.autoPrecache === 'now') {
            window.setTimeout(function () { if (!off.precaching) precache(); }, CFG.autoPrecacheDelayMs);
            return;
        }
        function onGesture() {
            window.removeEventListener('pointerdown', onGesture, true);
            window.removeEventListener('keydown', onGesture, true);
            window.setTimeout(function () { if (!off.precaching) precache(); }, CFG.precacheGestureDelayMs);
        }
        window.addEventListener('pointerdown', onGesture, true);
        window.addEventListener('keydown', onGesture, true);
    }

    if (off.supported && CFG.enabled) {
        ensureSW().then(function (sw) {
            if (!sw) return;
            console.log('[offline] 离线缓存已启用（Service Worker 版本 ' + (sw.state || 'active') +
                '，部署环境 ' + deployKind() + '）：页面、脚本、模型权重、离线语音都会留在本机，' +
                '第二次打开不再下载（预下载时机：' + CFG.autoPrecache + '）。');
            post2sw({ type: 'state' });
            armAutoPrecache();
            /* iPad / iPhone 的 Safari 有「7 天没访问就清站点存储」的策略，先提醒一次 */
            if (isIOS() && !isStandalone()) window.setTimeout(persistAdvice, 6000);
        });
    } else if (!off.secure) {
        console.warn('[offline] 当前不是安全上下文（需要 https 或 http://localhost / 127.0.0.1），' +
            '离线缓存不可用 —— 模型只能靠浏览器自身的 HTTP / IndexedDB 缓存。' +
            (deployKind() === 'pages'
                ? 'GitHub Pages 是 https，本来就满足条件。'
                : '这很可能就是「每次打开都重新下载」的原因：换回 https 或 http://127.0.0.1:8000/human.html 即可。'));
    }
})();
