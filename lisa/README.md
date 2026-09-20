# Lisa 3D 人物模型 · 精简版说明文档

> 本文档对应目录：`c:\Users\大爷\Desktop\lisa`
> 页面文件：`human.html`（重写过）、`app.js`（打了补丁）、`main.css`（**未改动**）

---

## 1. 这个页面是什么

从 `lisa.locomotive.ca`（Locomotive 的 Lisa 互动页）保存下来的资源中，**只保留「3D 人物模型 + 声音 + 表情视频」**，去掉一切品牌与弹窗相关内容的单页版本。

保留的东西：

| 文件 | 作用 | 备注 |
|---|---|---|
| `human.html` | 页面本身 | 已重写，649 行 / 27.8 KB（含语音 UI）→ 见第 3 节 |
| `app.js` | 主程序（three.js r165 + GSAP + hls.js 打包体） | 打了表情控制器补丁 |
| `main.css` | 站点样式（含 CSS 变量、`.c-lisa*` 全部样式、字体） | 原样未改 |
| `vendors.js` | 兼容性垫片（focus-visible、clipboard 等） | 原样 |
| `asr.js` | **语音输入（VAD + ASR）**：麦克风音量检测 + 语音识别（`engine:'auto'`：Safari/iOS 走**苹果原生听写**，其它走本机离线 Vosk） | 本次新增，纯前端零依赖，见第 3.4 节 |
| `vosk/vosk.js` | **离线识别引擎**（vosk-browser 单文件构建，WASM + Worker 已内联） | 5.8 MB，本地文件 |
| `vosk/model.vosk` | **中文语音模型**（= 官方 `vosk-model-small-cn-0.22.tar.gz`，只改了扩展名） | 43.9 MB，本地文件；叫 `.tar.gz` 会被 IDM 拦截，故改名 |
| `llm.js` | **端侧 GPU 小模型**（WebGPU / WebLLM）：听到你说完一整句就用显卡生成回复 | 本次新增，见第 3.5 节 |
| `memory.js` | **记忆 / 人设 / 世界书**：导入角色卡（PNG/JSON）与世界书、对话记忆本地缓存与导出导入 | 本次新增，见第 3.6 节 |
| `tts.js` | **语音播报（TTS）**：把 Lisa 的回复念出来（默认浏览器内置合成，离线、零依赖；也可换成自己起的本地 TTS 服务） | 本次新增，见第 3.7 节 |
| `sw.js` | **离线缓存 Service Worker**：页面 / 脚本 / 3D 资源 / 离线语音 / 模型权重下载一次就永久留在本机 | 本次新增，见第 3.8 节 |
| `cache.js` | **离线缓存（页面侧）**：申请持久化存储 + 一次性预下载全部资源 + 换地址提醒 | 本次新增，见第 3.8 节 |
| `llm/web-llm.js` | WebLLM 引擎（MLC 的浏览器端推理库，ESM） | 6.6 MB，本地文件 |
| `llm/Qwen2-0.5B-…-webgpu.wasm` | 该模型对应的 WebGPU 计算库 | 4.6 MB，本地文件 |
| `llm/models/Qwen2.5-0.5B-Instruct-q4f16_1-MLC/resolve/v2/` | 模型权重（q4f16 量化，14 个分片） | 276 MB，本地文件；**`resolve/<段>` 这层是 WebLLM 的规则，别删** |
| `lisa.glb` | **人物模型**（2.9 MB） | 网页加载 `./lisa.glb` |
| `envmap.exr` | 环境贴图（HDR） | 网页加载 `./envmap.exr` |
| `running_code.mp4` | 屏幕上的「代码窗口」贴图视频（闪屏用） | 本地文件 |
| `ambient.mp3` | 环境音（101 秒，循环） | 本地文件 |
| `favicon-32x32.png` | 图标 | |
| `PPLocomotiveNew-Light.woff2` / `HelveticaNowDisplay-Regular.woff2` | 字体 | 由 main.css 引用 |
| `表情.txt` | **表情视频清单**（6 条 mux 直播流地址） | 联网播放，见第 4.3 节 |

### 启动方式（必须用本地 HTTP 服务）

```bash
# 在本目录执行任意一种：
python -m http.server 8000
npx serve -l 8000
# 然后浏览器打开：
# http://127.0.0.1:8000/human.html
```

> **不能双击用 `file://` 打开**：浏览器会以 CORS 拦截 `.glb / .exr / .mp4 / .mp3` 的读取，模型和声音都不会出来。

---

## 2. 页面结构 / 交互行为

### 2.1 DOM 结构（就这些）

```
<html class="js-focus-visible is-loaded is-ready" data-theme="lisa">
  head： 基础重置样式 + #main-css（main.css） + 声音按钮样式
  body：
    #preloader（空壳，无任何 Logo，启动后被 app.js 移除）
    main > .c-lisa.is-compact
        ├─ <audio id="lisa-ambient" src="./ambient.mp3" loop>
        ├─ <div class="c-lisa_main" id="lisa-say">                        ← 对白层（弹幕）：复用原站 .c-lisa_main 样式
        ├─ <div class="c-lisa_visualizer" data-module-lisa-visualizer>   ← 3D 画布挂载点
        ├─ <button class="c-lisa_sound" id="lisa-sound">                  ← 声音开关
        ├─ <button class="c-lisa_sound" id="lisa-sound">                  ← **合并后的声音按钮**（环境音 + 语音播报，单击总开关，长按/右键开面板）
        ├─ <button class="c-lisa_voice" id="lisa-voice">                  ← 语音输入开关（说话时图标变声波）
        ├─ <button class="c-lisa_voice" id="lisa-memory-btn">             ← 记忆 / 人设 / 世界书面板开关
        ├─ <div class="c-lisa_voice-bar" id="lisa-voice-bar">             ← 底部实时字幕（上一句 / 定稿 / 草稿 + 光标）
        ├─ <div class="c-lisa_voice-tip" id="lisa-voice-tip">             ← 只在语音出错时出现的提示条
        ├─ <div class="c-lisa_memory" id="lisa-memory">                   ← 记忆 / 人设 / 世界书 + 离线缓存面板
        └─ <div class="c-lisa_memory" id="lisa-tts-panel">                ← 声音 / 语音面板（环境音开关与音量、音色、语速、音调、试听）
    window.preloaderEnterPromise / window.preloaderPromise                ← app.js 启动必需
    ./vendors.js、./app.js、./asr.js、./memory.js、./llm.js、./tts.js、./cache.js（+ Sw 里的 ./sw.js）
```

### 2.2 app.js 的启动链路（为什么要保留那几个元素）

1. `window.onload` → 查找 **`#main-css`**；找不到就只打印 `The "main-css" stylesheet not found`，**永远不会初始化任何模块**（模型也就永远不出来）→ 所以这个 `<link>` 必须留。
2. `roe()` → `noe.init(noe)`：扫描所有 `[data-module-*]` 属性，实例化对应模块。本页只有 `data-module-lisa-visualizer`。
3. `LisaVisualizer` 模块 `init()`：
   `We.init(.c-lisa_visualizer)` → `load()` → `./lisa.glb` + `./envmap.exr` → 在容器内 `prepend(canvas)`；
   然后 `this.call("start", null, "Lisa")`（本页没有 Lisa 对话模块 → 空操作）→ 绑定指针/尺寸事件 → 启动渲染循环。
4. `roe()` 还会用 `window.preloaderEnterPromise` / `window.preloaderPromise` 做开场动画并给 `<html>` 加 `is-loaded / is-ready` → 这两个 Promise 必须留。

### 2.3 交互一览

| 操作 | 表现 |
|---|---|
| 首次进入 | 模型屏幕上显示原站的 **`[CLICK] TO START`**（`We.setDisclaimer("en")`） |
| 点击 / 按键（或环境音自动播放成功） | 开始播放环境音；屏幕「闪一下」并显示第 1 个表情视频；开始空闲轮换 |
| **鼠标向右移动**（累计 ≈150px） | 切换屏幕 **右半边** 为下一个表情视频（带闪屏过渡） |
| **鼠标向左移动** | 切换屏幕 **左半边** 为下一个表情视频 |
| 鼠标静止 7~16 秒 | 65% 概率自动换一个表情（整屏）；35% 概率走原版 `We.setIdle()`（`sre` 随机内容 + 故障参数回落） |
| 点击模型画面 | 人物做一次「后仰」动作（原站 `We.click()` → `moveBack()`） |
| 右下角声音按钮（**合并后**） | 单击 = **声音总开关**：环境音 `ambient.mp3` 与 Lisa 的语音播报一起开 / 关；长按 ≈0.6s 或**右键** = 打开「声音 / 语音」面板（环境音开关与音量、音色、语速、音调、试听）。状态记忆在 `localStorage`：`lisa-muted`（静音）、`lisa-ambient-volume`（环境音音量）、`lisa-tts-v1`（播报设置） |
| **离线缓存（一次下载→永久本机）** | `sw.js` + `cache.js`：页面、脚本、3D 资源、离线语音模型、大模型权重下载一次就进浏览器 Cache Storage，**第二次打开是 0 下载**（断网也能开）；记忆面板里有「预下载全部 / 清空缓存」与缓存用量。⚠️ 缓存按「地址 + 端口」隔离，换地址会重下一遍（详见第 3.8 节） |
| **语音输入（VAD + ASR）** | 点过 `[CLICK] TO START` 之后**自动开麦常听**：一说话就自动识别、边说边出字，停顿 ≈0.8s 自动收句；右下角麦克风按钮可随时开 / 关（详见第 3.4 节） |
| **语音结果展示（对白层 / 弹幕）** | 一开口：底部白色面板升起并实时显示草稿；说完一句：用「乱码落定」定格 + 闪烁光标，停留 ≈7s 后收起；最多保留 3 行，新的一句把旧的往上顶（详见第 3.4 节） |
| **语音播报（TTS）** | Lisa 的回复（对白层里的那行蓝字）会**念出来**：右下角喇叭按钮单击开 / 关，长按或右键打开音色面板（音色 / 语速 / 音调 / 试听）；播报期间用 `asr.js` 的静默闸门按住识别结果，免得她听见自己（详见第 3.7 节） |

---

## 3. 相对「原站快照」做了什么改动

### 3.1 `human.html`：999 行 / 37.9 KB → 454 行 / 16.7 KB

**删掉的内容**

| 分类 | 具体内容 |
|---|---|
| 品牌 / 导航 | `<header>`（Locomotive logo、Work / Agency / Careers / Store 菜单、**Let's talk**、语言切换、Menu）、`<footer>` |
| Cookie 弹窗 | `data-module-cookie-consent` + 整段 `data-cookie-consent-config` JSON（内含 Locomotive 字样与全部 cookie 表格） |
| 对话层 | 两个 `<script type="text/x-template">`（`lisa-template-step` / `lisa-template-form`）、recaptcha、表单校验相关标记 |
| 弹窗 | `.c-video-modal` |
| 其他模块 | `data-module-load`、`data-module-hovers` 等 |
| 外链 / 统计 | Cloudflare 挑战脚本、`iframe` 探针、统计 beacon、`og:` / `twitter:` 之外的远程元数据、远程 favicon / manifest |
| 大段内联 CSS | 原文件 head 里 590 行的 normalize + 主题变量块（变量主体本来就在 `main.css`） |

