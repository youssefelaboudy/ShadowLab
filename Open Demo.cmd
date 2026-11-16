@echo off
cd /d "%~dp0"
call npm.cmd run demo -- --out artifacts\demo
if errorlevel 1 goto end
node tools/export.ts artifacts/demo
if errorlevel 1 goto end
start "" "%~dp0docs\index.html"
:end
pause

