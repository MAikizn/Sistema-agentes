@echo off
chcp 65001 >nul
title Instalando Hermes3D
cd /d "%USERPROFILE%\Documents"
for /f "tokens=1 delims=v." %%v in ('node -v') do set NODEV=%%v
if %NODEV% LSS 20 (echo O Hermes3D precisa do Node 20 ou mais novo. Instalando... & winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements & echo Feche esta janela e abra de novo. & pause & exit /b)
where git >nul 2>&1 || (winget install -e --id Git.Git --accept-source-agreements --accept-package-agreements & echo Feche esta janela e abra de novo. & pause & exit /b)
if not exist hermes3d git clone https://github.com/iamlukethedev/Hermes3D.git hermes3d
cd hermes3d
if not exist .env copy .env.example .env >nul
echo Instalando dependencias (pode levar 5-10 minutos)...
call npm install
echo.
echo PRONTO! Agora use ABRIR-ESCRITORIO-3D.bat
pause
