@echo off
cd /d "%~dp0"
(
echo === NODE ===
where node
node -v
npm -v
echo === FREELLMAPI ===
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'freellm' } | ForEach-Object { 'PID ' + $_.ProcessId + ' :: ' + $_.CommandLine; Get-NetTCPConnection -State Listen -OwningProcess $_.ProcessId -ErrorAction SilentlyContinue | ForEach-Object { 'PORTA ' + $_.LocalAddress + ':' + $_.LocalPort } }"
) > diagnostico.txt 2>&1
echo Pronto! Pode fechar esta janela.
timeout /t 5 >nul
