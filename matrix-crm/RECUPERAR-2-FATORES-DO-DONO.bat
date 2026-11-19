@echo off
chcp 65001 >nul
title MATRIX CRM - recuperar 2 fatores do dono
cd /d "%~dp0"
echo Isto zera a verificacao em 2 fatores do DONO no sistema publicado.
echo Use so se voce perdeu o celular e os codigos de reserva.
pause
node publicar.js nuvem reset2f
pause
