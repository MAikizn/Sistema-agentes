@echo off
chcp 65001 >nul
title Teste Higgsfield
cd /d "%~dp0"
node higgsfield.js
pause