**保留 & 新增**

| 保留 | 原因 |
|---|---|
| `<link id="main-css" href="./main.css">` | app.js 启动的开关（见 2.2 ①） |
| `window.preloaderEnterPromise` / `window.preloaderPromise` | app.js 启动流程直接使用 |
| `#preloader / #preloaderHead / #preloaderContent / #preloaderLogo` | `ioe()` 会取这四个节点做开场动画，缺了会抛异常导致 `is-loaded / is-ready` 加不上；这里只留空壳（**不含任何品牌 Logo**），完成后自动移除 |
| `.c-lisa_visualizer[data-module-lisa-visualizer]` | 3D 画布容器 |
| `<audio src="./ambient.mp3" loop>` | 环境音（改成相对路径，适配本地目录） |
| 新增：极简基础重置（box-sizing / body / svg fill / 按钮重置 / `::selection`） | 只保留模型与按钮需要的部分 |
| 新增：声音开关按钮（自带样式） | 见 3.3 |

> ⚠️ 说明：原文件是**运行时 DOM 快照**，`data-lisa-content` / `data-lisa-translations` 已经被 app.js 在运行时 `removeAttribute` 抹掉，所以**原站的对话层（文案 / 表单 / 语音）无法从这份文件恢复**，这也是把它整块删掉、只保留独立于对话层的 `LisaVisualizer` 模型模块的原因。

### 3.2 `app.js`：三类改动

**① 视频来源（表情内容全部联网）**

| 位置 | 现在的值 |
|---|---|
| `sre`（空闲随机内容） | 3 条 `https://stream.mux.com/….m3u8`（与 `表情.txt` 一致） |
| `pickMedia()` 表单默认媒体 | `https://stream.mux.com/mAXu5600….m3u8` |
| 调试面板 "Set vimeo video" | 原 vimeo 直链（生产构建下不会触发） |
| `iu`（资源基路径） | **`"./"`** |

`iu` 只影响 **`qZ(iu + "running_code.mp4")`**，即屏幕「代码窗口」贴图（闪屏要用）。原来的 `/assets/lisa/sixty/` 在本地目录不存在会 404，所以保持 `"./"` → 使用同目录的 `running_code.mp4`（唯一一处本地化的视频，**表情视频全部走网络**）。

**② 表情控制器（自写补丁，插在 `LisaVisualizer` 模块作用域内，紧跟 `oP` 类定义之后）**

```js
var LISA_DISCLAIMER = 1;      // 1 = 保留原站 "[CLICK] TO START" 开场
var LISA_MOVE_PX    = 150;    // 触发一次切换所需的鼠标横向位移
var LISA_SWITCH_MS  = 1200;   // 两次切换的最小间隔（节流）
var LISA_EXPRESSIONS = [ /* 表情.txt 里的 6 条 mux 地址 */ ];
var LISA_GLITCH_ON  = { screenGlitchFrequency: 10, screenGlitchIntensity: 1, displayRunningCode: 1 };
var LISA_GLITCH_OFF = { screenGlitchFrequency: .05, screenGlitchIntensity: 0, displayRunningCode: 0 };
```

| 方法 | 作用 |
|---|---|
| `lisaExpr(i)` | 取第 i 个表情地址（支持负数取模） |
| `lisaReady()` | 判断 `We.scene.lisa.screen` 是否就绪（**所有对 glitch 参数的写操作都必须先判断**，否则会抛错） |
| `lisaFlash()` | **原站同款闪屏**：0.22s 把故障强度 / 频率 / 代码窗口拉满，再 1.15s `power2.out` 回落到待机值 |
| `lisaShow(i, side)` | 切换表情：`"left"` → `We.setLeftSideContent`，`"right"` → `We.setRightSideContent`，`"both"` → `We.setContent`；切换前先 `lisaFlash()` |
| `lisaMove(e)` | 累计指针横向位移，方向决定换哪半边 |
| `lisaIdle()` | 7~16s 循环：鼠标静止时 65% 换表情 / 35% `We.setIdle()`（原站空闲逻辑） |
| `lisaStart()` / `lisaBoot()` | 开场提示 → 首次交互后启动整条链路；`lisaBoot` 由 `oP.prototype.init` 的包装函数在模型就绪后调用 |

**③ 播放报错静音**

切表情时旧视频的 `play()` 会被新 `src` 打断，浏览器抛 `AbortError`（原站也有，只是没人管）。补丁里给 `HTMLMediaElement.prototype.play` 加了一层包装，把这次预期内的失败 catch 掉，避免满屏红色报错（不影响任何真实失败的处理，调用方自己挂的 catch 仍然生效）。

### 3.3 声音按钮（**已合并**：环境音 + 语音播报同一颗）

右下角原来有两颗「喇叭」：一颗管 `ambient.mp3` 环境音（原站那颗黑圆），一颗是后加的语音播报开关。
现在**合并成同一颗** `#lisa-sound`：

| 操作 | 行为 |
|---|---|
| **单击** | **声音总开关**：还有声音在响（环境音或播报任一个开着）→ 全部关掉；两个都关着 → 全部打开 |
| **长按 ≈0.6s** / **右键** | 打开「声音 / 语音」面板（`#lisa-tts-panel`）：环境音开关 + 音量、语音播报开关、音色、语速、音调、试听、停止 |
| 图标 | 有声：喇叭 + 声波；全部静音：喇叭 + 叉**并且多一圈白环**（`box-shadow: inset 0 0 0 3px #fff`）；正在念：脉冲光圈（`.is-speak`） |
| 状态记忆 | `lisa-muted`（静音，沿用原站键名）、`lisa-ambient-volume`（环境音音量 0~1，默认 0.5）、`lisa-tts-v1`（播报开关 / 音色 / 语速 / 音调） |

**代码分工**（两半各管一摊，互不干扰）：

- **环境音那一半**在 `human.html` 的内联脚本里：负责 `<audio id="lisa-ambient">` 的播放 / 暂停、音量、
  静音记忆、以及「浏览器拦截自动播放 → 下一次点击页面时重试」的老逻辑；对外只暴露
  `window.lisaSound`（`isOn() / on() / off() / toggle() / volume(v) / state()`）并发 `lisa-sound` 事件。
- **按钮与播报那一半**在 `tts.js` 里：渲染图标、单击总开关、长按/右键开面板、面板里所有控件，
  以及 TTS 的播报与打断逻辑。它通过 `window.lisaSound` 驱动环境音，并监听 `lisa-sound` 事件刷新按钮状态。
- 两者都不存在时各自降级（`tts.js` 找不到 `#lisa-sound` 会退回独立按钮 `#lisa-tts`；环境音脚本找不到
  `window.lisaSound` 时面板里那两行控件就只是不生效）。

> 想单独控制其中一个：点开面板（长按 / 右键）里有两行 —— 「环境音：开 / 关 + 音量」「语音播报：开 / 关」，
> 也可以直接在控制台 `lisaSound.toggle()` / `lisaTTS.toggle()`。

### 3.4 `asr.js` + `vosk/`（本次新增）：语音输入 = VAD + ASR，**引擎自动挑**（Safari → 苹果原生听写 / 其它 → 本机离线 Vosk）

本页没有后端、也没有构建工具，全部用浏览器能力 + 本地 WASM 实现，**一行都没改 `app.js`**：

| 环节 | 用什么 | 说明 |
|---|---|---|
| **VAD** | `getUserMedia` + `AudioContext` + `AnalyserNode` | 每帧取时域数据算 RMS → dB，用「自适应噪声底 + SNR 阈值 + 悬挂时间」判断人声区间（自己写的，不引第三方库）；按钮上那 4 根声波柱就是它的输出 |
| **ASR（Safari / iOS，默认）** | `webkitSpeechRecognition`（**苹果原生听写**，就是 Siri 那套） | `CFG.engine = 'auto'` 时 Safari 自动走这条：中文通常比 WASM 小模型准；Safari 17 / iOS 17 起还能要求 **只在本机识别**（`requiresOnDeviceRecognition`，音频不出设备、断网可用） |
| **ASR（其它浏览器，默认）** | `vosk/vosk.js` + `vosk/model.vosk` | **中文小模型跑在本机 WASM 里**（5.8MB 引擎 + 43.9MB 模型，都是本地文件）：断网可用、音频不出本机，**流式出字** |
| **ASR（手动固定）** | `CFG.engine = 'webspeech'` / `'vosk'` | 想强制用浏览器自带识别（Chrome→Google、Edge→微软）或强制用 Vosk，直接改这一项 |
| **展示** | `human.html` 里新增的 DOM | 右下角麦克风按钮（说话时图标换成 4 根跳动声波 + 脉冲光圈）+ 底部居中字幕（上一句浅色、定稿白色、草稿灰色 + 闪烁光标）+ 只在出错时出现的顶部提示条 |

#### Safari / iOS：苹果原生 ASR 的注意事项（`CFG.engine = 'auto'` 时默认走这条）

Safari（含 iOS / iPadOS 上的**所有**浏览器，它们的 WebKit 内核决定了也只能用苹果识别）支持
`webkitSpeechRecognition`，也就是系统「听写 / Siri」那套识别引擎 —— 好消息是**中文通常比本地小模型准**，
而且新系统上可以完全在设备上跑。踩过的坑与处理：

| 事项 | 说明 / 代码里的处理 |
|---|---|
| **`continuous` 不支持** | Safari 说完一句就 `end`。靠 `onend` 里的**自动重启**接着听（`CFG.restartDelayMs`），再配 VAD 断句，体验接近连续识别 |
| **`interimResults` 支持有限** | 拿不到实时草稿也不影响使用：定稿文字照样出（`partial` 只是"边说边出字"的草稿） |
| **系统听写要打开** | 识别失败会报 `service-not-allowed`：页面会给出中文指引（iOS：设置 → 通用 → 键盘 → **启用听写**；macOS：系统设置 → 键盘 → 听写 / Siri 与听写） |
| **中文语言包** | 报 `language-not-supported` 说明系统里没装中文听写：页面提示去加「中文（普通话）」；不想折腾就把 `CFG.engine` 改成 `'vosk'` |
| **只在本机识别** | `CFG.appleOnDevice = true`（默认）会给识别器设 `requiresOnDeviceRecognition = true`；如果系统没准备好（报 `language-not-supported` / `service-not-allowed`），代码会**自动退回在线识别重试一次**，不会一直卡住 |
| **必须 https / localhost** | 和其它浏览器一样（Safari 对麦克风、识别都要求安全上下文） |
| **手势时机** | Safari / iOS 对"用户手势"很敏感：点过 `[CLICK] TO START` 之后**立即**开麦（其它浏览器仍延时 400ms，避开开场动画） |

