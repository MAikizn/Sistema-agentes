@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Transcrevendo o video (Whisper do FilmCraft)
echo Transcrevendo o "Video para editar" com o Whisper do FilmCraft. Pode levar alguns minutos...
node pedidos.js "pedidos\transcrever-video.json"
echo.
echo PRONTO. Avise o Claude no chat.
pause
