@echo off
cd /d "%~dp0"
echo x> limpar-conversas.txt
echo Pronto! Conversas zeradas (o Morfeus le isso em ate 5 segundos).
timeout /t 4 >nul
