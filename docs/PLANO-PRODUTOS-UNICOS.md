# Lista de produtos únicos vendidos no período — plano de ação

> Escrito em 26/08/2026 a partir da leitura do código em
> `homologacao/cadastro-produtos-2026-08-25` (HEAD `4526c52`) e das consultas
> do robô. **VERIFICADO** = lido no código, não suposto.

---

## 1. O pedido

> *"preciso trazer os únicos produtos vendidos durante o período de 01/01/2025
> até 26/08/2026… não vai me trazer 12.793,59 pães de queijo, vai ver que
> vendeu e traz pão de queijo… o que aparecer repetido você não repete, tipo
> fórmula de Excel"*

Uma linha por produto que teve venda no período. É o "Remover duplicatas" do
Excel aplicado à lista de vendas.

---

## 2. A pergunta que decide tudo: o que faz dois produtos serem "o mesmo"?

Este é o ponto onde a entrega dá certo ou vira lixo, e não é uma escolha
técnica — é uma escolha de negócio.

A tabela `venda_produto_dia` guarda **produto × dia**: um produto vendido em
300 dias tem 300 linhas. Agrupar é obrigatório. A questão é agrupar por quê.

| Critério | O que acontece em 20 meses | Veredito |
|---|---|---|
| `produto` (o nome) | "PAO DE QUEIJO" e "PAO DE QUEIJO PQ PRALIS" viram **dois** produtos se alguém renomeou no Creare | ruim |
| `produto_codigo` | Todos os pesáveis sem código colapsam numa linha só — VERIFICADO: `produto_codigo` vem de `LEFT JOIN` e pode ser vazio | ruim |
| `(produto_codigo, produto)` | É o que a tela usa hoje (VERIFICADO em `vendas-report.repository.ts:46`). Separa o mesmo produto quando o nome mudou | aceitável, imperfeito |
| **`ID_PRODUTO` do Creare** | Identidade real no ERP. Sobrevive a renomeação e a troca de código | **o certo** |

**O `ID_PRODUTO` não está no Pralis.** VERIFICADO: a consulta
`CREARE_COMPILART_ITENS_VENDAS_DIARIAS.sql` agrupa por
`ivb.ID_PRODUTO, cp.CODIGO, ivb.DESCRICAO_PRODUTO, DATE(...)` mas **não
seleciona o `ID_PRODUTO`** — ele é usado para agrupar e jogado fora. Nunca
chega na planilha nem no Postgres.

Essa é a decisão central deste plano: **trazer o `ID_PRODUTO` para dentro.**
Sem ele, qualquer lista "única" de um período longo vai ter o mesmo produto
repetido sob nomes diferentes, e o José vai (com razão) dizer que não
funcionou.

---

## 3. Fatia 0 — hoje, sem deploy nenhum

O script `produtos-unicos.js` já está pronto e entregue. Roda na máquina da
padaria, lê direto do Creare, agrupa por `ID_PRODUTO` e gera um CSV que abre no
Excel.

```
node produtos-unicos.js 2025-01-01 2026-08-26
```

Colunas: `CODIGO`, `PRODUTO` (o nome da venda mais recente), `QUANTIDADE`,
`FATURAMENTO`, `DIAS_COM_VENDA`, `PRIMEIRA_VENDA`, `ULTIMA_VENDA`,
`NOMES_DIFERENTES`, `ID_PRODUTO`.

Serve para responder **hoje** e, de quebra, produz o número que este plano
inteiro precisa: quantos produtos tiveram mais de um nome no período. Rode isso
antes de decidir o resto.

Não é a solução final — é um arquivo, não uma tela, e alguém precisa ir na
máquina da padaria rodar. A solução final é a fatia 2.

---

## 4. Fatia 1 — trazer o `ID_PRODUTO` para o Pralis

Sem isto, a fatia 2 nasce com o defeito do nome.

- [ ] Acrescentar `ivb.ID_PRODUTO AS PRODUTO_ID_ERP` ao `SELECT` de
      `CREARE_COMPILART_ITENS_VENDAS_DIARIAS.sql`. **Não mexer no `GROUP BY`** —
      `ID_PRODUTO` já está lá, então o resultado não muda de granularidade
- [ ] Acrescentar `PRODUTO_ID_ERP` ao fim da lista de colunas de
      `VENDAS_PRODUTOS` nos três `config.*.yaml`.
      **Sempre no fim**: o append grava por posição e as ~90 mil linhas
      existentes seguem a ordem antiga
- [ ] `mapVendaProduto` em `syncService.js` passa a preencher o campo.
      **NÃO incluir no HASH** — mesma regra das outras colunas novas, senão o
      robô reinsere todo o histórico
- [ ] Coluna `produto_id_erp` em `venda_produto_dia`, opcional (`text`, default
      `''`). Migration aditiva
- [ ] `vendaProdutoInputSchema` aceita o campo como opcional — o schema é
      `.loose()`, então dado antigo sem o campo continua entrando
- [ ] O backfill (`backfill-vendas.js`) reaproveita a mesma consulta e já traz
      o campo sozinho

