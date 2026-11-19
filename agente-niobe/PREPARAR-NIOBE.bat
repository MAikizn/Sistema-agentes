@echo off
chcp 65001 >nul
title Preparar Niobe
echo Fechando o FilmCraft que estiver aberto...
taskkill /im filmcraft.exe /f >nul 2>&1
timeout /t 2 >nul
echo Instalando a configuracao da Niobe no Claude...
copy /y "%USERPROFILE%\Documents\claude_desktop_config.json" "%APPDATA%\Claude\claude_desktop_config.json" >nul || (echo ERRO ao copiar. Avise o Claude. & pause & exit /b)
echo Abrindo o FilmCraft no modo da Niobe com o projeto da Midea...
set FILMCRAFT_CONTROL_TOKEN=b2c8a8e0407e930350686da066ba38a0a2b0fc8b21e4363149c4821b7a781ea5
start "" "%ProgramFiles%\ArtCraft\FilmCraft\filmcraft.exe" --control 9876 "%~dp0projetos\GM_midea.fcproj"
echo.
echo PRONTO! Agora feche o Claude por completo (tambem no icone perto do relogio),
echo abra de novo, inicie um chat novo e digite:  /Niobe continue o projeto GM_midea
pause
