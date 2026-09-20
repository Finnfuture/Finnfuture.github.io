#!/usr/bin/env powershell
<#
  Lisa 上传到 GitHub Pages 之前的自检（只读，不改任何文件）
  ---------------------------------------------------------------
  检查这几件最容易翻车的事：
    1) GitHub 单文件 100MiB 硬上限（超了 push 直接被拒）
    2) 仓库总体积（Pages 站点建议 ≤1GB；push/clone 也别太夸张）
    3) 关键文件是否齐全（页面 / 脚本 / 引擎 / 模型 / 语音 / 字体 / .nojekyll …）
    4) 模型权重分片是否漏传（按 tensor-cache.json 里的 dataPath 逐个核对）
    5) 缓存相关提醒：sw.js 的 VERSION、脚本的 ?v=、模型目录里的 resolve/<段>/ 别删
#>
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Set-Location (Split-Path -Parent $MyInvocation.MyCommand.Path)

$red = 'Red'; $green = 'Green'; $yellow = 'Yellow'
$problems = 0

Write-Host "`n===== Lisa 上传前自检 =====" -ForegroundColor Cyan

# ---------- 1) 体积 ----------
$files = Get-ChildItem -Recurse -File | Where-Object { $_.FullName -notmatch '[\\/]\.git[\\/]' }
$total = ($files | Measure-Object Length -Sum).Sum
Write-Host ("文件 {0} 个，总体积 {1:N1} MB" -f $files.Count, ($total / 1MB))

$LIMIT = 100MB
$over = $files | Where-Object { $_.Length -gt $LIMIT } | Sort-Object Length -Descending
if ($over.Count -gt 0) {
    $problems++
    Write-Host "[!!] 有文件超过 GitHub 的单文件 100MiB 上限，push 会被拒：" -ForegroundColor $red
    $over | ForEach-Object { Write-Host ("       {0}  {1:N1} MB" -f $_.FullName.Replace((Get-Location).Path + '\', ''), ($_.Length / 1MB)) }
} else {
    $max = ($files | Sort-Object Length -Descending)[0]
    Write-Host ("[OK] 单文件上限没问题（最大 {0} = {1:N1} MB / 100 MB）" -f $max.Name, ($max.Length / 1MB)) -ForegroundColor $green
}
if ($total -gt 900MB) {
    Write-Host ("[!!] 站点体积 {0:N0} MB 已接近 GitHub Pages 的 1GB 建议上限：大模型建议放别处（对象存储 / 自建）" -f ($total / 1MB)) -ForegroundColor $yellow
}

# ---------- 2) 关键文件 ----------
$need = @(
    'human.html', 'index.html', 'main.css', 'vendors.js', 'app.js',
    'asr.js', 'memory.js', 'llm.js', 'tts.js', 'cache.js', 'sw.js', '.nojekyll',
    'lisa.glb', 'envmap.exr', 'running_code.mp4', 'ambient.mp3', 'favicon-32x32.png',
    'llm/web-llm.js', 'vosk/vosk.js', 'vosk/model.vosk'
)
$missing = @()
foreach ($p in $need) { if (-not (Test-Path $p)) { $missing += $p } }
$wasm = Get-ChildItem 'llm' -Filter '*.wasm' -ErrorAction SilentlyContinue
if (-not $wasm) { $missing += 'llm/*.wasm（WebGPU 计算库）' }
if ($missing.Count) {
    $problems++
    Write-Host "[!!] 这些关键文件不在，Pages 上会 404：" -ForegroundColor $red
    $missing | ForEach-Object { Write-Host "       $_" }
} else {
    Write-Host "[OK] 关键文件齐全（含 .nojekyll，Pages 才不会把下划线开头的文件当 Jekyll 忽略）" -ForegroundColor $green
}

# ---------- 3) 模型权重分片（按 tensor-cache.json 核对） ----------
$modelDirs = Get-ChildItem 'llm/models' -Directory -ErrorAction SilentlyContinue
if ($modelDirs) {
    foreach ($d in $modelDirs) {
        $tc = Get-ChildItem $d.FullName -Recurse -Filter 'tensor-cache.json' -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $tc) { Write-Host ("[!!] {0} 里没有 tensor-cache.json" -f $d.Name) -ForegroundColor $red; $problems++; continue }
        $json = Get-Content $tc.FullName -Raw | ConvertFrom-Json
        $paths = $json.records | ForEach-Object { $_.dataPath } | Sort-Object -Unique
        $lack = @()
        foreach ($p in $paths) { if (-not (Test-Path (Join-Path $tc.DirectoryName $p))) { $lack += $p } }
        if ($lack.Count) {
            $problems++
            Write-Host ("[!!] {0} 少了 {1} 个权重分片（网页会报 404 / tensor-cache 不匹配）：" -f $d.Name, $lack.Count) -ForegroundColor $red
            $lack | Select-Object -First 5 | ForEach-Object { Write-Host "       $_" }
        } else {
            Write-Host ("[OK] {0}：{1} 个权重分片都在（{2}）" -f $d.Name, $paths.Count, $tc.DirectoryName.Replace((Get-Location).Path + '\', '')) -ForegroundColor $green
        }
        if ($tc.FullName -notmatch '[\\/]resolve[\\/]') {
            Write-Host "[!!] 模型目录里没有 resolve/<段>/ 这一层：WebLLM 会去请求 …/resolve/main/… 并 404" -ForegroundColor $red
            $problems++
        }
    }
} else {
    Write-Host "[!!] 没找到 llm/models/ 目录（端侧模型不会工作）" -ForegroundColor $red
    $problems++
}

# ---------- 4) 缓存相关提醒 ----------
$sw = Get-Content 'sw.js' -Raw
$ver = ([regex]::Match($sw, "VERSION\s*=\s*'([^']+)'")).Groups[1].Value
$html = Get-Content 'human.html' -Raw
$vs = [regex]::Matches($html, '(asr|memory|llm|tts|cache)\.js\?v=(\d+)') | ForEach-Object { $_.Groups[1].Value + '=' + $_.Groups[2].Value }
Write-Host ("[i ] sw.js 缓存版本 VERSION = {0}；脚本版本号：{1}" -f $ver, ($vs -join ', '))
Write-Host "[i ] 改过脚本(.js/.css/.html)：把 human.html 里对应的 ?v= 加一；改过缓存策略/清单：把 sw.js 的 VERSION 加一" -ForegroundColor $yellow
Write-Host "[i ] 缓存按「地址 + 目录、每台设备、每个浏览器」各一份：Pages 上全新一次访问约 345MB 流量" -ForegroundColor $yellow

Write-Host ""
if ($problems -eq 0) { Write-Host "===== 自检通过，可以 push 了 =====" -ForegroundColor $green }
else { Write-Host ("===== 有 {0} 处问题，先修再推 =====" -f $problems) -ForegroundColor $red }
Write-Host ""
Read-Host "按回车键关闭"
