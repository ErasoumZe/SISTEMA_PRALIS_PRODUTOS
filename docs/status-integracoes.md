# Status das integrações — 01/09/2026

Um lugar só para responder "o que já está no ar, o que está pronto mas
desligado, e o que falta".

`main` **é produção**: o Coolify faz deploy a cada merge. Não existe ambiente de
homologação separado.

---

## 1. Em produção

Mergeado e no ar.

| O quê | Onde | PR |
|---|---|---|
| Cadastro de produtos, herança BASE → lojas | `/produtos` | #2 (26/08) |
| Espelho na planilha (aba `(BASE) CADASTRO PRODUTOS`) | criar/editar/excluir | #1, #2 |
| Regras fiscais por grupo, com PLU de balança | automático no cadastro | #2 |
| Ingestão de vendas do robô (TNP/LI) | `POST /vendas/importar` | #2, #3 |
| Relatório de vendas, margem e cobertura | `/vendas` | #2 |
| De-para venda → produto | `/vendas/de-para` | #2 |
| Produtos únicos do período + CSV | `/vendas/produtos` | #4 (01/09) |
| Diagnóstico e unificação de duplicados | `/produtos/duplicados` | #4 |
| Aviso de código de barras repetido ao digitar | formulário do produto | #4 |
| Piso de semelhança do de-para em 55% + aviso de PLU | `/vendas/de-para` | #4 |

### Espelho na planilha

Criar, editar e excluir no app refletem na aba BASE. A exclusão limpa só as
colunas de entrada — a linha 12 é a linha-modelo das fórmulas e não pode ser
apagada.

**As abas por loja (TNP/LI/HORA) não são espelhadas.** Elas têm outro leiaute e
não têm coluna de ID; escrever nelas por posição corromperia uma planilha de
Só entra depois que ganharem uma coluna de ID alinhada com a BASE.

---

## 2. Pronto, atrás de flag

Código na `main`, **desligado**. Ligar é decisão sua, no painel do Coolify.

### Exportação Criare/SIA — Fase 1 (PR #5)

| Estado | |
|---|---|
| `CREARE_EXPORT_ENABLED` | **false** |
| `CREARE_STORE_CONFIG_JSON` | vazio |
| `CREARE_EXPORT_TOKEN` | vazio |

O que já funciona quando ligar: de-para do SIA por código de barras
(`npm run creare:depara`, testado com o arquivo real — 4.178 linhas), `coditem`,
grupo, NCM e alíquota vindos do SIA, recusa por colisão de `coditem`,
`GET /admin/creare/health` e `?limite=N`.

Passo a passo em [`creare-fase1-runbook.md`](creare-fase1-runbook.md).

### Ingestão de vendas pelo robô

O código está no ar desde 26/08, mas o robô **não está mandando**:
`PRALIS_VENDAS_API_URL` está vazio em todos os `.env` do robô, então ele
continua escrevendo só no Sheets. Ligar exige gerar o `VENDAS_IMPORT_TOKEN` no
Coolify e preencher a URL no robô — ver [`rollout-vendas.md`](rollout-vendas.md).

> Os valores efetivos das variáveis vivem no painel do Coolify e não dá para
> conferir daqui. As linhas acima refletem o padrão do código (tudo desligado
> quando a variável está ausente ou vazia).

---

## 3. Aberto, esperando merge

| PR | O quê |
|---|---|
| **#6** | `automacao/robo-sia/` (download versionado do cadastro) + as variáveis do Criare no `docker-compose.coolify.yaml` |
| **#7** | casas decimais do custo como configuração + amostra no `/admin/creare/health` |

**O #6 é pré-requisito para ligar o Criare.** O compose não repassava nenhuma
variável `CREARE_*` para o container da API — configurar as flags no Coolify sem
esse merge não teria efeito nenhum.

---

## 4. Pendente, e por quê

### Índice único em `(loja, codigo_barras)`

**Não subiu de propósito.** O `start:prod` roda `drizzle-kit push --force`:
subir um índice único enquanto ainda existem duplicatas **derruba o deploy** —
o push falha, o container não sobe.

A ordem é: limpar as duplicatas em `/produtos/duplicados` em produção →
confirmar que sobrou zero → aí sim adicionar o índice.

### Backfill do histórico de vendas

O Postgres tem cerca de duas semanas; o pedido era desde 01/01/2025. Precisa
rodar `node backfill-vendas.js 2025-01-01` **na máquina da loja** (o Creare só é
acessível de lá), TNP primeiro, Lisboa depois. Rode com `--so-contar` antes:
ninguém verificou se o histórico do Creare alcança 2025.

### Custo: 2 ou 3 casas decimais

O layout grava com 3. No TXT do fornecedor a SKOL 473ML, que vende a R$ 6,90,
sai com `0000000100` — R$ 0,10 a 3 casas, R$ 1,00 a 2. O arquivo não desempata.

Depois do PR #7, o `/admin/creare/health` mostra as duas leituras lado a lado. A
resposta sai de abrir um produto no SIA depois dos 10 primeiros aplicados.

### `ROBO-SIA-AUTO.ps1` não está versionado

O script que dirige o importador (132 linhas de automação de tela) existe **só na
máquina**. A cópia no Desktop de desenvolvimento pode não ser a que roda na
Lisboa, então não foi trazida no chute. Confira qual é a versão viva e copie para
`automacao/robo-sia/`.

### Loja HORA

**Sem integração nenhuma.** Não está no módulo de vendas, não tem de-para de
canal, não tem exportação Criare. Fora de escopo por decisão, até você pedir.

### Exportação Criare: o que a Fase 1 não faz

- **Exclusão espelhada:** produto sai como `ATIVO = "N"`, **nunca** removido do
  SIA. Isso é regra, não limitação.
- **Promoção:** o layout exige data de início e fim; o Pralis não tem as duas,
  então produto com promoção fica de fora do arquivo.
- **TNP e HORA:** desligados. Só Lisboa na Fase 1.

### CREARE/SIA — leitura direta

Ler `coditem` e alíquota direto do banco `bdsia` continua bloqueado por acesso.
A Fase 1 contorna isso com a exportação do SIA Supervisor em arquivo.

---

## 5. O que depende de mão humana

Em ordem:

1. Mergear **#6** e **#7**.
2. Rodar `npm run creare:depara` com a exportação do SIA da Lisboa.
3. Conferir `GET /admin/creare/health`: casados, não casados e a distribuição de
   ECF.
4. Gerar `?limite=10`, importar no Criare, aplicar, e conferir o log
   (`AplicarNoCadastro() ... ATUALIZADO ... coditem: X`).
5. Abrir um desses produtos no SIA e **decidir as casas do custo**.
6. Só então: `CREARE_EXPORT_ENABLED=true`, `CREARE_STORE_CONFIG_JSON` (só `LI`) e
   `CREARE_EXPORT_TOKEN` no Coolify, mais `PRALIS_API_BASE` e o token na máquina
   da Lisboa.
7. Limpar duplicatas em produção — destrava o índice único.
8. Backfill de vendas na máquina da loja.

### Fora deste repositório

Na pasta do robô de vendas: `DIAS_REPROCESSAR` está em **5** em `config.TNP.yaml`
e `config.yaml`. Foi marcado como temporário em 21/08 e precisa voltar para **3**.
