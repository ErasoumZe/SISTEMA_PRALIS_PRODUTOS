# Sincronizacao de vendas CREARE -> Caixa Cicluz (+ Pralis opcional)

Agente que le o banco do PDV **CREARE/Compilart** (MySQL, na propria loja) e envia as vendas para a
API do ERP (`POST /api/integracoes`). O segundo destino Pralis, descrito ao fim,
é opcional e cobre **itens de cupom**, não fechamentos. Roda na maquina da loja.

## Pre-requisitos

- **Node.js 22+** na maquina da loja.
- Acesso ao **MySQL do CREARE** (mesma maquina ou rede local).
- **Saida HTTPS** para a API do ERP (internet).
- Uma **chave de integracao** (ver abaixo).

## 1. Configurar o `.env.producao`

Copie `.env.producao.example` para `.env.producao` (que fica fora do git) e preencha:

| Variavel                                              | Descricao                                                      |
| ----------------------------------------------------- | -------------------------------------------------------------- |
| `SERVIDOR_CREARE_COMPILART`                           | host do MySQL do CREARE (ex.: `localhost`)                     |
| `PORTA_CREARE_COMPILART`                              | porta (default `3306`)                                         |
| `BANCO_CREARE_COMPILART`                              | nome do banco (ex.: `gerente`)                                 |
| `USUARIO_CREARE_COMPILART` / `SENHA_CREARE_COMPILART` | credenciais do MySQL                                           |
| `PADARIA_API_URL`                                     | `https://api-sistema.cicluzieai.com.br`                        |
| `PADARIA_INTEGRACAO_CODIGO`                           | a chave de integracao (passo 2)                                |
| `SYNC_INTERVALO_MINUTOS`                              | intervalo do loop (default `1`)                                |
| `SYNC_DIAS_CANCELAMENTOS`                              | janela para varrer vendas que viraram canceladas (default `90`) |
| `SYNC_DIAS_INICIAIS`                                  | 1a execucao: dias para tras (default `1`)                      |
| `SYNC_LOCK_MAX_MINUTOS`                               | idade maxima do lock (default `30`)                            |
| `SYNC_RETRY_TENTATIVAS` / `SYNC_RETRY_BASE_MS`        | retry de rede por venda (default `4` / `500`)                  |
| `SYNC_MAX_REQ_POR_SEGUNDO`                            | teto de envios/s (throttle; default `4`, fica < limite da API) |
| `SYNC_ESTADO_DIR`                                     | pasta do estado de runtime (default `.estado`)                 |
| `SYNC_FUSO_OFFSET`                                    | offset da loja para UTC (padrao `-03:00`, horario de Brasilia) |

## 2. Gerar a chave de integracao

### Segundo destino: cupons e pagamentos no Pralis (opt-in)

O Caixa continua recebendo o payload completo em `POST /api/integracoes`, sem mudanca.
Para alimentar o Pralis com o total original do cupom e suas formas de pagamento,
configure na maquina da loja `PRALIS_VENDAS_API_URL`, `PRALIS_VENDAS_API_TOKEN`,
`PRALIS_EMPRESA` e `PRALIS_ENVIAR_CUPONS="true"`. Use
`PRALIS_ENVIAR_ITENS="false"` enquanto o bot "Vendas ao vivo" continuar mandando
os itens. Nao copie tokens para o repositorio ou para logs.

O Pralis precisa estar publicado com o tipo `venda_creare` antes de ativar o envio.
Esse lote tem fila independente (`.estado/fila-pralis-cupons.json`); uma falha nele
nao desfaz as vendas ja entregues ao Caixa. O relatorio "Cupons CREARE" mostra
somente datas recebidas; a primeira/ultima venda nao prova cobertura integral.

Depois de homologar o fluxo ao vivo, reimporte historico em faixas de ate 31 dias,
sem reenviar ao Caixa e sem alterar o cursor do agente:

```powershell
npm.cmd run reprocessar:pralis-cupons -- --de 2026-09-01 --ate 2026-09-30
```

Antes de executar, confira a faixa/loja e a saude da API. Repita uma faixa que
falhou: o Pralis deduplica por loja + ID da venda. A fila do backfill e propria.

No ERP, logado como admin: **Integracoes -> criar chave "Vendas do PDV"** -> copie o codigo -> cole
em `PADARIA_INTEGRACAO_CODIGO`.

## 3. Instalar e testar

```bash
npm ci            # instala a unica dependencia (mysql2)
npm run sincronizar   # roda UM ciclo (bom para o primeiro teste)
```

Cada ciclo imprime um resumo:

```
[sincronizar] recebidas=.. fila_reprocessada=.. criadas=.. atualizadas=.. sem_novidade=.. erros=.. fila_pendente=.. cursor=..
```

## Como funciona

