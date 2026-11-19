@echo off
title Diagnostico da ponte da Niobe
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ao-vivo\diag.ps1"
echo Pronto. Pode fechar esta janela e avisar o Claude.
timeout /t 5 >nul
