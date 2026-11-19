@echo off
cd /d "%~dp0"
title Agente WhatsApp
where git >nul 2>&1 || (
  echo Instalando o Git ^(necessario para a biblioteca do WhatsApp^)... aceite a permissao do Windows se aparecer.
  winget install -e --id Git.Git --accept-source-agreements --accept-package-agreements
  echo.
  echo Git instalado. FECHE esta janela e abra o INICIAR.bat de novo.
  pause & exit /b
)
if not exist node_modules\@whiskeysockets\baileys (
  echo Instalando dependencias, aguarde 1-3 minutos...
  call npm install --omit=dev > instalacao-log.txt 2>&1
  if not exist node_modules\@whiskeysockets\baileys (
    echo.
    echo ERRO na instalacao. Detalhes salvos em instalacao-log.txt - avise o Claude.
    pause & exit /b
  )
)
if exist resetar-sessao.txt (
  echo Reiniciando a conexao do WhatsApp - sera preciso escanear o QR code de novo.
  ren sessao sessao_antiga_%RANDOM%
  del contatos.json >nul 2>&1
  del resetar-sessao.txt
)
:loop
node agent.js
echo O agente parou. Reiniciando em 10 segundos... (feche esta janela para desligar)
timeout /t 10 >nul
goto loop
