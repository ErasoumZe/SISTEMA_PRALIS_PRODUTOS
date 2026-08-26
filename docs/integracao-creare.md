# Exportação Criare/SIA Supervisor

## Estado

O Pralis possui a infraestrutura de exportação posicional, mas ela permanece
**desabilitada por padrão e não homologada para produção**.

O que foi implementado:

- layout de 40 campos e 363 posições no pacote `shared`;
- serializer ASCII estrito e parser para conferência;
- de-para independente por loja;
- bloqueio de valores ausentes, overflow, identificadores inválidos e
  promoções sem as datas exigidas pelo Supervisor;
- endpoint autenticado `GET /creare/produtos.txt`;
- diagnóstico administrativo `GET /admin/creare/health`;
- feature flag `CREARE_EXPORT_ENABLED=false`.

O endpoint apenas gera um download. Ele não grava em pasta monitorada, não
acessa Firebird e não envia dados ao Supervisor.

## Autorização do endpoint

- Usuário de loja exporta somente a própria loja.
- Administrador deve informar `?loja=TNP`, `?loja=LI` ou `?loja=HORA`.
- A resposta usa `Cache-Control: no-store` e arquivo ASCII com a quebra de linha
  configurada para a loja.
- Se um único produto estiver inválido, nenhum arquivo parcial é devolvido.

## Configuração

As duas variáveis ficam na API:

```dotenv
CREARE_EXPORT_ENABLED=false
CREARE_STORE_CONFIG_JSON=
```

`CREARE_STORE_CONFIG_JSON` é um JSON em uma linha. Exemplo **ilustrativo, não
aprovado para produção**:

```json
{
  "TNP": {
    "groupCodes": { "PRODUTOS DA CASA": "0005" },
    "categoryCodes": { "3": "000000003" },
    "units": { "UN": "UN", "KG": "KG", "G": "UN", "LT": "LT", "ML": "UN" },
    "ecfTaxCodesByGroup": { "PRODUTOS DA CASA": "01" },
    "decimalPlaces": {
      "unitPrice": 2,
      "icmsReduction": 2,
      "fullTaxRate": 2,
      "fcpRate": 2,
      "pisRate": 4,
      "cofinsRate": 4,
      "maximumQuantity": 3,
      "minimumQuantity": 3
    },
    "barcodeField": "automatic",
    "lineEnding": "CRLF",
    "noPromotionDate": "30/12/99",
    "iat": "A",
    "ipptByProductType": { "revenda": "T", "transformacao": "P" },
    "weighableByMeasure": { "UN": "N", "KG": "S", "G": "N", "LT": "N", "ML": "N" },
    "stockControlledByProductType": { "revenda": "S", "transformacao": "S" }
  }
}
```

Todos os valores acima precisam ser confirmados. Em particular, `G -> UN`,
`ML -> UN`, alíquota `01`, categoria `3`, escalas decimais e os defaults
operacionais não devem ser copiados do exemplo sem aprovação.

## Regras de segurança

- Grupo, categoria e alíquota ECF sem de-para causam erro.
- Código interno deve ter até 9 dígitos. Com até 6, usa somente o campo
  curto; com 7 a 9, usa somente o estendido.
- Código de barras deve ter até 14 dígitos e obedece à estratégia configurada
  (`short`, `extended` ou `automatic`).
- Identificadores nunca são truncados.
- Textos são normalizados para ASCII, mantendo exatamente um byte por posição.
- Preço automático exige custo e margem pontual; preço manual exige
  `vVendaPontual`.
- Promoções são recusadas enquanto o modelo do Pralis não possuir data inicial
  e final compatíveis com o layout.

## Pendência observada na descrição

A regra atual `montarDescricao()` inclui a quantidade zero. Um produto com nome
`PÃO DE SAL PRALIS`, quantidade `0` e medida `KG` vira
`PÃO DE SAL PRALIS 0 KG`. O exportador reutiliza a regra oficial do Pralis e não
corrige isso silenciosamente. A regra de produtos de fabricação própria
vendidos por quilo precisa ser decidida e corrigida no domínio, não somente no
arquivo Criare.

## Para homologar

1. Obter e revisar o de-para real de uma loja.
2. Confirmar encoding, quebra de linha, casas decimais e precedência dos campos
   curto/estendido com a Criare.
3. Configurar somente um ambiente de homologação.
4. Manter `CREARE_EXPORT_ENABLED=false` enquanto se usa o endpoint de health.
5. Ligar a flag, gerar um produto fictício autorizado e conferir os 363 bytes.
6. Importar no Supervisor de homologação e comparar todos os campos.
7. Registrar a aprovação antes de qualquer ativação em produção.

O contrato documental e as perguntas ao fornecedor permanecem em
`docs/descoberta-integracao-creare.md`.