**触发链路**：`[CLICK] TO START`（首次 `pointerdown` / `keydown`，用捕获阶段抢在 `app.js` 之前）→ 400ms 后自动 `getUserMedia` 开麦 → 进入 VAD 常听：

- **Vosk 模式（默认）**：首次加载模型（本地文件，实测 **1~2 秒**，之后走 IndexedDB 缓存秒起）→ `new model.KaldiRecognizer(16000)` → `AudioWorklet` 每攒够 4096 个采样就 `acceptWaveformFloat()` 喂一次；**断句由 Vosk 自己按静音完成**（`result` = 整句、`partialresult` = 正在说的草稿）。为了省电与隐私，VAD 只负责 UI 状态与声波，不门控识别器。
- **Web Speech 模式**（把 `CFG.engine` 改成 `'webspeech'`）：能量超阈值 **80ms** 提前启动识别器（抵消它 0.2~0.4s 的启动延迟）→ 持续 **150ms** 判定「正在说话」→ 静音 **800ms** 调 `recognition.stop()` 让它 flush 成定稿 → 在 `onend` 里提交整句。该模式下可用 `CFG.vadGate` 决定「VAD 门控」（省电）还是「识别器常开」（不丢句首）。

**离线原理**：Vosk = Kaldi 的 WASM 编译版。`vosk/vosk.js` 是单文件构建（**WASM 与 Worker 都内联在这一个文件里**，不需要其它资源），`vosk/model.vosk` 就是官方 `vosk-model-small-cn-0.22.tar.gz`（**只改了扩展名**）。worker 会把模型解包进 emscripten 虚拟文件系统并**挂载 IndexedDB 缓存**，所以第二次开麦是秒起。

> ⚠️ **千万别把 `vosk/model.vosk` 改回 `.tar.gz`**：IDM 之类的下载管理器会把 `.tar.gz` 当下载链接截走，worker 里只能拿到空文件，于是报
> `ERROR (VoskAPI:Model():src/model.cc:122) Folder '…' does not contain model files`，并一直卡在加载。
> （本次就是踩了这个坑：解包在 **7ms** 内"完成"、目录为空 —— 排查过程见第 6 节）

#### 对白层（弹幕）—— 直接复用原站样式

原站"Lisa 说话"的那块界面就是 `main.css` 里的 `.c-lisa_main`（从屏幕下方升起的白色圆角面板）+ `.c-lisa-step_dialog`（大字号对白）+ `.-show-cursor`（`lisaCursor` 闪烁光标）。本页**没有重写这套样式**，而是直接用原站类名，只在 `human.html` 里补了几条 `#lisa-say` 覆盖（id 特异性高于 `main.css` 的类选择器，稳定生效）：

```html
<div class="c-lisa_main" id="lisa-say">
    <div class="c-lisa-step" id="lisa-say-step"></div>   <!-- 每句一个 .c-lisa-step_dialog -->
</div>
```

行为（驱动逻辑在 `asr.js`，数据源就是 `window` 的 `'lisa-voice'` 事件，所以两个引擎都适用）：

| 时机 | 表现 |
|---|---|
| 一开口（VAD 判定「正在说话」） | 面板从屏幕下方升起（`is-on`），光标闪，等识别结果 |
| 实时草稿（`partial`） | 当前行文字直接刷新（不加特效，免得抖动） |
| 一句说完（`utterance`） | 当前行做**乱码落定**（随机字符逐个定下来，≈0.2~1.1s），光标闪烁，该行定型为「当前句」 |
| 继续说 | 新的一句另起一行；说过的行降为历史样式（淡一档、无光标），多的被顶掉，最多 `sayMaxLines` 行 |
| 停留 `sayHoldMs`（默认 7s） | 面板滑回屏幕外；再说话会重新升起 |
| 关掉麦克风 | 面板收起并清空历史行（`sayReset()`） |

想改成"不要弹幕、只用原来那条小字幕"，把 `CFG.sayLayer` 改成 `false` 即可（`#lisa-voice-bar` 小字幕会重新启用）。

**对外接口**（以后想接大模型、或让 Lisa 听到话就做动作，都从这里接）：

```js
window.lisaVoice.listen(function (d) { console.log(d.text); });  // 每说完一句回调一次
window.addEventListener('lisa-voice', function (e) { console.log(e.detail); }); // 或监听 window 事件
window.lisaVoice.state();          // { armed, on, engine, voskReady, speaking, recognizing, levelDb, noiseDb, last, draft }
window.lisaVoice.disable();        // 关掉麦克风（保护隐私）
window.lisaVoice.unloadModel();    // 释放离线模型内存（下次开麦重新加载）
window.lisaVoice.setLang('en-US'); // 换识别语言（只对 webspeech 引擎有效）
window.lisaVoice.hold(true);       // 静默闸门：这段时间不提交「你说的」（tts.js 播报她的回复时会用；
                                   // 定稿不提交、对白层不升、字幕条不显示，草稿仍带 quiet 标记派发出来）；
                                   // hold(false) 恢复。它的存在就是为了防「她自己听见自己再回一句」
```

`detail` 形如 `{ type: 'utterance' | 'partial', text: '…', draft: false }`。

**必须知道的几件事**：

1. **麦克风只在 `https` / `http://localhost` 下可用**：桌面用 `http://127.0.0.1:8000/human.html` 没问题；手机用 `启动本地服务.bat` 给出的 `http://192.168.x.x:8000` 属于**不安全上下文**，Chrome 会直接拒绝麦克风（页面会自己弹中文提示；临时办法是把该地址加进 `chrome://flags/#unsafely-treat-insecure-origin-as-secure` 白名单后重启浏览器）。
2. **识别默认完全离线**：模型/引擎都在 `vosk/`，断网可用、音频不出本机；代价是多了 **49MB** 本地文件（`vosk.js` 5.8MB + `model.vosk` 43.9MB），要跟着页面一起部署。
3. **中文小模型精度有限**：安静环境下常用词没问题，专业词/口音会错；想更准可以换更大的 Vosk 模型（如 `vosk-model-cn-0.22`，1.3GB），只替换 `vosk/` 里的模型文件并改 `CFG.voskModel` 即可。
4. **切回云端识别**：把 `CFG.engine` 改成 `'webspeech'` 精度更高、体积归零，但要联网（Chrome 走 Google、Edge 走微软，国内可能连不上并报 `network`），且 **Firefox 没有 Web Speech API**。

### 3.5 `llm.js` + `llm/`（本次新增）：跑在 GPU 上的端侧小模型

让 Lisa 真的能"回话"：**听到你说完一整句 → 用显卡在本机生成回复 → 回复流式打字进对白层**。引擎、计算库、权重全是本地文件，断网可用、数据不出本机。

| 组成 | 文件 | 体积 |
|---|---|---|
| 推理引擎 | `llm/web-llm.js`（WebLLM / MLC 的浏览器端 ESM 构建） | 6.6 MB |
| WebGPU 计算库 | `llm/Qwen2-0.5B-Instruct-q4f16_1_cs1k-webgpu.wasm` | 4.6 MB |
| 模型权重 | `llm/models/Qwen2.5-0.5B-Instruct-q4f16_1-MLC/resolve/v2/`（q4f16，14 个分片） | 276 MB |

> **为什么路径里有 `resolve/<段>/`？** WebLLM 的 `cleanModelUrl()` 会按 HuggingFace 的规则，给模型 URL 补上 `/resolve/main/`（只有 URL 里**已经**含 `resolve/<任意段>/` 时才不补）。所以本地权重就按这个层级摆，`CFG.modelUrl` 里带上这一段就不会被重复追加 —— 之前少了这层，浏览器请求 `…/resolve/main/mlc-chat-config.json` 直接 404，接着连 `Cache.add` 都失败。
>
> 现在这一段是 **`v2`**、不是 `main`：因为我们后来改过分片扩展名，而旧路径下的 `tensor-cache.json` 被浏览器"启发式缓存"住了、仍然指向老的 `.bin`，换个路径段就能让缓存自然失效（普通刷新即可拿到新文件）。同样地，`human.html` 里给 `asr.js` / `memory.js` / `llm.js` 加了 `?v=7`、给 `tts.js` 加了 `?v=1`（脚本一改就把版本号加一，普通刷新也能拿到新版）。
>
> **这个目录里必须有这些文件**（以后换模型照着抄）：`mlc-chat-config.json`、`ndarray-cache.json`、`tensor-cache.json`、`tokenizer.json`、`vocab.json`、`merges.txt`、`tokenizer_config.json`，以及两份 `*-cache.json` 里 `dataPath` 列出的所有权重分片。少任何一个，WebLLM 都会在对应的那个 URL 上报 404（`llm.js` 的 `checkAssets()` 会先把前三个关键文件探一遍）。
>
> ⚠️ **权重分片的扩展名被故意改成 `.mlcw`**（原本是 `.bin`）：IDM 这类下载管理器会把 `.bin` 当下载链接截走，浏览器只拿到 0 字节，接着 WebLLM 就报 `Tensor-cache record range [0, 68067328) exceeds shard size 0`。换模型时如果又遇到这个错，照做即可：分片改成 `.mlcw`，再把 `ndarray-cache.json` / `tensor-cache.json` 里的 `dataPath` 一起改过来（更省心的办法是关掉下载管理器的浏览器集成，或把 `127.0.0.1` 加进它的白名单）。

- **模型**：`Qwen2.5-0.5B-Instruct`（q4f16_1），中文可用；运行显存占用约 **950 MB**
- **首次启动**：会编译 WebGPU 着色器（十几秒~1 分钟），之后权重进 **IndexedDB 缓存**（`appConfig.cacheBackend = 'indexeddb'`，和 Vosk 那套缓存一个思路），再打开直接读缓存、不再传输/解包，几秒就绪
- **触发链路**：点 `[CLICK] TO START` → 2.5 秒后开始预热 → 你说的每句话定稿后（`lisa-voice` 的 `utterance`）自动问它 → 回复用 `say-partial` / `say` 事件流式打进对白层（**蓝色**，和"你说的"区分开）→ 你又开口说话时，会**打断**它正在生成的那一句
- **浏览器要求**：Chrome / Edge 113+（WebGPU），页面在 `https` 或 `http://localhost` 下；没有 WebGPU 时只在顶部提示一次，**语音识别照常工作**（两者互不影响）
- **全部本地路径都按绝对 URL 处理**（`abs()`），避免 WebLLM 内部拼相对路径出错

对外接口：

```js
window.lisaLLM.ask('你好');        // 手动问一句（返回整段回复）
window.lisaLLM.state();            // { webgpu, adapter, ready, busy, progress, model }
window.lisaLLM.abort();            // 打断正在生成的回复
window.lisaLLM.reset();            // 清空对话历史
window.addEventListener('lisa-llm', function (e) { console.log(e.detail); });  // progress / ready / say-partial / say / error
```

想让它"只听不说"（不自动回话），把 `CFG.autoAnswer` 改成 `false`；想改成"用到才加载"，把 `CFG.preload` 改成 `'manual'`。