- **Reprocesso do dia corrente** (fim da perda silenciosa): cada ciclo relê e reenvia o **dia
  corrente inteiro** — nao apenas o que e "novo". Assim, uma venda que o PDV sincronizou tarde (com
  hora anterior ao ultimo ciclo) e capturada no ciclo seguinte, em vez de ficar para tras. Na
  **primeira execucao de cada dia**, o ciclo reprocessa tambem o **dia anterior** uma vez (pega
  retardatarios da virada).
- **Cursor** (`.estado/cursor.json`): agora guarda so o **ultimo dia processado** e e **apenas
  otimizacao** (evita reprocessar o dia anterior a cada ciclo), nunca fonte de verdade — se sumir ou
  vier de versao antiga, o dia corrente inteiro e reprocessado do mesmo jeito.
- **Idempotente**: reenviar a mesma venda nao duplica (o servidor deduplica por `idVenda` + hash),
  entao reprocessar o dia inteiro a cada ciclo e sempre seguro (as repetidas voltam _sem novidade_).
- **Throttle + respeito ao rate limit**: o agente limita a saida a `SYNC_MAX_REQ_POR_SEGUNDO` (default
  4/s, abaixo do limite da API por chave). Se ainda assim receber **429**, le o `Retry-After` e
  **aguarda** (nunca re-martela); no reprocesso em faixa, a venda que levar 429 e **reenfileirada no
  proprio run** (as outras seguem e o limite reabastece), em vez de ser pulada.
- **Fila de falhas** (`.estado/fila-falhas.json`): vendas que falharam por erro de rede ficam nela e
  sao reenviadas no inicio do proximo ciclo. Erros de payload (4xx) sao logados e nao entram na fila.
- **Lock** (`.estado/agente.lock`): impede duas execucoes simultaneas (loop + tarefa agendada + run
  manual). Um lock de processo morto ou obsoleto (> `SYNC_LOCK_MAX_MINUTOS`) e roubado.
- **Conciliacao diaria**: ao fim do ciclo, o agente manda o agregado do CREARE (por PDV: quantidade,
  valor e os IDs das vendas fechadas) e a API compara com o sistema. Alem do **valor**, compara a
  **contagem** de vendas; havendo divergencia, o e-mail aos admins (e o log do ciclo) lista os **IDs
  presentes no CREARE e ausentes no sistema** — basta reprocessar esses IDs.

## Rodar como servico no Windows

### Opcao A — NSSM (recomendado): loop continuo

1. Baixe o **NSSM** em nssm.cc e extraia.
2. `nssm install CicluzSincronizacao`
3. Na janela do NSSM:
   - **Application Path**: caminho do `node.exe` (ex.: `C:\Program Files\nodejs\node.exe`).
   - **Startup directory**: a pasta `integracoes-scripts`.
   - **Arguments**: `--env-file-if-exists=.env.producao src/loop.js`
   - Aba **I/O**: aponte _Output (stdout)_ e _Error (stderr)_ para um arquivo (ex.:
     `logs\sincronizacao.log`) para ter historico.
4. `nssm start CicluzSincronizacao`. O NSSM reinicia o processo se ele cair.
5. Para parar: `nssm stop CicluzSincronizacao` — envia sinal e o agente encerra com seguranca
   (termina o ciclo atual e libera o lock).

### Opcao B — Agendador de Tarefas: um ciclo periodico

1. Crie uma tarefa que executa, na pasta `integracoes-scripts`:
   `node.exe --env-file-if-exists=.env.producao src/sincronizar.js`
2. Gatilho: repetir a cada `SYNC_INTERVALO_MINUTOS`.
3. Marque **"Nao iniciar uma nova instancia"** se a anterior ainda estiver rodando (o lock ja cobre
   isso, mas some as duas protecoes).

## Reprocesso manual (recuperacao)

Ferramenta para **reenviar vendas que ficaram de fora** da ingestao (ex.: falharam durante um deploy).
Re-le do CREARE e reenvia para a API. E **idempotente**: vendas que ja existem voltam _sem novidade_ e
as que faltavam sao **criadas**. **Nao mexe** no cursor, na fila nem no lock — pode rodar com o
`agente`/`sincronizar` no ar.

```bash
# Reprocessa o dia inteiro (todas as vendas daquela data no CREARE)
npm run reprocessar -- --dia 2026-07-15

# Reprocessa apenas vendas especificas (por ID_VENDA_BALCAO do CREARE)
npm run reprocessar -- --ids 522987,523147,523369

# Reprocessa uma FAIXA de dias, dia a dia (backfill)
npm run reprocessar -- --de 2026-07-01 --ate 2026-07-20
```

Informe **exatamente um** alvo (`--dia`, `--ids` **ou** `--de/--ate`). Nos modos `--dia`/`--ids` o
comando loga o resultado **de cada venda**; na **faixa**, um resumo **por dia** + o total geral:

