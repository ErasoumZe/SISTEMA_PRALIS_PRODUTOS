<#
  Faz a tarefa do TXT da TNP VOLTAR SOZINHA depois de um logoff ou reinicio.

  Em 07/10/2026 o TXT parou de sair as 07:15. Nao foi a API (tinha 3 produtos
  pendentes e nenhum lote aberto) nem o robo: o log mostra a tarefa rodando de
  5 em 5 minutos a noite toda, entregando o lote das 07:12, pegando 204 as
  07:15 -- e nunca mais. Parada limpa, sem erro, sem linha de log.

  Causa: em 06/10 o utilitario da janela oculta trocou o login da tarefa para
  InteractiveToken. Ele avisa isso no proprio cabecalho ("passa a funcionar
  somente enquanto SERVIDOR\Servidor estiver conectado"). A tarefa tinha UM
  disparador: um TimeTrigger de 29/09 com repeticao de 5 minutos. Quando a
  sessao terminou, a repeticao morreu -- e nao havia nada que a ressuscitasse.

  Tres defeitos de configuracao, cada um capaz de parar o TXT em silencio:

    1. So um TimeTrigger. Sem AtLogOn e sem AtStartup, logoff ou reboot mata a
       repeticao de vez.
    2. Sem ExecutionTimeLimit. Com MultipleInstancesPolicy = IgnoreNew, uma
       instancia pendurada faz o Agendador DESCARTAR todos os disparos
       seguintes, sem registrar nada em lugar algum.
    3. StopIfGoingOnBatteries e StopOnIdleEnd ligados. Uma piscada no UPS para
       a tarefa e ela nao volta.

  NAO mexe no login (nao pede senha), nao mexe na acao, nao mexe no intervalo
  de 5 minutos e nao mexe no TimeTrigger que ja existe.

  Por padrao apenas DIAGNOSTICA. -Aplicar faz backup do XML e grava.
#>
[CmdletBinding()]
param(
    [switch]$Aplicar,
    [string]$Raiz = ('C:\importa' + [char]0x00E7 + [char]0x00E3 + 'o-sia'),
    [string]$NomeTarefa = 'Download TXT SIA TNP'
)

$ErrorActionPreference = 'Stop'
$scriptRobo = Join-Path $Raiz 'SINCRONIZAR-TXT-TNP.ps1'
$LIMITE_EXECUCAO = 'PT10M'   # o robo faz ate 3 voltas de 120s; 10 min e folga
$INTERVALO = 'PT5M'

# TASK_TRIGGER_TYPE2
$TIPO_BOOT = 8
$TIPO_LOGON = 9

function ObterSid([string]$conta) {
    $nome = $conta.Trim()
    if ($nome -match '^S-\d-') { return $nome }
    if (-not $nome) { throw 'A tarefa nao informa a conta que a executa. Nada foi alterado.' }
    # Mesma armadilha tratada no OCULTAR-TAREFA: o Agendador pode devolver so
    # "Servidor" para a conta local SERVIDOR\Servidor.
    if ($nome -notmatch '[\\@]') { $nome = $env:COMPUTERNAME + '\' + $nome }
    try {
        return (New-Object System.Security.Principal.NTAccount -ArgumentList $nome).Translate(
            [System.Security.Principal.SecurityIdentifier]).Value
    } catch {
        throw "Nao consegui identificar a conta '$conta' (testada como '$nome'). Nada foi alterado."
    }
}

$servico = New-Object -ComObject Schedule.Service
$servico.Connect()
$pasta = $servico.GetFolder('\')
try {
    $tarefa = $pasta.GetTask($NomeTarefa)
} catch {
    # Sem isto o COM devolve so "O sistema nao pode encontrar o arquivo
    # especificado (0x80070002)", que nao diz o que faltou.
    throw ("Nao existe a tarefa '$NomeTarefa' na raiz do Agendador deste PC. " +
        'Rode isto no PC da padaria, ou passe -NomeTarefa com o nome correto. ' +
        'Para listar: Get-ScheduledTask | Where-Object TaskPath -eq "\" | Select-Object TaskName')
}
$definicao = $tarefa.Definition

# --- as mesmas guardas do OCULTAR-TAREFA: nunca gravar em tarefa alheia -----
$identidade = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$contaTarefa = [string]$definicao.Principal.UserId
if ((ObterSid $contaTarefa) -ne $identidade.User.Value) {
    throw "A tarefa pertence a $contaTarefa, mas este PowerShell esta como $($identidade.Name). Pare aqui."
}
if ($definicao.Actions.Count -ne 1 -or $definicao.Actions.Item(1).Type -ne 0) {
    throw 'A tarefa nao tem exatamente uma acao de programa. Nada foi alterado.'
}
$acao = $definicao.Actions.Item(1)
if ([IO.Path]::GetFileName([string]$acao.Path) -ine 'powershell.exe') {
    throw "Programa inesperado na tarefa: $($acao.Path). Nada foi alterado."
}
$arquivo = [regex]::Match([string]$acao.Arguments, '(?i)(?:^|\s)-File\s+(?:"([^"]+)"|''([^'']+)''|(\S+))')
if (-not $arquivo.Success) { throw 'A acao nao contem -File com o caminho do robo. Nada foi alterado.' }
$caminhoAtual = @($arquivo.Groups[1].Value, $arquivo.Groups[2].Value,
    $arquivo.Groups[3].Value) | Where-Object { $_ } | Select-Object -First 1
if ([IO.Path]::GetFullPath($caminhoAtual) -ine [IO.Path]::GetFullPath($scriptRobo)) {
    throw "A tarefa aponta para outro script: $caminhoAtual. Nada foi alterado."
}

# --- estado atual ------------------------------------------------------------
$logon = [int]$definicao.Principal.LogonType
Write-Host "Conta: $($identidade.Name)"
Write-Host "Tarefa: $NomeTarefa | login: $logon | estado: $($tarefa.State) | ultimo resultado: $($tarefa.LastTaskResult)"
Write-Host "Ultima execucao: $($tarefa.LastRunTime) | proxima prevista: $($tarefa.NextRunTime)"
Write-Host "Disparadores hoje: $($definicao.Triggers.Count)"
foreach ($t in $definicao.Triggers) {
    $rep = if ($t.Repetition.Interval) { $t.Repetition.Interval } else { '(sem repeticao)' }
    Write-Host ("  - tipo " + $t.Type + ' | repeticao ' + $rep)
}
# 4 = TASK_STATE_RUNNING. Com IgnoreNew, instancia viva engole todo disparo.
if ([int]$tarefa.State -eq 4) {
    Write-Host 'ATENCAO: a tarefa esta EM EXECUCAO agora. Com IgnoreNew, nenhum disparo novo acontece enquanto isso.'
    Write-Host '  Processos candidatos:'
    Get-Process powershell, pwsh -ErrorAction SilentlyContinue |
        Select-Object Id, StartTime | Format-Table | Out-String | Write-Host
}

$temLogon = $false
$temBoot = $false
foreach ($t in $definicao.Triggers) {
    if ([int]$t.Type -eq $TIPO_LOGON) { $temLogon = $true }
    if ([int]$t.Type -eq $TIPO_BOOT) { $temBoot = $true }
}

$pendencias = @()
if (-not $temLogon) { $pendencias += 'falta disparador AtLogOn (a tarefa nao volta depois de um logoff)' }
if (-not $temBoot) { $pendencias += 'falta disparador AtStartup (a tarefa nao volta depois de um reboot)' }
if (-not $definicao.Settings.ExecutionTimeLimit -or $definicao.Settings.ExecutionTimeLimit -eq 'PT0S') {
    $pendencias += 'sem ExecutionTimeLimit (instancia pendurada bloqueia a tarefa para sempre)'
}
if ($definicao.Settings.StopIfGoingOnBatteries) { $pendencias += 'StopIfGoingOnBatteries ligado' }
if ($definicao.Settings.DisallowStartIfOnBatteries) { $pendencias += 'DisallowStartIfOnBatteries ligado' }
if ($definicao.Settings.IdleSettings.StopOnIdleEnd) { $pendencias += 'StopOnIdleEnd ligado' }
if (-not $definicao.Settings.StartWhenAvailable) { $pendencias += 'StartWhenAvailable desligado (disparo perdido nao e recuperado)' }

if (-not $pendencias.Count) {
    Write-Host 'Nada a reparar: a tarefa ja volta sozinha depois de logoff e reboot.'
    exit 0
}
Write-Host ''
Write-Host 'A REPARAR:'
foreach ($p in $pendencias) { Write-Host "  - $p" }

if (-not $Aplicar) {
    Write-Host ''
    Write-Host 'Diagnostico apenas. Rode com -Aplicar para corrigir (faz backup do XML antes).'
    exit 0
}

# --- backup antes de gravar --------------------------------------------------
$dirBackup = Join-Path $Raiz 'backup-tarefas'
[System.IO.Directory]::CreateDirectory($dirBackup) | Out-Null
$backup = Join-Path $dirBackup ('Download-TXT-SIA-TNP-reparo-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.xml')
[System.IO.File]::WriteAllText($backup, $tarefa.Xml, [System.Text.Encoding]::Unicode)
Write-Host "Backup do XML atual: $backup"

# --- o reparo ----------------------------------------------------------------
$definicao.Settings.ExecutionTimeLimit = $LIMITE_EXECUCAO
$definicao.Settings.StopIfGoingOnBatteries = $false
$definicao.Settings.DisallowStartIfOnBatteries = $false
$definicao.Settings.IdleSettings.StopOnIdleEnd = $false
$definicao.Settings.StartWhenAvailable = $true

# Os disparadores NOVOS repetem no mesmo intervalo do que ja existia. O
# TimeTrigger de 29/09 fica intacto: se ele continuar vivo, apenas coexiste --
# IgnoreNew impede execucao dupla.
if (-not $temLogon) {
    $g = $definicao.Triggers.Create($TIPO_LOGON)
    $g.UserId = $contaTarefa
    $g.Repetition.Interval = $INTERVALO
    # 1 minuto de folga: no logon o Windows ainda esta subindo servico e rede
    $g.Delay = 'PT1M'
    Write-Host 'Adicionado: disparador AtLogOn, repeticao de 5 minutos, atraso de 1 minuto.'
}
if (-not $temBoot) {
    $g = $definicao.Triggers.Create($TIPO_BOOT)
    $g.Repetition.Interval = $INTERVALO
    $g.Delay = 'PT2M'
    Write-Host 'Adicionado: disparador AtStartup, repeticao de 5 minutos, atraso de 2 minutos.'
}

# 4 = TASK_CREATE_OR_UPDATE. Login preservado: InteractiveToken nao usa senha.
$null = $pasta.RegisterTaskDefinition($NomeTarefa, $definicao, 4, $contaTarefa, $null, $logon)
Write-Host ''
Write-Host 'Tarefa reparada. Confira com:  Get-ScheduledTaskInfo -TaskName "Download TXT SIA TNP"'
Write-Host 'Para o TXT dos produtos pendentes sair agora, rode o robo a mao:'
Write-Host ("  & '" + $scriptRobo + "'")
