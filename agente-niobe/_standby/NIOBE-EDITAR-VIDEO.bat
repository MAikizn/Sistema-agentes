@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Niobe editando ao vivo
echo A Niobe vai abrir o FilmCraft no modo ao vivo e editar o "Video para editar".
echo Se o FilmCraft estiver aberto, ele sera fechado e reaberto no modo Niobe.
node pedidos.js "pedidos\editar-video-para-editar.json"
type "pedidos\resultados\editar-video-para-editar.json"
echo.
pause
