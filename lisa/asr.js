/* ===================================================================================
   Lisa 语音输入：VAD（Web Audio 自适应能量检测）+ ASR（Web Speech API 流式识别）
   -----------------------------------------------------------------------------------
   · 纯前端：不需要任何后端、不依赖第三方库，也完全不改动 app.js
       VAD  = 同一条麦克风流 -> AudioContext -> AnalyserNode，自己算 RMS 与人声区间
       ASR  = window.SpeechRecognition / webkitSpeechRecognition（浏览器自带，流式出字）
   · 触发时机：页面上那句 “[CLICK] TO START” 被点击（或按任意键）之后自动打开麦克风，
     此后一直处于 VAD 监听状态 —— 你一开口就自动开始识别，停顿约 0.8s 自动收句。
   · 展示：
       右下角（声音按钮正上方）麦克风按钮：静听=麦克风图标，说话=跳动声波，出错=红圈
       屏幕底部居中：实时字幕条（已定稿 = 白色，草稿 = 灰色 + 光标闪烁）
   · 浏览器要求：
       Chrome / Edge / iOS Safari 14.5+（Firefox 没有 Web Speech API，会显示提示）
       页面必须在 https 或 http://localhost 下打开，否则浏览器直接拒绝麦克风
       （手机用 http://192.168.x.x:8000 访问就属于这种情况，页面会给出排查提示）
   · 可调参数都在下面的 CFG 里，改完刷新即可，不需要重新打包。
   =================================================================================== */
