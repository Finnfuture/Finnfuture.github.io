# Lisa 3D 人物模型 · 精简版说明文档

> 本文档对应目录：`c:\Users\大爷\Desktop\bendibanb - 副本`
> 页面文件：`human.html`（重写过）、`app.js`（打了补丁）、`main.css`（**未改动**）

---

## 1. 这个页面是什么

从 `lisa.locomotive.ca`（Locomotive 的 Lisa 互动页）保存下来的资源中，**只保留「3D 人物模型 + 声音 + 表情视频」**，去掉一切品牌与弹窗相关内容的单页版本。

保留的东西：

| 文件 | 作用 | 备注 |
|---|---|---|
| `human.html` | 页面本身 | 已重写，454 行 / 16.7 KB → 见第 3 节 |
| `app.js` | 主程序（three.js r165 + GSAP + hls.js 打包体） | 打了表情控制器补丁 |
| `main.css` | 站点样式（含 CSS 变量、`.c-lisa*` 全部样式、字体） | 原样未改 |
| `vendors.js` | 兼容性垫片（focus-visible、clipboard 等） | 原样 |
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
        ├─ <div class="c-lisa_visualizer" data-module-lisa-visualizer>   ← 3D 画布挂载点
        └─ <button class="c-lisa_sound" id="lisa-sound">                  ← 声音开关
    window.preloaderEnterPromise / window.preloaderPromise                ← app.js 启动必需
    ./vendors.js、./app.js
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
| 右下角声音按钮 | 当前没声音 → 点它开始播放；正在响 → 点它静音（状态记忆在 `localStorage['lisa-muted']`） |

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

### 3.3 声音开关按钮（完全自带实现）

- **语义**：当前没声音（自动播放被拦 / 已静音）→ 点它 **开始播放**；正在响 → 点它 **静音**。
- **记忆**：`localStorage['lisa-muted']`（沿用原站键名），刷新后保持；静音后「点击页面自动播放」那条逻辑不会再抢着开声音。
- **外观**：44×44 黑圆 + 白色图标，右下角 `var(--grid-margin)`，`z-index: 9999`；
  - 播放中：「喇叭 + 声波」
  - 静音中：「喇叭 + 叉」**并且多一圈白环**（`box-shadow: inset 0 0 0 2px`），状态一眼可辨
  - 每次切换会弹一下（`-pop` 关键帧动画），明确反馈"点到了"
  - `main.css` 里那套「两个图标上下叠 + 白圆滑动反色」的机制已用 `.c-lisa_sound:before { display:none !important }` 停用（它依赖白圆位移来反色，本页用不到，之前正是它导致静音时黑图标叠黑底看不见）
- **点击可靠性**（都踩过坑，逐条修过）：
  - 同时监听 `pointerup` 与 `click`：按下时指针略动会导致浏览器不派发 `click`，靠 `pointerup` 兜底；
  - 去重用**手势标记**（`pointerdown` 重置）而不是时间窗口 —— 按时间窗口会把"快速连点第二下"吃掉；
  - 键盘 `Enter` / `空格` 显式处理（并同样走去重）；
  - 图标状态以"音频是否真的在响"为准，另有 500ms 定时器兜底自愈，不会出现图标与声音不同步；
  - `start()` 里先把 `audio.muted = false` 强制解开（防止元素级静音卡死）；
  - 一旦 `play()` 被浏览器拦下，会打印 `[sound] play() 被浏览器拦截：NotAllowedError`，并在**下一次点击/按键**自动重试（点在按钮上的手势会跳过，避免与按钮自身切换抢跑）。

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

---

## 7. 想继续扩展的话

- **换/加表情**：改 `app.js` 里 `LISA_EXPRESSIONS` 数组即可（新增任意 mp4 或 m3u8 都能播）。
- **左右各用一套表情**：把 `lisaShow()` 里的索引分成左右两组（当前左右共用同一个数组、各自轮换）。
- **改回「点哪里都换表情」**：在 `lisaBoot()` 里给 `We.$wrapper` 加 `click` 监听调用 `lisaShow(++index, "both")`。
- **恢复原站对话层**：需要另外拿到官网的 `data-lisa-content` / `data-lisa-translations` JSON（本快照里已被运行时删除），再把两个 `x-template` 与 `data-module-lisa` 加回来。
- **完全离线**：把表情视频下载到本地，替换 `LISA_EXPRESSIONS` / `sre` 为 `./xxx.mp4`，并把 `iu` 指向本地目录即可。

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
| **仓库名用 ASCII** | 建议 `lisa-3d` 这类名字；当前文件夹名带空格和中文（`bendibanb - 副本`），URL 里会变成 `%20`/百分号编码，能用但难维护 |
| **把本目录内容推到仓库根** | 或者任意子目录都行（页面用的是相对路径）；Pages 设置里选对应分支/目录即可 |
| **体积** | 这个目录总共约 15 MB，最大的 `ambient.mp3` 4 MB、`lisa.glb` 2.9 MB、`app.js` 2.9 MB —— 远低于 GitHub 单文件 100 MB 限制，没问题 |
| **`启动本地服务.bat`** | 只在本地双击有用，推上去也不影响（可以删掉） |
| **CORS / MIME** | GitHub Pages 会给 `.mp3` 发 `audio/mpeg`、`.woff2` 发 `font/woff2`；`.glb` / `.exr` 一般是 `application/octet-stream`，three.js 用 arraybuffer 读取，不受影响 |
| **字体** | `main.css` 里是 `/xxx.woff2` 这种根路径，仓库在子路径下会 404；本页已在 `human.html` 里用**相对路径 `@font-face` 覆盖**，所以子目录部署也正常 |
| ⚠️ **签名视频会过期** | `表情.txt` 最后两条是带签名的临时地址（`expires=1790175600` ≈ **2026-09-23**），过期后会 403；长期用请只保留前 4 条公开地址 |
| ⚠️ **访客网络要求** | 表情视频要能访问 mux CDN；若访客网络访问不了，模型和声音仍正常，只是屏幕上的表情视频不出来 |

> 另外：`human.html` 里那段"检测 `file://` 就盖提示层"的逻辑，在 Pages 上不会触发（协议是 `https:`），无需改动。

---

## 9. 附

- 目录里 **`main.css`、`vendors.js`、`lisa.glb`、`envmap.exr`、`running_code.mp4`、`ambient.mp3`、字体、`表情.txt` 均未改动**；只改了 `human.html`（重写）与 `app.js`（三类补丁）。
- 桌面上另有 `bendibanb\`（原始快照，未改动）与 `bendibanb.zip`，需要对照或回退时可用。
- `app.js` 是压缩打包体，补丁以**独立段落注入**（只替换了 3 处字符串 + 在 `oP` 类后插入一段自包含代码），格式化/压缩工具不要再压缩这段，否则注释与可读结构会丢。
