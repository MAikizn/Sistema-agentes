@echo off
title Reiniciar Morfeus
cd /d "%~dp0"
echo Reiniciando o Morfeus...
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*agent.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
timeout /t 10 /nobreak >nul
powershell -NoProfile -Command "if (Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*agent.js*' }) { exit 0 } else { exit 1 }"
if errorlevel 1 (
  echo Iniciando o Morfeus...
  start "Morfeus" "%~dp0INICIAR.bat"
) else (
  echo Morfeus reiniciou sozinho.
)
timeout /t 3 >nul
