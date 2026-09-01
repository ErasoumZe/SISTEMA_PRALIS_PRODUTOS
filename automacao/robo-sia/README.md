# Robô do SIA — ciclo das 22:30 (máquina da Lisboa)

Todo dia às 22:30, na máquina da Lisboa, o cadastro do Pralis vira cadastro no
PDV. São três passos, nessa ordem:

```
1. baixar   -> baixar-cadastro.ps1     pega o TXT da API e valida
2. importar -> ROBO-SIA-AUTO.ps1       "Importar arquivo" (só LÊ o arquivo)
3. aplicar  -> ROBO-SIA-AUTO.ps1       "Aplicar ao cadastro" (é o que GRAVA)
```

O passo 2 apenas parseia o arquivo para a grade. Quem escreve em `produto`,
`codigos`, `estoques`, `tributacaopiscofins` e `aliquotas_internas_produto` é o
passo 3.

## Antes de tudo: variáveis de ambiente da máquina

Definir em **Sistema → Variáveis de ambiente** (não no script, que é versionado):

| Variável | O que é |
|---|---|
| `PRALIS_API_BASE` | domínio da **API** no Coolify (`API_URL`), sem barra no fim |
| `CREARE_EXPORT_TOKEN` | o mesmo token configurado no Coolify (mínimo 32 caracteres) |

`PRALIS_API_BASE` é o domínio da **API**, não o do site. No `docker-compose.coolify.yaml`
são dois serviços com domínios diferentes: `API_URL` (api) e `APP_URL` (pwa).
Pegue o valor de `API_URL` no painel do Coolify.

O token nunca aparece em log: o script registra a URL, jamais o `Authorization`.

## Passo 1 — baixar

```powershell
.\baixar-cadastro.ps1                # catálogo todo da LI
.\baixar-cadastro.ps1 -Limite 10     # primeira execução real, pequena
```

Grava em `C:\cadastro-sia\cadastro-lisboa.txt`.

O que ele faz antes de deixar o arquivo entrar:

- baixa para `cadastro-lisboa.txt.baixando` e só troca o arquivo real depois de validar;
- exige que **toda** linha tenha exatamente **363** posições;
- exige ASCII imprimível (o importador quebra a leitura com
  `' XXX' is not a valid integer value` se vier caractere estranho);
- guarda o anterior em `cadastro-lisboa.txt.anterior`.

**Se o download falhar, ele sai com código 1 e NÃO toca no arquivo que já
existe.** Isso é de propósito: passar adiante faria o robô importar o catálogo
de ontem achando que era o de hoje. Não importar é melhor que importar velho.

Erros com mensagem própria: `401` (token errado), `503` (exportação desligada ou
sem configuração), `422` (a API recusou gerar — veja
`GET /admin/creare/health`).

## Passo 2 e 3 — importar e aplicar

`ROBO-SIA-AUTO.ps1` abre o importador e dirige a tela: escolhe a empresa,
preenche o caminho do arquivo, clica em **Importar arquivo**, fecha os avisos,
troca para a aba **Dados no arquivo** e clica em **Aplicar ao cadastro**.

### A sessão precisa estar logada e desbloqueada

Isso não é detalhe: o robô usa automação de **tela** (`SetForegroundWindow`,
`SendKeys`, cliques em janelas). Com a máquina bloqueada ou a sessão desconectada
não existe desktop interativo, e ele falha ou clica no lugar errado.

- A tarefa agendada precisa rodar **como o usuário logado**, com "Executar
  somente quando o usuário estiver conectado".
- Não marque "Executar estando o usuário conectado ou não" — nesse modo a sessão
  fica sem desktop e a automação não funciona.
- A máquina pode estar com a tela apagada, mas **não bloqueada** (Win+L quebra).
- Nada de RDP desconectado: ao fechar a sessão remota o desktop some.

O passo 1 (baixar) não tem essa restrição — é só HTTP.

## Encaixando o download no robô

`baixar-cadastro.ps1` é um passo separado e pode simplesmente rodar antes. Se
preferir um só atalho, chame ele no começo do `ROBO-SIA-AUTO.ps1`, logo antes
da verificação `if(-not (Test-Path $ARQUIVO))`:

```powershell
& "$PSScriptRoot\baixar-cadastro.ps1"
if ($LASTEXITCODE -ne 0) {
    Write-Host 'download falhou - nao vou importar arquivo velho'
    return
}
```

O `if ($LASTEXITCODE -ne 0) { return }` é a parte que importa. Sem ele, uma
falha de rede faria o robô seguir e reimportar o arquivo do dia anterior.

## Logs

| O quê | Onde |
|---|---|
| download | `C:\cadastro-sia\logs\baixar-cadastro-<data>.txt` |
| robô (tela) | `C:\cadastro-sia\logs\robo-<data>.txt` |
| importador Criare | `C:\Program Files (x86)\Criare\logs\` |

Depois de uma execução real, procure no log do Criare as linhas
`AplicarNoCadastro() ... ATUALIZADO ... coditem: X`. É a confirmação de que
gravou — e de que atualizou em vez de inserir.

## Ainda não versionado

`ROBO-SIA-AUTO.ps1` continua existindo **só na máquina**. A cópia que está no
Desktop de quem desenvolve pode não ser igual à que roda na Lisboa, então não
foi trazida para cá no chute. Confira qual é a versão viva na Lisboa e copie ela
para esta pasta — script de automação que existe num Desktop só é risco.