(function () {
    'use strict';

    /* ------------------------------------------------------------------ 可调参数 */
    var CFG = {
        lang: 'zh-CN',          /* 识别语言 */

        vadGate: true,          /* true  = VAD 门控：只有检测到人说话才开识别器
                                           （省电、平时不上传音频；代价是句首约 0.2~0.4s 可能丢字）
                                   false = 常开识别：识别器一直跑，VAD 只负责分段与状态提示
                                           （不丢字，但环境音会被持续送去云端识别） */
        preStartMs: 80,         /* 能量超阈值多久就“提前”启动识别器，用来抵消识别器启动延迟 */
        minSpeechMs: 150,       /* 能量持续超阈值多久算“真的在说话” */
        hangMs: 800,            /* 静音持续多久算“这句话说完了”（会自动收句） */
        snrDb: 9,               /* 高于环境噪声底多少 dB 算人声 */
        minFloorDb: -62,        /* 噪声底下限（再安静也不会低于它） */
        maxFloorDb: -34,        /* 噪声底上限（很吵的地方也不会抬到听不见人声） */
        captionHoldMs: 5000,    /* 说完之后字幕再保留多久 */
        restartDelayMs: 350,    /* 识别器被浏览器自己结束后，多久后重启 */
        retryNetworkMs: 6000,   /* network 错误（连不上识别服务）后的重试间隔 */
        preStartGiveUpMs: 2500  /* 提前启动后多久还没确认在说话，就认作误触发并停掉 */
    };

    /* ------------------------------------------------------------------ DOM */
    var elBtn = document.getElementById('lisa-voice');
    var elBars = document.getElementById('lisa-voice-bars');
    var elIcon = document.getElementById('lisa-voice-icon');
    var elBar = document.getElementById('lisa-voice-bar');
    var elPrev = document.getElementById('lisa-voice-prev');
    var elFinal = document.getElementById('lisa-voice-final');
    var elDraft = document.getElementById('lisa-voice-draft');
    var elTip = document.getElementById('lisa-voice-tip');

    if (!elBtn || !elBar || !elBars) return;    /* 页面里没有语音 UI 就不干活 */

    var barList = elBars.getElementsByTagName('i');

    /* ------------------------------------------------------------------ 工具 */
    function nowMs() {
        return (window.performance && window.performance.now) ? window.performance.now() : Date.now();
    }

    function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

    /* ------------------------------------------------------------------ 状态 */
    var Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    var supported = !!Rec;

    var mic = { ctx: null, stream: null, src: null, analyser: null, timeBuf: null, byteBuf: null, freqBuf: null };
    var vad = {
        noise: -55,          /* 自适应噪声底（dB） */
        level: 0,            /* 平滑后的当前音量（dB） */
        speaking: false,     /* 是否判定为“正在说话” */
        preStarted: false,   /* 是否已经为了这一句提前启动了识别器 */
        aboveAt: 0,          /* 能量首次超过阈值的时刻 */
        belowAt: 0,          /* 能量首次低于阈值的时刻 */
        preAt: 0             /* 提前启动的时刻 */
    };
    var asr = {
        rec: null, running: false, starting: false, wantRun: false,
        finalText: '', draft: '', committed: false,
        netFails: 0, hardFail: false
    };
    var voice = {
        armed: false,        /* 用户是否已经点过 [CLICK] TO START */
        on: false,           /* 麦克风 + VAD 是否在运行 */
        raf: 0, hidden: false,
        restartTO: 0, captionTO: 0, starting: null
    };
    var hist = { prev: '' };   /* 上一句（字幕条里那一行浅色文字） */

    /* ------------------------------------------------------------------ 屏幕提示条
       （正式错误才出现，例如麦克风被拒 / 浏览器不支持；点一下可关掉） */
    function showTip(html) {
        if (!elTip) { console.warn('[voice]', String(html).replace(/<[^>]+>/g, '')); return; }
        elTip.innerHTML = html + '<span class="c-lisa_voice-tip-close">✕</span>';
        elTip.classList.add('is-show');
        elTip.onclick = function () { elTip.classList.remove('is-show'); };
    }

    function hideTip() { if (elTip) elTip.classList.remove('is-show'); }

    function insecureHint() {
        return '浏览器只在 <b>https</b> 或 <b>http://localhost</b> 下允许开麦克风。' +
            '桌面端请用 <code>http://127.0.0.1:8000/human.html</code>；' +
            '手机用局域网 IP（http://192.168.x.x:8000）访问时，Chrome 可以在 <code>chrome://flags/#unsafely-treat-insecure-origin-as-secure</code> ' +
            '里把这个地址加进白名单（加完重启浏览器）。';
    }

    function fail(title, html) {
        setState('bad');
        showTip('<b>' + title + '</b><br>' + html);
    }

    /* ------------------------------------------------------------------ 按钮 / 字幕 UI */
    var stateMap = {
        off: { cls: 'is-off', title: '语音输入：点击开启', label: '语音输入已关闭' },
        wait: { cls: 'is-wait', title: '正在监听 —— 直接说话就会自动识别', label: '正在监听' },
        speak: { cls: 'is-speak', title: '听到了，正在识别…', label: '正在识别' },
        load: { cls: 'is-load', title: '正在启动语音输入…', label: '正在启动' },
        bad: { cls: 'is-bad', title: '语音输入不可用', label: '语音输入不可用' }
    };

    function resetBars() {
        for (var i = 0; i < barList.length; i++) barList[i].style.height = '3px';
    }

    function setState(k) {
        var s = stateMap[k] || stateMap.wait;
        elBtn.className = 'c-lisa_voice ' + s.cls;
        elBtn.title = s.title;
        elBtn.setAttribute('aria-label', s.label);
        /* 说话时把麦克风图标换成跳动声波，其余状态显示麦克风 */
        var showBars = (k === 'speak');
        elBars.style.display = showBars ? 'flex' : 'none';
        if (elIcon) elIcon.style.display = showBars ? 'none' : 'block';
        if (!showBars) resetBars();
    }

    function drawBars(idle) {
        if (!mic.analyser || !mic.freqBuf) return;
        var n = barList.length, bins = mic.freqBuf.length;
        /* 只取人声主要频段（约 80Hz~2kHz 的低位 bin），高位基本都是噪声 */
        var from = 1, to = Math.min(40, bins - 1);
        var span = Math.max(1, Math.floor((to - from) / n));
        for (var i = 0; i < n; i++) {
            var sum = 0, k;
            for (k = 0; k < span; k++) sum += mic.freqBuf[Math.min(from + i * span + k, bins - 1)] || 0;
            var v = sum / span / 255;                        /* 0~1 */
            barList[i].style.height = (idle ? 3 : clamp(3 + v * 17, 3, 20)).toFixed(1) + 'px';
        }
    }

    function renderCaption() {
        var has = !!(asr.finalText || asr.draft || hist.prev);
        elPrev.textContent = hist.prev || '';
        elPrev.style.display = hist.prev ? 'block' : 'none';
        elFinal.textContent = asr.finalText;
        elDraft.textContent = asr.draft;
        if (has) elBar.classList.add('is-show'); else elBar.classList.remove('is-show');
    }

    function holdCaption() {
        window.clearTimeout(voice.captionTO);
        voice.captionTO = window.setTimeout(function () {
            /* 静默一会儿只把当前行淡掉，“上一句”留着，下次说话直接顶上来 */
            asr.finalText = '';
            asr.draft = '';
            renderCaption();
        }, CFG.captionHoldMs);
    }
    /* ------------------------------------------------------------------ VAD：麦克风 + 能量检测 */
    function audioSupported() {
        return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia &&
            (window.AudioContext || window.webkitAudioContext));
    }

    function secureOk() { return window.isSecureContext !== false; }

    function startMic() {
        if (voice.on) return Promise.resolve(true);
        if (voice.starting) return voice.starting;      /* 连点按钮时复用同一次授权请求，避免拿到两个麦克风流 */
        var p = startMicNow();
        voice.starting = p;
        p.then(function () { voice.starting = null; }, function () { voice.starting = null; });
        return p;
    }

    function startMicNow() {
        if (!audioSupported()) {
            fail('浏览器不支持麦克风采集', '缺少 getUserMedia / Web Audio，换 Chrome、Edge 或系统自带浏览器打开。');
            return Promise.resolve(false);
        }
        if (!secureOk()) {
            fail('必须用 https 或 http://localhost 打开', insecureHint());
            return Promise.resolve(false);
        }

        setState('load');
        mic.ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (mic.ctx.resume) { try { mic.ctx.resume(); } catch (e) { } }

        return navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        }).then(function (stream) {
            mic.stream = stream;
            mic.src = mic.ctx.createMediaStreamSource(stream);

            var a = mic.ctx.createAnalyser();
            a.fftSize = 1024;
            a.smoothingTimeConstant = 0.15;
            mic.analyser = a;
            mic.freqBuf = new Uint8Array(a.frequencyBinCount);
            mic.timeBuf = a.getFloatTimeDomainData ? new Float32Array(a.fftSize) : null;
            mic.byteBuf = new Uint8Array(a.fftSize);

            mic.src.connect(a);        /* 只做分析，不接 destination，避免自激啸叫 */

            voice.on = true;
            vad.speaking = false;
            vad.noise = -55;
            vad.level = 0;
            vad.aboveAt = vad.belowAt = vad.preAt = 0;
            vad.preStarted = false;
            setState(supported ? 'wait' : 'bad');
            hideTip();
            loop();
            return true;
        }, function (err) {
            var name = (err && err.name) || '';
            if (name === 'NotAllowedError' || name === 'SecurityError') {
                fail('麦克风权限被拒绝', '浏览器没放行麦克风：点地址栏左边的「锁」图标 → 把「麦克风」改成 <b>允许</b> → 刷新页面。' +
                    (secureOk() ? '' : '<br>' + insecureHint()));
            } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
                fail('没有找到麦克风', '系统里没有可用录音设备（检查耳麦是否插好、系统隐私设置里是否禁用了麦克风）。');
            } else {
                fail('麦克风打开失败', (err && (err.message || err.name)) || '未知错误');
            }
            return false;
        });
    }

    function stopMic() {
        voice.on = false;
        if (voice.raf) {
            if (window.cancelAnimationFrame) cancelAnimationFrame(voice.raf);
            else clearTimeout(voice.raf);
            voice.raf = 0;
        }
        window.clearTimeout(voice.restartTO);
        if (mic.stream) { try { mic.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) { } }
        if (mic.ctx && mic.ctx.close) { try { mic.ctx.close(); } catch (e) { } }
        mic.ctx = mic.stream = mic.src = mic.analyser = null;
        vad.speaking = false;
        vad.preStarted = false;
        vad.aboveAt = vad.belowAt = vad.preAt = 0;
        resetBars();
    }

    /* 每帧：算音量 -> 喂 VAD 状态机 -> 画声波 */
    function loop() {
        if (!voice.on) return;
        voice.raf = window.requestAnimationFrame ? requestAnimationFrame(loop) : setTimeout(loop, 32);
        if (!mic.analyser) return;

        var db = readDb();
        vad.level = vad.level ? (vad.level * 0.65 + db * 0.35) : db;

        /* 阈值 = 噪声底 + SNR，并且不低于绝对下限 + SNR（很安静的房间也稳） */
        var thr = Math.max(vad.noise + CFG.snrDb, CFG.minFloorDb + CFG.snrDb);
        var heard = vad.level > thr;
        var t = nowMs();

        /* 自适应噪声底：只在“没在说话”时缓慢跟随，免得把人声学成噪声 */
        if (!vad.speaking) {
            vad.noise = clamp(vad.noise * 0.985 + Math.min(vad.level, thr) * 0.015, CFG.minFloorDb, CFG.maxFloorDb);
        }

        if (heard) {
            if (!vad.aboveAt) vad.aboveAt = t;
            vad.belowAt = 0;
        } else {
            if (!vad.belowAt) vad.belowAt = t;
            vad.aboveAt = 0;
        }

        /* ① 提前启动识别器：抵消它的启动延迟，少丢句首那一两个字 */
        if (!vad.preStarted && !vad.speaking && vad.aboveAt && (t - vad.aboveAt) >= CFG.preStartMs) {
            vad.preStarted = true;
            vad.preAt = t;
            if (CFG.vadGate && !asr.running) startRecognizer();
        }

        /* ② 确认在说话 */
        if (!vad.speaking && vad.aboveAt && (t - vad.aboveAt) >= CFG.minSpeechMs) {
            vad.speaking = true;
            window.clearTimeout(voice.captionTO);
            if (!asr.running) startRecognizer();      /* 常开模式本来就该在跑 */
            setState('speak');
            elBar.classList.add('is-show');
        }

        /* ③ 误触发：提前启动之后一直没确认为“说话”，把识别器停掉 */
        if (!vad.speaking && vad.preStarted && vad.preAt && (t - vad.preAt) > CFG.preStartGiveUpMs) {
            vad.preStarted = false;
            if (CFG.vadGate) { if (asr.running) stopRecognizer(); }
            else if (asr.draft) { asr.draft = ''; renderCaption(); }
        }

        /* ④ 停顿够久 -> 收句 */
        if (vad.speaking && vad.belowAt && (t - vad.belowAt) >= CFG.hangMs) {
            vad.speaking = false;
            vad.preStarted = false;
            if (CFG.vadGate && asr.running) stopRecognizer();   /* 让它 flush 出最终结果（onend 里提交） */
            else commitUtterance();                             /* 常开模式：直接提交当前这一句 */
            holdCaption();
            setState(voice.on ? 'wait' : 'off');
        }

        drawBars(!(vad.speaking || vad.aboveAt));
    }

    /* 当前帧音量（dB，-inf ~ 0）：优先 Float32 时域，旧内核退回 byte 时域 */
    function readDb() {
        var a = mic.analyser, buf, i, v, sum = 0;
        if (mic.timeBuf) {
            a.getFloatTimeDomainData(mic.timeBuf);
            buf = mic.timeBuf;
            for (i = 0; i < buf.length; i++) { v = buf[i]; sum += v * v; }
        } else {
            a.getByteTimeDomainData(mic.byteBuf);
            buf = mic.byteBuf;
            for (i = 0; i < buf.length; i++) { v = (buf[i] - 128) / 128; sum += v * v; }
        }
        if (a.getByteFrequencyData) a.getByteFrequencyData(mic.freqBuf);
        var rms = Math.sqrt(sum / buf.length);
        return 20 * Math.log10(rms > 1e-7 ? rms : 1e-7);
    }

    /* ------------------------------------------------------------------ ASR：浏览器自带流式识别 */
    var listeners = [];

    /* 对外广播：window 上派发 'lisa-voice' 事件，注册的回调也会收到
       detail = { type:'utterance' | 'partial', text:'...', draft:true|false } */
    function emit(type, detail) {
        detail = detail || {};
        detail.type = type;
        for (var i = 0; i < listeners.length; i++) {
            try { listeners[i](detail); } catch (e) { console.warn('[voice] listener 出错', e); }
        }
        try {
            var ev;
            if (window.CustomEvent) ev = new CustomEvent('lisa-voice', { detail: detail });
            else {
                ev = document.createEvent('CustomEvent');
                ev.initCustomEvent('lisa-voice', false, false, detail);
            }
            window.dispatchEvent(ev);
        } catch (e) { }
    }

    function buildRecognizer() {
        var r = new Rec();
        r.lang = CFG.lang;
        r.continuous = true;
        r.interimResults = true;      /* 关键：打开它才有“边说边出字”的草稿 */
        r.maxAlternatives = 1;

        r.onstart = function () {
            asr.starting = false;
            asr.running = true;
            asr.netFails = 0;
            setState(vad.speaking ? 'speak' : (voice.on ? 'wait' : 'off'));
        };

        /* 流式输出：草稿(isFinal=false) 会反复刷新，定稿(isFinal=true) 一次性追加 */
        r.onresult = function (e) {
            var i, res, txt, draft = '';
            if (asr.committed) {          /* 上一句已提交，说明这是新的一句 */
                asr.committed = false;
                asr.finalText = '';
            }
            for (i = e.resultIndex; i < e.results.length; i++) {
                res = e.results[i];
                txt = (res[0] && res[0].transcript) || '';
                if (res.isFinal) asr.finalText += txt;
                else draft += txt;
            }
            asr.draft = draft;
            window.clearTimeout(voice.captionTO);
            renderCaption();
            emit('partial', { text: asr.finalText + asr.draft, draft: true });
        };

        r.onerror = function (e) {
            var code = (e && e.error) || '';
            if (code === 'no-speech' || code === 'aborted') return;    /* 静音 / 主动 stop，正常现象 */
            if (code === 'not-allowed' || code === 'service-not-allowed') {
                asr.hardFail = true;
                asr.wantRun = false;
                fail('浏览器不让用语音识别', code === 'not-allowed'
                    ? ('识别服务被拒绝：一般是麦克风权限被拒，或页面不在 https / localhost 下。' +
                        (secureOk() ? '' : '<br>' + insecureHint()))
                    : '识别服务被拒绝（service-not-allowed）：换个浏览器，或用 https / localhost 打开。');
                return;
            }
            if (code === 'network') {
                asr.netFails++;
                if (asr.netFails >= 3) {
                    asr.hardFail = true;
                    asr.wantRun = false;
                    fail('连不上语音识别服务',
                        'Web Speech 的识别是在<b>云端</b>完成的（Chrome 走 Google、Edge 走微软），并不在本机：<br>' +
                        '1) 先确认电脑／手机能上外网；<br>2) 国内网络常常连不上 Google 的识别服务，需要代理；<br>' +
                        '3) 想「真正离线、音频不出本机」就得换成 Vosk / Whisper 那类 WASM 本地模型（替换本文件的识别层即可）。');
                }
                return;
            }
            if (code === 'audio-capture') {
                asr.hardFail = true;
                asr.wantRun = false;
                fail('采集不到麦克风音频', '麦克风被别的程序占用，或在系统层面被禁用了。');
            }
        };

        r.onend = function () {
            asr.running = false;
            asr.starting = false;
            commitUtterance();             /* flush 掉最后一段，免得丢句尾 */
            if (asr.wantRun && voice.on && !voice.hidden && !asr.hardFail) {
                var delay = CFG.restartDelayMs + (asr.netFails ? CFG.retryNetworkMs : 0);
                window.clearTimeout(voice.restartTO);
                voice.restartTO = window.setTimeout(function () {
                    if (asr.wantRun && voice.on) startRecognizer();
                }, delay);
                return;
            }
            setState(asr.hardFail ? 'bad' : (voice.on ? 'wait' : 'off'));
        };

        return r;
    }

    function startRecognizer() {
        if (!supported || asr.hardFail || !voice.on || asr.running || asr.starting) return;
        if (!asr.rec) asr.rec = buildRecognizer();
        if (!asr.rec) return;
        asr.wantRun = true;
        asr.starting = true;
        window.clearTimeout(voice.restartTO);
        try {
            asr.rec.start();               /* 上一次 start 还没退出会抛 InvalidStateError，忽略即可 */
        } catch (e) { asr.starting = false; }
    }

    /* 收句：让识别器把最后一段 flush 成定稿，随后在 onend 里提交 */
    function stopRecognizer() {
        asr.wantRun = false;
        if (!asr.rec || !asr.running) { commitUtterance(); return; }
        try { asr.rec.stop(); } catch (e) { commitUtterance(); }
    }

    /* 收句入库：一句说完后把它提交出来（字幕、回调、window 事件都会拿到） */
    function commitUtterance() {
        var fin = (asr.finalText || '').replace(/\s+/g, ' ').trim();
        var draft = (asr.draft || '').replace(/\s+/g, ' ').trim();
        var text = fin || draft;
        var byDraft = !fin && !!draft;      /* 定稿还没回来，先拿草稿顶上 */
        if (!text) {
            asr.finalText = '';
            asr.draft = '';
            asr.committed = false;
            renderCaption();
            return '';
        }
        hist.prev = voice.lastText || '';
        voice.lastText = text;
        asr.finalText = text;
        asr.draft = '';
        asr.committed = true;              /* 标记：这是“已提交”的一句，新结果到来时开新句 */
        renderCaption();
        holdCaption();
        emit('utterance', { text: text, draft: byDraft });
        return text;
    }

    /* ------------------------------------------------------------------ 开 / 关 */
    function enable() {
        hideTip();
        if (!supported) {
            fail('当前浏览器不支持语音识别',
                'Web Speech API 只有 Chrome / Edge / iOS Safari 14.5+ 才有（Firefox 没有实现）。' +
                '换个浏览器打开即可；想要离线可用就得换 Vosk / Whisper 那类 WASM 本地模型。');
            return;
        }
        startMic().then(function (ok) {
            if (!ok) return;
            voice.userOff = false;
            asr.hardFail = false;
            asr.netFails = 0;
            if (CFG.vadGate) setState('wait');     /* 门控：等 VAD 听到人声再开识别器 */
            else startRecognizer();                /* 常开：立刻开识别器 */
        });
    }

    function disable() {
        voice.userOff = true;
        window.clearTimeout(voice.restartTO);
        window.clearTimeout(voice.captionTO);
        asr.wantRun = false;
        asr.starting = false;
        if (asr.rec && asr.running) { try { asr.rec.abort(); } catch (e) { } }
        asr.running = false;
        asr.finalText = asr.draft = '';
        asr.committed = false;
        hist.prev = voice.lastText = '';
        stopMic();
        renderCaption();
        setState('off');
    }

    /* 点右下角麦克风按钮 = 开 / 关（关掉后就不再听，保护隐私） */
    elBtn.addEventListener('click', function () {
        if (voice.on) disable(); else enable();
    });

    /* ------------------------------------------------------------------ 什么时候开始
       原站那句 “[CLICK] TO START” 就是页面的首次 pointerdown / keydown —— 就挂在这个手势上：
       点过之后（有用户手势，浏览器才会放行麦克风）自动进入 VAD 常听状态。 */
    function onFirstGesture(e) {
        if (voice.armed) return;
        var tg = e && e.target;
        if (tg && tg.nodeType === 1 && elBtn.contains(tg)) return;   /* 点麦克风按钮，交给按钮自己处理 */
        window.removeEventListener('pointerdown', onFirstGesture, true);
        window.removeEventListener('keydown', onFirstGesture, true);
        voice.armed = true;
        /* 稍等一下再开麦，别和入场的闪屏动画抢资源 */
        window.setTimeout(function () { if (!voice.userOff) enable(); }, 400);
    }

    /* 用捕获阶段监听，保证比 app.js 里那个 “[CLICK] TO START” 的监听先拿到这次手势 */
    window.addEventListener('pointerdown', onFirstGesture, true);
    window.addEventListener('keydown', onFirstGesture, true);

    /* 切到后台就停掉识别（省电、也避免后台一直上传音频），切回来自动恢复 */
    document.addEventListener('visibilitychange', function () {
        voice.hidden = !!document.hidden;
        if (voice.hidden) {
            asr.wantRun = false;
            if (asr.rec && asr.running) { try { asr.rec.abort(); } catch (e) { } }
            return;
        }
        if (voice.armed && voice.on && !voice.userOff && !asr.hardFail) {
            /* 后台期间 rAF 是停的，能量时间戳都过期了，先清一遍再继续，免得一回来就被误判成“正在说话” */
            vad.aboveAt = vad.belowAt = vad.preAt = 0;
            vad.speaking = false;
            vad.preStarted = false;
            vad.level = 0;
            if (CFG.vadGate) setState('wait'); else startRecognizer();
        }
    });

    /* ------------------------------------------------------------------ 对外接口
       window.lisaVoice.listen(fn)  —— 每说完一句回调一次：fn({ type:'utterance', text:'…', draft:false })
       也可以直接听 window 事件：window.addEventListener('lisa-voice', e => e.detail)
       拿到 text 之后想接大模型 / 让 Lisa 换表情 / 打开某个页面，都从这里接即可。 */
    window.lisaVoice = {
        config: CFG,
        supported: supported,
        enable: enable,
        disable: disable,
        toggle: function () { if (voice.on) disable(); else enable(); },
        setLang: function (lang) {
            CFG.lang = lang;
            if (asr.rec) asr.rec.lang = lang;
            if (asr.running) { try { asr.rec.abort(); } catch (e) { } }   /* onend 之后会用新语言重启 */
        },
        listen: function (cb) { if (typeof cb === 'function') listeners.push(cb); return cb; },
        unlisten: function (cb) {
            var i = listeners.indexOf(cb);
            if (i >= 0) listeners.splice(i, 1);
        },
        state: function () {
            return {
                armed: voice.armed, on: voice.on, hidden: voice.hidden,
                speaking: !!vad.speaking, recognizing: asr.running,
                levelDb: Math.round(vad.level), noiseDb: Math.round(vad.noise),
                last: voice.lastText || '', draft: asr.draft || ''
            };
        }
    };

    /* ------------------------------------------------------------------ 初始化 */
    voice.userOff = false;
    voice.hidden = !!document.hidden;
    setState('off');
    console.log('[voice] VAD + ASR 已就绪（' + (supported ? '本浏览器支持 Web Speech API' : '本浏览器不支持 Web Speech API，只能做 VAD') +
        '）；点页面任意处（[CLICK] TO START）之后会自动开始监听。');
})();

