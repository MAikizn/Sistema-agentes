@echo off
chcp 65001 >nul
title MATRIX CRM - publicar na Cloudflare
cd /d "%~dp0"
node publicar.js nuvem
pause
