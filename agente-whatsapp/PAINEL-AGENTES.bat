@echo off
title Painel dos Agentes
cd /d "%~dp0"
:menu
cls
echo ================ PAINEL DOS AGENTES ================
echo.
echo  1 - Reiniciar o Morfeus
echo  2 - Reiniciar conversas (testar como lead novo)
echo  3 - Ver status e log do Morfeus
echo  4 - Falar com a Claudia / Niobe / Neo (Claude)
echo  5 - Abrir o WhatsApp Web
echo  0 - Sair
echo.
set /p op=Escolha: 
if "%op%"=="1" call "%~dp0REINICIAR-MORFEUS.bat"
if "%op%"=="2" call "%~dp0LIMPAR-CONVERSAS.bat"
if "%op%"=="3" call "%~dp0STATUS-MORFEUS.bat"
if "%op%"=="4" start "" "https://claude.ai/new"
if "%op%"=="5" start "" "https://web.whatsapp.com"
if "%op%"=="0" exit
goto menu
