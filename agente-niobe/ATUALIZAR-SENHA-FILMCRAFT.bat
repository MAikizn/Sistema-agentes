@echo off
chcp 65001 >nul
title Atualizar senha do FilmCraft
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ao-vivo\atualizar-senha.ps1"
echo.
echo Agora o FilmCraft sera reaberto no modo Niobe.
call "%~dp0NIOBE-AO-VIVO.bat"
