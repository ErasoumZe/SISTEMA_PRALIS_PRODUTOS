@echo off
REM ===================================================================
REM  Agenda o Robo Cadastro SIA para rodar TODO DIA as 22:30, sozinho.
REM  IMPORTANTE: automacao de tela precisa da sessao LOGADA e DESBLOQUEADA
REM  no horario. Este PC (SERVIDOR) deve ficar ligado e logado as 22:30.
REM  Rode este arquivo UMA VEZ, na pasta onde esta o ROBO-SIA-AUTO.ps1.
REM
REM  A LOJA E O PRIMEIRO ARGUMENTO e entra na tarefa agendada:
REM      INSTALAR-AGENDAMENTO-SIA.bat TNP
REM      INSTALAR-AGENDAMENTO-SIA.bat LI
REM  Sem argumento assume LI, que era o comportamento antigo.
REM
REM  Isso nao e detalhe: o arquivo carrega o CODITEM do SIA daquela loja, e o
REM  importador usa o CODITEM para decidir entre atualizar e inserir. Agendar
REM  a loja errada grava por cima de produtos DIFERENTES no PDV.
REM ===================================================================
title Agendar Robo Cadastro SIA (22:30)
setlocal
set "LOJA=%~1"
if "%LOJA%"=="" set "LOJA=LI"
set "PASTA=%~dp0"
if "%PASTA:~-1%"=="\" set "PASTA=%PASTA:~0,-1%"
set "PS1=%PASTA%\ROBO-SIA-AUTO.ps1"
set "TAREFA=Robo Cadastro SIA - %LOJA%"
set "HORARIO=22:30"

echo.
echo  Loja:    %LOJA%
echo  Robo:    "%PS1%"
echo  Horario: %HORARIO% (todo dia)
echo.

if not exist "%PS1%" (
  echo  ERRO: nao achei o ROBO-SIA-AUTO.ps1 nesta pasta.
  echo  Coloque este .bat na mesma pasta do robo e rode de novo.
  pause & exit /b 1
)

REM /IT = roda na sessao interativa quando o usuario esta logado (necessario p/ a tela)
schtasks /Create /TN "%TAREFA%" /TR "powershell -NoProfile -ExecutionPolicy Bypass -File \"%PS1%\" -Loja %LOJA%" /SC DAILY /ST %HORARIO% /IT /RL HIGHEST /F

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
