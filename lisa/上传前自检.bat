@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

rem =====================================================================
rem  Lisa - pre-upload self check for GitHub Pages  (read-only, changes nothing)
rem    * GitHub hard limit: 100 MiB per file (bigger files make push fail)
rem    * repo size (GitHub Pages suggests <= 1GB)
rem    * key files present / model shards complete / keep the resolve/<seg>/ layer
rem    * cache reminders: sw.js VERSION, script ?v= version bumps
rem  The real logic (and all Chinese output) is in 上传前自检.ps1
rem  This .bat is only a double-clickable entry point.
rem =====================================================================

echo.
echo  ================================================================
echo   Lisa - pre-upload self check for GitHub Pages
echo  ================================================================
echo.

set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS%" set "PS=powershell"

"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0上传前自检.ps1"

endlocal

