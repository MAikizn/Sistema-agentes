@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Unidade
where node >nul 2>&1 || (echo Node.js nao encontrado. Avise o Claude. & pause & exit /b)
netstat -ano | findstr /r /c:"127.0.0.1:7780 .*LISTENING" >nul
if %errorlevel%==0 (echo A Unidade ja esta ligada. & timeout /t 3 >nul & exit /b)
:loop
node server.js
echo A Unidade parou. Reiniciando em 5 segundos... (feche esta janela para desligar)
timeout /t 5 >nul
goto loop
