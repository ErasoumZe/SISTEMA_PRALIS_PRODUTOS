<#
    baixar-cadastro.ps1 - busca no Pralis o arquivo posicional do SIA.

    Roda ANTES do ROBO-SIA-AUTO.ps1, na maquina da Lisboa, as 22:30.

    Regras que este script segue de proposito:

    - URL e token vem de VARIAVEIS DE AMBIENTE DA MAQUINA. Nada de credencial
      dentro do arquivo: ele e versionado.
    - Grava primeiro num temporario e so troca o arquivo real depois de validar.
      Download pela metade, pagina de erro HTML ou resposta vazia nunca chegam
      ao importador.
    - Falhou o download? SAI COM ERRO e NAO mexe no arquivo que ja existe. Isso
      e proposital: se deixasse passar, o robo importaria o catalogo de ontem
      achando que era o de hoje. Nao importar e melhor que importar velho.

    Uso:
      .\baixar-cadastro.ps1
      .\baixar-cadastro.ps1 -Limite 10      # primeira execucao real, pequena
      .\baixar-cadastro.ps1 -Loja LI -Destino 'C:\cadastro-sia\cadastro-lisboa.txt'

    Variaveis de ambiente necessarias (defina em Sistema > Variaveis de ambiente):
      PRALIS_API_BASE      ex.: https://<dominio-da-API-no-Coolify>
                           E o dominio da API (API_URL), NAO o do site.
      CREARE_EXPORT_TOKEN  o mesmo valor configurado no Coolify.

    Codigos de saida: 0 = ok | 1 = falhou (o robo deve parar).
#>
[CmdletBinding()]
param(
    [ValidateSet('LI', 'TNP', 'HORA')]
    [string]$Loja = 'LI',

    [string]$Destino = 'C:\cadastro-sia\cadastro-lisboa.txt',

    # Quantos produtos pedir. 0 = todos. Use 10 na primeira execucao real.
    [int]$Limite = 0,

    # Opt-in: baixa somente o lote pendente; 204 = nada para importar.
    [switch]$Incremental,

    [string]$LogDir = 'C:\cadastro-sia\logs'
)

$ErrorActionPreference = 'Stop'

# --- o registro tem 363 posicoes; e o que separa arquivo bom de lixo ---
$TAMANHO_REGISTRO = 363

function Escrever-Log {
    param([string]$Mensagem)
    $linha = "{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Mensagem
    Write-Host $linha
    if ($script:ArquivoLog) { Add-Content -LiteralPath $script:ArquivoLog -Value $linha -Encoding UTF8 }
}

function Falhar {
    param([string]$Mensagem)
    Escrever-Log "ERRO: $Mensagem"
    Escrever-Log 'O arquivo existente NAO foi alterado. O robo deve parar aqui.'
    exit 1
}

