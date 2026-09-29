# Teste sem rede: lote antigo ja salvo, lote novo e resposta sem alteracoes.
$ErrorActionPreference = 'Stop'
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('pralis-sincronizar-test-' + [guid]::NewGuid().ToString('N'))
$destino = Join-Path $tempRoot 'TXT'
[System.IO.Directory]::CreateDirectory($destino) | Out-Null
$apiAnterior = $env:PRALIS_API_BASE
$tokenAnterior = $env:CREARE_EXPORT_TOKEN
try {
    $env:PRALIS_API_BASE = 'https://api-teste.invalid'
    $env:CREARE_EXPORT_TOKEN = '12345678901234567890123456789012'
    $global:requests = 0
    $global:entregas = @()
    $global:antigoId = '11111111-1111-4111-8111-111111111111'
    $global:novoId = '22222222-2222-4222-8222-222222222222'
    $global:antigoTexto = ('A' * 363) + "`r`n"
    $global:novoTexto = ('B' * 363) + "`r`n"
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    $global:antigoSha = ([BitConverter]::ToString($sha256.ComputeHash([Text.Encoding]::ASCII.GetBytes($global:antigoTexto)))).Replace('-', '').ToLowerInvariant()
    $global:novoSha = ([BitConverter]::ToString($sha256.ComputeHash([Text.Encoding]::ASCII.GetBytes($global:novoTexto)))).Replace('-', '').ToLowerInvariant()
    $sha256.Dispose()
    $arquivoAntigo = Join-Path $destino 'produtos-TNP-antigo.txt'
    [System.IO.File]::WriteAllText($arquivoAntigo, $global:antigoTexto, [Text.Encoding]::ASCII)
    $marcador = Join-Path $destino '.ultimo-lote-tnp.json'
    [System.IO.File]::WriteAllText($marcador, (@{
        id = $global:antigoId; sha256 = $global:antigoSha; arquivo = $arquivoAntigo; registros = 1
    } | ConvertTo-Json -Compress))

    function global:Invoke-WebRequest {
        param($Uri, $Headers, $OutFile, [switch]$PassThru, [switch]$UseBasicParsing, $TimeoutSec)
        $global:requests++
        if ($global:requests -eq 3) { return [pscustomobject]@{ StatusCode = 204; Headers = @{} } }
        if ($global:requests -eq 1) {
            $id = $global:antigoId; $hash = $global:antigoSha; $conteudo = $global:antigoTexto
        } else {
            $id = $global:novoId; $hash = $global:novoSha; $conteudo = $global:novoTexto
        }
        [System.IO.File]::WriteAllText($OutFile, $conteudo, [Text.Encoding]::ASCII)
        return [pscustomobject]@{ StatusCode = 200; Headers = @{
            'X-Creare-Lote-Id' = $id; 'X-Creare-Sha256' = $hash; 'X-Creare-Registros' = '1'
        } }
    }
    function global:Invoke-RestMethod {
        param($Method, $Uri, $Headers, $ContentType, $Body, $TimeoutSec)
        $global:entregas += [pscustomobject]@{ Uri = $Uri; Body = $Body }
        return @{ data = @{ alreadyDelivered = $false } }
    }

    & (Join-Path $PSScriptRoot 'SINCRONIZAR-TXT-TNP.ps1') -Destino $destino
    $arquivos = @(Get-ChildItem -LiteralPath $destino -Filter '*.txt' -File)
    if ($global:requests -ne 3 -or $global:entregas.Count -ne 2 -or $arquivos.Count -ne 2) {
        throw "Falha: requests=$global:requests entregas=$($global:entregas.Count) arquivos=$($arquivos.Count)"
    }
    $estado = [System.IO.File]::ReadAllText($marcador) | ConvertFrom-Json
    if ($estado.id -ne $global:novoId -or -not [System.IO.File]::Exists([string]$estado.arquivo)) {
        throw 'Novo lote nao foi salvo corretamente.'
    }
    Write-Host 'OK: lote antigo reconhecido sem duplicar; lote novo salvo e entregue na mesma execucao.'
} finally {
    Remove-Item function:Invoke-WebRequest -ErrorAction SilentlyContinue
    Remove-Item function:Invoke-RestMethod -ErrorAction SilentlyContinue
    $env:PRALIS_API_BASE = $apiAnterior
    $env:CREARE_EXPORT_TOKEN = $tokenAnterior
    $resolvido = [System.IO.Path]::GetFullPath($tempRoot)
    $raizTemp = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
    if ($resolvido.StartsWith($raizTemp, [StringComparison]::OrdinalIgnoreCase) -and
        (Split-Path -Leaf $resolvido) -like 'pralis-sincronizar-test-*') {
        Remove-Item -LiteralPath $resolvido -Recurse -Force
    }
}
