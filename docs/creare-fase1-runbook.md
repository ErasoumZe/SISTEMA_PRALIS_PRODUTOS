# Fase 1 Criare — como ligar, na ordem

A exportação continua **desligada**. Nada aqui muda o PDV sozinho.

## 1. Importar o de-para do SIA

O `coditem` é a chave que o importador usa para decidir entre inserir e
atualizar. Sem ele, importar **duplica o catálogo**. Por isso o de-para vem do
próprio SIA:

```
cd stack/api
npm run creare:depara -- "caminho/para/exportacaoSIA.xls" --loja LI
npm run creare:depara -- "caminho/para/exportacaoSIA.xls" --loja LI --apply
```

O primeiro comando só confere; o segundo grava. O importador também aceita o
`docs/fonte_sia_lisboa.csv` normalizado e versionado, que representa a mesma
exportação já tratada.

Aceita `.xls`, `.xlsx` e `.csv`, acha as colunas pelo nome (a exportação tem
340) e **recusa antes de gravar** se algum código de barras apontar para mais de
um produto.

Rodado com a exportação real de 01/09/2026: **4.178 linhas gravadas**, 8 sem
código de barras, nenhuma ambiguidade, nenhum coditem repetido.

O arquivo **não é versionado** — é catálogo real da loja.

## 2. Conferir antes de exportar qualquer coisa

```
GET /admin/creare/health
```

Mostra, por loja: total de produtos, quantas linhas do SIA foram carregadas,
quantos casaram, quantos ficaram de fora (com exemplos e o motivo) e a
**distribuição dos códigos de ECF** que sairiam.

Confira a distribuição antes de importar. Se aparecer um código estranho, é
sinal de de-para desatualizado.

## 3. Primeira execução real: pequena

```
GET /creare/produtos.txt?loja=LI&limite=10
```

Importe esse arquivo no Criare, aplique ao cadastro e confira no log
(`C:\Program Files (x86)\Criare\logs\`) as linhas
`AplicarNoCadastro() ... ATUALIZADO ... coditem: X`, sem erro.

### O que conferir nesses 10 primeiros — não pule

**O custo — esta é a decisão que só os 10 primeiros respondem.**

O campo sai hoje com **3 casas decimais**. No TXT do fornecedor a SKOL 473ML,
que vende a R$ 6,90, sai com `0000000100`: isso é **R$ 0,10** a 3 casas e
**R$ 1,00** a 2. O arquivo do fornecedor não desempata, e adivinhar contamina
margem e precificação do catálogo inteiro.

O `GET /admin/creare/health` traz `amostraCusto` com até 5 produtos já mostrando
as duas leituras lado a lado:

```jsonc
{
  "nome": "CERVEJA",
  "custoNoPralis": 1,
  "casasConfiguradas": 3,
  "campoGravado": "0000001000",   // o que vai nas posições 143-152
  "seSiaLerCom2Casas": 10,        // se o SIA mostrar R$ 10,00 -> são 2 casas
  "seSiaLerCom3Casas": 1          // se mostrar R$ 1,00 -> são 3, está certo
}
```

**Depois de aplicar os 10, abra um desses produtos no SIA e veja qual coluna
bate.** Se bater a de 2 casas, mude `decimalPlaces.cost` para `2` no
`CREARE_STORE_CONFIG_JSON` — é um valor só, num lugar só, e nada mais no arquivo
muda (há teste garantindo que preço e estoque não se mexem).

A mesma dúvida vale para `quantity` (no exemplo, `0000000096` com 3 casas seria
0,096), mas esse campo sai sempre `0` na Fase 1, então não atrapalha agora.

## 4. Só então ligar

No Coolify:

- `CREARE_EXPORT_ENABLED=true`
- `CREARE_STORE_CONFIG_JSON` com a chave `LI` (TNP e HORA ficam de fora)
- `CREARE_EXPORT_TOKEN` — token forte (mínimo 32 caracteres) **gerado por você**,
  para o robô baixar sem login. Sem ele, só sessão de administrador exporta.

O que a config precisa ter, com os valores que o TXT do fornecedor comprova:

```jsonc
{
  "LI": {
    "categoryCodes": { "3": "000000003" },
    "units": { "UN": "UN", "KG": "KG", "G": "UN", "LT": "LT", "ML": "UN" },
    "groupCodes": {},          // não usado quando há casamento no SIA
    "decimalPlaces": {
      "unitPrice": 2,          // confirmado: 0000000690 = R$ 6,90
      "cost": 3,               // A CONFERIR nos 10 primeiros (ver passo 3)
      "icmsReduction": 2, "fullTaxRate": 2, "fcpRate": 2,
      "pisRate": 4, "cofinsRate": 4,
      "maximumQuantity": 3, "minimumQuantity": 3
    },
    "barcodeField": "automatic",
    "lineEnding": "LF",        // o TXT do fornecedor não tem CR
    "noPromotionDate": "30/12/99",
    "iat": "A",
    "ipptByProductType": { "revenda": "T", "transformacao": "P" },
    "weighableByMeasure": { "UN": "N", "KG": "S", "G": "N", "LT": "N", "ML": "N" },
    "stockControlledByProductType": { "revenda": "S", "transformacao": "S" }
  }
}
```

`groupCodes` e `ecfTaxCodesByGroup` deixaram de ser usados quando há casamento
no SIA — grupo e alíquota vêm de lá. Ver `creare-aliquota-ecf.md`.

## 5. Automação das 22:30

O robô da Lisboa lê `C:\cadastro-sia\cadastro-lisboa.txt`. O passo de download
está versionado em [`automacao/robo-sia/`](../automacao/robo-sia/README.md):

```powershell
.\baixar-cadastro.ps1                # catálogo todo
.\baixar-cadastro.ps1 -Limite 10     # a execução de conferência do passo 3
```

Ele lê `PRALIS_API_BASE` e `CREARE_EXPORT_TOKEN` das **variáveis de ambiente da
máquina** — nunca de dentro do script, que é versionado. Valida as 363 posições
antes de trocar o arquivo, e se o download falhar **não mexe no arquivo que já
existe** (importar o catálogo de ontem é pior que não importar).

`PRALIS_API_BASE` é o domínio da **API** (`API_URL` no Coolify), que é diferente
do domínio do site (`APP_URL`) — são dois serviços no
`docker-compose.coolify.yaml`.

## O que a exportação recusa, e por quê

| Situação | O que acontece |
|---|---|
| De-para não importado | recusa tudo (`CREARE_DEPARA_MISSING`) |
| Dois produtos do Pralis casando no mesmo `coditem` | recusa tudo (`CREARE_CODITEM_COLLISION`) |
| Produto sem par no SIA | fica de fora, aparece no health |
| Código interno do Pralis diverge do `coditem` | fica de fora, aparece no health |
| Produto com promoção | fica de fora (o layout exige as duas datas) |

A colisão derruba o arquivo inteiro de propósito: o importador roda
`update produto set codbarra = null WHERE codbarra = :codbarra` antes de gravar.
Escrever no coditem errado faria o produto legítimo perder o código de barras e
**sumir do caixa**.

## Ainda fora desta fatia

- Exclusão espelhada: produto sai como `ATIVO = "N"`, nunca removido.
- Promoção: só quando o Pralis tiver as duas datas que o layout exige.
- TNP e HORA: desligados.
