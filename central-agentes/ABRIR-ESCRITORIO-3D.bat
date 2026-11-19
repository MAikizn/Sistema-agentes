@echo off
chcp 65001 >nul
title Escritorio 3D (Hermes3D)
netstat -ano | findstr /r /c:":3000 .*LISTENING" >nul
if %errorlevel%==0 (start http://localhost:3000/office & exit /b)
cd /d "%USERPROFILE%\Documents\hermes3d" || (echo Rode primeiro o INSTALAR-HERMES3D.bat & pause & exit /b)
if exist ".next\dev\lock" del /q ".next\dev\lock" >nul 2>&1
start "" cmd /c "timeout /t 12 >nul & start http://localhost:3000/office"
set NODE_OPTIONS=--max-old-space-size=4096
call npm run dev
pause
