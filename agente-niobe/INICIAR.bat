@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Niobe - edicao de video
where node >nul 2>&1 || (echo Node.js nao encontrado. Avise o Claude. & pause & exit /b)
if not exist node_modules\ffmpeg-static (
  echo Instalando o FFmpeg da Niobe, aguarde 1-3 minutos...
  call npm install --omit=dev > instalacao-log.txt 2>&1
)
node niobe.js
pause
