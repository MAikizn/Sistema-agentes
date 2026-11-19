@echo off
chcp 65001 >nul
title MATRIX CRM - teste no PC
cd /d "%~dp0"
node publicar.js local
pause
