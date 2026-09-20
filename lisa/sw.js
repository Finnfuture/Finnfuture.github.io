/* ===================================================================================
   Lisa 离线缓存 Service Worker —— 「下载过一次的东西，就永远留在本机」
   -----------------------------------------------------------------------------------
   它拦下页面发出的**同源 GET 请求**，把响应存进浏览器 Cache Storage；下次直接给本地副本：
     · 大文件（模型权重 .mlcw/.bin、vosk 模型 .vosk、wasm、glb、exr、mp4、mp3、字体、图片）
       → **缓存优先**：一次下载，之后永远命本地，一个字节都不再从网络取
     · 代码与小配置（.html / .js / .css / .json）
       → **先用缓存渲染 + 后台悄悄更新**（stale-while-revalidate）：打开最快，
         想立刻生效就把 URL 上的 ?v= 加一（本项目已经在用这一招）
     · 页面导航（打开 human.html）→ **网络优先 + 离线兜底**：在线永远是最新的，断网也能开
     · 跨域请求（表情视频 mux 流等）、非 GET、带 Range 的请求 → 原样放行，完全不碰
   页面侧配套在 cache.js：申请「持久化存储」（防止浏览器在磁盘紧张时把缓存清掉）
   + 把全部资源一次性预下载下来（带进度）。
   ⚠️ 改过缓存策略/清单后，把下面的 VERSION 加一：浏览器会自动丢掉旧缓存重建。
   =================================================================================== */
'use strict';

var VERSION = 'lisa-v1';                    /* 改缓存策略就 +1（lisa-v2、lisa-v3…） */
var PREFIX = 'lisa-';
var SHELL = 'lisa-shell-' + VERSION;        /* 页面骨架：装完就能离线打开 */
var RUNTIME = 'lisa-runtime-' + VERSION;    /* 运行期缓存：模型 / 媒体 / 引擎 / 语音 */

/* 骨架清单（相对路径，按 SW 作用域拼绝对地址，GitHub Pages 子目录部署也能对上） */
var SHELL_LIST = ['', 'human.html', 'index.html', 'main.css', 'favicon-32x32.png'];

/* 这些扩展名走「先用缓存 + 后台更新」；其余一律缓存优先 */
var SWR_EXT = /\.(html?|js|mjs|css|json)$/i;

var cancel = { flag: false };

function noop() { }

function scopeUrl(p) {
    try { return new URL(p, self.registration.scope).href; } catch (e) { return p; }
}

/* 通知所有打开的页面（进度、结果） */
function post(msg) {
    self.clients.matchAll({ includeUncontrolled: true }).then(function (cs) {
        cs.forEach(function (c) { try { c.postMessage(msg); } catch (e) { } });
    });
}

/* ------------------------------------------------------------------ 安装 / 更新 */
self.addEventListener('install', function (e) {
    e.waitUntil(caches.open(SHELL).then(function (c) {
        /* 逐个 add：某一个取不到（比如文件还没部署）也不会把整个安装搞失败 */
        return Promise.all(SHELL_LIST.map(function (p) {
            return c.add(scopeUrl(p)).catch(noop);
        }));
    }).then(function () {
        return self.skipWaiting();                 /* 新版本立刻接管，不用等下次打开 */
    }));
});

self.addEventListener('activate', function (e) {
    e.waitUntil(caches.keys().then(function (keys) {
        return Promise.all(keys.map(function (k) {
            if (k.indexOf(PREFIX) === 0 && k !== SHELL && k !== RUNTIME) return caches.delete(k);
        }));
    }).then(function () {
        return self.clients.claim();
    }));
});

/* ------------------------------------------------------------------ 请求拦截 */
self.addEventListener('fetch', function (e) {
    var req = e.request;
    if (req.method !== 'GET') return;
    var url;
    try { url = new URL(req.url); } catch (err) { return; }
    if (url.origin !== self.location.origin) return;      /* 跨域（mux 表情视频等）不碰 */
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
    if (req.headers.get('range')) return;                 /* 音视频拖进度：交给网络 */

    var isNav = (req.mode === 'navigate') || /\.html?$/i.test(url.pathname);
    if (isNav) { e.respondWith(networkFirst(req)); return; }
    if (SWR_EXT.test(url.pathname)) { e.respondWith(staleWhileRevalidate(req)); return; }
    e.respondWith(cacheFirst(req));
});

/* 导航：网络优先，断网回落到缓存 */
function networkFirst(req) {
    return fetch(req).then(function (resp) {
        if (resp && resp.ok) put(RUNTIME, req, resp.clone());
        return resp;
    }).catch(function () {
        return caches.match(req).then(function (hit) {
            if (hit) return hit;
            return caches.match(scopeUrl('human.html')).then(function (h2) {
                return h2 || new Response('离线，而且本地缓存里没有这一页', {
                    status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' }
                });
            });
        });
    });
}

