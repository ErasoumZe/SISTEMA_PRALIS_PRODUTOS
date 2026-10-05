@echo off
setlocal EnableExtensions
cd /d "%~dp0"

if not exist "logs" mkdir "logs"
where node >nul 2>nul
if errorlevel 1 (
  echo [%date% %time%] Node.js nao foi encontrado no PATH. Instale Node.js 22+ e rode instalar-tarefa-windows.ps1.>>"logs\agente-erros.log"
  exit /b 1
)

rem A tarefa oficial roda a cada 1 minuto, mesmo se o .env antigo ainda tiver 10 minutos.
set "SYNC_INTERVALO_MINUTOS=1"
node --env-file-if-exists=.env.producao src\loop.js >>"logs\agente-saida.log" 2>>"logs\agente-erros.log"
exit /b %errorlevel%
