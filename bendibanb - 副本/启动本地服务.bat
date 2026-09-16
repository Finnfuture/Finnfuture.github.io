@echo off
cd /d "%~dp0"
echo ================================================================
echo  Lisa 3D page - local static server (serves THIS folder)
echo.
echo  Page : http://127.0.0.1:8000/human.html
echo  Audio: http://127.0.0.1:8000/ambient.mp3
echo  Model: http://127.0.0.1:8000/lisa.glb
echo.
echo  Close the server window to stop.
echo ================================================================
start "lisa-http-server" cmd /k python -m http.server 8000 --bind 127.0.0.1
timeout /t 2 >nul
start "" http://127.0.0.1:8000/human.html