### 3.6 `memory.js`（本次新增）：记忆 / 人设 / 世界书

让 Lisa 变成"有设定的角色"：右下角那个**书**图标打开面板，可以导入角色卡、世界书，把对话记忆导出/导入；三样数据全部缓存在**这台浏览器**里（`localStorage`，键 `lisa-memory-v1`），刷新不丢、不上传任何地方。

#### 内置内容：宇宙管理员 Lisa（开箱即用）

没导入任何东西时，Lisa 就是**这片宇宙的管理员**：

- **内置人设**：她负责维护从星系到粒子的一切运行参数，但从不直接改写任何生命的选择；你看到的「3D 女孩」是她为了迁就人类感官带宽做的**人形接口**。风格要求：简短、口语化、不炫耀能力、不自称 AI。带一句开场白，首次打开会记进历史，并在你点 `[CLICK] TO START` 约 2 秒后说出来
- **内置世界书**（9 条）：2 条**常驻**（身份 + 人形接口，永远注入）；7 条按关键词命中（`管理/权限/规则`、`时间/多久`、`人类/地球`、`名字/怎么叫`、`记忆/忘记`、`故障/报错`、`宇宙/星系`）
- 面板上两个人设/世界书按钮都叫「**恢复内置**」：导入的卡与世界书会覆盖内置，点它就还原（不会叠加）
- 内置内容也会**一起被导出**进记忆包，换台机器导入即可还原

#### 支持导入的格式

| 能力 | 支持的格式 |
|---|---|
| **人设（角色卡）** | SillyTavern **v2**（`{spec:'chara_card_v2', data:{…}}`）、**v1**（字段直接摊在最外层）、**PNG 角色卡**（读 PNG 的 `tEXt`/`iTXt` 块里的 `chara` / `ccv3`，纯手写解析、不需要库）。卡里若带 `character_book`，会作为"内嵌世界书"一并收下 |
| **世界书** | world info JSON：`{entries:{"0":{…}}}`、`{entries:[…]}`、直接一个条目数组，或单条目；可导入多本叠加 |
| **记忆包** | 本页导出的 `{kind:'lisa-memory', profile, books, history}` 一份 JSON，导入即完整恢复（**人设 + 世界书 + 对话历史**三样都在里面） |
| **导入方式** | 面板按钮选文件，或者**把文件直接拖到页面上**（会提示松手导入） |

**世界书的注入规则**（省 token 的关键）：`constant:true` 的条目**永远注入，而且不占 `maxWorldHits` 名额**（否则开场白里出现几个词就可能把它们挤掉）；其余条目按**命中关键词的个数**排序（多的优先，相同再按 `insertion_order`），一次最多注入 `maxWorldHits` 条（默认 8）；`selective` 的条目还要同时命中 `secondary_keys`；`probability` 支持按概率注入。扫描范围是**最近 `worldScanDepth` 条消息 + 当前这句话**。

**prompt 组装**（`llm.js` 调 `window.lisaMemory.buildMessages()`）：

```
system = "你叫<卡片名>。" + 【角色设定】【性格】【场景】【要求】【对话示例】 + 【背景设定（和当前话题相关）】 + post_history_instructions
messages = [system] + 最近 promptHistory 条历史 + 当前这句
```

**对外接口**：

```js
window.lisaMemory.profile()        // 当前人设对象（name / description / firstMes …）
window.lisaMemory.worldStats()     // { books, entries }
window.lisaMemory.history()        // 对话历史数组
window.lisaMemory.lastHits('咖啡') // 这句话会命中哪几条世界书（调试用）
window.lisaMemory.exportAll()      // 拿到记忆包对象（面板上的「导出记忆」会下载成 JSON）
window.lisaMemory.importData(obj)  // 直接喂对象导入（自动识别：记忆包 / 角色卡 / 世界书）
window.lisaMemory.importArrayBuffer(buf)  // 喂 ArrayBuffer（PNG 角色卡也能认）
window.lisaMemory.clearHistory() / clearWorld() / clearProfile()
window.lisaMemory.openPanel(true)  // 打开面板
```

导入角色卡后如果历史是空的，会先用卡片的 `first_mes` 说一句开场白（进入底部对白层）。

### 3.7 `tts.js`（本次新增）：把 Lisa 的回复念出来（TTS）

让「对话」真的能听见：**她在对白层里说的那一行蓝字会被念出来**。默认用浏览器内置的 `SpeechSynthesis` —— 本机合成、**断网可用、零依赖、不新增任何文件**（和 asr.js 挑「本机离线识别」是同一个思路）；想要更自然的音色，再换成自己起的本地 TTS 服务。

| 环节 | 用什么 | 说明 |
|---|---|---|
| **音色** | `speechSynthesis.getVoices()` | 只列**同语言**（`CFG.lang` 的语言前缀，默认 `zh`）的音色，再按 `voiceHints` 的关键词顺序打分（`Xiaoxiao` → `Xiaoyi` → `Yunxi` → `Huihui` → …），并优先「本机离线」音色；面板里选的音色名存进 `localStorage['lisa-tts-v1']` |
| **播报（默认）** | `SpeechSynthesisUtterance` | **一句一个 utterance**：整段交给引擎容易被截断，逐句播报还能「边生成边念」，句间留 `sentenceGapMs` 换气 |
| **播报（可选）** | `CFG.engine = 'server'` | POST `{text,voice,rate,pitch,lang}` 到本地 TTS 服务（GPT-SoVITS / edge-tts / ChatTTS / CosyVoice…），回来的音频二进制用 `<audio>` 播 |

**触发链路**：`llm.js` 的回复走 `say-partial`（**反复推「到目前为止的整段回复」**）→ 这里只取新长出来的那一段 → 攒够一句（遇到句末标点，或到 `maxChunkChars` 退到最近的逗号）→ 清洗文本 → 入队 → 逐句念；`say` 到达时把剩下的尾巴也念完。`memory.js` 的人设开场白是一条 `say`，同样会被念。

```js
// 半句 -> 整句：半句先在缓冲区里攒着，句末标点一到就念
say-partial "我是 Lisa，这片宇宙"                      -> 不念
say-partial "我是 Lisa，这片宇宙由我维护。欢迎回来…"    -> 念「我是 Lisa，这片宇宙由我维护。」
say-partial 之后同一段反复推来（每次都带全量文本）      -> 只取新增部分，不会重复念
```

**不吵到自己**（这是最容易踩的坑）：她一开口，麦克风必然把扬声器里的她收进去 —— 这些识别结果如果不处理，就会被当成「你说的」再回她一句，于是两个人自己跟自己聊下去。所以：

```
起播      -> window.lisaVoice.hold(true)   // asr.js 静默闸门：定稿不提交、对白层不升、字幕条不显示
播完 / 被打断 -> hold(false)                // 留 holdReleaseMs 余量，等回声散掉再放开
起播保护窗口 guardMs（默认 900ms）          // 这段时间忽略语音事件，防「起播那一下」的回声误打断
```

**被打断（barge-in）**：`CFG.bargeIn = false`（默认）时她会把话说完 —— 你这时候说话**不会被识别**（等她说完再听你）。
戴耳机想随时插话就把 `bargeIn` 改成 `true`：你一出字（`partial`）就停下播报，并把闸门放开，你的话立刻被正常识别。

**界面**（和 `#lisa-sound` **合并**成同一颗按钮，详见第 3.3 节）：

| 元素 | 行为 |
|---|---|
| 右下角喇叭按钮 `#lisa-sound`（黑圆那颗，`bottom: 18px`） | 单击 = **声音总开关**（环境音 + 播报一起）；**长按 ≈0.6s 或右键 = 声音 / 语音面板**；全部静音时声波藏起来（`#lisa-sound.is-off .c-lisa_tts-wave`）+ 一圈白环，正在念时吃 `.is-speak` 的脉冲光圈 |
| 声音 / 语音面板 `#lisa-tts-panel` | 复用 `.c-lisa_memory` 那套深色样式：① 环境音开关 + 音量滑杆；② 语音播报开关；③ 音色下拉 / 语速 / 音调；④ 试听 / 停止 / 重找音色 |
| 记忆按钮与面板 | 记忆面板与声音面板同一个位置（`bottom: 200px`），打开一个会自动收起另一个 |

**对外接口**：

```js
window.lisaTTS.speak('你好呀');            // 手动念一段（不受开关限制）
window.lisaTTS.test();                    // 试听（面板上「试听」按钮调的就是它）
window.lisaTTS.on() / .off() / .toggle()  // 只切「语音播报」这一半
window.lisaTTS.master();                  // 等价于点右下角那颗按钮：环境音 + 播报一起开 / 关
window.lisaTTS.sound();                   // 环境音那一侧的对象（window.lisaSound）
window.lisaTTS.stop();                    // 立刻停下（同时放开 asr.js 的静默闸门）
window.lisaTTS.voices();                  // 当前浏览器的音色列表
window.lisaTTS.setVoice('Microsoft Xiaoxiao Online …');
window.lisaTTS.setLang('zh-CN');          // 换播报语言（会影响挑音色的规则）
window.lisaTTS.panel(true);               // 打开音色面板
window.lisaTTS.state();                   // { supported, enabled, engine, playing, queue, voice, voiceCount, rate, pitch, gate, bargeIn, lastError }
window.addEventListener('lisa-tts', function (e) { console.log(e.detail); });  // sentence / end / error / state
```

**必须知道的几件事**：

1. **音色来自系统**：Windows 在「设置 → 时间和语言 → 语音」里装中文语音包，macOS 自带 `Tingting`，Chrome 还有自带的「Google 普通话」。列表里没有中文音色时不会报错，只是念出来带英文口音 —— 面板上点「重找音色」刷新。
2. **切到后台自动停**：`visibilitychange` 到 hidden 时会 `stop()`（asr.js 那边也停了识别，继续念没意义）；切回来不会自动续念。
3. **和右下角那个圆形「声音」按钮无关**：那个管的是 `ambient.mp3` 环境音；播报音量是 `CFG.volume`。
4. **长句不会被截断**：每句一个 utterance，另有按字数估算时长的看门狗（Chrome 偶尔不触发 `onend`）。

### 3.8 `sw.js` + `cache.js`（本次新增）：**下载一次就永久留在本机**

针对「每次打开网页都在重新下载」这个问题，做了三层保障：

| 层次 | 做什么 | 为什么需要 |
|---|---|---|
| **持久化存储** | `cache.js` 启动时调 `navigator.storage.persist()` | 浏览器在磁盘紧张时会自动清理「尽力而为」型的存储（Cache Storage / IndexedDB 一起清），一清就得重下；拿到持久化授权后就不会被清 |
| **Service Worker** | `sw.js` 拦下**同源 GET**：大文件缓存优先、代码「先用缓存 + 后台更新」、页面导航网络优先 + 离线兜底 | 页面、脚本、`lisa.glb`、`vosk/`、`llm/`（含 276MB 权重）统统进 Cache Storage；第二次打开**一个字节都不再从网络取**，断网也能开 |
| **一次性预下载** | `cache.js` 把清单里的文件逐个拉进缓存（已经有的直接跳过），进度条显示「已缓存 xx / yy MB」 | 不用等"用到才下"：第一次打开就把约 345MB 全存好，之后是 0 下载 |

