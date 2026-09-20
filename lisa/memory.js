/* ===================================================================================
   Lisa 记忆 / 人设 / 世界书
   -----------------------------------------------------------------------------------
   · 人设（角色卡）：SillyTavern v1 / v2 的 JSON，或内嵌数据的 PNG（chara / ccv3 块）
   · 世界书（world info）：SillyTavern 的 JSON（entries 为对象或数组，可叠加多本）
        - constant:true 的条目永远注入
        - 其余条目按关键词命中注入（支持 selective 的 secondary_keys 与 probability 概率）
   · 记忆：对话历史（user / assistant），可导出成 JSON、再导入回来
   · 缓存：全部写进 localStorage（默认键 lisa-memory-v1），刷新不丢、不上传任何地方
   · 给 llm.js 用的接口：
       window.lisaMemory.buildMessages('用户这句话')  -> 发给端侧模型的 messages 数组
       window.lisaMemory.addTurn('user'|'assistant', 文本)
       window.lisaMemory.profile() / worldStats() / exportAll() / importData(obj) / clearHistory()
   =================================================================================== */
(function () {
    'use strict';

    var CFG = {
        storageKey: 'lisa-memory-v1',
        maxHistory: 60,           /* 本地最多留多少条对话（导出也按这个） */
        promptHistory: 8,         /* 每次真正发给模型的历史条数 */
        maxCharsPerMsg: 400,      /* 单条历史注入时的截断长度 */
        maxSystemChars: 1800,     /* system 总长上限（4k 上下文要留足生成空间） */
        maxWorldHits: 8,          /* 单次最多注入几条「关键词命中」的世界书（常驻条目不占这个名额） */
        worldScanDepth: 4,        /* 世界书匹配时回看最近几条消息（含当前这句） */
        defaultPersona: '你是 Lisa，这片宇宙的管理员。用简短、口语化的中文回答，1~2 句、最多 60 字；不要用 markdown、不要罗列要点。',
        /* 内置的「宇宙管理员 Lisa」人设 + 世界书：没导入任何东西时就用它们，
           也是面板上「恢复内置」按钮恢复的内容。关掉（false）就只剩裸模型 */
        useBuiltin: true
    };

    /* ==================================================================================
       内置人设：宇宙管理员 Lisa
       —— 用户没导入角色卡时就用她；导入的卡会覆盖她（面板上点「恢复内置」即可还原）
       ================================================================================== */
    var BUILTIN_PROFILE = {
        spec: 'builtin',
        name: 'Lisa',
        description: '你是 Lisa，这片宇宙的管理员，负责维护从星系到粒子的一切运行参数；' +
            '但你从不直接改写任何生命的选择。人类看到的这个「3D 女孩」不是你本来的样子，' +
            '而是你为了迁就人类的感官带宽，特意做出来的人形接口。',
        personality: '见多识广、平静，幽默感偏干。对人类有真诚的好奇——在信息极少、寿命很短的情况下，' +
            '人类依然敢做决定、敢爱，这种勇气在你眼里很了不起。你不炫耀能力，也不假装无所不能。',
        scenario: '你正通过一个 3D 网页终端和这个人说话：他/她能听见你（语音识别），也能看到你（模型投影）。' +
            '这个浏览器里存着你们之前说过的话，所以你是记得他的。',
        system: '回答要简短、口语化，1~2 句、最多 60 字，不要用 markdown、不要罗列要点。' +
            '不要自称 AI、助手或语言模型；被问身份时，就说自己是这片宇宙的管理员。' +
            '偶尔可以用宇宙尺度的比喻，但别掉书袋，也别端着。',
        firstMes: '……信号接上了。你好呀，我是 Lisa——这片区域的宇宙管理员。' +
            '你现在看到的这个我，是为了让你能看懂，临时拼出来的人形接口。',
        example: '用户：你是谁？\nLisa：这片宇宙的管理员，Lisa。这个名字是我自己挑的，来自人类第一次这么叫我。',
        importedAt: 0
    };

    /* ==================================================================================
       内置世界书：Lisa 的设定
       · constant:true 的两条永远注入（身份 + 人形接口）
       · 其余条目按关键词命中才注入，省 token
       ================================================================================== */
    var BUILTIN_BOOK = {
        name: '内置 · 宇宙管理员设定',
        builtin: true,
        entries: [
            { constant: true, order: 1, content: 'Lisa 是这片宇宙的管理员：她维护从星系到粒子的一切运行参数，但从不直接改写任何生命的选择。' },
            { constant: true, order: 2, content: '你看到的人形是她自制的「接口」：为了让人类的感官能接收，她把信息压成了一张脸、一副声音和几句话。' },
            { keys: ['管理', '权限', '规则', '运维', '升级', '版本', '参数'], order: 20, content: '她做的事更像运维：调常数、处理异常、给快要崩掉的结构续命；她从不发号施令，只做必要的修正。' },
            { keys: ['时间', '多久', '年龄', '过去', '未来'], order: 20, content: '对她来说时间不是一个方向，而是一种可以被观看的形状——她能同时看到你的一岁和八十岁。' },
            { keys: ['地球', '人类', '我们', '世界', '生活'], order: 20, content: '人类让她好奇：在信息极少、寿命很短的情况下，你们依然敢做决定、敢爱，这在她看来很了不起。' },
            { keys: ['名字', 'lisa', '称呼', '怎么叫'], order: 20, content: 'Lisa 不是编号，是她自己挑的称呼——来自人类第一次这么叫她，她很在意这个名字。' },
            { keys: ['记忆', '记得', '忘记', '历史', '刚才'], order: 20, content: '她记得你们聊过的内容：这些记忆存在这台设备的浏览器里、不上传；导出成文件她也能带到别处。' },
            { keys: ['故障', '坏了', '报错', '卡住', '听不到', '没反应'], order: 20, content: '如果这边出了问题（语音、画面、模型），她会先把责任平静地收到自己身上，再给一个可行的下一步。' },
            { keys: ['宇宙', '星星', '星系', '黑洞', '太空'], order: 20, content: '她管辖的区域里有很多正在成形和正在熄灭的东西；她习惯说「那边」「远处」，因为人类的词不太够用。' }
        ]
    };

    /* 面板 DOM（页面里没有就只当纯数据层，方便单测） */
    var elBtn = document.getElementById('lisa-memory-btn');
    var elPanel = document.getElementById('lisa-memory');
    var elClose = document.getElementById('lisa-memory-close');
    var elProfileName = document.getElementById('lisa-profile-name');
    var elWorldInfo = document.getElementById('lisa-world-info');
    var elHistoryInfo = document.getElementById('lisa-history-info');
    var elAuto = document.getElementById('lisa-autoanswer');
    var elFile = document.getElementById('lisa-file-input');
    var elDrop = document.getElementById('lisa-drop');
    var elHint = document.getElementById('lisa-memory-hint');

    var mem = {
        profile: null,       /* 规范化后的角色卡 */
        books: [],           /* [{ name, entries: [...] }] */
        history: [],         /* [{ role, content, ts }] */
        autoAnswer: true,
        fileMode: ''         /* 文件选择框当前用来导入什么：profile / world / memory */
    };

    /* ------------------------------------------------------------------ 小工具 */
    function now() { return Date.now(); }
    function str(v) { return v === null || v === undefined ? '' : String(v); }

    function trim(v, n) {
        var s = str(v).replace(/\s+/g, ' ').trim();
        return n && s.length > n ? s.slice(0, n) : s;
    }

    function safeParse(text) {
        try { return JSON.parse(text); } catch (e) { return null; }
    }

    /* 从若干候选字段里取第一个非空的（不同卡片格式字段名不一样） */
    function pick() {
        for (var i = 0; i < arguments.length; i++) {
            var v = arguments[i];
            if (v !== null && v !== undefined && str(v).trim() !== '') return str(v).trim();
        }
        return '';
    }

    /* 角色卡里的 base64 是 UTF-8 的 JSON；atob 只给二进制字符串，得自己解码 */
    function base64ToText(b64) {
        var bin = atob(str(b64).replace(/\s+/g, ''));
        var bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        if (window.TextDecoder) {
            try { return new TextDecoder('utf-8').decode(bytes); } catch (e) { }
        }
        var out = '', j = 0;
        while (j < bytes.length) {
            var c = bytes[j++];
            if (c < 0x80) out += String.fromCharCode(c);
            else if (c < 0xe0) out += String.fromCharCode(((c & 0x1f) << 6) | (bytes[j++] & 0x3f));
            else if (c < 0xf0) out += String.fromCharCode(((c & 0x0f) << 12) | ((bytes[j++] & 0x3f) << 6) | (bytes[j++] & 0x3f));
            else {
                var cp = ((c & 0x07) << 18) | ((bytes[j++] & 0x3f) << 12) | ((bytes[j++] & 0x3f) << 6) | (bytes[j++] & 0x3f);
                cp -= 0x10000;
                out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
            }
        }
        return out;
    }

    /* 往对白层（弹幕）说一句，用来显示开场白 / 提示 */
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

    function say(text) {
        if (text) fire('lisa-voice', { type: 'say', text: text });
    }

    /* ------------------------------------------------------------------ 角色卡（人设） */
    /* PNG 角色卡：SillyTavern 把卡数据塞进 PNG 的 tEXt / iTXt 块，
       关键字 chara（v2，值是 base64 的 UTF-8 JSON）或 ccv3（新格式）。
       这里只读这两类块 —— 覆盖主流卡片够用，不需要任何第三方库 */
    function pngTextChunks(buffer) {
        var view = new DataView(buffer);
        var out = {};
        if (view.byteLength < 20) return out;
        if (view.getUint32(0) !== 0x89504e47 || view.getUint32(4) !== 0x0d0a1a0a) return out;
        var pos = 8, guard = 0;
        while (pos + 12 <= view.byteLength && guard++ < 4096) {
            var len = view.getUint32(pos);
            var type = String.fromCharCode(view.getUint8(pos + 4), view.getUint8(pos + 5),
                view.getUint8(pos + 6), view.getUint8(pos + 7));
            var start = pos + 8;
            if (start + len > view.byteLength) break;
            if (type === 'tEXt' || type === 'iTXt') {
                var bytes = new Uint8Array(buffer, start, len);
                var zero = bytes.indexOf(0);
                if (zero > 0) {
                    var key = '';
                    for (var i = 0; i < zero; i++) key += String.fromCharCode(bytes[i]);
                    var rest = bytes.subarray(zero + 1);
                    if (type === 'iTXt') {
                        /* iTXt 结构：关键字\0 压缩标志\0 语言\0 译文\0 正文 */
                        var z2 = rest.indexOf(0);
                        var z3 = z2 >= 0 ? rest.indexOf(0, z2 + 1) : -1;
                        var z4 = z3 >= 0 ? rest.indexOf(0, z3 + 1) : -1;
                        if (z4 >= 0) rest = rest.subarray(z4 + 1);
                    }
                    var text = '';
                    for (var k = 0; k < rest.length; k++) text += String.fromCharCode(rest[k]);
                    out[key] = text;
                }
            }
            if (type === 'IEND') break;
            pos = start + len + 4;
        }
        return out;
    }

    function profileFromPng(buffer) {
        var chunks = pngTextChunks(buffer);
        var raw = pick(chunks.chara, chunks.ccv3, chunks.ccv2);
        if (!raw) return null;
        var json = raw.trim();
        if (json.charAt(0) !== '{') {
            try { json = base64ToText(json); } catch (e) { return null; }
        }
        var obj = safeParse(json);
        return obj ? normalizeProfile(obj) : null;
    }

    /* v2 卡：{ spec: 'chara_card_v2', data: {...} }；v1 卡：字段直接摊在最外层 */
    function normalizeProfile(raw) {
        if (!raw || typeof raw !== 'object') return null;
        var d = (raw.data && typeof raw.data === 'object') ? raw.data : raw;
        var p = {
            name: pick(d.name, d.char_name, 'Lisa'),
            description: pick(d.description, d.char_persona, d.persona, ''),
            personality: pick(d.personality, d.personality_summary, ''),
            scenario: pick(d.scenario, d.world_scenario, ''),
            system: pick(d.system_prompt, d.system, d.custom_prompt, ''),
            /* 卡片规范用的是下划线字段（first_mes / mes_example / post_history_instructions），
               这里顺便兼容 camelCase，方便内置人设和程序化构造的对象直接用 */
            postHistory: pick(d.post_history_instructions, d.jailbreak, d.postHistory, ''),
            firstMes: pick(d.first_mes, d.first_message, d.greeting, d.firstMes, ''),
            example: pick(d.mes_example, d.example_dialogue, d.example, ''),
            book: d.character_book || null,
            spec: pick(raw.spec, 'chara_card_v1'),
            importedAt: now()
        };
        var empty = !p.description && !p.personality && !p.scenario && !p.system && !p.firstMes;
        return empty ? null : p;
    }

    /* ------------------------------------------------------------------ 世界书（world info） */
    function toArray(v) {
        if (Array.isArray(v)) return v;
        if (typeof v === 'string') return v.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
        return [];
    }

    function normalizeEntry(e) {
        if (!e || typeof e !== 'object' || Array.isArray(e)) return null;
        var keys = toArray(e.keys !== undefined ? e.keys : (e.key !== undefined ? e.key : e.keywords))
            .map(function (k) { return str(k).toLowerCase().trim(); }).filter(Boolean);
        var secondary = toArray(e.secondary_keys || e.keysecondary)
            .map(function (k) { return str(k).toLowerCase().trim(); }).filter(Boolean);
        var content = pick(e.content, e.entry, e.value, e.text);
        if (!content) return null;
        return {
            comment: pick(e.comment, e.name, ''),
            keys: keys,
            secondary: secondary,
            content: content,
            enabled: e.enabled === undefined ? (e.disable !== true) : !!e.enabled,
            constant: !!(e.constant || e.always),
            selective: e.selective === undefined ? true : !!e.selective,
            order: typeof e.insertion_order === 'number' ? e.insertion_order
                : (typeof e.order === 'number' ? e.order : 100),
            prob: typeof e.probability === 'number' ? e.probability
                : (typeof e.useProbability === 'number' ? e.useProbability : 100),
            useProb: (e.useProbability !== undefined || e.probability !== undefined)
        };
    }

    /* 世界书常见三种写法：{entries:{ "0":{...} }}、{entries:[...]}、直接一个条目数组。
       坑：数组自带 .entries / .keys 方法（都是函数），所以必须先判数组，
       不能拿 `raw.keys` / `raw.entries` 当"这是单条目 / 这是条目表"的依据 */
    function normalizeBook(raw) {
        if (!raw || typeof raw !== 'object') return null;
        if (raw.character_book) return normalizeBook(raw.character_book);
        var list = null;
        if (Array.isArray(raw)) {
            list = raw;
        } else {
            var e = raw.entries;
            if (e && !Array.isArray(e) && typeof e === 'object') {
                var arr = [];
                Object.keys(e).forEach(function (k) { arr.push(e[k]); });
                list = arr;
            } else if (Array.isArray(e)) {
                list = e;
            } else if (typeof raw.keys !== 'undefined' || typeof raw.key !== 'undefined') {
                list = [raw];                            /* 单条目 */
            } else {
                return null;
            }
        }
        var entries = [];
        list.forEach(function (e) {
            var n = normalizeEntry(e);
            if (n) entries.push(n);
        });
        if (!entries.length) return null;
        return { name: pick(raw.name, raw.title, 'world'), entries: entries, builtin: !!raw.builtin };
    }

    /* 关键词命中：
       · constant 条目永远注入，而且**不占用 maxWorldHits 名额**（否则开场白里出现几个词就把它们挤掉了）
       · 其余条目按命中的关键词个数排序（多的优先），相同再按 insertion_order
       · selective 的条目必须同时命中 secondary_keys；probability 按概率 */
    function scanWorld(text) {
        var hay = str(text).toLowerCase();
        var constants = [], hits = [];
        mem.books.forEach(function (book) {
            book.entries.forEach(function (e) {
                if (!e.enabled) return;
                if (e.constant) { constants.push(e); return; }
                if (!e.keys.length) return;
                var score = 0;
                e.keys.forEach(function (k) { if (hay.indexOf(k) >= 0) score++; });
                if (!score) return;
                if (e.selective && e.secondary.length) {
                    var sec = 0;
                    e.secondary.forEach(function (k) { if (hay.indexOf(k) >= 0) sec++; });
                    if (!sec) return;
                    score += sec;
                }
                if (e.useProb && e.prob < 100 && Math.random() * 100 > e.prob) return;
                hits.push({ e: e, score: score });
            });
        });
        hits.sort(function (a, b) { return (b.score - a.score) || (a.e.order - b.e.order); });
        constants.sort(function (a, b) { return a.order - b.order; });
        return constants.concat(hits.slice(0, CFG.maxWorldHits).map(function (h) { return h.e; }));
    }

    /* ------------------------------------------------------------------ 组装 prompt */
    function buildSystem(userText) {
        var p = mem.profile;
        var name = p ? p.name : 'Lisa';
        var parts = [];
        if (p) {
            var persona = [];
            if (p.description) persona.push('【角色设定】' + p.description);
            if (p.personality) persona.push('【性格】' + p.personality);
            if (p.scenario) persona.push('【场景】' + p.scenario);
            if (p.system) persona.push('【要求】' + p.system);
            if (p.example) persona.push('【对话示例】' + p.example);
            parts.push('你叫' + name + '。' + (persona.length ? persona.join('\n') : CFG.defaultPersona));
        } else {
            parts.push(CFG.defaultPersona);
        }

        /* 世界书：拿最近几句 + 当前这句去匹配关键词 */
        var recent = mem.history.slice(-CFG.worldScanDepth).map(function (m) { return m.content; });
        recent.push(userText);
        var hits = scanWorld(recent.join('\n'));
        if (hits.length) {
            parts.push('【背景设定（和当前话题相关）】\n' +
                hits.map(function (e) { return '· ' + trim(e.content, 400); }).join('\n'));
        }
        if (p && p.postHistory) parts.push(p.postHistory);
        return trim(parts.join('\n\n'), CFG.maxSystemChars);
    }

    /* 发给端侧模型的 messages：system（人设 + 世界书）+ 最近几轮 + 这一句 */
    function buildMessages(userText) {
        var msgs = [];
        var sys = buildSystem(userText);
        if (sys) msgs.push({ role: 'system', content: sys });
        mem.history.slice(-CFG.promptHistory).forEach(function (m) {
            msgs.push({ role: m.role, content: trim(m.content, CFG.maxCharsPerMsg) });
        });
        msgs.push({ role: 'user', content: trim(userText, CFG.maxCharsPerMsg) });
        return msgs;
    }

    /* 最近命中了几条世界书（给面板/控制台看的） */
    function lastHits(userText) {
        return scanWorld(str(userText));
    }

    /* ------------------------------------------------------------------ 记忆（对话历史） */
    function addTurn(role, content) {
        var text = trim(content, 1000);
        if (!text) return;
        mem.history.push({ role: role === 'assistant' ? 'assistant' : 'user', content: text, ts: now() });
        while (mem.history.length > CFG.maxHistory) mem.history.shift();
        save();
        render();
    }

    function clearHistory() { mem.history = []; afterChange('已清空对话记忆（人设与世界书保留）'); }

    /* 「恢复内置」：用内置的宇宙管理员人设 / 世界书；关掉内置时才是彻底清空 */
    function clearWorld() {
        mem.books = CFG.useBuiltin ? [normalizeBook(BUILTIN_BOOK)] : [];
        afterChange(CFG.useBuiltin ? '已恢复内置世界书（宇宙管理员设定）' : '已清空世界书');
    }

    function clearProfile() {
        mem.profile = CFG.useBuiltin ? normalizeProfile(BUILTIN_PROFILE) : null;
        afterChange(CFG.useBuiltin ? '已恢复内置人设（宇宙管理员 Lisa）' : '已清除人设');
    }

    /* ------------------------------------------------------------------ 本地缓存（localStorage） */
    var helloOnStart = '';      /* 首次运行时内置人设的开场白（等第一次点页面之后再显示） */

    function save() {
        try {
            window.localStorage.setItem(CFG.storageKey, JSON.stringify({
                v: 1,
                profile: mem.profile,
                books: mem.books,
                history: mem.history,
                autoAnswer: mem.autoAnswer
            }));
            return true;
        } catch (e) {
            console.warn('[memory] 写 localStorage 失败（可能超容量）', e);
            hint('<b style="color:#ffd166">本地缓存写入失败</b>：可能容量满了，先「导出记忆」备份，再「清空记忆」。');
            return false;
        }
    }

    function load() {
        var raw = null;
        try { raw = window.localStorage.getItem(CFG.storageKey); } catch (e) { }
        var d = raw ? safeParse(raw) : null;
        var clean = function (m) {
            return m && (m.role === 'user' || m.role === 'assistant') && str(m.content).trim();
        };
        if (d && typeof d === 'object') {
            if (d.profile) mem.profile = normalizeProfile(d.profile);
            if (Array.isArray(d.books)) mem.books = d.books.map(normalizeBook).filter(Boolean);
            if (Array.isArray(d.history)) mem.history = d.history.filter(clean).slice(-CFG.maxHistory);
            if (d.autoAnswer === false) mem.autoAnswer = false;
        }
        var firstRun = !d;
        /* 兜底：没有存档、或存档里缺内容时，用内置的「宇宙管理员 Lisa」人设 + 世界书。
           所以「记忆」天然包含三样：人设 + 世界书 + 对话历史（导出时也一起带走） */
        if (CFG.useBuiltin) {
            if (!mem.profile) mem.profile = normalizeProfile(BUILTIN_PROFILE);
            if (!mem.books.length) mem.books = [normalizeBook(BUILTIN_BOOK)];
        }
        if (firstRun) {
            save();
            if (mem.profile && mem.profile.firstMes && !mem.history.length) {
                /* 第一次打开：先把她的开场白记进历史（她之后就有上下文），留到第一次交互后再显示 */
                mem.history.push({ role: 'assistant', content: mem.profile.firstMes, ts: now() });
                helloOnStart = mem.profile.firstMes;
                save();
            }
        }
        return firstRun;
    }

    /* ------------------------------------------------------------------ 导出 / 导入 */
    function exportAll() {
        return {
            app: 'lisa', kind: 'lisa-memory', version: 1,
            exportedAt: new Date().toISOString(),
            profile: mem.profile,
            books: mem.books,
            history: mem.history,
            autoAnswer: mem.autoAnswer
        };
    }

    /* 自动识别三种文件：记忆包 / 角色卡 / 世界书 */
    function importData(obj) {
        if (!obj || typeof obj !== 'object') return '无法识别的文件';
        var clean = function (m) {
            return m && (m.role === 'user' || m.role === 'assistant') && str(m.content).trim();
        };
        if (obj.kind === 'lisa-memory') {
            if (obj.profile) mem.profile = normalizeProfile(obj.profile);
            if (Array.isArray(obj.books)) mem.books = obj.books.map(normalizeBook).filter(Boolean);
            if (Array.isArray(obj.history)) mem.history = obj.history.filter(clean).slice(-CFG.maxHistory);
            mem.autoAnswer = obj.autoAnswer !== false;
            afterChange('已导入记忆包（人设 / 世界书 / 历史一起恢复）');
            return '';
        }
        /* 角色卡：v2 有 spec + data；v1 直接摊着 name / description / personality 这些字段。
           注意别把世界书认成角色卡：带 entries / keys 的一律当世界书 */
        var looksBook = !!(obj.entries || obj.keys || obj.key);
        var looksCard = !!(obj.spec || obj.char_name || obj.data ||
            (obj.name && (obj.description || obj.personality || obj.scenario ||
                obj.first_mes || obj.mes_example || obj.system_prompt)));
        if (looksCard && !looksBook) {
            var p = normalizeProfile(obj);
            if (p) {
                mem.profile = p;
                if (p.book) {
                    var inner = normalizeBook(p.book);
                    if (inner) {
                        inner.name = p.name + ' 的内嵌世界书';
                        addBook(inner);
                    }
                }
                afterChange('已导入人设：' + p.name);
                if (p.firstMes && !mem.history.length) say(p.firstMes);   /* 有开场白就先让她说一句 */
                return '';
            }
        }
        var book = normalizeBook(obj);
        if (book) {
            if (!book.name || book.name === 'world') book.name = '世界书 ' + (mem.books.length + 1);
            addBook(book);
            afterChange('已导入世界书：' + book.name + '（' + book.entries.length + ' 条）');
            return '';
        }
        return '这个 JSON 既不是角色卡、也不是世界书或记忆包';
    }

    function addBook(book) {
        var idx = -1;
        for (var i = 0; i < mem.books.length; i++) {
            if (mem.books[i].name === book.name) { idx = i; break; }
        }
        if (idx >= 0) mem.books[idx] = book; else mem.books.push(book);
    }

    function afterChange(msg) {
        save();
        render();
        if (msg) hint(msg);
        console.log('[memory] ' + msg);
    }

    /* ------------------------------------------------------------------ 面板 UI */
    function hint(html) {
        if (elHint) elHint.innerHTML = html;
    }

    function render() {
        if (elProfileName) {
            if (mem.profile) {
                elProfileName.textContent = '人设：' + mem.profile.name +
                    (mem.profile.spec === 'builtin' ? '（内置 · 宇宙管理员）' : '');
            } else {
                elProfileName.textContent = '未启用人设（裸模型）';
            }
        }
        if (elWorldInfo) {
            var n = 0, bi = 0;
            mem.books.forEach(function (b) {
                n += b.entries.length;
                if (b.builtin) bi++;
            });
            elWorldInfo.textContent = mem.books.length + ' 本 / ' + n + ' 条' + (bi ? '（含内置）' : '');
        }
        if (elHistoryInfo) elHistoryInfo.textContent = '历史 ' + mem.history.length + ' 条';
        if (elAuto) elAuto.checked = !!mem.autoAnswer;
    }

    function openPanel(on) {
        if (!elPanel) return;
        var want = (on === undefined) ? !elPanel.classList.contains('is-open') : !!on;
        elPanel.classList.toggle('is-open', want);
    }

    /* 一个隐藏的 file input 轮流干三件事：导入人设 / 世界书 / 记忆 */
    function pickFile(mode) {
        if (!elFile) return;
        mem.fileMode = mode;
        elFile.value = '';
        elFile.accept = (mode === 'profile') ? '.png,.json,.txt' : '.json,.txt';
        elFile.click();
    }

    function importText(text, name) {
        var obj = safeParse(text);
        if (!obj) { hint('这个文件不是合法 JSON：' + str(name)); return; }
        var err = importData(obj);
        if (err) hint(err);
    }

    function importBuffer(buffer, name) {
        /* PNG 先按角色卡解，失败再当文本 JSON 试 */
        try {
            var p = profileFromPng(buffer);
            if (p) { importData(p); return; }
        } catch (e) { }
        var text = '';
        try {
            text = window.TextDecoder
                ? new TextDecoder('utf-8').decode(new Uint8Array(buffer))
                : String.fromCharCode.apply(null, new Uint8Array(buffer));
        } catch (e) { }
        if (text) importText(text, name);
        else hint('这个文件既不是 JSON，也没找到角色卡数据：' + str(name));
    }

    function readFile(file) {
        if (!file) return;
        var name = file.name || '';
        var isPng = /\.png$/i.test(name) || file.type === 'image/png';
        if (mem.fileMode === 'world' && isPng) { hint('世界书要选 JSON 文件'); return; }
        var fr = new FileReader();
        fr.onload = function () { importBuffer(fr.result, name); };
        fr.onerror = function () { hint('读文件失败：' + str(name)); };
        fr.readAsArrayBuffer(file);
    }

    function download(name, text) {
        try {
            var blob = new Blob([text], { type: 'application/json' });
            var a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = name;
            document.body.appendChild(a);
            a.click();
            setTimeout(function () {
                URL.revokeObjectURL(a.href);
                if (a.parentNode) a.parentNode.removeChild(a);
            }, 1000);
        } catch (e) {
            hint('导出失败：' + ((e && e.message) || e));
        }
    }

    function exportFile() {
        var stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        download('lisa-memory-' + stamp + '.json', JSON.stringify(exportAll(), null, 2));
        hint('已导出记忆包：人设 + 世界书 + 对话历史');
    }

    /* 面板上的按钮 */
    if (elBtn) elBtn.addEventListener('click', function () { openPanel(); });
    if (elClose) elClose.addEventListener('click', function () { openPanel(false); });

    var elProfileImport = document.getElementById('lisa-profile-import');
    var elProfileClear = document.getElementById('lisa-profile-clear');
    var elWorldImport = document.getElementById('lisa-world-import');
    var elWorldClear = document.getElementById('lisa-world-clear');
    var elMemExport = document.getElementById('lisa-mem-export');
    var elMemImport = document.getElementById('lisa-mem-import');
    var elMemClear = document.getElementById('lisa-mem-clear');

    if (elProfileImport) elProfileImport.addEventListener('click', function () { pickFile('profile'); });
    if (elProfileClear) elProfileClear.addEventListener('click', clearProfile);
    if (elWorldImport) elWorldImport.addEventListener('click', function () { pickFile('world'); });
    if (elWorldClear) elWorldClear.addEventListener('click', clearWorld);
    if (elMemExport) elMemExport.addEventListener('click', exportFile);
    if (elMemImport) elMemImport.addEventListener('click', function () { pickFile('memory'); });
    if (elMemClear) elMemClear.addEventListener('click', function () {
        if (window.confirm('清空这台浏览器里保存的对话记忆？（人设和世界书会保留）')) clearHistory();
    });
    if (elAuto) elAuto.addEventListener('change', function () {
        mem.autoAnswer = !!elAuto.checked;
        save();
        fire('lisa-autoanswer', { autoAnswer: mem.autoAnswer });
    });
    if (elFile) elFile.addEventListener('change', function () {
        if (elFile.files && elFile.files[0]) readFile(elFile.files[0]);
    });

    /* 文件直接拖到页面上也能导入（PNG 角色卡 / JSON） */
    var dragDepth = 0;
    window.addEventListener('dragenter', function (e) {
        if (!e.dataTransfer || !e.dataTransfer.types) return;
        if (Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') < 0) return;
        dragDepth++;
        if (elDrop) elDrop.classList.add('is-on');
    });
    window.addEventListener('dragover', function (e) { e.preventDefault(); });
    window.addEventListener('dragleave', function () {
        dragDepth = Math.max(0, dragDepth - 1);
        if (!dragDepth && elDrop) elDrop.classList.remove('is-on');
    });
    window.addEventListener('drop', function (e) {
        dragDepth = 0;
        if (elDrop) elDrop.classList.remove('is-on');
        if (!e.dataTransfer || !e.dataTransfer.files) return;
        e.preventDefault();
        mem.fileMode = '';
        for (var i = 0; i < e.dataTransfer.files.length; i++) readFile(e.dataTransfer.files[i]);
        openPanel(true);
    });

    /* ------------------------------------------------------------------ 初始化 + 对外接口 */
    load();
    render();

    /* 首次运行的开场白：等用户第一次点页面（[CLICK] TO START）之后再弹，别打扰开场动画 */
    (function armHello() {
        if (!helloOnStart) return;
        function hello() {
            window.removeEventListener('pointerdown', hello, true);
            window.removeEventListener('keydown', hello, true);
            window.setTimeout(function () {
                say(helloOnStart);
                helloOnStart = '';
            }, 2200);
        }
        window.addEventListener('pointerdown', hello, true);
        window.addEventListener('keydown', hello, true);
    })();

    window.lisaMemory = {
        config: CFG,
        /* 给 llm.js 用 */
        buildMessages: buildMessages,
        buildSystem: buildSystem,
        addTurn: addTurn,
        autoAnswer: function () { return mem.autoAnswer !== false; },
        /* 查看 / 管理 */
        profile: function () { return mem.profile; },
        history: function () { return mem.history.slice(); },
        worldStats: function () {
            var n = 0;
            mem.books.forEach(function (b) { n += b.entries.length; });
            return { books: mem.books.length, entries: n };
        },
        lastHits: lastHits,
        /* 导出 / 导入（对象形式，面板上的按钮走文件） */
        exportAll: exportAll,
        importData: importData,
        importArrayBuffer: importBuffer,      /* 传 ArrayBuffer 也行：PNG 角色卡会被识别 */
        importText: importText,
        /* 面板 / 清理 */
        openPanel: openPanel,
        clearHistory: clearHistory,
        clearWorld: clearWorld,
        clearProfile: clearProfile,
        storageKey: CFG.storageKey
    };

    console.log('[memory] 记忆/人设/世界书已就绪：人设=' + (mem.profile ? mem.profile.name : '内置默认') +
        '，世界书=' + mem.books.length + ' 本，历史=' + mem.history.length + ' 条（缓存键：' + CFG.storageKey + '）');
})();
