/* ===================================================================================
   Lisa 语音播报（TTS）：把她的回复念出来，让「对话」真的能听见
   -----------------------------------------------------------------------------------
   · 数据源：window 上的 'lisa-voice' 事件里 type = 'say-partial' / 'say' 的那两种
       - llm.js（端侧小模型）的回复是流式吐字的：say-partial 反复推「到目前为止的整段回复」，
         这里只取新长出来的那一段，按标点切成一句一句，**边生成边念**；say 到达时把尾巴念完
       - memory.js（人设的开场白）直接推一条 say，那就整段念
   · 引擎（CFG.engine）：
       'webspeech'（默认）= 浏览器内置的 SpeechSynthesis：Windows / macOS / Android 都自带
                            中文音色，本机合成、断网可用、零依赖，**不新增任何文件**
       'server'     = 自己起的本地 TTS 服务（GPT-SoVITS / edge-tts / ChatTTS / CosyVoice…）：
                      POST {text,voice,rate,pitch}，收音频二进制回来播，音色更自然但要有服务
   · 不吵到自己（关键）：她一开口，麦克风必然会把扬声器里的她收进去。所以播报期间会调用
     asr.js 的静默闸门 window.lisaVoice.hold(true)：这段识别结果不提交（llm.js 不会回话）、
     对白层不显示；播完（或被打断）后自动 hold(false)。另外每次起播后 CFG.guardMs 内忽略
     语音事件，防止回声一上来就误打断。
   · 打断：CFG.bargeIn = true 时，你一开口就立刻停下她的播报（真实对话感）。
     默认关闭：音箱外放时她会听到自己，容易被自己的声音打断；戴耳机可以打开它。
   · 界面：右下角喇叭按钮 —— 单击 = 开 / 关播报；长按（约 0.6s）或右键 = 音色面板
     （音色 / 语速 / 音调 / 试听 / 停止）；设置存在 localStorage['lisa-tts-v1']，刷新不丢。
   · 对外接口：window.lisaTTS.speak('…') / .stop() / .on() / .off() / .toggle()
               .voices() / .setVoice(名字) / .panel(true) / .test() / .state()
     事件：window 上的 'lisa-tts' —— { type: 'sentence' | 'end' | 'error' | 'state', … }
   =================================================================================== */
