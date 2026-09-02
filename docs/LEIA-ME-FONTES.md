# Fontes normalizadas para a unificação de produtos

Todas em CSV UTF-8 (BOM), separador `;`. Casamento entre lojas SÓ por código de
barras — código interno é por loja e não cruza.

| Arquivo | Loja | Chave | O que traz |
|---|---|---|---|
| `fonte_sia_lisboa.csv` | LI | COD_BARRAS / CODITEM | fiscal Lisboa: ALIQ_ECF, CST, CSOSN, NCM, REDUCAO |
| `fonte_compilart_tnp.csv` | TNP | COD_BARRAS / COD_INTERNO | catálogo TNP: custo, venda, ativo |
| `fonte_planilha_antiga_tnp.csv` | TNP | COD_INTERNO | nome + ativo (sem barras) |
| `fonte_fiscal_tnp_contabilidade.csv` | TNP | COD_INTERNO | fiscal TNP da contabilidade: NCM, CST, ICMS efetivo (940 produtos) |
| (Pralis vivo) `produtos-YYYYMMDD.csv` | todas | COD_BARRAS | a base atual (147) — export do próprio sistema |

## Correção medida em 02/09/2026 — a chave de duas fontes está errada acima

A tabela diz que `fonte_planilha_antiga_tnp.csv` e
`fonte_fiscal_tnp_contabilidade.csv` casam por `COD_INTERNO`. **Casam por
`COD_INTERNO` do quê?** Medido contra as outras fontes:

```
fiscal contabilidade (940) casando por COD_INTERNO:
   COD_INTERNO do Compilart:   0     <-- o que a tabela acima manda usar
   COD_BARRAS do Compilart:  900     <-- onde realmente casa

planilha antiga (3.122) casando por COD_INTERNO:
   COD_INTERNO do Compilart:   0
   CODITEM do SIA:         2.978
```

Os dois arquivos usam a **linhagem de código do Creare**, não a numeração
interna do Compilart. Conferido na amostra: fiscal `10010` →
"AÇUCAR REFINADO REI FINO 1KG" no SIA e no Compilart.

**Consequência:** ligar o fiscal da TNP pelo `COD_INTERNO` do Compilart daria
cobertura **zero**. Pela chave certa dá **925 de 4.350 (21,3%)**, e sobram
**3.425 sem fiscal** — que é o buraco que o módulo tem que mostrar.

Outro dado do mesmo levantamento: dos "códigos de barras", só ~860 são EAN de
verdade; ~3.300 são o código curto do Creare guardado na coluna de barras.
Casar por eles une 4.126 pares SIA↔Compilart, **99,81% com o mesmo nome** — e
dá 4.369 produtos únicos, que bate com a conta de ~4.368.

Regras de campo (decididas pelo José):
- Fiscal LI vem do SIA; fiscal TNP vem da contabilidade (por código interno TNP).
- Cadastro (nome/preço/custo) vem do Pralis onde existe; senão do Compilart.
- Todos os produtos entram; os parados entram como INATIVO.
- Cobertura fiscal TNP é PARCIAL (940 de ~4.300) — o módulo deve mostrar o buraco.
