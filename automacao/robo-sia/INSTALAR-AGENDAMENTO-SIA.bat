@echo off
REM ===================================================================
REM  Agenda o Robo Cadastro SIA para rodar TODO DIA as 22:30, sozinho.
REM  IMPORTANTE: automacao de tela precisa da sessao LOGADA e DESBLOQUEADA
REM  no horario. Este PC (SERVIDOR) deve ficar ligado e logado as 22:30.
REM  Rode este arquivo UMA VEZ, na pasta onde esta o ROBO-SIA-AUTO.ps1.
REM ===================================================================
title Agendar Robo Cadastro SIA (22:30)
setlocal
set "PASTA=%~dp0"
if "%PASTA:~-1%"=="\" set "PASTA=%PASTA:~0,-1%"
set "PS1=%PASTA%\ROBO-SIA-AUTO.ps1"
set "TAREFA=Robo Cadastro SIA - Lisboa"
set "HORARIO=22:30"

echo.
echo  Robo:    "%PS1%"
echo  Horario: %HORARIO% (todo dia)
echo.

if not exist "%PS1%" (
  echo  ERRO: nao achei o ROBO-SIA-AUTO.ps1 nesta pasta.
  echo  Coloque este .bat na mesma pasta do robo e rode de novo.
  pause & exit /b 1
)

REM /IT = roda na sessao interativa quando o usuario esta logado (necessario p/ a tela)
schtasks /Create /TN "%TAREFA%" /TR "powershell -NoProfile -ExecutionPolicy Bypass -File \"%PS1%\"" /SC DAILY /ST %HORARIO% /IT /RL HIGHEST /F

echo.
if %ERRORLEVEL%==0 (
  echo  >>> AGENDADO com sucesso. Confira abaixo:
  schtasks /Query /TN "%TAREFA%" /FO LIST | findstr /I "Tarefa Nome Proxima Next Status Agendar Schedule Hora"
  echo.
  echo  Para testar agora mesmo, sem esperar as 22:30, rode:
  echo     schtasks /Run /TN "%TAREFA%"
) else (
  echo  Nao consegui agendar. Se pediu permissao, rode este arquivo como
  echo  Administrador (botao direito - Executar como administrador).
)
echo.
pause