**清单是自动生成的**（不用手维护）：脚本 / 样式直接从 DOM 里读（`?v=` 是多少就缓存多少）；
大模型这一侧从 `llm.js` 的 `CFG` 拿到模型目录，再读模型自带的 `mlc-chat-config.json`
（`tokenizer_files`）和 `tensor-cache.json`（`dataPath` + `nbytes`）把分词器与所有权重分片枚举出来；
离线语音从 `asr.js` 的 `CFG` 拿 `vosk.js` + `model.vosk`。**以后换模型不用改 cache.js**。

**界面**：记忆面板里多了一行 —— 「预下载全部」「清空缓存」+ 缓存状态（文件数 / 体积 / 是否已持久化）；
预下载期间屏幕下方有一条进度条（`#lisa-offline-bar`，完成 5 秒后自动消失）。

**⚠️ 换地址 = 换缓存**（"每次打开都重新下载"最常见的原因）：
浏览器缓存按「协议 + 主机 + 端口」隔离，`http://127.0.0.1:8000` 与 `http://192.168.x.x:8000`
是**两套完全独立的缓存**。`cache.js` 会记住上次用的地址，换了就弹提示。固定用一个地址最省事，
推荐 `http://127.0.0.1:8000/human.html`（`启动本地服务.bat` 现在默认打开的就是它）。

**其它要点**：

1. **只在安全上下文可用**（https / `http://localhost` / `http://127.0.0.1`）。手机用局域网 IP 打开时
   Service Worker 注册不了 —— 页面会提示；那种情况下模型只能靠浏览器自身的 HTTP / IndexedDB 缓存。
2. **不重复占盘（可选）**：权重既在 WebLLM 的 IndexedDB 里，也在 SW 缓存里（各一份，约 276MB×2）。
   想省磁盘就把 `cache.js` 里的 `CFG.cacheWeights` 改成 `false`（权重的持久化交给 WebLLM 的 IndexedDB）；
   `CFG.cacheVosk = false` 同理跳过那 49MB。
3. **跨域与 Range 请求不碰**：表情视频（`stream.mux.com`）等跨域请求、带 `Range` 的音视频拖动请求
   原样放行，不受影响。
4. **更新代码怎么办**：脚本 / 样式走「先用缓存 + 后台更新」，所以改了文件**把 `?v=` 加一**（本项目一直在用）
   就立刻生效；想彻底重建缓存，把 `sw.js` 顶部的 `VERSION` 加一（`lisa-v1` → `lisa-v2`）。

**对外接口**：

```js
window.lisaOffline.state();      // { supported, secure, entries, cachedBytes, persistent, quota, usage, origin, … }
window.lisaOffline.assets();     // 看清单：现在会缓存哪些文件
window.lisaOffline.precache();   // 手动再跑一次预下载（已经有的会跳过）
window.lisaOffline.clear();      // 清空离线缓存（下次打开会重下）
window.lisaOffline.estimate();   // 本机存储用量 / 配额
window.addEventListener('lisa-offline', function (e) { console.log(e.detail); });  // progress / done / state
```

---

## 4. 可调参数速查

### 4.1 行为参数（都在 `app.js` 的表情控制器开头）

| 变量 | 默认 | 说明 |
|---|---|---|
| `LISA_DISCLAIMER` | `1` | `1` = 保留 `[CLICK] TO START` 开场；改 `0` 可直接进入表情轮换 |
| `LISA_MOVE_PX` | `150` | 鼠标横向累计位移达到多少像素触发一次切换（调小更敏感） |
| `LISA_SWITCH_MS` | `1200` | 两次切换最短间隔，防止疯狂换视频（调小更频繁，但会增加解码压力） |
| `LISA_EXPRESSIONS` | 6 条 | 表情视频列表，顺序即轮换顺序 |
| `LISA_GLITCH_ON / OFF` | 见上 | 闪屏的「拉满」与「回落」参数 |

### 4.2 视觉 / 样式

| 位置 | 变量 | 说明 |
|---|---|---|
| `main.css` `:root` | `--color` / `--color-bg` | 主色（默认黑）与背景色（默认白），声音按钮、屏幕底色都吃这两个值 |
| `main.css` `:root` | `--grid-margin` | 页面边距，46 行按钮距右下角的距离 |
| `human.html` 内联样式 | `.c-lisa_sound { width/height: 44px }` | 按钮尺寸 |
| `human.html` 内联样式 | `.c-lisa_sound-icon svg { width/height: 60% }` | 图标相对按钮的大小 |

### 4.3 表情视频清单（`表情.txt`）

```
1  https://stream.mux.com/5Q3pTwEulaTwVGHEHscqcNiczpzKtiZaYDbjd02xHKw00.m3u8
2  https://stream.mux.com/mAXu5600Bhp70101nP4EU66jdEgBhSl4MIpBIbROPGCdis.m3u8
3  https://stream.mux.com/aCO5naKzdS662xMPN2NjH9ZW9ZdeL0100i301tF024QPWyg.m3u8
4  https://stream.mux.com/SlDvk8aCjdGxd00Kkb02U01YSSVSU1agBMlwUpDExfOGH00.m3u8
5  https://manifest-oci-…/rendition.m3u8?…&expires=1790175600&signature=…   ← 带签名
6  https://manifest-oci-…/rendition.m3u8?…&expires=1790175600&signature=…   ← 带签名
```

- 前 4 条是 mux 的公开播放地址，**长期有效**；后 2 条是**带签名的临时地址**（`expires=1790175600` ≈ **2026-09-23**），过期后到 `app.js` 里把那两行删掉即可。
- 全部是 HLS（`.m3u8`）：Chrome/Edge 由打包进 `app.js` 的 hls.js 播放，Safari 用原生播放。
- **必须联网**（国内网络能否直连 mux CDN 取决于你的网络环境，必要时把地址换成自己的 CDN / 本地文件）。

### 4.4 语音输入参数（都在 `asr.js` 顶部的 `CFG` 里，改完刷新即可）

| 变量 | 默认 | 说明 |
|---|---|---|
| `engine` | `'auto'` | `'auto'` = 自动挑：**Safari / iOS → 苹果原生听写**（`webkitSpeechRecognition`），其它浏览器 → 本机离线 Vosk；也可强制 `'vosk'`（本机离线，断网可用）或 `'webspeech'`（浏览器自带识别，要联网） |
| `appleOnDevice` | `true` | Safari 专用：给识别器加 `requiresOnDeviceRecognition`（**只在本机识别**，音频不出设备、断网可用）；系统没装中文听写包时自动退回在线识别一次 |
| `voskScript` | `'./vosk/vosk.js'` | 离线引擎文件（单文件构建，WASM + Worker 都在里面） |
| `voskModel` | `'./vosk/model.vosk'` | 离线模型文件；**扩展名别改回 `.tar.gz`**，否则会被 IDM 之类下载管理器拦截 |
| `voskSampleRate` | `16000` | Vosk 模型原生采样率，不要改（采集端会按它开 AudioContext） |
| `lang` | `'zh-CN'` | 识别语言（只对 `webspeech` 引擎有效；要英文改 `'en-US'`，也可运行时 `lisaVoice.setLang()`） |
| `sayLayer` | `true` | 是否启用「对白层（弹幕）」；`false` = 改用原来那条小的底部字幕条 |
| `sayScramble` | `true` | 说完一句时是否用「乱码落定」效果（原站同款）；`false` = 直接显示 |
| `sayHoldMs` | `7000` | 说完之后面板停留多久（毫秒）后收起 |
| `sayMaxLines` | `3` | 对白层最多保留几行，超出的从上面顶掉 |
| `vadGate` | `true` | `true` = 检测到人声才开识别器（省电、不上传环境音）；`false` = 识别器常开（不丢句首，但一直上传音频） |
| `preStartMs` | `80` | 能量超阈值多少毫秒就**提前**启动识别器（越大越省，越小越不容易丢句首） |
| `minSpeechMs` | `150` | 持续多久算「真的在说话」（调大能压掉敲键盘、咳嗽之类的误触发） |
| `hangMs` | `800` | 静音多久算「这句话说完了」（觉得收句太急就调大，例如 `1200`） |
| `snrDb` | `9` | 高于环境噪声底多少 dB 算人声（环境吵、容易误触发就调大到 `12`） |
| `minFloorDb` / `maxFloorDb` | `-62` / `-34` | 自适应噪声底的上下限 |
| `captionHoldMs` | `5000` | 说完之后字幕再保留多久（毫秒） |
| `restartDelayMs` / `retryNetworkMs` | `350` / `6000` | 识别器被浏览器结束后 / 网络错误后的重启间隔 |
| `preStartGiveUpMs` | `2500` | 提前启动后多久还没确认在说话，就认作误触发并把识别器停掉 |

界面尺寸、颜色都在 `human.html` 的内联样式里：`.c-lisa_voice`（右下角按钮，`bottom: 78px`）、`.c-lisa_voice-bar`（底部字幕条，`bottom: 92px`）、`.c-lisa_voice-tip`（错误提示条）；声波柱数量就是 `#lisa-voice-bars` 里的 `<i>` 个数（现在是 4 根）；对白层（弹幕）的样式在 `#lisa-say` 那几条覆盖规则里；Lisa 的回复用 `#lisa-say .c-lisa-step_dialog.is-lisa` 的蓝色。

### 4.5 端侧小模型参数（都在 `llm.js` 顶部的 `CFG` 里，改完刷新即可）

| 变量 | 默认 | 说明 |
|---|---|---|
| `modelId` / `modelUrl` / `modelLib` | Qwen2.5-0.5B-Instruct-q4f16_1 | 换模型改这三项（权重目录 + WebGPU 计算库）；WebLLM 的 `prebuiltAppConfig.model_list` 里还有别的模型可挑 |
| `maxTokens` | `160` | 一次最多生成多少 token（调大回复更长、更慢） |
| `temperature` / `topP` | `0.8` / `0.95` | 采样参数（调低更稳、调高更发散） |
| `system` | 中文人设 | 系统提示词（"你是谁、怎么回答"）；留空就不发 system 角色 |
| `autoAnswer` | `true` | `false` = 不自动回话，只能用 `lisaLLM.ask()` 手动调 |
| `preload` | `'idle'` | `'idle'` = 点过 START 后预热；`'manual'` = 用到才加载 |
| `preloadDelayMs` | `2500` | 预热延迟（避开开场动画） |
| `cooldownMs` | `1200` | 两次回话的最小间隔 |

### 4.6 记忆 / 人设 / 世界书参数（都在 `memory.js` 顶部的 `CFG` 里，改完刷新即可）

