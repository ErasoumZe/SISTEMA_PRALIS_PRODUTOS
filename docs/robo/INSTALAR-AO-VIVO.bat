@echo off
REM ====================================================================
REM  INSTALAR-AO-VIVO.bat
REM  Registra no Agendador de Tarefas o envio das vendas item a item
REM  ao Pralis, A CADA MINUTO. Nao altera a tarefa diaria das 22:10.
REM  Rode UMA vez, com botao direito > "Executar como administrador".
REM  Para desligar depois:  schtasks /Delete /TN "Bot Padaria - Vendas ao vivo" /F
REM ====================================================================
setlocal
set PASTA=C:\Users\Server-Pralis\Documents\bot
set TAREFA=Bot Padaria - Vendas ao vivo

echo.
echo Registrando a tarefa "%TAREFA%" para rodar a cada 1 minuto...
echo.

schtasks /Create ^
  /TN "%TAREFA%" ^
  /TR "\"%PASTA%\rodar-vendas-ao-vivo.bat\"" ^
  /SC MINUTE ^
  /MO 1 ^
  /RU SYSTEM ^
  /RL HIGHEST ^
  /F

if errorlevel 1 (
  echo.
  echo FALHOU. Voce abriu como administrador?
  echo Botao direito neste arquivo ^> Executar como administrador.
) else (
  echo.
  echo OK. A cada minuto o Windows roda rodar-vendas-ao-vivo.bat.
  echo Acompanhe em logs\ao-vivo.txt  e na aba Vendas do Pralis.
)
echo.
pause