(function () {
    'use strict';

    /* ------------------------------------------------------------------ 可调参数 */
    var CFG = {
        engine: 'webspeech',    /* 'webspeech' = 浏览器内置合成（离线、零依赖）
                                   'server'    = 本地 TTS 服务（见下面的 server.*，音色更好） */
        lang: 'zh-CN',          /* 期望的语音；挑音色 / 建 utterance 都用它 */
        /* 自动挑音色时的偏好顺序（越靠前越优先，按名字片段匹配，不区分大小写）：
           Windows 常见的中文音色是 Microsoft Xiaoxiao / Xiaoyi / Yunxi / Huihui，
           macOS 是 Tingting / 婷婷，Chrome 自带的是 Google 普通话 */
        voiceHints: ['xiaoxiao', '晓晓', 'xiaoyi', '晓伊', 'yunxi', '云希', 'yunyang', '云扬',
            'huihui', '慧慧', 'tingting', '婷婷', 'meijia', '美佳', 'yaoyao', '瑶瑶',
            'google', '中文', 'chinese', 'mandarin'],
        voiceName: '',          /* 指定音色（面板里选的会写进这里；留空 = 按 voiceHints 自动挑） */
        preferLocal: true,      /* 优先挑「本机离线」音色（不把文字送去云端合成） */
        rate: 1.06,             /* 语速，0.5 ~ 2 */
        pitch: 1.06,            /* 音调，0 ~ 2（略高一点，更像那个人形接口） */
        volume: 1,              /* 播报音量 0 ~ 1（和右下角那个环境音开关互不影响） */

        enabled: true,          /* 默认开着：她一有回复就念出来 */
        autoSpeak: true,        /* false = 只认手动 lisaTTS.speak(...)，不自动念回复 */
        streamSpeech: true,     /* true = 边生成边念（按标点断句）；false = 等整段生成完再念 */
        stripText: true,        /* 念之前清洗文本（markdown、括号动作、emoji、链接…） */
        minChunkChars: 6,       /* 短于这个字数的一句先攒着，和后面并起来念 */
        maxChunkChars: 110,     /* 单次最多念多少字（模型飙长句时退到最近的逗号处切开） */
        sentenceGapMs: 150,     /* 句与句之间的停顿（毫秒），像人说话换气 */
        firstDelayMs: 220,      /* 收到第一段文字后先等一会儿（多攒几个字再开口，语气更连贯） */

        guardMs: 900,           /* 每次起播后这段时间内忽略语音事件（防回声误打断） */
        bargeIn: false,         /* true = 你开口就打断她的播报（耳机下推荐）；false = 等她说完 */
        selfListen: true,       /* true = 播报期间用 asr.js 的静默闸门按住提交，避免自己跟自己聊 */
        holdReleaseMs: 350,     /* 播完之后多久恢复「接收你说的语音」 */
        maxQueue: 6,            /* 待念的句子最多堆几条，超了丢最早的一句 */
        longPressMs: 600,       /* 长按喇叭按钮多久算「长按」（= 打开音色面板；右键同效） */

        storageKey: 'lisa-tts-v1',
        /* 引擎二：本地 TTS 服务（CFG.engine = 'server' 时才用；留空 url 会在界面上提示） */
        server: {
            url: '',            /* 例：'http://127.0.0.1:9880/tts'，POST JSON，响应体是音频 */
            voice: '',          /* 服务端音色 id，原样透传（按你的服务约定） */
            format: 'wav',
            timeoutMs: 15000
        }
    };

    /* ------------------------------------------------------------------ DOM */
    var elBtn = document.getElementById('lisa-tts');
    var elPanel = document.getElementById('lisa-tts-panel');
    var elClose = document.getElementById('lisa-tts-close');
    var elSel = document.getElementById('lisa-tts-voice');
    var elRate = document.getElementById('lisa-tts-rate');
    var elRateVal = document.getElementById('lisa-tts-rate-val');
    var elPitch = document.getElementById('lisa-tts-pitch');
    var elPitchVal = document.getElementById('lisa-tts-pitch-val');
    var elTest = document.getElementById('lisa-tts-test');
    var elStopBtn = document.getElementById('lisa-tts-stop');
    var elRefresh = document.getElementById('lisa-tts-refresh');
    var elInfo = document.getElementById('lisa-tts-info');
    var elTip = document.getElementById('lisa-voice-tip');     /* 复用语音输入那条顶部提示条 */
    var elMemPanel = document.getElementById('lisa-memory');   /* 两个面板位置重叠，开一个收一个 */

    /* ------------------------------------------------------------------ 状态 */
    var synth = window.speechSynthesis || null;
    var tts = {
        supported: !!(synth && window.SpeechSynthesisUtterance),
        enabled: CFG.enabled,          /* 用户开关（按钮 / 面板改它） */
        voices: [], voice: null,
        queue: [], playing: false,
        seq: 0,                        /* 播放代次：stop() 之后所有老回调直接作废 */
        watchdog: 0, warned: false, lastError: '', text: ''
    };
    var gate = { on: false, timer: 0 };            /* 静默闸门（asr.js 那边的 hold） */
    var stream = { full: '', seen: 0, buf: '', pending: false, timer: 0 };
    var press = { timer: 0, long: false };         /* 按钮长按识别 */
    var guardUntil = 0;                            /* 起播保护窗口的截止时间 */

    /* ------------------------------------------------------------------ 工具 */
    function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

    function fire(type, detail) {
        detail = detail || {};
        detail.type = type;
        try {
            var ev;
            if (window.CustomEvent) ev = new CustomEvent('lisa-tts', { detail: detail });
            else {
                ev = document.createEvent('CustomEvent');
                ev.initCustomEvent('lisa-tts', false, false, detail);
            }
            window.dispatchEvent(ev);
        } catch (e) { }
    }

    /* 出问题才出现的顶部提示条（和 asr.js / llm.js 共用同一个 DOM） */
    function tip(msg) {
        console.warn('[tts]', String(msg).replace(/<[^>]+>/g, ''));
        if (!elTip) return;
        elTip.innerHTML = '<b>语音播报</b><br>' + msg +
            '<span class="c-lisa_voice-tip-close">✕</span>';
        elTip.classList.add('is-show');
        elTip.onclick = function () { elTip.classList.remove('is-show'); };
    }

    /* ------------------------------------------------------------------ 设置持久化（localStorage，和 memory.js 一个思路） */
    function save() {
        try {
            window.localStorage.setItem(CFG.storageKey, JSON.stringify({
                enabled: tts.enabled, engine: CFG.engine, voiceName: CFG.voiceName,
                rate: CFG.rate, pitch: CFG.pitch
            }));
        } catch (e) { }
    }

    function load() {
        var raw = null;
        try { raw = window.localStorage.getItem(CFG.storageKey); } catch (e) { }
        if (!raw) return;
        var o;
        try { o = JSON.parse(raw) || {}; } catch (e) { return; }
        if (typeof o.enabled === 'boolean') tts.enabled = o.enabled;
        if (typeof o.voiceName === 'string') CFG.voiceName = o.voiceName;
        if (typeof o.rate === 'number') CFG.rate = clamp(o.rate, 0.5, 2);
        if (typeof o.pitch === 'number') CFG.pitch = clamp(o.pitch, 0, 2);
        if (o.engine === 'webspeech' || o.engine === 'server') CFG.engine = o.engine;
    }

    /* ==================================================================================
       文本清洗：把「看着好看、念出来难听」的东西去掉
       （人设已经要求口语化了，但模型偶尔还是会带 **强调**、（笑）、emoji、链接、列表符号）
       ================================================================================== */
    function clean(text) {
        var t = String(text == null ? '' : text);
        t = t.replace(/```[\s\S]*?```/g, ' ');                  /* 代码块 */
        t = t.replace(/`([^`]*)`/g, '$1');                      /* 行内代码 */
        t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');            /* 图片 */
        t = t.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');          /* 链接：只念文字 */
        t = t.replace(/https?:\/\/\S+|www\.\S+/gi, ' ');
        t = t.replace(/^\s{0,3}#{1,6}\s*/gm, ' ');              /* 标题号 */
        t = t.replace(/^\s{0,3}[-*+•]\s+/gm, ' ');              /* 列表符号 */
        t = t.replace(/^\s{0,3}>\s?/gm, ' ');                   /* 引用号 */
        t = t.replace(/（[^）]{0,40}）|\([^)]{0,40}\)/g, ' ');   /* 括号里的动作 / 备注 */
        t = t.replace(/[[\]]/g, ' ');                           /* 方括号本身（链接文字已经留下来了） */
        t = t.replace(/[*_~`|^]+/g, ' ');                       /* markdown 强调符号 */
        t = t.replace(/[\u200B-\u200F\u2028\u2029\uFEFF\u200D\uFE0F]/g, '');   /* 零宽字符 */
        t = t.replace(/[\u2190-\u21FF\u2300-\u23FF\u2460-\u24FF\u25A0-\u27BF\u2B00-\u2BFF]/g, ' ');
        t = t.replace(/[\uD83C-\uDBFF][\uDC00-\uDFFF]/g, ' ');  /* emoji（增补平面） */
        t = t.replace(/[…]+/g, '，').replace(/[—–]+/g, '，');    /* 省略号 / 破折号 → 逗号，引擎会自然停顿 */
        t = t.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ');
        t = t.replace(/^[，、。；：:;,.!?！？\s]+/, '').replace(/[，、；：\s]+$/, '');
        return t.trim();
    }

    /* ==================================================================================
       流式分句：say-partial 推来的是「到目前为止的整段回复」，只取新长出来的部分
       ================================================================================== */
    var SENT_END = /[。！？!?；;…\n]/;

    /* 从缓冲区里切出「可以开念」的句子：遇到句末标点就切；一直没标点就退到最近的逗号 */
    function cutSentences(force) {
        var out = [], text = stream.buf;
        for (; ;) {
            if (!text) break;
            var cut = 0, i, ch;
            for (i = 0; i < text.length && !cut; i++) {
                ch = text.charAt(i);
                if (SENT_END.test(ch)) {
                    if (i + 1 >= CFG.minChunkChars) cut = i + 1;        /* 太短的一句先攒着 */
                } else if (i + 1 >= CFG.maxChunkChars) {
                    var j = Math.max(text.lastIndexOf('，', i), text.lastIndexOf(',', i),
                        text.lastIndexOf('、', i), text.lastIndexOf(' ', i));
                    cut = (j >= CFG.minChunkChars) ? j + 1 : i + 1;
                }
            }
            if (!cut) break;
            out.push(text.slice(0, cut));
            text = text.slice(cut);
        }
        if (force && text.trim()) { out.push(text); text = ''; }
        stream.buf = text;
        return out;
    }

    function flushStream() {
        stream.timer = 0;
        enqueue(cutSentences(false));
    }

    function feed(full, isFinal) {
        full = String(full || '');
        if (!CFG.streamSpeech) {                 /* 不流式：攒到 say 再整段念 */
            if (!isFinal) return;
            stream.buf = full;
            stream.seen = full.length;
            enqueue(cutSentences(true));
            return;
        }
        if (stream.full && full.indexOf(stream.full) !== 0) {
            stop('restart');                     /* 不是上一段的前缀：换了回复，重来 */
        }
        stream.full = full;
        if (full.length > stream.seen) {
            stream.buf += full.slice(stream.seen);
            stream.seen = full.length;
        }
        if (isFinal) {                           /* 整段生成完了：尾巴也念掉 */
            window.clearTimeout(stream.timer);
            stream.timer = 0;
            stream.pending = false;
            enqueue(cutSentences(true));
            return;
        }
        /* 第一段先等 firstDelayMs 再开口（多攒几个字，语气更连贯），之后来了就念 */
        if (stream.pending) flushStream();
        else {
            stream.pending = true;
            window.clearTimeout(stream.timer);
            stream.timer = window.setTimeout(flushStream, CFG.firstDelayMs);
        }
    }

    function enqueue(list) {
        var i, t;
        for (i = 0; i < list.length; i++) {
            t = CFG.stripText ? clean(list[i]) : String(list[i]).trim();
            if (!t) continue;
            if (tts.queue.length >= CFG.maxQueue) tts.queue.shift();
            tts.queue.push(t);
        }
        if (tts.enabled && tts.queue.length && !tts.playing) playNext();
    }

    /* ==================================================================================
       播放：一句一个 utterance（或一段音频），念完再排下一句
       ================================================================================== */

    /* 播报期间按住 asr.js 的静默闸门：麦克风收进来的多半是扬声器里她自己的声音；
       不按住的话她会「听到自己」再回一句，然后无限循环下去 */
    function holdMic(on) {
        var V = window.lisaVoice;
        var usable = !!(V && typeof V.hold === 'function');
        if (on) {
            if (!CFG.selfListen || !usable) return;
            window.clearTimeout(gate.timer);
            if (gate.on) return;
            gate.on = true;
            try { V.hold(true); } catch (e) { }
            return;
        }
        if (!usable) { gate.on = false; return; }
        if (!gate.on) return;
        window.clearTimeout(gate.timer);
        gate.timer = window.setTimeout(function () {          /* 留一点余量，等回声散掉再放开 */
            gate.on = false;
            try { V.hold(false); } catch (e) { }
        }, CFG.holdReleaseMs);
    }

    function playNext() {
        if (tts.playing) return;
        if (!tts.queue.length) { finishAll(); return; }
        var text = tts.queue.shift();
        tts.playing = true;
        tts.text = text;
        tts.lastError = '';
        window.clearTimeout(tts.watchdog);
        guardUntil = Date.now() + CFG.guardMs;                /* 起播保护窗口：回声刚起来时别误打断 */
        holdMic(true);
        setBtn();
        fire('sentence', { text: text });
        if (CFG.engine === 'server') speakServer(text);
        else speakLocal(text);
    }

    /* 一句念完（或出错 / 超时）：记录下来 + 排下一句 */
    function afterSentence(err) {
        window.clearTimeout(tts.watchdog);
        tts.playing = false;
        tts.text = '';
        if (err) {
            tts.lastError = String(err);
            console.warn('[tts] 这句没念成：' + tts.lastError);
            fire('error', { error: tts.lastError });
        }
        setBtn();
        if (tts.queue.length) window.setTimeout(playNext, CFG.sentenceGapMs);
        else playNext();                                     /* 队列空了 -> finishAll() */
    }

    function finishAll() {
        if (tts.playing) return;
        holdMic(false);
        fire('end', { text: stream.full || '' });
    }

    /* 引擎一：浏览器内置合成（默认）—— 本机合成、断网可用、零依赖 */
    function speakLocal(text) {
        if (!tts.supported) {
            if (!tts.warned) {
                tts.warned = true;
                tip('这台浏览器没有内置语音合成（SpeechSynthesis），念不出来。' +
                    '换 Chrome / Edge / Safari 打开，或把 tts.js 顶部 CFG.engine 改成 <code>server</code> 接自己的 TTS 服务。');
            }
            afterSentence('unsupported');
            return;
        }
        var u = new SpeechSynthesisUtterance(text);
        if (tts.voice) u.voice = tts.voice;
        u.lang = CFG.lang;
        u.rate = clamp(CFG.rate, 0.1, 10);
        u.pitch = clamp(CFG.pitch, 0, 2);
        u.volume = clamp(CFG.volume, 0, 1);
        var seq = tts.seq, done = false;
        function end(code) {
            if (done || seq !== tts.seq) return;         /* 这句已经被 stop() / 新一轮取代了 */
            done = true;
            afterSentence(code);
        }
        u.onend = function () { end(''); };
        u.onerror = function (e) {
            var code = (e && e.error) || 'speech-error';
            end((code === 'interrupted' || code === 'canceled') ? '' : code);   /* 被主动打断不算错 */
        };
        try { synth.speak(u); }
        catch (e) { end('合成失败：' + ((e && e.message) || e)); return; }
        /* 看门狗：Chrome 偶尔不触发 onend（长句 / 被切到后台），按字数估个时长兜底 */
        tts.watchdog = window.setTimeout(function () { end('timeout'); },
            (1800 + text.length * 260) / clamp(CFG.rate, 0.5, 2));
    }

    /* 引擎二：本地 TTS 服务 —— POST JSON，回来的是音频二进制，用 <audio> 播 */
    function speakServer(text) {
        var url = CFG.server.url;
        if (!url) {
            if (!tts.warned) {
                tts.warned = true;
                tip('CFG.engine 是 <code>server</code>，但没配 <code>CFG.server.url</code>（本地 TTS 服务的地址）。' +
                    '填上地址，或把 engine 改回 <code>webspeech</code> 用浏览器内置合成。');
            }
            afterSentence('no-server-url');
            return;
        }
        var seq = tts.seq;
        var ctl = window.AbortController ? new AbortController() : null;
        tts.req = ctl;
        var to = window.setTimeout(function () { if (ctl) ctl.abort(); }, CFG.server.timeoutMs);
        fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text: text, voice: CFG.server.voice, format: CFG.server.format,
                rate: CFG.rate, pitch: CFG.pitch, lang: CFG.lang
            }),
            signal: ctl ? ctl.signal : undefined
        }).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.blob();
        }).then(function (blob) {
            window.clearTimeout(to);
            tts.req = null;
            if (seq !== tts.seq) return;
            var src = URL.createObjectURL(blob);
            var a = new Audio(src);
            tts.audio = a;
            var done = false;
            function end(err) {
                if (done || seq !== tts.seq) return;
                done = true;
                try { URL.revokeObjectURL(src); } catch (e) { }
                if (tts.audio === a) tts.audio = null;
                afterSentence(err);
            }
            a.onended = function () { end(''); };
            a.onerror = function () { end('音频放不出来（服务返回的不是可播的音频？）'); };
            tts.watchdog = window.setTimeout(function () { end('timeout'); },
                (2500 + text.length * 400) / clamp(CFG.rate, 0.5, 2));
            var p = a.play();
            if (p && p.catch) p.catch(function (e) { end('播放被拦：' + ((e && e.message) || e)); });
        }).catch(function (err) {
            window.clearTimeout(to);
            tts.req = null;
            if (seq !== tts.seq) return;
            afterSentence('TTS 服务不可用：' + ((err && err.message) || err));
        });
    }

    /* 停下所有播报（打断 / 关开关 / 换了一轮回复时都用它） */
    function stop(reason) {
        tts.seq++;                                   /* 老回调全部作废 */
        window.clearTimeout(tts.watchdog);
        window.clearTimeout(stream.timer);
        stream.timer = 0;
        tts.queue.length = 0;
        tts.playing = false;
        tts.text = '';
        stream.full = '';
        stream.seen = 0;
        stream.buf = '';
        stream.pending = false;
        if (tts.supported) { try { synth.cancel(); } catch (e) { } }
        if (tts.audio) { try { tts.audio.pause(); } catch (e) { } tts.audio = null; }
        if (tts.req && tts.req.abort) { try { tts.req.abort(); } catch (e) { } }
        tts.req = null;
        holdMic(false);
        setBtn();
        fire('end', { text: '', stopped: true, reason: reason || '' });
    }


    /* ==================================================================================
       音色挑选：先把同语言的挑出来，再按 CFG.voiceHints 的顺序打分（顺便照顾「本机离线」音色）
       ================================================================================== */
    function wantLang() {
        return String(CFG.lang || 'zh').toLowerCase().split('-')[0];
    }

    function langOf(v) {
        return String((v && v.lang) || '').toLowerCase().replace('_', '-');
    }

    function scoreVoice(v) {
        var name = String((v && v.name) || '').toLowerCase();
        var idx = CFG.voiceHints.length, i;
        for (i = 0; i < CFG.voiceHints.length; i++) {
            if (name.indexOf(String(CFG.voiceHints[i]).toLowerCase()) >= 0) { idx = i; break; }
        }
        var s = (CFG.voiceHints.length - idx) * 10;
        if (CFG.preferLocal && v.localService) s += 6;
        if (langOf(v).indexOf(wantLang()) === 0) s += 3;
        return s;
    }

    function refreshVoices() {
        var list = [];
        try { list = synth ? (synth.getVoices() || []) : []; } catch (e) { list = []; }
        tts.voices = list;
        var langList = [], i;
        for (i = 0; i < tts.voices.length; i++) {
            if (langOf(tts.voices[i]).indexOf(wantLang()) === 0) langList.push(tts.voices[i]);
        }
        var pool = langList.length ? langList : tts.voices;
        var want = null;
        if (CFG.voiceName) {                          /* 面板里指定过音色就优先用它 */
            for (i = 0; i < pool.length; i++) {
                if (pool[i].name === CFG.voiceName) { want = pool[i]; break; }
            }
        }
        if (!want && pool.length) {                   /* 没指定（或指定的音色没了）就按打分挑 */
            var best = -1e9;
            for (i = 0; i < pool.length; i++) {
                var s = scoreVoice(pool[i]);
                if (s > best) { best = s; want = pool[i]; }
            }
        }
        tts.voice = want;
        if (want) CFG.voiceName = want.name;
        renderVoices();
    }

    /* 面板上的音色下拉：只列同语言的音色（一个都没有才退回全部） */
    function renderVoices() {
        if (!elSel) return;
        var langList = [], other = [], i, opt;
        for (i = 0; i < tts.voices.length; i++) {
            if (langOf(tts.voices[i]).indexOf(wantLang()) === 0) langList.push(tts.voices[i]);
            else other.push(tts.voices[i]);
        }
        var show = langList.length ? langList : other;
        elSel.innerHTML = '';
        for (i = 0; i < show.length; i++) {
            opt = document.createElement('option');
            opt.value = show[i].name;
            opt.textContent = show[i].name + ' · ' + show[i].lang + (show[i].localService ? ' · 离线' : '');
            if (tts.voice && show[i].name === tts.voice.name) opt.selected = true;
            elSel.appendChild(opt);
        }
        if (!show.length) {
            opt = document.createElement('option');
            opt.value = '';
            opt.textContent = tts.supported ? '没找到可用音色' : '这台浏览器没有语音合成';
            elSel.appendChild(opt);
        }
        if (elInfo) {
            elInfo.textContent = tts.supported
                ? ('引擎：' + (CFG.engine === 'server' ? '本地 TTS 服务' : '浏览器内置（离线）') +
                    '　音色 ' + show.length + ' 个' + (tts.voice ? '，当前 ' + tts.voice.name : ''))
                : '这台浏览器没有语音合成（换 Chrome / Edge / Safari）';
        }
    }

    /* ==================================================================================
       界面：右下角喇叭按钮（单击 = 开/关；长按或右键 = 音色面板）+ 音色面板
       ================================================================================== */
    function setBtn() {
        if (!elBtn) return;
        var cls = 'c-lisa_voice';
        if (!tts.enabled || !tts.supported) cls += ' is-off';    /* is-off = 半透明 + 藏起声波 */
        else if (tts.playing) cls += ' is-speak';                /* is-speak = 脉冲光圈，正在念 */
        elBtn.className = cls;
        elBtn.title = !tts.supported
            ? '语音播报不可用（这台浏览器没有内置语音合成）'
            : (tts.playing ? '语音播报：正在念（单击关掉）'
                : (tts.enabled ? '语音播报：开（单击关闭 / 长按选音色）'
                    : '语音播报：关（单击开启 / 长按选音色）'));
        elBtn.setAttribute('aria-label', tts.enabled ? '语音播报已开启' : '语音播报已关闭');
    }

    function toggle(on) {
        var want = (on === undefined) ? !tts.enabled : !!on;
        if (want === tts.enabled) { setBtn(); return tts.enabled; }
        tts.enabled = want;
        if (want) setBtn();
        else stop('off');                 /* 关掉的时候顺手把正在念的打住，并把闸门放开 */
        save();
        fire('state', { enabled: tts.enabled });
        return tts.enabled;
    }

    function panel(on) {
        if (!elPanel) return false;
        var want = (on === undefined) ? !elPanel.classList.contains('is-open') : !!on;
        if (want && elMemPanel) elMemPanel.classList.remove('is-open');   /* 两块面板位置重叠 */
        elPanel.classList.toggle('is-open', want);
        if (want) { refreshVoices(); syncPanel(); }
        return want;
    }

    function syncPanel() {
        if (elRate) {
            elRate.value = CFG.rate;
            if (elRateVal) elRateVal.textContent = CFG.rate.toFixed(2) + '×';
        }
        if (elPitch) {
            elPitch.value = CFG.pitch;
            if (elPitchVal) elPitchVal.textContent = CFG.pitch.toFixed(2);
        }
    }

    function bindUI() {
        if (elBtn) {
            elBtn.addEventListener('pointerdown', function () {            /* 长按 -> 音色面板 */
                press.long = false;
                window.clearTimeout(press.timer);
                press.timer = window.setTimeout(function () {
                    press.long = true;
                    panel(true);
                }, CFG.longPressMs);
            });
            function cancelPress() { window.clearTimeout(press.timer); }
            elBtn.addEventListener('pointerup', cancelPress);
            elBtn.addEventListener('pointerleave', cancelPress);
            elBtn.addEventListener('pointercancel', cancelPress);
            elBtn.addEventListener('click', function () {
                if (press.long) { press.long = false; return; }   /* 长按已经开过面板，别再切成关 */
                toggle();
            });
            elBtn.addEventListener('contextmenu', function (e) {  /* 右键 -> 音色面板 */
                e.preventDefault();
                panel();
            });
        }
        if (elClose) elClose.onclick = function () { panel(false); };
        if (elSel) elSel.onchange = function () {
            CFG.voiceName = elSel.value || '';
            refreshVoices();                  /* 按名字重新定位到音色对象 */
            save();
            fire('state', { voice: tts.voice ? tts.voice.name : '' });
        };
        if (elRate) elRate.oninput = function () {
            CFG.rate = clamp(parseFloat(elRate.value) || 1, 0.5, 2);
            syncPanel();
            save();
        };
        if (elPitch) elPitch.oninput = function () {
            CFG.pitch = clamp(parseFloat(elPitch.value) || 1, 0, 2);
            syncPanel();
            save();
        };
        if (elTest) elTest.onclick = function () { test(); };
        if (elStopBtn) elStopBtn.onclick = function () { stop('panel'); };
        if (elRefresh) elRefresh.onclick = function () { refreshVoices(); syncPanel(); };
    }

    /* ==================================================================================
       对外接口 + 事件接线
       ================================================================================== */

    /* 手动念一段：不看 CFG.autoSpeak，也不改开关（开关关着也能用，方便脚本里点句招呼） */
    function speak(text) {
        var t = clean(text);
        if (!t) return false;
        stop('manual');                       /* 先把队列 / 正在念的清掉，换成这一段 */
        if (tts.queue.length >= CFG.maxQueue) tts.queue.shift();
        tts.queue.push(t);
        playNext();
        return true;
    }

    function test() {
        return speak('你好呀，我是 Lisa。语音播报已经打开了，你现在听到的就是我在说话。');
    }

    /* 数据源：'lisa-voice'。say-partial / say 是「Lisa 说的」，
       partial / utterance 是「你说的」（用来做打断判断） */
    window.addEventListener('lisa-voice', function (e) {
        var d = e.detail || {};
        if (d.type === 'say-partial') {                 /* llm.js 流式吐字（对白层里那行蓝字） */
            if (CFG.autoSpeak && tts.enabled) feed(d.text, false);
            return;
        }
        if (d.type === 'say') {                         /* 整段定稿：llm.js 的收尾 / memory.js 的开场白 */
            if (CFG.autoSpeak && tts.enabled) feed(d.text, true);
            return;
        }
        if (d.type === 'partial' || d.type === 'utterance') {
            if (d.text && tts.playing && CFG.bargeIn && Date.now() >= guardUntil) stop('barge-in');
        }
    }, false);

    /* 切到后台就别念了（asr.js 切后台会停识别，继续念只是对着空房间说）；切回来不会自动续念 */
    document.addEventListener('visibilitychange', function () {
        if (document.hidden && (tts.playing || tts.queue.length)) stop('hidden');
    });

    window.lisaTTS = {
        config: CFG,
        supported: tts.supported,
        engine: CFG.engine,
        speak: speak,
        test: test,
        stop: stop,
        on: function () { return toggle(true); },
        off: function () { return toggle(false); },
        toggle: toggle,
        panel: panel,                                   /* lisaTTS.panel(true) 打开音色面板 */
        voices: function () { return (tts.voices || []).slice(); },
        setVoice: function (name) {
            CFG.voiceName = String(name || '');
            refreshVoices();
            save();
            return tts.voice ? tts.voice.name : '';
        },
        setLang: function (lang) {                      /* 换播报语言（同时影响挑音色的规则） */
            CFG.lang = String(lang || CFG.lang);
            refreshVoices();
            return CFG.lang;
        },
        state: function () {
            return {
                supported: tts.supported, enabled: tts.enabled, engine: CFG.engine,
                playing: tts.playing, queue: tts.queue.length,
                voice: tts.voice ? tts.voice.name : '', voiceCount: (tts.voices || []).length,
                rate: CFG.rate, pitch: CFG.pitch, lang: CFG.lang,
                gate: gate.on, bargeIn: CFG.bargeIn, lastError: tts.lastError
            };
        }
    };

    /* ------------------------------------------------------------------ 初始化 */
    load();
    if (!tts.supported) {
        tts.enabled = false;                 /* 没有合成能力就别显示成「开着」，免得以为坏了 */
        console.warn('[tts] 这台浏览器没有内置语音合成（SpeechSynthesis），语音播报不可用');
    }
    refreshVoices();
    bindUI();
    /* 音色列表在 Chrome 里是异步来的：onvoiceschanged + 兜底轮询（最多 7 次 × 400ms） */
    if (synth) {
        try { synth.onvoiceschanged = function () { refreshVoices(); }; } catch (e) { }
        var tries = 0;
        (function poll() {
            if (tts.voices.length || tries++ > 6) return;
            refreshVoices();
            window.setTimeout(poll, 400);
        })();
    }
    setBtn();
    syncPanel();

    console.log('[tts] 语音播报已挂载（引擎: ' +
        (CFG.engine === 'server' ? '本地 TTS 服务' : '浏览器内置合成（离线）') +
        '；' + (tts.enabled ? '开' : '关') + '）｜' +
        (tts.supported ? ('当前音色：' + (tts.voice ? tts.voice.name : '（音色列表还没就绪）'))
            : '这台浏览器不支持语音合成') +
        '；单击右下角喇叭开 / 关，长按或右键选音色。');
})();