| 变量 | 默认 | 说明 |
|---|---|---|
| `storageKey` | `'lisa-memory-v1'` | localStorage 缓存键；改它等于换一套独立存档 |
| `maxHistory` | `60` | 本地最多保留多少条对话（超出丢最老的） |
| `promptHistory` | `8` | 每次真正发给模型的历史条数（省上下文） |
| `maxCharsPerMsg` | `400` | 单条消息注入时的截断长度 |
| `maxSystemChars` | `1800` | system 总长上限（4k 上下文要留够生成空间） |
| `maxWorldHits` | `8` | 一次最多注入几条「关键词命中」的世界书（常驻条目不占这个名额） |
| `useBuiltin` | `true` | 是否启用内置的宇宙管理员人设 + 世界书；`false` = 什么都不带的裸模型 |
| `worldScanDepth` | `4` | 匹配世界书时回看最近几条消息 |
| `defaultPersona` | 内置中文人设 | 没导入角色卡时用的默认人设 |

### 4.7 语音播报参数（都在 `tts.js` 顶部的 `CFG` 里，改完刷新即可）

| 变量 | 默认 | 说明 |
|---|---|---|
| `engine` | `'webspeech'` | `'webspeech'` = 浏览器内置合成（离线、零依赖）；`'server'` = 本地 TTS 服务 |
| `lang` | `'zh-CN'` | 期望的语音；挑音色和建 utterance 都用它 |
| `voiceHints` | `['xiaoxiao','晓晓','xiaoyi',…]` | 自动挑音色的偏好顺序（按名字片段匹配，越靠前越优先） |
| `voiceName` | `''` | 指定音色名（面板里选的就是它；清空 = 按 `voiceHints` 自动挑） |
| `preferLocal` | `true` | 优先挑「本机离线」音色（不把文字送去云端合成） |
| `rate` / `pitch` / `volume` | `1.06` / `1.06` / `1` | 语速 / 音调 / 播报音量 |
| `enabled` | `true` | 默认开着播报（用户开关会写进 localStorage 并覆盖它） |
| `autoSpeak` | `true` | `false` = 只认手动 `lisaTTS.speak()`，不自动念回复 |
| `streamSpeech` | `true` | `true` = 边生成边念（按标点断句）；`false` = 等整段生成完再念 |
| `stripText` | `true` | 念之前清洗文本（markdown、括号里的动作、emoji、链接…） |
| `minChunkChars` | `6` | 短于这个字数的一句先攒着，和后面并起来念（避免「嗯。」「好。」） |
| `maxChunkChars` | `110` | 单次最多念多少字（模型飙长句时退到最近的逗号处切开） |
| `sentenceGapMs` | `150` | 句与句之间的停顿（毫秒） |
| `firstDelayMs` | `220` | 收到第一段文字后先等一会儿再开口（多攒几个字，语气更连贯） |
| `guardMs` | `900` | 每次起播后忽略语音事件的时间（防回声误打断） |
| `bargeIn` | `false` | `true` = 你一开口就打断她的播报（耳机下推荐） |
| `selfListen` | `true` | `true` = 播报期间按住 `asr.js` 的静默闸门（防自己跟自己聊） |
| `holdReleaseMs` | `350` | 播完之后多久恢复「接收你说的语音」 |
| `maxQueue` | `6` | 待念的句子最多堆几条（超了丢最早的） |
| `longPressMs` | `600` | 长按喇叭按钮多久算「长按」（打开声音 / 语音面板；右键同效） |
| `storageKey` | `'lisa-tts-v1'` | 开关 / 音色 / 语速 / 音调的 localStorage 键 |
| `server.url` / `.voice` / `.format` / `.timeoutMs` | `''` / `''` / `'wav'` / `15000` | 引擎二：本地 TTS 服务的地址 / 音色 id / 音频格式 / 超时 |

### 4.8 离线缓存参数（`cache.js` 顶部的 `CFG`；`sw.js` 顶部只有 `VERSION`）

| 变量 | 默认 | 说明 |
|---|---|---|
| `swUrl` | `'./sw.js'` | Service Worker 文件位置 |
| `enabled` | `true` | `false` = 不注册 SW（退回浏览器自身的 HTTP / IndexedDB 缓存） |
| `autoPrecache` | `true` | 打开页面后自动把全部资源预下载到本机 |
| `autoPrecacheDelayMs` | `4000` | 预下载的启动延迟（别和开场动画、模型预热抢带宽） |
| `cacheWeights` | `true` | 是否把大模型权重（约 276MB）收进离线缓存；`false` = 只靠 WebLLM 的 IndexedDB（省一份磁盘） |
| `cacheVosk` | `true` | 是否把离线语音（约 49MB）收进离线缓存 |
| `always` | 3D / 声音 / 图标 / 字体清单 | 一定会缓存的本地文件（脚本与样式自动从 DOM 读，不在这里列） |
| `extra` | `[]` | 想额外缓存的相对路径 |
| `sw.js` 里的 `VERSION` | `'lisa-v1'` | **改缓存策略 / 清单后 +1**，浏览器会自动丢掉旧缓存重建 |

---

## 5. 已经跑过的验证（headless Chrome + 本地 HTTP）

| 检查项 | 结果 |
|---|---|
| 页面加载 | 无 JS 异常；只剩 WebGL 驱动性能提示与一条无害的 GSAP 警告 |
| 3D 画布 | `.c-lisa_visualizer canvas` 创建成功，WebGL 上下文正常，模型可辨认（截图逐像素转换字符画确认） |
| 资源加载 | 全部本地：`main.css` `vendors.js` `app.js` `ambient.mp3` `lisa.glb` `envmap.exr` `running_code.mp4` `favicon` |
| 开场状态（不交互） | 显示 `[CLICK] TO START`，**mux 请求 0 条**，环境音处于暂停（被浏览器拦截属正常） |
| 点击之后 | 环境音开始播放，**mux 请求 13~18 条**（表情视频联网加载） |
| 鼠标向右 / 向左 | 屏幕对应半边内容改变（相邻帧像素差异 16~24%，集中在屏幕/胸口区域） |
| 声音按钮 | ① 静音态点一下 → 开始播放 ② 播放中点一下 → 静音 ③ 静音后点模型 → **保持静音**（不被自动播放打开） ④ 再点 → 恢复播放 ⑤ 带 `lisa-muted=true` 刷新 → 保持静音 |
| 按钮显示（逐像素字符画） | 播放中＝白圆+黑图标；静音中＝黑底+白图标，两个状态都清晰可见 |
| 语法 | `node --check app.js` 通过 |
| 语音输入（离线引擎全链路） | `node --check` 通过；逻辑自测（假 DOM + 假 Web Audio + 假 SpeechRecognition）20+ 项断言全过；**无头 Chrome + 假麦克风实测**：点 `[CLICK] TO START` → 自动开麦 → `engine=vosk` → 模型加载 → `voskReady:true` → 识别器建立 → 音频喂入，**5 秒内就绪**；真实 Chrome 里单独验证 `Vosk.createModel()` 成功（模型加载 **1.8s**，`acceptWaveformFloat()` 正常） |
| 语音输入（真人语音） | ⚠️ 还需你本人说一句话确认识别效果（无头环境只有假麦克风）：打开页面 → 点 `[CLICK] TO START` → 允许麦克风 → 说一句中文 → 底部应实时出字、停顿后定稿 |
| 对白层（弹幕） | 无头 Chrome 实测通过：`lisa-voice` 事件驱动下 —— 草稿时面板升起（`is-on`）并带光标；定稿时做乱码落定（中途抓到乱码、结束时完整）；第二句另起一行且上一行降级为历史样式；连发 4 句只保留 3 行；停留 `sayHoldMs` 后面板收起；并核对了 `font-size / color / background / border-radius / z-index` 等计算样式确实吃到 `main.css` 的原站规则（过程中修掉一个真 bug：多句连续时前一句的落定动画被打断、卡在乱码） |
| 端侧 GPU 小模型（`llm.js`） | `node --check` 通过；`llm/web-llm.js` 确认是 ESM 且导出 `CreateMLCEngine`；**无头 Chrome 实测**：`llm.js` 加载成功、`window.lisaLLM` 挂载、`navigator.gpu` 存在但无适配器时走到中文降级提示（`progress 正在检查 GPU…` → `error 这台设备的浏览器没有可用的 WebGPU…`），语音识别不受影响 |
| 端侧小模型（真机生成） | ⚠️ 需要你在**有显卡的 Chrome / Edge** 里确认（无头环境没有 WebGPU 适配器，SwiftShader 也跑不动 276MB 模型）：点 `[CLICK] TO START` 后控制台应出现 `[llm] 端侧模型已就绪：Qwen2.5-0.5B-Instruct-q4f16_1-MLC（跑在 GPU 上）`，然后说一句话，弹幕里应出现**蓝色**的回复 |
| 记忆 / 人设 / 世界书（`memory.js`） | `node --check` 通过；**逻辑单测 47 项全过**（node + 假 DOM）：v2 / v1 / **PNG** 角色卡解析、卡内嵌世界书、世界书三种写法、关键词命中与不命中、`constant` 永远注入、`secondary_keys` 二级命中才注入、`enabled:false` 不注入、prompt 组装（system 在最前、历史进 prompt）、导出/导入往返、清空、非法输入拒绝、localStorage 写入结构。**无头 Chrome 实测 15 项**：面板点开/关闭、导入后人设/世界书/历史文案实时更新、`buildMessages` 含人设与世界书条目、`localStorage` 921 字节结构正确、导出结构正确。过程中修掉四个真 bug：数组自带 `.entries/.keys` 方法导致数组式世界书解析失败；v1 角色卡识别条件不足；内置人设用了 camelCase 字段名导致开场白丢失；`constant` 常驻条目会被 `maxWorldHits` 名额挤掉（已改为常驻不占名额） |
| Safari 苹果原生 ASR（`asr.js`） | `node --check` 通过；`CFG.engine='auto'` 的判定逻辑（Safari/WebKit → `webspeech` 苹果听写，其它 → Vosk；拿不到 `webkitSpeechRecognition` 时自动退回 Vosk）；`requiresOnDeviceRecognition` 只在 Safari 且系统支持时设置，失败（`language-not-supported` / `service-not-allowed`）自动退回在线识别一次；Safari 的 `onend`（不支持 `continuous`）由已有重启逻辑接住。⚠️ **Safari 端还需你在真机（macOS Safari / iPhone）上确认**：无需代理、中文识别质量、系统听写开关提示是否正常 |
| 声音按钮合并（`human.html` + `tts.js`） | 静态检查通过：`#lisa-tts` 已移除，按钮统一为 `#lisa-sound`；`window.lisaSound`（环境音）与 `tts.js`（按钮 + 播报）分工明确，两边各自能降级；`lisa-muted` / `lisa-ambient-volume` / `lisa-tts-v1` 三个键各管一段状态。⚠️ 交互效果请你在真机点一下确认（单击总开关 / 长按与右键开面板） |
| 离线缓存（`sw.js` + `cache.js`） | `node --check` 通过；**实测过一次完整预下载**（无头 Chrome，全新 profile + 127.0.0.1）：`CacheStorage` 落盘 **36 个文件 / 339MB**，与清单预估的 345.8MB 一致（含 8 个权重分片 + `vosk/model.vosk` + `web-llm.js` + `.wasm` + 分词器 + 页面资源）；`navigator.storage.estimate()` 报同量级占用；跨域请求与 HEAD 探测都不进缓存 |
| 语音播报（`tts.js`） | `node --check` 通过；**逻辑自测 44 项全过**（node + 假 DOM + 假 `speechSynthesis`）：流式分句（半句先不念 / 句末才念 / 只念新长出来的那段）、逐句排队与句间停顿、`lisaVoice.hold` 起播按上、播完放开、`guardMs` 内不打断、`bargeIn` 打开后一开口就停、开关与手动 `speak()`、音色优选（同语言 + `voiceHints`）、下拉只列同语言音色、设置写进 localStorage、空文本不炸。**无头 Chrome 真实环境 19 项全过**（真 DOM / 真事件 / 真 `getVoices()`，`speak()` 包一层以便断言）：22 个音色里自动挑中「Google 普通话（中国大陆）」、按钮 class 在开 / 关之间切换、面板试听与点叉关闭、清洗 `**你好**（笑）[emoji] 看看 https://… 还有 [官网](…)` → `你好 emoji 看看 还有 官网。` |
| 语音播报（真人听感） | ⚠️ 需要你自己听一下：点 `[CLICK] TO START` → 说一句话 → 蓝字出现后应当**同时听到**她的声音；长按喇叭打开面板可换音色 / 调语速。若只出字没声音，先看面板里「音色」是不是空的（系统没装中文语音包） |

