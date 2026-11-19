@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Niobe - teste do Haiku pela assinatura
where claude >nul 2>&1 || (echo Claude Code nao encontrado. Instale com:  powershell -c "irm https://claude.ai/install.ps1 | iex"  e rode de novo. & pause & exit /b)
echo Se pedir login, escolha a conta da assinatura do Claude (nao a de API).
node haiku.js
pause
