@echo off
chcp 65001 >nul
title MATRIX CRM - ligar o Morfeus
cd /d "%~dp0"
echo Onde esta o Matrix que vai receber as conversas do Morfeus?
echo   1) No meu PC (TESTAR-NO-PC.bat)
echo   2) Na Cloudflare (publicado)
set /p ONDE=Digite 1 ou 2:
if "%ONDE%"=="2" (node chave-integracao.js nuvem) else (node chave-integracao.js local)
pause