---

## 6. 常见问题排查

| 现象 | 原因 / 处理 |
|---|---|
| 打开是白屏、没有模型 | 用了 `file://` 双击打开 → 换成本地 HTTP 服务（第 1 节） |
| 模型出来但屏幕/表情不动 | ① 还在 `[CLICK] TO START` 状态 → 点一下页面；② 断网（表情视频是联网的）；③ 看控制台有没有 mux 请求失败 |
| 表情视频偶尔空白 | 命中了 `表情.txt` 第 5/6 条签名地址且已过期（≈2026-09-23）→ 删掉那两行 |
| 右下角按钮看不到图标 | 浏览器缓存了旧的 `human.html` / `main.css` → **Ctrl+F5 强刷** |
| 一进来就没声音 | Chrome 等浏览器默认拦截自动播放 → 点一下页面任意位置或点按钮即可；检查是否点过静音（`localStorage['lisa-muted']`） |
| 关不掉声音 | 已修：静音后点击页面不会再自动开声音；若状态错乱可在控制台 `localStorage.removeItem('lisa-muted')` 后刷新 |
| 点按钮"没反应 / 状态不变" | ① 先 **Ctrl+F5 强刷**（旧 human.html 有缓存）；② 看控制台是否有 `[sound] play() 被浏览器拦截`：有说明浏览器不认这次播放，点一下页面任意处会自动重试；③ 屏幕上的按钮应在"喇叭+声波（无白环）"与"喇叭+叉（带白环）"之间切换，若完全无变化说明文件还是旧的 |
| 想临时调参 | 在控制台直接改 `localStorage` 不生效（这些参数是编译进 `app.js` 的常量），需编辑 `app.js` 里那一小段后再刷新 |
| 控制台出现 `AbortError: play() request was interrupted` | 已用 `HTMLMediaElement.play` 包装静音；若仍看到，说明是页面里其他播放器抛的 |
| 语音：点过 `[CLICK] TO START` 后没有任何反应 | 先看控制台有没有 `[voice] …` 输出：①「麦克风权限被拒」→ 点地址栏的锁图标把麦克风改成允许并刷新；②「必须用 https 或 http://localhost 打开」→ 手机用局域网 IP 访问属于不安全上下文（见第 3.4 节） |
| 语音：能出几个字就断，或提示「连不上语音识别服务」 | Web Speech 的识别在云端（Chrome→Google、Edge→微软），断网 / 被墙就是 `network` 错误：确认能上外网，或改成 Vosk / Whisper 本地模型 |
| 语音：句首一两个字没识别出来 | 用的是「VAD 门控」模式，识别器启动有 0.2~0.4s 延迟：把 `CFG.preStartMs` 调小（如 `40`），或把 `CFG.vadGate` 改成 `false`（识别器常开） |
| 语音：环境吵时乱触发 / 收句太快太频繁 | 把 `CFG.snrDb`（默认 9）、`CFG.minSpeechMs`（默认 150）、`CFG.hangMs`（默认 800）按需要调大 |
| 不想让它一直听麦克风 | 点右下角麦克风按钮关闭（会释放麦克风轨道）；或把 `human.html` 里 `<script src="./asr.js" defer …>` 那行注释掉 |
| **语音一直卡在"正在加载离线语音模型"、控制台报 `Folder '…' does not contain model files`** | 基本就是 **IDM / 迅雷之类下载管理器把模型请求截走了**：① 保持 `vosk/model.vosk` 这个扩展名（**别改回 `.tar.gz`**）；② 或在下载管理器里把 `127.0.0.1` 加进白名单。判断特征：解压在**几毫秒**内就"完成"、目录为空（本次踩坑记录） |
| 语音报 `需要 https 或 localhost` | 手机用局域网 IP（`http://192.168.x.x:8000`）访问属不安全上下文：改回 `localhost` 或用 `chrome://flags/#unsafely-treat-insecure-origin-as-secure` 加白名单 |
| **Vosk 报 `HTTP error! status: 404`，但直接访问模型 URL 明明 200**（尤其部署在 GitHub Pages 项目页 `/仓库名/` 下） | **已修**：Vosk 的 worker 是从 blob URL 创建出来的，它内部用 `new URL(相对路径, blob 去掉前缀后的地址)` 解析 —— 相对路径 `./vosk/model.vosk` 会被解析到**站点根目录**、把 `/仓库名/` 丢掉，于是 404。`asr.js` 现在给 `createModel()` 传**绝对 URL**。任何"页面不在站点根目录"的部署都会踩这个坑（本地测试时页面在根目录，所以一直没暴露） |
| **首次打开很慢**（要下 Vosk 43MB + LLM 276MB） | 这是在下模型本体，不是卡死：① 屏幕上会有一条进度提示（"端侧模型加载中 xx%"）；② 现在两个模型**串行预热**（先等 Vosk 就绪再拉 LLM），不再互相抢带宽；③ **第二次打开走浏览器缓存**（Vosk → IndexedDB、LLM → IndexedDB），快很多；④ 服务器带宽差（如 GitHub Pages 在国内）可把 `vosk/`、`llm/` 换成对象存储/自建地址的绝对 URL |
| 对白层（弹幕）样子不对 / 位置怪 | 它吃的是 `main.css` 里原站那套 `.c-lisa_main` 样式：① 确认 `<link id="main-css" href="./main.css">` 还在（app.js 也依赖它）；② 想挪位置、改配色，就改 `human.html` 里 `#lisa-say` 那几条覆盖规则；③ 不想用它就设 `CFG.sayLayer = false`（回到小的底部字幕条） |
| 顶部提示「没有可用的 WebGPU」 | 端侧小模型要 Chrome / Edge 113+，且页面在 `https` / `http://localhost` 下；老版 Chrome 可在 `chrome://flags/#enable-unsafe-webgpu` 里开。**开不了也没关系，语音识别照常工作** |
| 控制台报 `…/resolve/main/mlc-chat-config.json 404` 接着 `Failed to execute 'add' on 'Cache'` | 模型目录层级不对（**已修**）：WebLLM 会把模型 URL 当 HF 仓库地址、自动补 `/resolve/main/`，所以权重必须摆在 `llm/models/<模型名>/resolve/main/` 下。现在 `llm.js` 里的 `checkAssets()` 会先 HEAD 探测，报错时直接告诉你**是哪个 URL 404** |
| `Tensor-cache record range [0, N) exceeds shard size 0`，同时看到 IDM / 迅雷弹窗要下 `params_shard_x.bin` | 下载管理器把权重分片截走了，浏览器拿到 0 字节（**已修**）：分片扩展名改成 `.mlcw`，两份 `*-cache.json` 的 `dataPath` 也同步改了。建议顺手把 `127.0.0.1` 加进下载管理器白名单，一劳永逸 |
| `An AudioWorkletProcessor with name "lisa-tap" is already registered` | 采集节点重复初始化（`addModule()` 异步期间的竞态，**已修**：加了 `tapPending` 守卫）。这个报错只影响麦克风采集，刷新页面即可 |
| 小模型加载很久 / 加载失败 | 首次要编译 WebGPU 着色器（十几秒~1 分钟）并把 276MB 权重写进 IndexedDB，控制台会打 `progress` 进度，耐心等；失败时看控制台：`Failed to fetch …/llm/…` = 模型文件没跟着部署；显存不足则会报 WebGPU / OOM（需要约 1GB 空闲显存） |
| Lisa 不自动回话 | ① `CFG.autoAnswer` 是否为 `true`；② `lisaLLM.state().ready` 是否为 `true`；③ 控制台有没有 `[llm] 生成失败` —— 若模型模板不接受 system 角色，代码会自动去掉 system 重试一次 |
| 想让它别用显卡 / 别自动跑 | 把 `human.html` 里 `<script src="./llm.js" …>` 那行注释掉；或把 `CFG.preload` 改成 `'manual'`（不预热，只在你手动 `lisaLLM.ask()` 时才加载）；或 `CFG.autoAnswer = false`（只听不说） |
| 导入角色卡没反应 / 提示"不是角色卡" | 面板底部会直接给原因：① 文件得是合法 JSON（PNG 卡走 `chara`/`ccv3` 块）；② 角色卡至少要有一个内容字段（`description` / `personality` / `scenario` / `system_prompt` / `first_mes`）；③ 带 `character_book` 的卡会连内嵌世界书一起收下 |
| 世界书导入了但回答里没用上 | 世界书是**关键词命中**才注入：确认条目 `enabled` 不是 false、`keys` 里有你话里会出现的词（用 `lisaMemory.lastHits('你的一句话')` 看命中）；`constant:true` 的条目才是永远注入 |
| 想换一套存档 / 彻底清干净 | 面板三个按钮分别清人设、世界书、对话记忆；换独立存档就改 `memory.js` 的 `storageKey`，或控制台 `localStorage.removeItem('lisa-memory-v1')` |
| 播报：只出字、没有声音 | ① 右下角喇叭按钮是不是被关掉了（半透明、没有声波就是关着）；② 长按喇叭打开面板看「音色」列表：空的说明系统没装中文语音包（Windows：设置 → 时间和语言 → 语音 → 添加语音）；③ 控制台有没有 `[tts]` 开头的报错（`CFG.engine='server'` 时没配 `CFG.server.url` 会明确提示） |
| 播报：她念到一半突然停 | 这段时间麦克风里出现了「在说话」的判定，而 `CFG.bargeIn` 被打开了（默认是 `false`）—— 音箱外放时她会被自己的声音打断：戴耳机，或把 `bargeIn` 改回 `false` |
| 播报：她开始自问自答 | 静默闸门没起作用：确认 `asr.js` 是最新版（`window.lisaVoice.hold` 存在）、`CFG.selfListen` 为 `true`；应急可关掉 `CFG.bargeIn` 并把 `guardMs` 调大（如 `1500`） |
| 播报：说话时「你说的」不被识别 | 这是**故意**的：播报期间 `asr.js` 的静默闸门会按住提交（防自激）。想边说边插话：戴耳机 + `CFG.bargeIn = true` |
| 播报：想更自然的声音 | 浏览器内置合成是「能用、离线、零依赖」的水平；要更像人就把 `CFG.engine` 改成 `'server'` 并填 `CFG.server.url`，接自己起的本地 TTS（GPT-SoVITS / edge-tts / ChatTTS / CosyVoice 都行，只要 POST JSON 回来音频） |
| **Safari / iPhone：识别不了、或提示要让打开听写** | Safari 用的是**苹果原生听写**（不是 Google / 微软那套）：① iOS：设置 → 通用 → 键盘 → **启用听写**，并把「中文（普通话）」加进听写语言；② macOS：系统设置 → 键盘 → 听写、以及「Siri 与听写」里允许听写；③ 页面必须在 https 或 `http://localhost` 下并允许麦克风。做不到这些就把 `asr.js` 的 `CFG.engine` 改成 `'vosk'`（本机离线小模型，不依赖系统） |
| Safari：想确认音频到底有没有出本机 | `lisaVoice.state()` 里的 `safari: true, onDevice: true` 表示**只在本机识别**（`requiresOnDeviceRecognition` 生效）；如果控制台出现「苹果本机听写不可用（…），改为在线识别重试一次」，说明系统缺中文听写包，这次退回了 Apple 的在线识别 |
| **右下角那颗喇叭为什么管两件事** | 2026-09 起把原来两颗按钮（环境音 / 语音播报）合并成一颗：单击 = 全部开 / 关，**长按或右键** = 面板里分别控制「环境音（开关 + 音量）」与「语音播报（开关 + 音色 / 语速 / 音调）」 |
| **每次打开都还在重新下载模型** | ① 先看**访问地址是不是变了**：`127.0.0.1:8000` 与 `192.168.x.x:8000`、`localhost:8000` 是**三套不同的缓存**，换来换去等于每次重下（`cache.js` 会弹提示）；② 看是不是**非安全上下文**（局域网 IP）：那种情况下 Service Worker 注册不了，缓存只剩浏览器自身的 HTTP / IndexedDB；③ 打开记忆面板看「离线缓存」那行：正常应显示「已缓存 30+ 个文件 / 300+ MB · 已持久化」，是 0 就点「预下载全部」；④ 浏览器清理数据 / 隐私模式下每次都会重下 |
| 改了文件但页面还是旧的 | 脚本 / 样式走「先用缓存 + 后台更新」：**把 `?v=` 加一**（如 `llm.js?v=7` → `v=8`）或把 `sw.js` 的 `VERSION` 加一，刷新即可；也可以 `lisaOffline.clear()` 清空缓存后再刷新 |

