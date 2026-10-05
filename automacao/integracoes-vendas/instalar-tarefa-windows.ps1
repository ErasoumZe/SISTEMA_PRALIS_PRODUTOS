[CmdletBinding()]
param(
  [string]$NomeTarefa = "Cicluz-CREARE-Sincronizacao"
)

$ErrorActionPreference = "Stop"
$raiz = Split-Path -Parent $PSCommandPath
$cmd = Join-Path $raiz "executar-agente.cmd"
$envArquivo = Join-Path $raiz ".env.producao"

if (-not (Test-Path -LiteralPath $cmd)) { throw "Arquivo nao encontrado: $cmd" }
if (-not (Test-Path -LiteralPath $envArquivo)) {
  throw "Nao existe .env.producao em $raiz. Preserve o arquivo de configuracao/segredos do servidor antes de instalar."
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js 22+ nao foi encontrado no PATH da maquina."
}

# SYSTEM + inicializacao do Windows fazem o robo sobreviver a logoff e reboot. Esta operacao exige
# PowerShell aberto como administrador, deliberadamente: uma tarefa sem privilegio nao e confiavel
# para uma maquina de PDV que pode reiniciar sem usuario logado.
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$acao = New-ScheduledTaskAction -Execute "$env:ComSpec" -Argument "/c `"$cmd`"" -WorkingDirectory $raiz
$gatilho = New-ScheduledTaskTrigger -AtStartup
$configuracoes = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -MultipleInstances IgnoreNew

Get-ScheduledTask -TaskName $NomeTarefa -ErrorAction SilentlyContinue | Stop-ScheduledTask -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $NomeTarefa -Action $acao -Trigger $gatilho -Principal $principal -Settings $configuracoes -Description "Sincroniza vendas e cancelamentos CREARE para o Sistema Pralis." -Force | Out-Null
Start-ScheduledTask -TaskName $NomeTarefa

Write-Host "Tarefa '$NomeTarefa' instalada e iniciada. Confira logs\\agente-saida.log em alguns minutos."
