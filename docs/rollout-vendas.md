# Rollout do módulo de vendas — homologação primeiro, TNP antes da LI

Este documento é operacional. Ele não descreve o desenho (isso está em
`docs/superpowers/specs/2026-08-26-relatorio-vendas-design.md`), e sim **como
colocar no ar sem quebrar o que já funciona**.

Escopo: **TNP e LI**. A HORA está fora — usa outro PDV.

---

## 1. Como o schema é aplicado (verificado, não suposto)

O projeto **NÃO usa `drizzle-kit migrate`**. O `start:prod` da API é:

```
drizzle-kit push --config ./src/db/drizzle.config.ts --force && ... && tsx src/server.ts
```

Ou seja: **ao subir o container, o Drizzle compara o schema do código com o
banco e aplica a diferença, sem perguntar** (`--force`). Os arquivos em
`stack/api/drizzle/` são artefato de histórico e são usados pelos testes de
integração (`migrate()`); **não são o que roda em produção**.

Consequências práticas:

- não existe "aplicar a migration 0006" em produção: existe **subir a versão
  nova da API**, e o `push` cria as duas tabelas;
- `--force` aplicaria também mudança destrutiva se o schema pedisse. Esta
  entrega é **puramente aditiva** (dois `CREATE TABLE` e seus índices), então
  não há `DROP` nem `ALTER` de coluna existente — confira isso no passo 2.2
  antes de subir.

### 1.1 Rollback

| Situação | O que fazer |
|---|---|
| A API nova subiu e algo quebrou | Redeploy da versão anterior no Coolify. As duas tabelas novas **ficam** no banco, sem uso — não atrapalham a versão antiga, que não as conhece. |
| Quer remover mesmo assim | `DROP TABLE venda_produto_dia; DROP TABLE fechamento_caixa_dia;` — só depois de confirmar que a versão antiga está no ar. |
| O robô começou a mandar e quer parar | Esvaziar `PRALIS_VENDAS_API_URL` no `.env` do robô. Ele volta a escrever **só** no Sheets, sem alterar código. |
| Dado ruim entrou | `DELETE FROM venda_produto_dia WHERE loja = 'TNP' AND data = 'AAAA-MM-DD';` e reenviar o lote. A ingestão é idempotente: reenviar não duplica. |

**Nada aqui é destrutivo para os dados existentes**: nenhuma tabela antiga é
alterada por esta entrega.

---

## 2. Homologação

### 2.1 Antes de subir

- [ ] Snapshot/backup do banco de homologação.
- [ ] Confirmar a branch e o commit que vão subir.

### 2.2 Conferir que o `push` é aditivo

Rodar **contra homologação** o push em modo de conferência antes do deploy:

```
npm run db:push --workspace @pralis/api
```

(sem `--force`: ele mostra o que faria e pede confirmação). Esperado: apenas a
criação de `venda_produto_dia`, `fechamento_caixa_dia` e seus índices.
**Se aparecer qualquer `DROP` ou alteração de coluna existente, parar** e
investigar antes de continuar.

### 2.3 Subir e verificar

- [ ] Deploy da API e da PWA em homologação.
- [ ] `GET /health` responde.
- [ ] As duas tabelas existem e têm os índices:

```sql
SELECT indexname FROM pg_indexes
 WHERE tablename IN ('venda_produto_dia','fechamento_caixa_dia');
```

Esperado: `uq_venda_produto_dia_natural`, `uq_venda_produto_dia_hash`,
`idx_venda_produto_dia_loja_data` e os três equivalentes do fechamento.

- [ ] Login funciona; Produtos, Usuários e Dashboard seguem normais.

---

## 3. Token de importação

Gerar um segredo aleatório de **no mínimo 32 caracteres**. Sugestão:

