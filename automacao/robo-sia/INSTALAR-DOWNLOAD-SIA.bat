@echo off
REM ===================================================================
REM  Agenda SOMENTE O DOWNLOAD do TXT de cadastro, todo dia as 22:30.
REM
REM  Este NAO abre o importador e NAO clica em nada. Ele so busca o
REM  arquivo na API, valida e deixa na pasta. Quem importa e aplica no
REM  PDV continua sendo uma pessoa, na hora que quiser.
REM
REM  Para o ciclo completo (baixar + importar + aplicar), use o outro:
REM  INSTALAR-AGENDAMENTO-SIA.bat
REM
REM  USO:
REM    INSTALAR-DOWNLOAD-SIA.bat TNP "H:\...\ARQUIVO_SISTEMA_TNP\cadastro-tnp.txt"
REM    INSTALAR-DOWNLOAD-SIA.bat LI
REM
REM  Sem o segundo argumento, grava em C:\cadastro-sia\cadastro-<loja>.txt
REM
REM  A LOJA NAO E DETALHE: o TXT carrega o CODITEM do SIA daquela loja, e
REM  o importador usa o CODITEM para decidir entre ATUALIZAR e INSERIR. O
REM  mesmo numero e outro produto no outro cadastro.
REM
REM  ANTES DE RODAR, defina nas variaveis de ambiente DA MAQUINA
REM  (Sistema -> Variaveis de ambiente), nao aqui dentro:
REM    PRALIS_API_BASE      dominio da API no Coolify (API_URL), sem barra
REM    CREARE_EXPORT_TOKEN  o mesmo token do Coolify, minimo 32 caracteres
REM ===================================================================
title Agendar Download do Cadastro SIA (22:30)
setlocal
set "LOJA=%~1"
if "%LOJA%"=="" (
  echo  ERRO: informe a loja. Exemplo:
  echo     INSTALAR-DOWNLOAD-SIA.bat TNP "H:\...\ARQUIVO_SISTEMA_TNP\cadastro-tnp.txt"
  pause & exit /b 1
)

set "DESTINO=%~2"
if "%DESTINO%"=="" set "DESTINO=C:\cadastro-sia\cadastro-%LOJA%.txt"

set "PASTA=%~dp0"
if "%PASTA:~-1%"=="\" set "PASTA=%PASTA:~0,-1%"
set "PS1=%PASTA%\baixar-cadastro.ps1"
set "TAREFA=Download Cadastro SIA - %LOJA%"
set "HORARIO=22:30"

echo.
echo  Loja:     %LOJA%
echo  Destino:  "%DESTINO%"
echo  Script:   "%PS1%"
echo  Horario:  %HORARIO% (todo dia)
echo.

if not exist "%PS1%" (
  echo  ERRO: nao achei o baixar-cadastro.ps1 nesta pasta.
  echo  Coloque este .bat na mesma pasta do script e rode de novo.
  pause & exit /b 1
)

REM Sem /IT: baixar e so HTTP, nao precisa de desktop interativo. Assim a
REM tarefa roda com a maquina ligada mesmo com a sessao bloqueada -- ao
REM contrario do robo de cliques, que exige sessao aberta e desbloqueada.
schtasks /Create /TN "%TAREFA%" /TR "powershell -NoProfile -ExecutionPolicy Bypass -File \"%PS1%\" -Loja %LOJA% -Destino \"%DESTINO%\"" /SC DAILY /ST %HORARIO% /RL HIGHEST /F

echo.
if %ERRORLEVEL%==0 (
  echo  ^>^>^> AGENDADO. Confira abaixo:
  schtasks /Query /TN "%TAREFA%" /FO LIST | findstr /I "Tarefa Nome Proxima Next Status Hora"
  echo.
  echo  Para testar AGORA, sem esperar as 22:30:
  echo     schtasks /Run /TN "%TAREFA%"
  echo.
  echo  O log de cada execucao fica em C:\cadastro-sia\logs\
  echo.
  echo  Se a API recusar, a mensagem diz o motivo:
  echo     401  token errado ou ausente
  echo     503  exportacao desligada ou sem configuracao da loja
  echo     422  a API recusou gerar - veja GET /admin/creare/health
  echo.
  echo  Em qualquer falha ele NAO toca no arquivo que ja esta na pasta:
  echo  deixar o de ontem seria pior do que nao entregar nada.
) else (
  echo  Nao consegui agendar. Se pediu permissao, rode este arquivo como
  echo  Administrador (botao direito - Executar como administrador).
)
echo.
pause