# --- log ---
if (-not (Test-Path -LiteralPath $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
$script:ArquivoLog = Join-Path $LogDir ("baixar-cadastro-{0}.txt" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
Escrever-Log "baixando cadastro da loja $Loja"

# --- configuracao vem do ambiente, nunca do arquivo ---
$apiBase = $env:PRALIS_API_BASE
$token = $env:CREARE_EXPORT_TOKEN

if ([string]::IsNullOrWhiteSpace($apiBase)) {
    Falhar 'PRALIS_API_BASE nao esta definida. Defina com o dominio da API (API_URL do Coolify), sem barra no fim.'
}
if ([string]::IsNullOrWhiteSpace($token)) {
    Falhar 'CREARE_EXPORT_TOKEN nao esta definida. Use o mesmo valor configurado no Coolify.'
}
if ($token.Length -lt 32) {
    Falhar 'CREARE_EXPORT_TOKEN tem menos de 32 caracteres. A API recusa token curto de proposito.'
}

$apiBase = $apiBase.TrimEnd('/')
$url = "$apiBase/creare/produtos.txt?loja=$Loja"
if ($Limite -gt 0) { $url = "$url&limite=$Limite" }
if ($Incremental) { $url = "$url&modo=pendentes" }
# a URL aparece no log; o token NUNCA
Escrever-Log "origem: $url"

# --- baixa para um temporario ao lado do destino (mesmo volume, move atomico) ---
#
# Daqui para baixo o acesso a disco e por [System.IO], nao pelos cmdlets.
# Test-Path/Remove-Item/Copy-Item/Move-Item interpretam o caminho, e `~`
# derruba todos eles -- inclusive com -LiteralPath. E `~` aparece sozinho
# em nome curto do Windows: C:\Users\JOS~1\..., PROGRA~1. Medido: falhou
# com "Nao existe um objeto no caminho especificado C:\Users\JOS~1" depois
# de o arquivo ja ter sido baixado e validado -- ou seja, na pior hora.
$pastaDestino = Split-Path -Parent $Destino
[System.IO.Directory]::CreateDirectory($pastaDestino) | Out-Null
$temporario = "$Destino.baixando"
[System.IO.File]::Delete($temporario)

try {
    # Windows PowerShell 5.1 ainda negocia TLS 1.0 por padrao em algumas maquinas
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $resposta = Invoke-WebRequest -Uri $url `
        -Headers @{ Authorization = "Bearer $token" } `
        -OutFile $temporario `
        -PassThru `
        -UseBasicParsing `
        -TimeoutSec 120
}
catch {
    $status = $null
    if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
    if ($status -eq 401) { Falhar 'a API recusou o token (401). Confira CREARE_EXPORT_TOKEN.' }
    if ($status -eq 503) { Falhar 'a exportacao esta desligada ou sem configuracao na API (503).' }
    if ($status -eq 422) { Falhar 'a API recusou gerar o arquivo (422) - veja /admin/creare/health.' }
    Falhar ("nao consegui baixar: {0}" -f $_.Exception.Message)
}

if ($Incremental -and [int]$resposta.StatusCode -eq 204) {
    [System.IO.File]::Delete($temporario)
    Escrever-Log 'Sem alteracoes pendentes (204). Importador nao deve abrir.'
    exit 2
}
if (-not [System.IO.File]::Exists($temporario)) { Falhar 'o download terminou mas nao gerou arquivo.' }

if ($Incremental) {
    $loteId = [string]$resposta.Headers['X-Creare-Lote-Id']
    $loteHash = [string]$resposta.Headers['X-Creare-Sha256']
    $hashRecebido = (Get-FileHash -LiteralPath $temporario -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($loteId -notmatch '^[0-9a-f-]{36}$' -or $loteHash -ne $hashRecebido) {
        [System.IO.File]::Delete($temporario)
        Falhar 'Lote sem identificador ou hash divergente; arquivo nao sera importado.'
    }
}

# --- validacao antes de deixar isso chegar perto do importador ---
$linhas = @([System.IO.File]::ReadAllLines($temporario) | Where-Object { $_.Trim().Length -gt 0 })

if ($linhas.Count -eq 0) {
    [System.IO.File]::Delete($temporario)
    Falhar 'o arquivo baixado esta vazio.'
}

$forasDoTamanho = @($linhas | Where-Object { $_.Length -ne $TAMANHO_REGISTRO })
if ($forasDoTamanho.Count -gt 0) {
    $exemplo = $forasDoTamanho[0]
    $amostra = $exemplo.Substring(0, [Math]::Min(60, $exemplo.Length))
    [System.IO.File]::Delete($temporario)
    Falhar ("{0} linha(s) nao tem {1} posicoes (a primeira tem {2}). Comeco: '{3}'. Provavelmente veio pagina de erro em vez do arquivo." -f `
        $forasDoTamanho.Count, $TAMANHO_REGISTRO, $exemplo.Length, $amostra)
}

# o importador quebra na leitura se vier caractere fora de ASCII imprimivel
$naoAscii = @($linhas | Where-Object { $_ -match '[^\x20-\x7e]' })
if ($naoAscii.Count -gt 0) {
    [System.IO.File]::Delete($temporario)
    Falhar ("{0} linha(s) tem caractere fora de ASCII imprimivel." -f $naoAscii.Count)
}

# --- guarda o anterior e troca ---
if ([System.IO.File]::Exists($Destino)) {
    $backup = "$Destino.anterior"
    [System.IO.File]::Copy($Destino, $backup, $true)
    Escrever-Log "copia do anterior em: $backup"
    [System.IO.File]::Delete($Destino)
}
[System.IO.File]::Move($temporario, $Destino)

$marcador = "$Destino.lote.json"
if ($Incremental) {
    $dadosLote = @{ loja = $Loja; id = $loteId; sha256 = $loteHash; arquivo = $Destino }
    [System.IO.File]::WriteAllText("$marcador.baixando", ($dadosLote | ConvertTo-Json -Compress))
    [System.IO.File]::Delete($marcador)
    [System.IO.File]::Move("$marcador.baixando", $marcador)
    Escrever-Log "Lote pendente: $loteId. Confirme SOMENTE apos verificar o log do SIA."
} else {
    [System.IO.File]::Delete($marcador)
}

Escrever-Log ("OK: {0} registro(s) de {1} posicoes gravados em {2}" -f $linhas.Count, $TAMANHO_REGISTRO, $Destino)
if ($Limite -gt 0) {
    Escrever-Log "ATENCAO: arquivo PARCIAL (-Limite $Limite). E a execucao de conferencia, nao o catalogo todo."
}
exit 0
