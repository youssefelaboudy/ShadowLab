@echo off
cd /d "%~dp0"
if not exist node_modules\yaml call npm.cmd ci
if errorlevel 1 goto end
set "reportDir=artifacts\desktop-%RANDOM%-%RANDOM%"
call npm.cmd run demo -- --out "%reportDir%"
if errorlevel 1 goto end
node tools/export.ts "%reportDir%" "%reportDir%"
if errorlevel 1 goto end
start "" "%~dp0%reportDir%\index.html"
:end
pause

