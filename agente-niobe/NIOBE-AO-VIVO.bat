@echo off
chcp 65001 >nul
title Niobe ao vivo
set "FILMCRAFT_CONTROL_TOKEN=b2c8a8e0407e930350686da066ba38a0a2b0fc8b21e4363149c4821b7a781ea5"
set "FC=%ProgramFiles%\ArtCraft\FilmCraft\filmcraft.exe"
if not exist "%FC%" set "FC=%LOCALAPPDATA%\Programs\ArtCraft\FilmCraft\filmcraft.exe"
if exist "%~dp0ao-vivo\overlay.pid" for /f %%p in ('type "%~dp0ao-vivo\overlay.pid"') do taskkill /pid %%p /f >nul 2>&1

rem Modo ponte ja ligado? (porta 9876 respondendo)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ao-vivo\ponte.ps1" && goto camada

rem FilmCraft aberto do jeito normal (sem ponte): precisa reabrir no modo Niobe
tasklist /fi "imagename eq filmcraft.exe" | find /i "filmcraft.exe" >nul && (
  echo.
  echo O FilmCraft esta aberto, mas sem o modo Niobe ^(ponte^).
  echo Salve o que estiver fazendo nele. Ele sera fechado e reaberto no modo Niobe.
  pause
  taskkill /im filmcraft.exe /f >nul 2>&1
  timeout /t 2 >nul
)
start "" "%FC%" --control 9876 "%~dp0projetos\GM_midea.fcproj"
echo Abrindo o FilmCraft no modo Niobe...
for /l %%i in (1,1,30) do (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ao-vivo\ponte.ps1" && goto camada
  timeout /t 1 >nul
)
echo (aviso) O FilmCraft demorou para ligar a ponte. A camada sera aberta assim mesmo.

:camada
start "" powershell -NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0ao-vivo\overlay.ps1"
exit
