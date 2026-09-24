@echo off
REM ====================================================================
REM  Manda ao Pralis as vendas item a item (ultimos dias) e sai.
REM  Chamado pelo Agendador de Tarefas a cada minuto. Nao abre janela.
REM  Nao mexe no robo diario (rodar-bot.bat) nem na planilha.
REM ====================================================================
cd /d "C:\Users\Server-Pralis\Documents\bot"
node rodar-vendas-ao-vivo.js >> logs\ao-vivo-agendado.txt 2>&1
exit /b %errorlevel%
