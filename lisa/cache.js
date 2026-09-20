/* ===================================================================================
   Lisa 离线缓存（页面侧）：让「下载过一次的东西，永远留在本机」
   -----------------------------------------------------------------------------------
   和 ./sw.js（Service Worker）配合，解决「每次打开网页都在重新下载」：

   1) 申请「持久化存储」：navigator.storage.persist()
      —— 浏览器磁盘紧张时会自动清理「尽力而为」型的存储，一清就得重下；
         拿到持久化授权后，Cache Storage / IndexedDB（模型权重、离线语音）都不会被清
   2) 注册 Service Worker（./sw.js）：把页面、脚本、3D 资源、离线识别模型、
      大模型权重统统收进浏览器 Cache Storage；之后**一个字节都不用再从网络取**
      （断网也能打开、也能跑）
   3) 一次性预下载：自动把全部资源拉到本机，底部进度条显示「已缓存 xx / yy MB」，
      已经缓存过的直接跳过 —— 所以第二次打开是 0 下载、几秒就绪
   4) 换地址 = 换缓存（这条最容易被忽略）：浏览器缓存按「协议+主机+端口」隔离，
      http://127.0.0.1:8000 和 http://192.168.x.x:8000 是**两套完全独立的缓存**。
      用了新地址就等于重新下载一遍 —— 这里会检测并提醒你固定用一个地址。

   对外接口：window.lisaOffline.state() / .precache() / .clear() / .estimate()
             / .config（可改参数）/ .assets()（看看清单里有什么）
   事件：window 上的 'lisa-offline' —— { type: 'progress' | 'done' | 'state' | 'error', … }
   =================================================================================== */
(function () {
    'use strict';

    /* ------------------------------------------------------------------ 可调参数 */
    var CFG = {
        swUrl: './sw.js',
        enabled: true,              /* false = 不用 Service Worker（退回浏览器自己的缓存机制） */
        autoPrecache: true,         /* true = 打开页面后自动把全部资源预下载到本机 */
        autoPrecacheDelayMs: 4000,  /* 延迟一点再开始，别和开场动画 / 模型预热抢带宽 */
        cacheWeights: true,         /* 是否把大模型权重（约 276MB）也收进离线缓存：
                                       true  = 万无一失（WebLLM 自己的 IndexedDB 被清掉也能本地取）
                                       false = 少占一份磁盘，权重只靠 WebLLM 的 IndexedDB */
        cacheVosk: true,            /* 是否把离线语音模型（约 49MB）也收进离线缓存 */
        /* 一定会缓存的本地文件（3D / 声音 / 图标 / 字体；脚本与样式会自动从页面里读） */
        always: ['./lisa.glb', './envmap.exr', './running_code.mp4', './ambient.mp3',
            './favicon-32x32.png', './HelveticaNowDisplay-Regular.woff2', './PPLocomotiveNew-Light.woff2'],
        extra: [],                  /* 想额外缓存的相对路径写这里 */
        originKey: 'lisa-offline-origin',   /* 记住上次用的访问地址（换地址要提醒） */
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
        persistent: null, quota: 0, usage: 0, lastError: '', warned: false
    };

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
                (off.persistent === true ? '　·　已持久化' : (off.persistent === false ? '　·　未持久化' : '')))
            : (off.secure ? '这台浏览器不支持 Service Worker' :
                '当前地址不是安全上下文（用 127.0.0.1 或 https 打开才有离线缓存）');
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
    function persist() {
        if (!navigator.storage || !navigator.storage.persist) { refreshInfo(); return Promise.resolve(null); }
        return navigator.storage.persisted().then(function (already) {
            if (already) { off.persistent = true; refreshInfo(); return true; }
            return navigator.storage.persist().then(function (ok) {
                off.persistent = !!ok;
                refreshInfo();
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
       换地址提醒：缓存按「协议 + 主机 + 端口」隔离，换了地址就等于换了一整套缓存，
       这正是「每次打开都在重新下载」最常见的原因（127.0.0.1 与局域网 IP 是两套）
       ================================================================================== */
    function originCheck() {
        var now = location.origin, last = null;
        try { last = window.localStorage.getItem(CFG.originKey); } catch (e) { }
        try { window.localStorage.setItem(CFG.originKey, now); } catch (e) { }
        if (last && last !== now) {
            tip('你换了访问地址：<b>' + last + '</b> → <b>' + now + '</b><br>' +
                '浏览器缓存按地址隔离，所以这次要重新下载一次模型（约 276MB）。<br>' +
                '固定用一个地址就不会重复下载 —— 推荐 <code>http://127.0.0.1:8000/human.html</code>' +
                '（手机用局域网 IP 时属于另一套缓存，两边各下一次）。');
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
                precaching: off.precaching, done: off.done, total: off.total,
                bytes: off.bytes, bytesTotal: off.bytesTotal,
                entries: off.entries, cachedBytes: off.cachedBytes,
                failed: off.failed, persistent: off.persistent,
                quota: off.quota, usage: off.usage, lastError: off.lastError,
                origin: location.origin
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
    originCheck();
    persist().then(estimate);
    refreshInfo();

    if (elBtnNow) elBtnNow.onclick = function () { precache(true); };
    if (elBtnClear) elBtnClear.onclick = function () { clearCache(); };

    if (off.supported && CFG.enabled) {
        ensureSW().then(function (sw) {
            if (!sw) return;
            console.log('[offline] 离线缓存已启用（Service Worker 版本 ' + (sw.state || 'active') +
                '）：页面、脚本、模型权重、离线语音都会留在本机，第二次打开不再下载。');
            post2sw({ type: 'state' });
            if (CFG.autoPrecache) {
                window.setTimeout(function () {
                    if (!off.precaching) precache();
                }, CFG.autoPrecacheDelayMs);
            }
        });
    } else if (!off.secure) {
        console.warn('[offline] 当前不是安全上下文（需要 https 或 http://localhost / 127.0.0.1），' +
            '离线缓存不可用 —— 模型只能靠浏览器自身的 HTTP / IndexedDB 缓存。' +
            '这很可能就是「每次打开都重新下载」的原因：换回 http://127.0.0.1:8000/human.html 即可。');
    }
})();