---

## 7. 想继续扩展的话

- **换/加表情**：改 `app.js` 里 `LISA_EXPRESSIONS` 数组即可（新增任意 mp4 或 m3u8 都能播）。
- **左右各用一套表情**：把 `lisaShow()` 里的索引分成左右两组（当前左右共用同一个数组、各自轮换）。
- **改回「点哪里都换表情」**：在 `lisaBoot()` 里给 `We.$wrapper` 加 `click` 监听调用 `lisaShow(++index, "both")`。
- **恢复原站对话层**：需要另外拿到官网的 `data-lisa-content` / `data-lisa-translations` JSON（本快照里已被运行时删除），再把两个 `x-template` 与 `data-module-lisa` 加回来。
- **完全离线**：把表情视频下载到本地，替换 `LISA_EXPRESSIONS` / `sre` 为 `./xxx.mp4`，并把 `iu` 指向本地目录即可。
- **接大模型 / 让 Lisa 回应你说的话**：`window.lisaVoice.listen(function (d) { /* d.text 就是整句 */ })`，在回调里调你自己的接口，拿到回复后可以再用 `We.setContent(...)` 换屏幕内容或 `We.setIdle()`（`We` 的可用方法见 `app.js` 里的 `LisaVisualizer`）。
- **让她用别的声音说话**：`window.lisaTTS.setVoice('音色名')`（音色名取自 `lisaTTS.voices()`），或把 `tts.js` 的 `CFG.engine` 改成 `'server'` 接自己的 TTS 服务（`POST {text,voice,rate,pitch,lang}` → 音频二进制即可）；想让播报只在某些时候发生，就关掉 `CFG.autoSpeak`，用 `lisaTTS.speak()` 手动触发。

---

## 8. 部署到 GitHub Pages（可以生效，注意几点）

GitHub Pages 是 **HTTP(S) 静态服务**，所以：
- ✅ 不会再出现 `file://` 那种"音频/模型被拦、按钮看着没用"的问题；
- ✅ 相对路径（`ambient.mp3` / `lisa.glb` / `envmap.exr` / `running_code.mp4`）在同仓库子目录下也能正常加载；
- ✅ 表情视频走 `stream.mux.com`（HTTPS），不会和页面产生混合内容问题。

推送前建议：

| 事项 | 说明 |
|---|---|
| **加 `.nojekyll`** | 仓库根目录放一个空文件 `.nojekyll`，避免 GitHub Pages 用 Jekyll 处理时忽略/改写文件（本目录已放好） |
| **仓库名用 ASCII** | 建议 `lisa-3d` 这类名字；本目录名 `lisa` 已经是纯 ASCII，直接用即可（历史上它叫 `bendibanb - 副本`，带空格和中文，URL 里会变成 `%20`/百分号编码，能用但难维护） |
| **把本目录内容推到仓库根** | 或者任意子目录都行（页面用的是相对路径）；Pages 设置里选对应分支/目录即可 |
| **体积** | 现在约 **340 MB**：`llm/models/` 276 MB + `llm/web-llm.js` 6.6 MB + `llm/*.wasm` 4.6 MB、`vosk/model.vosk` 43.9 MB、`vosk/vosk.js` 5.8 MB、`ambient.mp3` 4 MB、`lisa.glb` 2.9 MB、`app.js` 2.9 MB。**GitHub 单文件 100 MB 的上限仍然满足**（最大单文件是 `params_shard_0.bin` 65 MB），但仓库 340MB，push/clone 会明显变慢；介意的话可把 `vosk/`、`llm/` 放到别的静态服务上，再把 `CFG.voskModel` 与 `llm.js` 里的 `modelUrl` / `modelLib` 改成绝对 URL |
| **`启动本地服务.bat`** | 只在本地双击有用，推上去也不影响（可以删掉） |
| **CORS / MIME** | GitHub Pages 会给 `.mp3` 发 `audio/mpeg`、`.woff2` 发 `font/woff2`；`.glb` / `.exr` 一般是 `application/octet-stream`，three.js 用 arraybuffer 读取，不受影响 |
| **字体** | `main.css` 里是 `/xxx.woff2` 这种根路径，仓库在子路径下会 404；本页已在 `human.html` 里用**相对路径 `@font-face` 覆盖**，所以子目录部署也正常 |
| ⚠️ **大文件必须真的推上去** | `vosk/`（49MB）和 `llm/`（287MB）要跟页面一起提交推送。**Git LFS 不行**：GitHub Pages 不支持 LFS，页面拿到的是几百字节的指针文件，表现就是 `vosk/model.vosk` 404、Vosk 报 `HTTP error! status: 404`（`asr.js` / `llm.js` 现在会先 HEAD 探测并明确报出是哪个 URL）。检查方法：在仓库网页上点开这些文件，看大小是不是真实大小 |
| ⚠️ **子目录部署要注意相对路径** | 页面不在站点根目录（GitHub Pages 项目页 `/仓库名/`）时，**从 blob worker 里发起的请求**会把相对路径解析到站点根目录。`asr.js` 已改成传绝对 URL；如果你以后自己改路径，记得也用绝对地址（代码里的 `abs()`） |
| **字体的两个 404 可以无视** | `main.css` 里 `@font-face` 用的是根路径 `/PPLocomotiveNew-Light.woff2`，子目录部署时浏览器必然报两个 404；`human.html` 已经用相对路径的 `@font-face` 覆盖，字体显示正常 |
| ⚠️ **签名视频会过期** | `表情.txt` 最后两条是带签名的临时地址（`expires=1790175600` ≈ **2026-09-23**），过期后会 403；长期用请只保留前 4 条公开地址 |
| ⚠️ **访客网络要求** | 表情视频要能访问 mux CDN；若访客网络访问不了，模型和声音仍正常，只是屏幕上的表情视频不出来 |

> 另外：`human.html` 里那段"检测 `file://` 就盖提示层"的逻辑，在 Pages 上不会触发（协议是 `https:`），无需改动。

---

## 9. 附

- 目录里 **`main.css`、`vendors.js`、`lisa.glb`、`envmap.exr`、`running_code.mp4`、`ambient.mp3`、字体、`表情.txt` 均未改动**；本次改动清单：`human.html`（重写 + 语音 UI + 对白层 + 记忆面板 + **环境音/播报合并成一颗声音按钮** + 离线缓存那行）、`app.js`（三类补丁）、**新增 `asr.js`**（VAD + 双引擎 ASR：`engine:'auto'` → Safari 走**苹果原生听写**、其它走离线 Vosk，另带给播报用的静默闸门 `lisaVoice.hold`）、**新增 `vosk/`**（`vosk.js` 5.8MB + 中文模型 `model.vosk` 43.9MB）、**新增 `llm.js` + `llm/`**（端侧 GPU 小模型：WebLLM 引擎 6.6MB + WebGPU 计算库 4.6MB + Qwen2.5-0.5B 权重 276MB）、**新增 `memory.js`**（记忆 / 人设 / 世界书，纯 localStorage 缓存）、**新增 `tts.js`**（语音播报：浏览器内置合成，离线零依赖；可选接本地 TTS 服务）、**新增 `sw.js` + `cache.js`**（离线缓存：下载一次 → 永久本机，第二次打开 0 下载）、`启动本地服务.bat`（默认改成打开 `127.0.0.1`，避免和局域网 IP 用成两套缓存）。
- 桌面上另有 `bendibanb\`（原始快照，未改动）与 `bendibanb.zip`，需要对照或回退时可用。
- `app.js` 是压缩打包体，补丁以**独立段落注入**（只替换了 3 处字符串 + 在 `oP` 类后插入一段自包含代码），格式化/压缩工具不要再压缩这段，否则注释与可读结构会丢。
