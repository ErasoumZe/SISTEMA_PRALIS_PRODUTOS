# Checklist V1 — o que depende de você

> Atualizado em 03/09/2026. O que dependia de código está feito e mergeado
> (18 PRs). O que está aqui precisa de uma decisão sua, de um acesso que eu não
> tenho, ou de um dado que só você consegue.

---

## 🔴 Bloqueia o resto — Central de Produtos

- [ ] **Classificar os 4.178 produtos em grupos** ← *o gargalo do projeto*
- [ ] Decidir os **178 "A CLASSIFICAR"** (só existem na TNP; nenhuma fonte traz grupo)
- [ ] Resolver na origem os **4 códigos de barras conflitantes** do Compilart
      (um EAN serve `ICE TEA LIMÃO` e `ICE TEA PÊSSEGO`)
- [ ] Revisar os **176 grupos com nomes divergentes**
- [ ] Cobrar da contabilidade o fiscal dos **3.389 produtos TNP sem NCM/CST**

**Cuidado:** trocar o grupo de um produto criado pela Central, no cadastro
normal, vai dar `TAX_RULE_NOT_FOUND`. Os 17 grupos do SIA (`BOMBONIERI`,
`MERCEARIA`…) não existem na planilha fiscal, que usa 76 regras `MER ...`.
Editar outros campos não tem problema.

---

## 🔴 Ligar o Criare (o código está pronto e provado)

Verificado em 03/09 com dado real: 3 registros de 363 bytes, `coditem` nos dois
campos, grupo e ECF vindos do SIA, NCM com zero à esquerda.

- [ ] **1.** Rodar `npm run creare:depara -- "exportacaoSIA.xls" --loja LI`
- [ ] **2.** Conferir `GET /admin/creare/health`
- [ ] **3.** No Coolify, definir:
  - `CREARE_EXPORT_ENABLED=true`
  - `CREARE_EXPORT_TOKEN` = token forte, **32+ caracteres, gerado por você**
  - `CREARE_STORE_CONFIG_JSON` = o JSON abaixo
- [ ] **4.** Gerar `GET /creare/produtos.txt?loja=LI&limite=10`, importar no
      Criare, aplicar, e conferir no log `AplicarNoCadastro() ... ATUALIZADO`
- [ ] **5.** ⚠️ **Abrir um desses 10 no SIA e olhar o CUSTO** — decide 2 ou 3
      casas decimais. Com 3 casas, R$ 1,00 é gravado como `0000001000`. Se o SIA
      mostrar R$ 10,00, troque `"cost"` para `2`
- [ ] **6.** Na máquina da Lisboa: `PRALIS_API_BASE` (domínio da **API**, que é
      o `API_URL` do Coolify — não é o do site) e `CREARE_EXPORT_TOKEN`

```jsonc
{
  "LI": {
    "categoryCodes": { "3": "000000003" },
    "units": { "UN": "UN", "KG": "KG", "G": "UN", "LT": "LT", "ML": "UN" },
    "groupCodes": {},
    "decimalPlaces": {
      "unitPrice": 2,
      "cost": 3,
      "icmsReduction": 2, "fullTaxRate": 2, "fcpRate": 2,
      "pisRate": 4, "cofinsRate": 4,
      "maximumQuantity": 3, "minimumQuantity": 3
    },
    "barcodeField": "automatic",
    "lineEnding": "LF",
    "noPromotionDate": "30/12/99",
    "iat": "A",
    "ipptByProductType": { "revenda": "T", "transformacao": "P" },
    "weighableByMeasure": { "UN": "N", "KG": "S", "G": "N", "LT": "N", "ML": "N" },
    "stockControlledByProductType": { "revenda": "S", "transformacao": "S" }
  }
}
```

---

## 🔴 Ligar a ingestão de vendas

O código está no ar desde 26/08; o robô não está mandando.

- [ ] No Coolify: `VENDAS_IMPORT_TOKEN` = token forte, 32+ caracteres
- [ ] No `.env` do robô: `PRALIS_VENDAS_API_URL` = domínio da API
- [ ] **Backfill** desde 2025, na máquina da loja, com `--so-contar` antes
      (ninguém verificou se o histórico do Creare alcança 2025)
- [ ] Devolver **`DIAS_REPROCESSAR` de 5 para 3** em `config.TNP.yaml` e
      `config.yaml` — marcado temporário em 21/08

---

## 🟡 Dados que eu preciso de você

- [ ] **Margem por grupo.** A aba
      `(TNP/LI/HORA - EXP.) GRUPOS/REF. - VLD SAIDA` está com **`#REF!`** — a
      fórmula quebrou e a aba está vazia inteira. Conserte lá, ou me mande a
      lista grupo → margem %. A canalização já existe no código
      (`calcularVVenda` cai em `margemGrupo`); falta só a fonte.
- [ ] **Espelho nas abas de loja.** Precisa de uma decisão sua — ver
      [`docs/espelho-abas-loja.md`](docs/espelho-abas-loja.md).
- [ ] **Listas oficiais** de setor e local de venda (hoje são texto livre;
      viram lista fechada quando você passar).
- [ ] **Lista oficial dos grupos de mercadoria** (backlog DB-02).
- [ ] **Regra da descrição automática** — critério para ocultar o "1" de
      "1 kg" (backlog DB-03).

---

## 🟡 Bloqueado por limpeza ou acesso

- [ ] **Índice único** em `(loja, codigo_barras)` — só depois da limpeza real.
      O `start:prod` roda `drizzle-kit push --force`: subir o índice com
      duplicata existente **derruba o deploy**.
- [ ] **Versionar o `ROBO-SIA-AUTO.ps1`** — existe só na máquina da Lisboa, e a
      cópia do Desktop pode não ser a mesma.
- [ ] **CREARE/SIA leitura direta** — depende de acesso ao `bdsia`.
- [ ] **Promoção no Criare** — o layout exige data de início e fim; o Pralis tem
      uma só.
- [ ] **Loja HORA** — sem integração nenhuma (nem vendas, nem Criare).

---

## ⚪ Decisões de arquitetura em aberto

- [ ] Governança do código interno: por loja ou global (backlog).
- [ ] Apagar de vez a tela de Duplicados (saiu do menu em 02/09; página e
      endpoint continuam no código como rede de segurança).

---

## ✅ Duas coisas para não esquecer

**A alíquota de ECF nunca pode ser derivada.** Medido: 28,71% de erro em 4.186
produtos, e produtos fiscalmente idênticos têm códigos diferentes. Sempre copiar
do SIA.

**Os nomes de grupo têm caractere invisível** (`U+2060`, em 11 dos 13). Ao
cruzar com qualquer outro sistema, o nome digitado à mão não casa — e o motivo
não aparece na tela.
