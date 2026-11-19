@echo off
chcp 65001 >nul
title Consertar Niobe
echo Consertando a conexao da Niobe com o FilmCraft...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ao-vivo\consertar.ps1"
echo Pronto. Feche e abra o app Claude e avise.
timeout /t 8 >nul