**Retrocompatibilidade:** linhas antigas ficam com `produto_id_erp` vazio. A
fatia 2 precisa funcionar com isso — ver 5.2.

---

## 5. Fatia 2 — a tela

### 5.1 O que é

Uma listagem "Produtos vendidos no período": uma linha por produto, com filtro
de loja e datas, ordenável, com busca e **exportação para Excel**.

- [ ] `GET /vendas/produtos-unicos?loja=&inicio=&fim=`
- [ ] Colunas: código, produto, quantidade, faturamento, dias com venda,
      primeira e última venda, nº de nomes diferentes
- [ ] Ordenação padrão por faturamento, alternável por nome e por quantidade
- [ ] Busca por nome na própria tela
- [ ] Paginação no servidor — 20 meses podem dar milhares de linhas e a tela
      não pode tentar renderizar tudo
- [ ] Botão **Exportar CSV** com o período inteiro, não só a página visível.
      Separador `;`, vírgula decimal, BOM UTF-8 — é o que faz o Excel em
      português abrir sem estragar acento e sem juntar tudo numa coluna
- [ ] Respeitar a mesma regra de acesso do relatório: usuário de loja vê só a
      dele, HORA fora, admin escolhe

### 5.2 A regra de agrupamento, com o histórico incompleto

```
COALESCE(NULLIF(produto_id_erp, ''), produto_codigo || '|' || produto)
```

Usa o `ID_PRODUTO` quando existe e cai no par código+nome quando não existe.
Assim a tela funciona no dia seguinte à fatia 1, sem esperar o histórico
inteiro ser recarregado.

- [ ] Mostrar na tela, discretamente, quantas linhas do período ainda estão sem
      `produto_id_erp` — é o aviso honesto de que aquele pedaço pode repetir

### 5.3 Detalhes que decidem se a tela é usada

- [ ] O nome exibido é o da **venda mais recente**, não o alfabeticamente maior:
      é o nome que o produto tem hoje no PDV
- [ ] `NOMES_DIFERENTES > 1` vira um marcador visual clicável que abre a lista
      dos nomes — isso liga esta tela ao plano de unificação de cadastros
- [ ] Código com zeros à esquerda precisa sair como texto no CSV, senão o Excel
      come os zeros e o código deixa de casar com o cadastro

---

## 6. Onde isto encosta no plano de unificação

São dois problemas diferentes que se alimentam:

| | Onde vive | O que resolve |
|---|---|---|
| **Produtos únicos** (este plano) | vendas, no Creare | o mesmo produto aparecendo várias vezes **no relatório de vendas** |
| **Unificação de cadastros** (`PLANO-UNIFICACAO-CADASTROS.md`) | catálogo, no Pralis | o mesmo produto tendo **mais de um cadastro** |

A coluna `NOMES_DIFERENTES` desta lista é matéria-prima direta da unificação: um
produto que teve três nomes em 20 meses provavelmente tem cadastro repetido no
Pralis. Vale fazer esta lista antes.

---

## 7. Pré-requisito de dados

**O período pedido começa em 01/01/2025 e o Postgres hoje tem cerca de duas
semanas.** A tela da fatia 2 não tem o que mostrar até o histórico entrar.

- [ ] Rodar `backfill-vendas.js 2025-01-01` na TNP
- [ ] Confirmar antes, com `--so-contar`, que o Creare tem mesmo 2025 —
      ninguém verificou até agora, e é possível que a base tenha sido migrada
      em alguma data e não vá tão longe
- [ ] Repetir na LI depois

O `produtos-unicos.js` da fatia 0 **não depende disso**: ele lê o Creare direto.
É inclusive a forma mais rápida de descobrir até onde o histórico vai.

---

## 8. Decisões do José — FECHADAS em 31/08/2026

Respondidas pelo José; não perguntar de novo, implementar assim:

1. **Por loja.** A lista é de uma loja por vez (usuário escolhe TNP, LI ou HORA).
   Não somar as três — cada loja tem código e `ID_PRODUTO` próprios e o modelo
   mantém as lojas separadas.
2. **Só o líquido.** Usar `TOTAL_ITEM_LIQUIDO_RATEIO` como já é. Não abater
   canceladas/devolvidas por consulta separada — os números têm que bater com o
   relatório de vendas atual.
3. **Nome + quanto vendeu.** Colunas: produto, quantidade, faturamento e dias
   com venda. Ordenável por faturamento (padrão), quantidade e nome.
4. **Fatia 0 já, tela depois.** Entregar HOJE a lista via `produtos-unicos.js`
   (CSV, sem deploy). As Fatias 1 e 2 (a tela fixa) entram na sequência, não
   são pré-requisito da entrega imediata.

## 9. Regras que continuam valendo

- Coluna nova em aba do robô vai **sempre no fim** da lista do `config.yaml`.
- Coluna nova **nunca** entra no HASH.
- Migrations aditivas. `DROP` ou `ALTER` de coluna existente: parar.
- Não existe ambiente de homologação — a `main` é produção.
- Não desligar o espelho na planilha.
