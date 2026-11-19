@echo off
chcp 65001 >nul
cd /d "%~dp0"
title MATRIX CRM - Neo e Trinity construindo
echo O Neo e a Trinity vao construir o MATRIX CRM. Deixe o FreeLLMAPI aberto. Leva de 5 a 20 minutos.
node construir.js %*
if exist site\login.html start "" "site\login.html"
pause
