<#
  Baixa somente mudancas da TNP. Salvar/confirmar ENTREGA libera o proximo TXT,
  mas nao declara que o SIA importou o anterior. Requer PRALIS_API_BASE e
  CREARE_EXPORT_TOKEN no ambiente da conta que executa a tarefa agendada.
#>
[CmdletBinding()]
param([string]$Destino = ('C:\importa' + [char]0x00E7 + [char]0x00E3 + 'o-sia\TXT'))

$ErrorActionPreference = 'Stop'
$mutex = New-Object System.Threading.Mutex($false, 'Global\PralisDownloadTxtTnp')
$locked = $false
$temporario = $null
$logPath = $null

function Registrar([string]$mensagem) {
    $linha = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '  ' + $mensagem
    Write-Host $linha
    if ($logPath) { [System.IO.File]::AppendAllText($logPath, $linha + [Environment]::NewLine) }
}

function ConfirmarEntrega([string]$base, [string]$token, [string]$id, [string]$sha) {
    $url = $base.TrimEnd('/') + '/creare/lotes/' + $id + '/entrega?loja=TNP'
    $body = @{ sha256 = $sha } | ConvertTo-Json -Compress
    $null = Invoke-RestMethod -Method Post -Uri $url -Headers @{ Authorization = "Bearer $token" } `
        -ContentType 'application/json' -Body $body -TimeoutSec 30
}

try {
    $locked = $mutex.WaitOne(0)
    if (-not $locked) { Write-Host 'Outra sincronizacao TNP ja esta em andamento.'; exit 0 }
    $base = [string]$env:PRALIS_API_BASE
    $token = [string]$env:CREARE_EXPORT_TOKEN
    if ([string]::IsNullOrWhiteSpace($base)) { throw 'PRALIS_API_BASE ausente.' }
    if ($token.Length -lt 32) { throw 'CREARE_EXPORT_TOKEN ausente ou curto.' }

    [System.IO.Directory]::CreateDirectory($Destino) | Out-Null
    $logDir = Join-Path (Split-Path -Parent $Destino) 'logs'
    [System.IO.Directory]::CreateDirectory($logDir) | Out-Null
    $logPath = Join-Path $logDir 'sincronizar-tnp.log'
    $estado = Join-Path $Destino '.ultimo-lote-tnp.json'
    # Na atualizacao, a primeira volta reconhece o lote legado ja salvo;
    # a segunda baixa os produtos novos na MESMA execucao da tarefa.
    for ($poll = 0; $poll -lt 3; $poll++) {
    $temporario = Join-Path $Destino ('.download-' + [guid]::NewGuid().ToString('N') + '.tmp')
    $url = $base.TrimEnd('/') + '/creare/produtos.txt?loja=TNP&modo=pendentes'
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $resposta = Invoke-WebRequest -Uri $url -Headers @{ Authorization = "Bearer $token" } `
        -OutFile $temporario -PassThru -UseBasicParsing -TimeoutSec 120

    if ([int]$resposta.StatusCode -eq 204) {
        Registrar 'TNP: sem alteracoes novas (204). Nenhum TXT criado.'
        break
    }
    if ([int]$resposta.StatusCode -ne 200) { throw "Resposta inesperada: $($resposta.StatusCode)." }
    if (-not [System.IO.File]::Exists($temporario)) { throw 'A API nao entregou um arquivo.' }
    $id = [string]$resposta.Headers['X-Creare-Lote-Id']
    $sha = ([string]$resposta.Headers['X-Creare-Sha256']).ToLowerInvariant()
    if ($id -notmatch '^[0-9a-fA-F-]{36}$' -or $sha -notmatch '^[0-9a-f]{64}$') {
        throw 'Resposta sem identificador/hash de lote valido.'
    }
    $shaLocal = (Get-FileHash -LiteralPath $temporario -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($shaLocal -ne $sha) { throw 'Hash do TXT diferente do informado pela API.' }
    $bytes = [System.IO.File]::ReadAllBytes($temporario)
    foreach ($byte in $bytes) {
        if (($byte -lt 0x20 -and $byte -ne 0x0D -and $byte -ne 0x0A) -or $byte -gt 0x7E) {
            throw 'TXT recusado: byte fora de ASCII imprimivel/CRLF.'
        }
    }
    $linhas = [System.IO.File]::ReadAllLines($temporario, [System.Text.Encoding]::ASCII)
    if ($linhas.Length -eq 0) { throw 'Lote vazio com resposta 200.' }
    foreach ($linha in $linhas) {
        if ($linha.Length -ne 363 -or $linha -match '[^\x20-\x7e]') {
            throw 'TXT recusado: registro fora das 363 posicoes ASCII.'
        }
    }
    $totalCabecalho = [string]$resposta.Headers['X-Creare-Registros']
    if ($totalCabecalho -and $totalCabecalho -ne [string]$linhas.Length) {
        throw 'Quantidade de registros diferente do cabecalho da API.'
    }

    if ([System.IO.File]::Exists($estado)) {
        $anterior = [System.IO.File]::ReadAllText($estado) | ConvertFrom-Json
        if ($anterior.id -eq $id -and $anterior.sha256 -eq $sha -and
            [System.IO.File]::Exists([string]$anterior.arquivo)) {
            $hashAnterior = (Get-FileHash -LiteralPath ([string]$anterior.arquivo) -Algorithm SHA256).Hash.ToLowerInvariant()
            if ($hashAnterior -eq $sha) {
                ConfirmarEntrega $base $token $id $sha
                Registrar "TNP: lote $id ja salvo em $($anterior.arquivo). Entrega registrada; nenhum TXT duplicado."
                [System.IO.File]::Delete($temporario)
                $temporario = $null
                continue
            }
        }
    }

    $nome = 'produtos-TNP-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.txt'
    $arquivo = Join-Path $Destino $nome
    while ([System.IO.File]::Exists($arquivo)) {
        Start-Sleep -Seconds 1
        $nome = 'produtos-TNP-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.txt'
        $arquivo = Join-Path $Destino $nome
    }
    [System.IO.File]::Move($temporario, $arquivo)
    $temporario = $null
    $dados = @{ id = $id; sha256 = $sha; arquivo = $arquivo; registros = $linhas.Length }
    $estadoTemporario = "$estado.tmp"
    [System.IO.File]::WriteAllText($estadoTemporario, ($dados | ConvertTo-Json -Compress))
    if ([System.IO.File]::Exists($estado)) { [System.IO.File]::Delete($estado) }
    [System.IO.File]::Move($estadoTemporario, $estado)
    ConfirmarEntrega $base $token $id $sha
    Registrar "TNP: $($linhas.Length) registro(s) salvos em $arquivo. Entrega registrada; importacao no SIA nao confirmada."
    }
} catch {
    Registrar "ERRO: download TNP falhou: $($_.Exception.Message)"
    exit 1
} finally {
    if ($temporario -and [System.IO.File]::Exists($temporario)) { [System.IO.File]::Delete($temporario) }
    if ($locked) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
