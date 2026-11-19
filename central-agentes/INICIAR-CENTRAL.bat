@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Central de Agentes
where node >nul 2>&1 || (echo Node.js nao encontrado. Avise o Claude. & pause & exit /b)
start "" http://localhost:7770
node server.js
pause
