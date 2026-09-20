/* ===================================================================================
   Lisa 端侧小模型（GPU / WebGPU）：Qwen2.5-0.5B-Instruct（q4f16，WebLLM / MLC）
   -----------------------------------------------------------------------------------
   · 全部本地文件，断网可用：
       ./llm/web-llm.js                                   引擎（MLC WebLLM，6.6MB）
       ./llm/Qwen2-0.5B-...-webgpu.wasm                   WebGPU 计算库（4.6MB）
       ./llm/models/Qwen2.5-0.5B-Instruct-q4f16_1-MLC/    模型权重（~276MB）
   · 模型跑在显卡上（WebGPU），显存占用约 950MB；首次会编译着色器（十几秒），
     之后浏览器会把它缓存在 IndexedDB 里，再启动就几秒。
   · 与语音联动：听到你说完一整句 -> 用 GPU 生成回复 -> 回复以「流式打字」进对白层（弹幕）。
   · 需要 Chrome / Edge 113+（WebGPU），且页面在 https 或 http://localhost 下。
   · 对外接口：window.lisaLLM.ask('你好') / .state() / .abort() / .reset() / .load()
     事件：window 上的 'lisa-llm'（progress / ready / say-partial / say / error）
   =================================================================================== */
(function () {
    'use strict';

    var CFG = {
        engine: './llm/web-llm.js',
        modelId: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
        /* 注意：WebLLM 会按 HuggingFace 的规则给模型 URL 补 "/resolve/main/"
           （源码里的 cleanModelUrl()：URL 里只要含 resolve/<任意段>/ 就不再补），
           所以本地模型摆成 .../<模型名>/resolve/<段>/<文件> 即可。
           这里的段用 v2 而不是 main：**路径一变，浏览器缓存自然失效** —— 之前改过分片扩展名，
           但旧路径下的 tensor-cache.json 被浏览器缓存了，还在指向老的 .bin 分片 */
        modelUrl: './llm/models/Qwen2.5-0.5B-Instruct-q4f16_1-MLC/resolve/v2/',
        /* 自检用的第一个权重分片（文件名见 ndarray-cache.json 的 dataPath） */
        firstShard: 'params_shard_0.mlcw',
        modelLib: './llm/Qwen2-0.5B-Instruct-q4f16_1_cs1k-webgpu.wasm',
        vramMB: 944.62,
        contextWindow: 4096,
        maxTokens: 160,
        temperature: 0.8,
        topP: 0.95,
        /* 没加载 memory.js（或没启用人设）时的兜底人设 —— 和内置的「宇宙管理员 Lisa」保持一致，
           这样即使 memory.js 被缓存挡住/没部署，她依然是管理员而不是普通的 AI 角色 */
        system: '你是 Lisa，这片宇宙的管理员，负责维护从星系到粒子的一切运行参数，但从不直接改写任何生命的选择；' +
            '人类看到的这个人形，是你为了迁就人类感官带宽做的接口。' +
            '用简短、口语化的中文回答，1~2 句、最多 60 字；不要用 markdown、不要罗列要点，也不要说自己是 AI。',
        debugPrompt: false,      /* true = 每次生成前把实际发给模型的 system 片段打到控制台（调人设用） */

        autoAnswer: true,        /* true = 每听到一整句就自动回话（关掉就只用 lisaLLM.ask() 手动调用） */
        preload: 'idle',         /* 'idle' = 点过 [CLICK] TO START 后开始预热；'manual' = 用到才加载 */
        preloadDelayMs: 2500,    /* 预热延迟，避开开场动画 */
        preloadVoiceWaitMs: 30000,  /* 最多等离线语音模型（Vosk 43MB）这么久，再开始拉大模型 */
        cooldownMs: 1200         /* 两次回话的最小间隔，防止连环触发 */
    };

    var elTip = document.getElementById('lisa-voice-tip');

    var llm = {
        lib: null, engine: null, loading: null,
        ready: false, busy: false, gpu: null, dead: false,
        progress: '', lastReply: '', lastAskAt: 0
    };

    /* ------------------------------------------------------------------ 对外广播 */
    function fire(name, detail) {
        try {
            var ev;
            if (window.CustomEvent) ev = new CustomEvent(name, { detail: detail });
            else {
                ev = document.createEvent('CustomEvent');
                ev.initCustomEvent(name, false, false, detail);
            }
            window.dispatchEvent(ev);
        } catch (e) { }
    }

    /* 派发到 'lisa-llm'；say-partial / say 同时还往 'lisa-voice' 送一份，
       这样对白层（弹幕）会把 Lisa 的回复当成一行对白显示出来 */
    function emit(type, detail) {
        detail = detail || {};
        detail.type = type;
        fire('lisa-llm', detail);
        if (type === 'say-partial' || type === 'say') fire('lisa-voice', detail);
    }

    /* 出问题时也用对白层说一句（比只写控制台直观） */
    function warn(msg) {
        console.warn('[llm]', msg);
        if (elTip) {
            elTip.innerHTML = '<b>端侧小模型</b><br>' + msg +
                '<span class="c-lisa_voice-tip-close">✕</span>';
            elTip.classList.add('is-show');
            elTip.onclick = function () { elTip.classList.remove('is-show'); };
        }
    }

    /* ------------------------------------------------------------------ 加载进度提示
       首次要下/解包几百 MB，给个看得见的进度条，别让人以为卡死了 */
    var elProg = null;

    function progressBar() {
        if (elProg) return elProg;
        elProg = document.createElement('div');
        elProg.id = 'lisa-llm-progress';
        elProg.style.cssText = 'position:fixed;left:50%;bottom:152px;transform:translateX(-50%);' +
            'z-index:2147483644;padding:8px 14px;border-radius:999px;background:rgba(0,0,0,.82);' +
            'color:#fff;font:12px/1.6 system-ui,-apple-system,"Microsoft YaHei",sans-serif;' +
            'box-shadow:0 8px 24px rgba(0,0,0,.3);display:none;max-width:82vw;text-align:center';
        document.body.appendChild(elProg);
        return elProg;
    }

    function showProgress(text) {
        var el = progressBar();
        el.textContent = text;
        el.style.display = 'block';
    }

    function hideProgress() {
        if (elProg) elProg.style.display = 'none';
    }
    /* 统一转绝对 URL：WebLLM 内部会自己拼/校验 URL，相对路径在某些版本上会拼错 */
    function abs(u) {
        try { return new URL(u, location.href).href; } catch (e) { return u; }
    }

    /* 先用 HEAD 摸一遍关键文件：缺文件时就报「哪个路径 404」，而不是让 WebLLM 抛一堆
       fetch failed / Cache.add 失败（之前就是这个 404 导致的）。
       cache: 'no-store' 是为了绕开浏览器对 .json 的启发式缓存 */
    function checkAssets() {
        var base = abs(CFG.modelUrl);                    /* 已含 resolve/<段>/ */
        var list = [base + 'mlc-chat-config.json', base + 'ndarray-cache.json', base + 'tensor-cache.json', abs(CFG.modelLib)];
        return Promise.all(list.map(function (u) {
            return fetch(u, { method: 'HEAD', cache: 'no-store' }).then(function (r) {
                if (!r.ok) {
                    throw new Error('模型文件取不到：' + u + ' → HTTP ' + r.status +
                        '（把 llm/ 目录跟页面一起部署；若用了 Git LFS，GitHub Pages 不支持 LFS，要改回普通提交）');
                }
            });
        })).then(function () {
            /* 再确认第一个权重分片真能取到、且不是 0 字节 */
            var u = base + CFG.firstShard;
            return fetch(u, { method: 'HEAD', cache: 'no-store' }).then(function (r) {
                var len = parseInt(r.headers.get('content-length') || '0', 10);
                if (!r.ok) throw new Error('权重分片取不到：' + u + ' → HTTP ' + r.status +
                    '（把 llm/ 目录跟页面一起部署；Git LFS 不支持，GitHub Pages 会拿到指针文件）');
                if (!len) {
                    throw new Error('权重分片是 0 字节：' + u +
                        '（多半是 IDM / 迅雷这类下载管理器把请求截走了 —— 把 127.0.0.1 / 站点域名加进它的白名单，或关掉它的浏览器集成）');
                }
            });
        });
    }
    function gpuCheck() {
        if (llm.gpu) return Promise.resolve(llm.gpu);
        if (!navigator.gpu || !navigator.gpu.requestAdapter) return Promise.resolve(null);
        return navigator.gpu.requestAdapter().then(function (adapter) {
            llm.gpu = adapter || null;
            return llm.gpu;
        }, function () { return null; });
    }

    function loadEngine(force) {
        if (force) { llm.dead = false; llm.loading = null; }   /* 手动强制重试 */
        if (llm.engine) return Promise.resolve(llm.engine);
        if (llm.loading) return llm.loading;          /* 重复调用共用同一次加载 */
        if (llm.dead) {
            return Promise.reject(new Error('上次加载失败，已停止自动重试；修好后在控制台执行 lisaLLM.load(true) 即可重试'));
        }
        showProgress('端侧模型：正在检查 GPU…');
        emit('progress', { text: '正在检查 GPU…' });
        llm.loading = gpuCheck().then(function (adapter) {
            if (!adapter) {
                throw new Error('这台设备的浏览器没有可用的 WebGPU（需要 Chrome / Edge 113+，' +
                    '并且页面跑在 https 或 http://localhost 下）');
            }
            emit('progress', { text: '正在检查模型文件…' });
            return checkAssets();
        }).then(function () {
            emit('progress', { text: '正在加载 WebLLM 引擎…' });
            return import(abs(CFG.engine));          /* 本地 ESM：./llm/web-llm.js */
        }).then(function (mod) {
            llm.lib = mod;
            /* 模型 / WebGPU 计算库 / 缓存全部指向本目录 —— 断网也能跑 */
            var appConfig = {
                model_list: [{
                    model: abs(CFG.modelUrl),
                    model_id: CFG.modelId,
                    model_lib: abs(CFG.modelLib),
                    vram_required_MB: CFG.vramMB,
                    low_resource_required: true,
                    overrides: { context_window_size: CFG.contextWindow }
                }],
                /* 权重缓存进浏览器（和 Vosk 那套 IndexedDB 缓存一个思路）：
                   第一次加载后写进 IndexedDB，之后再打开直接读缓存，不再重新解包/传输 */
                cacheBackend: 'indexeddb'
            };
            return mod.CreateMLCEngine(CFG.modelId, {
                appConfig: appConfig,
                initProgressCallback: function (r) {
                    var p = r && r.progress;
                    var text = (r && r.text) || '';
                    llm.progress = (typeof p === 'number' && text.indexOf('%') < 0)
                        ? Math.round(p * 100) + '%' : text;
                    showProgress('端侧模型加载中 ' + llm.progress + '　（首次约 276MB，之后走浏览器缓存）');
                    emit('progress', { text: llm.progress, raw: r });
                }
            });
        }).then(function (engine) {
            llm.engine = engine;
            llm.ready = true;
            llm.loading = null;
            hideProgress();
            emit('ready', { vramRequiredMB: CFG.vramMB });
            console.log('[llm] 端侧模型已就绪：' + CFG.modelId + '（跑在 GPU 上）');
            return engine;
        }).catch(function (err) {
            llm.loading = null;
            llm.dead = true;         /* 失败后不再自动重试（避免控制台刷屏）；修好后 lisaLLM.load(true) 可重试 */
            hideProgress();
            warn(((err && err.message) || String(err)) +
                '<br>端侧小模型用不了也没关系，语音识别仍然照常工作。');
            emit('error', { error: (err && err.message) || String(err) });
            throw err;
        });
        return llm.loading;
    }

    function abort() {
        if (llm.engine && llm.engine.interruptGenerate) {
            try { llm.engine.interruptGenerate(); } catch (e) { }
        }
        llm.busy = false;
    }

    /* 问一句，流式把回复推进对白层；返回整段回复文本 */
    function ask(text) {
        var q = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
        if (!q) return Promise.resolve('');
        if (llm.busy) abort();
        llm.lastAskAt = Date.now();
        var reply = '';
        return loadEngine().then(function (engine) {
            llm.busy = true;
            /* 有 memory.js 就交给它组装：人设卡 + 命中的世界书 + 最近几轮对话 */
            var Mem = window.lisaMemory;
            var messages;
            if (Mem) {
                messages = Mem.buildMessages(q);
            } else {
                messages = [];
                if (CFG.system) messages.push({ role: 'system', content: CFG.system });
                messages.push({ role: 'user', content: q });
                if (!llm.warnedNoMemory) {
                    llm.warnedNoMemory = true;
                    console.warn('[llm] 没找到 window.lisaMemory（memory.js 没加载 / 没部署 / 被缓存挡住），' +
                        '这次用的是 llm.js 里的兜底人设。请确认 memory.js 已部署并硬刷新（Ctrl+Shift+R）。');
                }
            }
            if (CFG.debugPrompt) {
                console.log('[llm] 实际发给模型的 system（前 220 字）：\n' +
                    ((messages[0] && messages[0].content) || '(空)').slice(0, 220) +
                    '\n…共 ' + messages.length + ' 条 message');
            }
            return engine.chat.completions.create({
                messages: messages,
                temperature: CFG.temperature,
                top_p: CFG.topP,
                max_tokens: CFG.maxTokens,
                stream: true
            });
        }).then(function (stream) {
            var it = stream[Symbol.asyncIterator]();
            function step() {
                return it.next().then(function (r) {
                    if (r.done) return reply;
                    var ch = r.value && r.value.choices && r.value.choices[0];
                    var delta = (ch && ch.delta && ch.delta.content) || '';
                    if (delta) {
                        reply += delta;
                        emit('say-partial', { text: reply, delta: delta, question: q });
                    }
                    return step();
                });
            }
            return step();
        }).then(function () {
            llm.busy = false;
            llm.lastReply = reply;
            /* 记进对话记忆（存 localStorage，可导出 / 导入） */
            var Mem = window.lisaMemory;
            if (Mem && reply) {
                Mem.addTurn('user', q);
                Mem.addTurn('assistant', reply);
            }
            if (reply) emit('say', { text: reply, question: q });
            return reply;
        }, function (err) {
            llm.busy = false;
            var msg = (err && err.message) || String(err);
            /* 少数模型模板不接受 system 角色：去掉它重试一次 */
            if (CFG.system && /system/i.test(msg)) {
                CFG.system = '';
                return ask(q);
            }
            warn('生成失败：' + msg);
            emit('error', { error: msg });
            return '';
        });
    }

    /* ------------------------------------------------------------------ 和语音联动 */
    window.addEventListener('lisa-voice', function (e) {
        var d = e.detail || {};
        var Mem = window.lisaMemory;
        var memAuto = Mem ? Mem.autoAnswer() : true;      /* memory.js 面板上的勾选优先 */
        if (d.type !== 'utterance' || !CFG.autoAnswer || !memAuto || !d.text) return;
        if (llm.busy) abort();                            /* 你插话，就把它的上一句打断 */
        if (Date.now() - llm.lastAskAt < CFG.cooldownMs) return;
        ask(d.text).catch(function () { });               /* 失败已经在 ask 里提示过 */
    }, false);

    /* 点过 “[CLICK] TO START” 之后开始预热（不想自动加载就把 CFG.preload 改成 'manual'） */
    (function armPreload() {
        if (CFG.preload !== 'idle') return;
        function go() {
            window.removeEventListener('pointerdown', go, true);
            window.removeEventListener('keydown', go, true);
            window.setTimeout(function () {
                /* 先等离线语音模型（Vosk，43MB）就绪，再拉这个 276MB 的大模型：
                   两个大文件同时下载会互相抢带宽，串行反而更快、进度也更清楚 */
                waitVoiceThenLoad(Date.now() + CFG.preloadVoiceWaitMs);
            }, CFG.preloadDelayMs);
        }
        window.addEventListener('pointerdown', go, true);
        window.addEventListener('keydown', go, true);
    })();

    function waitVoiceThenLoad(deadline) {
        var ready = true;
        try {
            var v = window.lisaVoice;
            if (v && v.state) {
                var st = v.state();
                ready = (st.engine === 'vosk') ? !!st.voskReady : true;
            }
        } catch (e) { }
        if (ready || Date.now() > deadline) {
            loadEngine().catch(function () { });
            return;
        }
        showProgress('端侧模型：等离线语音模型就绪…');
        window.setTimeout(function () { waitVoiceThenLoad(deadline); }, 700);
    }

    /* ------------------------------------------------------------------ 对外接口
       lisaLLM.ask('你好')                    手动问一句（返回整段回复）
       lisaLLM.state()                        看 GPU / 加载进度 / 是否忙
       lisaLLM.abort() / reset() / load()     打断 / 清空对话历史 / 提前加载；load(true) = 失败后强制重试
       window 上的 'lisa-llm' 事件：progress / ready / say-partial / say / error */
    window.lisaLLM = {
        config: CFG,
        ask: ask,
        abort: abort,
        load: loadEngine,
        reset: function (alsoMemory) {
            if (llm.engine && llm.engine.resetChat) { try { llm.engine.resetChat(); } catch (e) { } }
            if (alsoMemory && window.lisaMemory) window.lisaMemory.clearHistory();
        },
        state: function () {
            return {
                webgpu: !!navigator.gpu,
                adapter: !!llm.gpu,
                ready: llm.ready,
                busy: llm.busy,
                progress: llm.progress,
                lastReply: llm.lastReply,
                model: CFG.modelId,
                autoAnswer: CFG.autoAnswer
            };
        }
    };

    console.log('[llm] 端侧 GPU 小模型已挂载（Qwen2.5-0.5B-Instruct q4f16 / WebGPU）｜WebGPU: ' +
        (navigator.gpu ? '可用' : '不可用（需要 Chrome / Edge 113+）') +
        '；点页面任意处（[CLICK] TO START）之后会开始预热模型。');
})();