/* 代码 / 小配置：有缓存先给缓存（最快），同时后台更新一份给下次用 */
function staleWhileRevalidate(req) {
    return caches.open(RUNTIME).then(function (c) {
        return c.match(req).then(function (hit) {
            var net = fetch(req).then(function (resp) {
                if (resp && resp.ok) c.put(req, resp.clone()).catch(noop);
                return resp;
            }).catch(function () {
                return hit || new Response('', { status: 504 });
            });
            return hit || net;
        });
    });
}

/* 大文件：缓存优先，没有才去网络拿并顺手存下来 */
function cacheFirst(req) {
    return caches.open(RUNTIME).then(function (c) {
        return c.match(req).then(function (hit) {
            if (hit) return hit;
            return fetch(req).then(function (resp) {
                if (resp && resp.ok && resp.status === 200) c.put(req, resp.clone()).catch(noop);
                return resp;
            });
        });
    });
}

function put(cacheName, req, resp) {
    caches.open(cacheName).then(function (c) { c.put(req, resp).catch(noop); }).catch(noop);
}

/* ------------------------------------------------------------------ 页面发来的指令
   precache：把清单里的资源尽量全下载进本机缓存（已经有的直接跳过），并回报进度
   clear   ：清掉本 SW 管的全部缓存（页面上的「清空缓存」按钮用）
   state   ：回报当前缓存了多少条目、占了多少字节（按响应头的 Content-Length 估） */
self.addEventListener('message', function (e) {
    var d = e.data || {};
    if (d.type === 'precache') doPrecache(d.list || []);
    else if (d.type === 'cancel') cancel.flag = true;
    else if (d.type === 'clear') doClear();
    else if (d.type === 'state') doState();
});

function doPrecache(list) {
    var total = list.length, done = 0, bytes = 0, bytesTotal = 0, failed = [], i;
    for (i = 0; i < list.length; i++) bytesTotal += (list[i].bytes || 0);
    cancel.flag = false;
    post({ type: 'precache-start', total: total, bytesTotal: bytesTotal });

    caches.open(RUNTIME).then(function (c) {
        /* 串行：一次只下一个文件，进度更清楚，也不会把带宽全占满 */
        return list.reduce(function (chain, item) {
            return chain.then(function () {
                if (cancel.flag) return;
                return c.match(item.url).then(function (hit) {
                    if (hit) {                       /* 已经有了（比如上次下过） */
                        done++; bytes += (item.bytes || 0);
                        return post({ type: 'precache-progress', done: done, total: total, bytes: bytes, bytesTotal: bytesTotal, url: item.url, cached: true });
                    }
                    return fetch(item.url, { credentials: 'same-origin' }).then(function (resp) {
                        if (!resp || !resp.ok) throw new Error('HTTP ' + (resp && resp.status));
                        return c.put(item.url, resp).then(function () {
                            done++; bytes += (item.bytes || 0);
                            post({ type: 'precache-progress', done: done, total: total, bytes: bytes, bytesTotal: bytesTotal, url: item.url });
                        });
                    }).catch(function (err) {
                        done++;
                        failed.push(item.url + ' → ' + ((err && err.message) || err));
                        post({ type: 'precache-progress', done: done, total: total, bytes: bytes, bytesTotal: bytesTotal, url: item.url, failed: true });
                    });
                });
            });
        }, Promise.resolve());
    }).then(function () {
        var msg = { type: 'precache-done', done: done, total: total, bytes: bytes, bytesTotal: bytesTotal, failed: failed, canceled: cancel.flag };
        cancel.flag = false;
        post(msg);
        doState();
    }).catch(function (err) {
        post({ type: 'precache-done', done: done, total: total, bytes: bytes, bytesTotal: bytesTotal, failed: failed, error: (err && err.message) || String(err) });
    });
}

function doClear() {
    caches.keys().then(function (keys) {
        return Promise.all(keys.map(function (k) {
            if (k.indexOf(PREFIX) === 0) return caches.delete(k);
        }));
    }).then(function () {
        post({ type: 'cleared' });
        doState();
    });
}

function doState() {
    var out = { type: 'state', version: VERSION, caches: {}, entries: 0, bytes: 0 };
    caches.keys().then(function (keys) {
        var list = keys.filter(function (k) { return k.indexOf(PREFIX) === 0; });
        return list.reduce(function (chain, k) {
            return chain.then(function () {
                return caches.open(k).then(function (c) {
                    return c.keys().then(function (reqs) {
                        out.caches[k] = reqs.length;
                        out.entries += reqs.length;
                        /* 逐条给出 Content-Length（仅头部，不读 body） */
                        return reqs.reduce(function (p, r) {
                            return p.then(function () {
                                return c.match(r).then(function (resp) {
                                    if (!resp) return;
                                    var n = parseInt(resp.headers.get('content-length') || '0', 10) || 0;
                                    out.bytes += n;
                                }).catch(noop);
                            });
                        }, Promise.resolve());
                    });
                });
            });
        }, Promise.resolve());
    }).then(function () {
        post(out);
    }).catch(noop);
}
