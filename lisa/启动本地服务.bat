@echo off
setlocal
cd /d "%~dp0"

rem =====================================================================
rem  Lisa 3D page - local static server (serves THIS folder)
rem
rem  改动说明①（旧版）：旧版本用的是 python -m http.server 8000 --bind 127.0.0.1，
rem  只监听本机回环地址，手机（局域网）永远连不上 —— 这就是
rem  "手机完全打不开" 的原因。现在按 python 默认行为监听 0.0.0.0，
rem  并把电脑的局域网 IP 算出来打印给你，手机用那个地址访问。
rem
rem  改动说明②（本次）：以前默认打开的是局域网 IP（http://192.168.x.x:8000）。
rem  对浏览器来说那是"非安全上下文"：麦克风会被拒、Service Worker 也用不了，
rem  而且它和 127.0.0.1 属于 **两套完全独立的缓存** —— 换来换去就会
rem  "每次打开都重新下载一遍 276MB 模型"。现在默认打开 127.0.0.1
rem  （安全上下文：麦克风 + 离线缓存都正常），局域网 IP 仍然打印出来给手机用。
rem  想彻底不重复下载：固定用同一个地址（就用本机这个 127.0.0.1）。
rem
rem  首次运行 Windows 防火墙会弹窗问是否允许 python 访问网络，
rem  一定要点 “允许访问 / 专用网络”，否则手机会连不上。
rem =====================================================================

set "PORT=8000"
if not "%~1"=="" set "PORT=%~1"

rem ---- 取本机局域网 IPv4（默认路由那张网卡） ----
set "LANIP="
for /f "delims=" %%i in ('powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-NetRoute -DestinationPrefix '0.0.0.0/0' ^| Sort-Object RouteMetric ^| Select-Object -First 1 ^| ForEach-Object { (Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $_.ifIndex).IPAddress }" 2^>nul') do set "LANIP=%%i"
if "%LANIP%"=="" set "LANIP=127.0.0.1"

rem ---- 选一个能用的 python ----
set "PY=python"
where python >nul 2>nul
if errorlevel 1 set "PY=py -3"

echo ================================================================
echo  Lisa 3D page - local static server (serves THIS folder)
echo.
echo  This PC  (OPENED, use this one) : http://127.0.0.1:%PORT%/human.html
echo  PHONE    (same Wi-Fi)           : http://%LANIP%:%PORT%/human.html
echo.
echo  Tips:
echo    * Use ONE address always. Caches are per-address, so switching
echo      between 127.0.0.1 and the LAN IP downloads the model twice.
echo    * 127.0.0.1/https = secure context: microphone + offline cache work.
echo    * Phone must be on the SAME Wi-Fi. If the phone still cannot open it:
echo        1) allow python.exe through Windows Firewall (Private networks)
echo        2) turn off the router's AP isolation / guest network
echo        3) type the address by hand (do not rely on a QR code)
echo.
echo  Close the server window to stop.
echo ================================================================
start "lisa-http-server" cmd /k %PY% -m http.server %PORT%
timeout /t 2 >nul
start "" http://127.0.0.1:%PORT%/human.html