```
[reprocessar] ids=522987,523147,523369: 3 venda(s) lida(s) no CREARE.
[reprocessar] CREARE:522987 -> CRIADA (estava faltando)
[reprocessar] CREARE:523147 -> sem novidade (ja existia igual)
[reprocessar] CREARE:523369 -> CRIADA (estava faltando)
[reprocessar] ids=522987,523147,523369 concluido: total=3 criadas=2 atualizadas=0 sem_novidade=1 erros=0

[reprocessar] faixa 2026-07-01..2026-07-03: 3 dia(s).
[reprocessar] dia=2026-07-01: lidas=180 criadas=0 atualizadas=0 sem_novidade=180 erros=0
[reprocessar] dia=2026-07-02: lidas=205 criadas=2 atualizadas=0 sem_novidade=203 erros=0
[reprocessar] dia=2026-07-03: lidas=190 criadas=0 atualizadas=0 sem_novidade=190 erros=0
[reprocessar] faixa 2026-07-01..2026-07-03 concluida: dias=3 total=575 criadas=2 atualizadas=0 sem_novidade=573 erros=0
```

No modo `--ids`, um ID que nao existir no CREARE e avisado (`NAO ENCONTRADA`) e ignorado. Se alguma
venda falhar no envio, o comando sai com codigo != 0.

## Backfill inicial (opcional)

Para importar dias anteriores na primeira vez, use a **faixa** do reprocesso manual:

```bash
npm run reprocessar -- --de 2026-07-01 --ate 2026-07-20
```

Isso nao mexe no cursor e e idempotente. Alternativamente, na primeira execucao do `sincronizar` o
`SYNC_DIAS_INICIAIS` controla quantos dias para tras o **primeiro** ciclo relê.

## Segundo destino opcional: itens de venda para o Pralis (piloto)

Esta cópia local inclui um adaptador independente para `POST /vendas/importar`
(`tipo=venda_item_pdv`). O envio original ao Caixa da Cicluz continua igual.
Sem as três variáveis abaixo, o adaptador permanece desligado:

```env
PRALIS_VENDAS_API_URL=https://api-produtos.cicluzieai.com.br
PRALIS_VENDAS_API_TOKEN=<token do VENDAS_IMPORT_TOKEN da API>
PRALIS_EMPRESA=TNP CENTRAL
```

Para Lisboa, usar `PRALIS_EMPRESA=LISBOA CENTRAL` **na instalação daquela loja**.
Nunca escrever o token em README, log ou chamado de suporte. A fila separada
`.estado/fila-pralis.json` guarda apenas itens de venda, não credenciais; não a
apague se houver pendências. O log informa `enviados` e `pendentes`.

**Estado do piloto:** adaptador testado localmente, não instalado nem conciliado
na padaria. Ele cobre itens de cupom; **não substitui ainda** os fechamentos por
operador/turno nem as planilhas do robô antigo. Não desligar o robô diário.
Antes de habilitar este destino, desabilitar apenas a tarefa antiga de vendas
*ao vivo* para evitar dois remetentes com regras diferentes de cancelamento;
fazer o corte em janela acompanhada, conferindo fila e IDs de cupons.

## Estado (nao apagar)

A pasta `.estado/` guarda `cursor.json`, `fila-falhas.json` e `agente.lock`. Nao vai para o git.
O `cursor.json` e so otimizacao (ultimo dia processado): apaga-lo e inofensivo — o proximo ciclo o
trata como primeira execucao (relê `SYNC_DIAS_INICIAIS` dias) e o dia corrente inteiro entra do mesmo
jeito. Evite apagar com o agente rodando so para nao competir pela escrita.

## Problemas comuns

- **`Chave de integracao invalida`**: `PADARIA_INTEGRACAO_CODIGO` errado ou inativado no ERP.
- **Erro de conexao MySQL**: confira `SERVIDOR/PORTA/USUARIO/SENHA_CREARE_COMPILART`.
- **`Nao foi possivel conectar na API`**: `PADARIA_API_URL` errada ou sem internet.
- **`fila_pendente` crescendo**: a API esta recusando (veja `erros` e as linhas de erro no log) ou a
  rede esta instavel; o agente segue reenviando a cada ciclo.

## Observacao sobre fuso horario

O CREARE guarda a hora **local**. O agente usa `SYNC_FUSO_OFFSET="-03:00"` por padrao para converter
o horario de Brasilia no instante UTC real, a mesma convencao usada pela abertura e pelo fechamento
do caixa. Altere a variavel apenas se a loja estiver em outro fuso. **Valide no primeiro dia real**
que as vendas caem no caixa certo.

## Modo desenvolvimento

`npm run dev:teste_integracao` (usa `.env.desenvolvimento`) reenvia as vendas do ultimo dia com a
data reescrita para hoje e prefixo `TESTE` no `idVenda` — util para testar a integracao sem sujar os
dados reais. Nao use em producao (para isso e o `sincronizar`/`agente`).
