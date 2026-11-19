@echo off
title Status do Morfeus
cd /d "%~dp0"
type status.json
echo.
echo ---- ultimas linhas do log ----
powershell -NoProfile -Command "Get-Content agente.log -Tail 25 -Encoding UTF8"
echo.
pause
