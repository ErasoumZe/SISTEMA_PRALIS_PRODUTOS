<#
  Ajusta a ACAO da tarefa existente sem abrir as Propriedades no Agendador.
  Nao altera o robo, os disparadores, o intervalo nem o token da API.
  Por padrao apenas diagnostica. -Aplicar faz backup e registra a mudanca.

  Se a tarefa usa login por senha, -SomenteUsuarioConectado troca apenas o
  tipo de login para InteractiveToken. Assim nao pede senha, mas a tarefa
  passa a funcionar somente enquanto SERVIDOR\Servidor estiver conectado.
#>
[CmdletBinding()]
param(
    [switch]$Aplicar,
    [switch]$SomenteUsuarioConectado
)

$ErrorActionPreference = 'Stop'
$raiz = 'C:\importa' + [char]0x00E7 + [char]0x00E3 + 'o-sia'
$scriptRobo = Join-Path $raiz 'SINCRONIZAR-TXT-TNP.ps1'
$nomeTarefa = 'Download TXT SIA TNP'

function ObterSid([string]$conta) {
    if ($conta -match '^S-\d-') { return $conta }
    return (New-Object System.Security.Principal.NTAccount -ArgumentList $conta).Translate(
        [System.Security.Principal.SecurityIdentifier]).Value
}

try {
    $servico = New-Object -ComObject Schedule.Service
    $servico.Connect()
    $pasta = $servico.GetFolder('\')
    $tarefa = $pasta.GetTask($nomeTarefa)
    $definicao = $tarefa.Definition
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
    $arquivo = [regex]::Match([string]$acao.Arguments,
        '(?i)(?:^|\s)-File\s+(?:"([^"]+)"|''([^'']+)''|(\S+))')
    if (-not $arquivo.Success) { throw 'A acao nao contem -File com o caminho do robo. Nada foi alterado.' }
    $caminhoAtual = @($arquivo.Groups[1].Value, $arquivo.Groups[2].Value,
        $arquivo.Groups[3].Value) | Where-Object { $_ } | Select-Object -First 1
    if ([IO.Path]::GetFullPath($caminhoAtual) -ine [IO.Path]::GetFullPath($scriptRobo)) {
        throw "A tarefa aponta para outro script: $caminhoAtual. Nada foi alterado."
    }
    if (-not [IO.File]::Exists($scriptRobo)) {
        throw "O robo nao existe em $scriptRobo. Nada foi alterado."
    }
    $loginAtual = [int]$definicao.Principal.LogonType
    if ($loginAtual -ne 3 -and -not $SomenteUsuarioConectado) {
        throw "Tipo de login da tarefa: $loginAtual. Para seguir sem senha, rode com -Aplicar -SomenteUsuarioConectado. Isso exige a conta conectada nas proximas execucoes."
    }
    $jaOculto = [string]$acao.Arguments -match '(?i)(?:^|\s)-WindowStyle\s+Hidden(?:\s|$)'
    if (-not $jaOculto -and [string]$acao.Arguments -match '(?i)(?:^|\s)-(?:WindowStyle|W)\s+') {
        throw 'A tarefa ja define outro WindowStyle. Revise manualmente antes de alterar.'
    }

    Write-Host "Conta: $($identidade.Name)"
    Write-Host "Tarefa: $nomeTarefa | login: $loginAtual | intervalos preservados: $($definicao.Triggers.Count) disparador(es)"
    Write-Host "Acao atual: $($acao.Path) $($acao.Arguments)"
    if ($jaOculto -and $loginAtual -eq 3) {
        Write-Host 'A tarefa ja usa -WindowStyle Hidden e login interativo. Nenhuma mudanca necessaria.'
        exit 0
    }
    if (-not $Aplicar) {
        Write-Host 'DIAGNOSTICO APENAS: para aplicar, rode novamente com -Aplicar.'
        exit 0
    }

    $pastaBackup = Join-Path $raiz 'backup-tarefas'
    [IO.Directory]::CreateDirectory($pastaBackup) | Out-Null
    $backup = Join-Path $pastaBackup ($nomeTarefa.Replace(' ', '-') + '-' +
        (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '.xml')
    [IO.File]::WriteAllText($backup, [string]$tarefa.Xml, [Text.Encoding]::Unicode)
    Write-Host "Backup da tarefa: $backup"

    if (-not $jaOculto) { $acao.Arguments = '-WindowStyle Hidden ' + [string]$acao.Arguments }
    $definicao.Principal.LogonType = 3 # TASK_LOGON_INTERACTIVE_TOKEN; sem senha.
    $null = $pasta.RegisterTaskDefinition($nomeTarefa, $definicao, 6,
        $identidade.Name, $null, 3) # TASK_CREATE_OR_UPDATE

    $nova = $pasta.GetTask($nomeTarefa).Definition
    if ([int]$nova.Principal.LogonType -ne 3 -or
        [string]$nova.Actions.Item(1).Arguments -notmatch '(?i)(?:^|\s)-WindowStyle\s+Hidden(?:\s|$)') {
        throw 'O Agendador nao confirmou a mudanca. Confira a tarefa e preserve o backup.'
    }
    Write-Host 'OK: proxima execucao sem janela do PowerShell; mesmo usuario e mesmos disparadores.'
} catch {
    Write-Error $_.Exception.Message
    exit 1
}