```
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Configurar **o mesmo valor** em dois lugares, e em nenhum outro:

| Onde | Variável |
|---|---|
| API (Coolify, homologação) | `VENDAS_IMPORT_TOKEN` |
| Robô (`.env` da máquina da loja) | `PRALIS_VENDAS_API_TOKEN` |

**Nunca** no repositório, em log, em print ou neste documento.

### 3.1 Provar a autenticação antes de ligar o robô

| Teste | Esperado |
|---|---|
| `POST /vendas/importar` com token correto | 200 |
| com token errado | 401 |
| com token, mas `VENDAS_IMPORT_TOKEN` vazio na API | 503 (automação desligada) |
| sem token, usuário comum logado | 403 |
| sem token, admin logado | 200 |
| sem token e sem sessão | 401 |

---

## 4. Ligar a TNP (só a TNP)

No `.env` do robô **da TNP**:

```
PRALIS_VENDAS_API_URL=<url da API de homologação, sem /vendas/importar>
PRALIS_VENDAS_API_TOKEN=<o mesmo segredo>
```

Vazio = desligado. **Não remover nem desligar a escrita no Google Sheets**: ele
continua sendo a conferência durante todo o rollout.

---

## 5. Conferir um dia fechado da TNP

Escolher **um dia já fechado** (não o dia corrente) e comparar as quatro fontes:

| # | O que | Google Sheets | Resposta da importação | Postgres | Tela `/vendas` |
|---|---|---|---|---|---|
| 1 | linhas de venda do dia | | `recebidas` | `SELECT count(*) FROM venda_produto_dia WHERE loja='TNP' AND data='...'` | — |
| 2 | inseridas / atualizadas / ignoradas | — | os três números | — | — |
| 3 | faturamento do dia | soma de `TOTAL` | — | `SELECT sum(total) ...` | card Faturamento |
| 4 | quantidade vendida | soma de `QUANTIDADE` | — | `SELECT sum(quantidade) ...` | card Quantidade |
| 5 | nº de vendas | `NUMERO_VENDAS` | — | `SELECT sum(numero_vendas) FROM fechamento_caixa_dia ...` | card Nº de vendas |
| 6 | cada forma de pagamento | as 12 colunas | — | as 12 colunas | tabela por dia |
| 7 | produtos sem código | linhas com `PRODUTO_CODIGO` vazio | — | `... WHERE produto_codigo = ''` | aviso amarelo |
| 8 | valor em "Outros" | coluna `OUTROS` | — | coluna `outros` | aviso amarelo |

### 5.1 Provar a idempotência com dado real

Reenviar **exatamente o mesmo lote** e confirmar:

- [ ] `inseridas = 0`
- [ ] `atualizadas = 0`
- [ ] `ignoradas = <total do lote>`
- [ ] a contagem de linhas no Postgres **não mudou**
- [ ] os totais da tela **não mudaram**

### 5.2 Medir o que ainda não sabemos

Esta é a razão principal de o rollout vir antes da margem. Com o primeiro dia
real, anotar:

```sql
-- quanto do faturamento vem sem código (define o tamanho do de-para da fatia 3)
SELECT count(*) FILTER (WHERE produto_codigo = '') AS sem_codigo,
       count(*)                                    AS total,
       sum(total) FILTER (WHERE produto_codigo = '') AS faturamento_sem_codigo
  FROM venda_produto_dia WHERE loja = 'TNP';

-- a chave natural colide? (esperado: nenhuma linha)
SELECT loja, data, produto_codigo, count(*)
  FROM venda_produto_dia GROUP BY 1,2,3 HAVING count(*) > 1;
```

O segundo resultado diz se a descrição na chave era mesmo necessária.

---

## 6. Validar o acesso

| Quem | Esperado |
|---|---|
| admin | vê o seletor de loja; consulta TNP e LI |
| usuário TNP | sem seletor; vê só TNP |
| usuário LI | sem seletor; vê só LI |
| usuário TNP pedindo `?loja=LI` | 403 |
| usuário HORA | **não vê o item "Vendas" no menu**; acesso direto à URL → 403 |
| sem sessão | 401 |

---

## 7. Liberar a LI

Só depois de a TNP fechar corretamente por pelo menos um dia. Repetir os
passos 4, 5 e 6 com o `.env` do robô da LI.

---

## 8. Concluído quando

- [ ] schema aplicado em homologação e conferido
- [ ] API e PWA publicadas
- [ ] token configurado nos dois lados, sem exposição
- [ ] robô da TNP enviando dado real
- [ ] reenvio comprovadamente idempotente **com dado real**
- [ ] totais batendo com o Sheets
- [ ] frequência de código vazio medida
- [ ] nenhuma loja enxergando dado de outra
- [ ] HORA fora da interface
- [ ] logs sem erro recorrente
- [ ] rollback documentado e entendido

Só então começa a **fatia 3** (margem, cobertura e de-para).
