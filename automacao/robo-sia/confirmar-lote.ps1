<#
  Confirma um lote incremental SOMENTE depois de verificar no log do Criare
  que todos os registros foram aplicados ao cadastro da loja correta.
  Baixar ou clicar em "Aplicar" nao e comprovacao suficiente.
#>
[CmdletBinding()]
param(
    [ValidateSet('LI', 'TNP', 'HORA')][string]$Loja = 'LI',
    [string]$Arquivo = '',
    [string]$LoteId = ''
)
$ErrorActionPreference = 'Stop'
if (-not $Arquivo) { $Arquivo = "C:\cadastro-sia\cadastro-$($Loja.ToLower()).txt" }
$marcador = "$Arquivo.lote.json"
if (-not [System.IO.File]::Exists($Arquivo)) { throw 'TXT nao encontrado. Nada foi confirmado.' }
$lote = $null
if ([System.IO.File]::Exists($marcador)) {
    $lote = [System.IO.File]::ReadAllText($marcador) | ConvertFrom-Json
    if ($lote.loja -ne $Loja -or $lote.arquivo -ne $Arquivo) {
        throw 'Identificador do lote nao corresponde a esta loja/arquivo.'
    }
    $LoteId = [string]$lote.id
} elseif (-not $LoteId) {
    $nome = [System.IO.Path]::GetFileName($Arquivo)
    if ($nome -match '^produtos-(TNP|LI|HORA)-lote-([0-9a-f-]{36})\.txt$' -and $Matches[1] -eq $Loja) {
        $LoteId = $Matches[2]
    }
}
if ($LoteId -notmatch '^[0-9a-f-]{36}$') {
    throw 'ID do lote ausente. Use o nome original do download ou informe -LoteId.'
}
$hashAtual = (Get-FileHash -LiteralPath $Arquivo -Algorithm SHA256).Hash.ToLowerInvariant()
if ($lote -and $hashAtual -ne $lote.sha256) { throw 'TXT foi alterado depois do download. Nada foi confirmado.' }

Write-Host "Loja: $Loja | Lote: $LoteId | TXT: $Arquivo"
Write-Host 'Confira o log do Criare: cada registro do lote deve ter sido aplicado, sem erro.'
$frase = Read-Host 'Digite CONFIRMO IMPORTACAO NO SIA para reconhecer a conclusao'
if ($frase -cne 'CONFIRMO IMPORTACAO NO SIA') { throw 'Confirmacao cancelada.' }

$base = [string]$env:PRALIS_API_BASE
$token = [string]$env:CREARE_EXPORT_TOKEN
if (-not $base -or $token.Length -lt 32) { throw 'PRALIS_API_BASE ou CREARE_EXPORT_TOKEN ausente/invalido.' }
$url = "$($base.TrimEnd('/'))/creare/lotes/$LoteId/confirmar?loja=$Loja"
$body = @{ sha256 = $hashAtual } | ConvertTo-Json -Compress
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$resultado = Invoke-RestMethod -Uri $url -Method Post `
    -Headers @{ Authorization = "Bearer $token" } `
    -ContentType 'application/json' -Body $body -TimeoutSec 30
Write-Host "Lote confirmado: $($resultado.data.count) registro(s)."
