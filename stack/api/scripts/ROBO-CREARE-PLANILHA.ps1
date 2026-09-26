<#
  Executa o observador Google Sheets -> TXT Criare.

  O script usa as credenciais já mantidas em stack/api/.env e nunca as copia
  para a pasta da automação. Ctrl+C encerra o modo contínuo.
#>
[CmdletBinding()]
param(
    [switch]$UmaVez,
    [string]$Produto,
    [switch]$Forcar
)

$ErrorActionPreference = 'Stop'
$Repo = Resolve-Path (Join-Path $PSScriptRoot '..\..\..')
$Api = Join-Path $Repo 'stack\api'
$Config = Join-Path $PSScriptRoot 'creare-planilha.config.json'
$Script = Join-Path $PSScriptRoot 'creare-planilha-bot.ts'

if (-not (Test-Path -LiteralPath $Script)) { throw "Robô não encontrado: $Script" }
if (-not (Test-Path -LiteralPath $Config)) { throw "Configuração não encontrada: $Config" }

$argumentos = @('tsx', $Script, '--config', $Config)
if ($UmaVez) { $argumentos += '--once' } else { $argumentos += '--watch' }
if (-not [string]::IsNullOrWhiteSpace($Produto)) { $argumentos += @('--produto', $Produto) }
if ($Forcar) { $argumentos += '--force' }

Push-Location $Api
try {
    & npx @argumentos
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
