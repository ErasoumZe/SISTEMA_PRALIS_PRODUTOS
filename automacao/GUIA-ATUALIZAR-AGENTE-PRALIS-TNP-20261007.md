# TNP — atualizar o agente CREARE para enviar itens também ao Pralis

Diagnóstico de 07/10/2026 no PC da padaria: `npm.cmd run check` e `npm.cmd test` passaram (41 testes), mas `obterConfig()` não retornou a propriedade `pralis` e não há referência a `sincronizarPralis` em `src/env.js`/`src/sincronizar.js`. O `.env.producao` já tem as três variáveis `PRALIS_`. **Portanto o código instalado é anterior ao adaptador do Pralis.**

Este pacote contém só código, sem `.env`, senha, token, `.estado`, fila, logs ou `node_modules`. Ele não substitui a integração do Caixa Cicluz; adiciona um segundo destino opcional para itens de cupom. A correção histórica do biscoito 10824 é outra etapa, no bot diário.

## 1. Antes de copiar

1. No Agendador de Tarefas, localize `Cicluz-CREARE-Sincronizacao`, confirme na aba **Ações** que usa `C:\Users\Server-Pralis\Documents\integracoes-scripts`. Se apontar outra pasta, **pare** e informe o caminho.
2. Verifique se a API do Pralis implantada contém a correção da PR #135 (atualização de cancelamento quando a data do Creare não muda). O `/health` responde, mas não informa commit; isso precisa de confirmação no deploy/Coolify. Sem essa confirmação, não ative o novo destino.
3. Desabilite a tarefa `Cicluz-CREARE-Sincronizacao` e **encerre a instância em execução**. Isto pausa por alguns minutos a entrega ao Caixa Cicluz; faça em horário acompanhado. Não apague `.estado/agente.lock`.
4. Faça uma cópia integral de `C:\Users\Server-Pralis\Documents\integracoes-scripts` para uma pasta de backup com data/hora. Confirme que o backup contém `.env.producao`, `.estado` e `logs`. Não compartilhe esse backup nem suba ao GitHub.

## 2. Copiar só o código

Extraia `PATCH-AGENTE-PRALIS-TNP-20261007.zip` no PC da padaria. Copie e substitua na pasta **instalada**:

| Do pacote | Para |
| --- | --- |
| `src/env.js` | `integracoes-scripts\src\env.js` |
| `src/sincronizar.js` | `integracoes-scripts\src\sincronizar.js` |
| `src/pralis-client.js` | `integracoes-scripts\src\pralis-client.js` |
| `package.json` | `integracoes-scripts\package.json` |
| `test/pralis-client.test.js` | `integracoes-scripts\test\pralis-client.test.js` |

**Não substitua a pasta inteira.** Preserve o `.env.producao` já editado, `.estado`, `logs`, `node_modules`, `package-lock.json`, `executar-agente.cmd` e a tarefa agendada. Não rode `npm ci`: não há dependência nova.

## 3. Testar antes de iniciar

Abra PowerShell na pasta instalada:

```powershell
cd 'C:\Users\Server-Pralis\Documents\integracoes-scripts'
npm.cmd run check
npm.cmd test
node --env-file=.env.producao --input-type=module -e "import('./src/env.js').then(({obterConfig})=>{const c=obterConfig(); new URL(c.padaria.apiUrl); new URL(c.pralis.apiUrl); console.log('Config OK, loja:',c.pralis.empresa)})"
```

Esperado: `check` sem erro, **43 testes aprovados**, `Config OK, loja: TNP CENTRAL`. O teste não imprime token nem envia vendas. Se falhar, **não inicie a tarefa**; restaure os cinco arquivos de código do backup e envie só a mensagem de erro (nunca o `.env`). Se a URL estiver escrita literalmente como `[https://...](https://...)`, corrija-a no `.env` para URL simples antes de retestar.

## 4. Corte e observação

1. Desabilite **somente** o antigo remetente `Bot Padaria - Vendas ao vivo` (ou o processo PM2 `rodar-vendas-ao-vivo.js`, se existir). O bot **diário/planilha/fechamento permanece ativo**. Não mantenha dois remetentes dos mesmos itens.
2. Reative e inicie `Cicluz-CREARE-Sincronizacao` no Agendador. Aguarde 2–3 minutos.
3. Abra `integracoes-scripts\logs\agente-saida.log` e `agente-erros.log`. Procure `[sincronizar]` (Caixa) e `[pralis] itens=... enviados=... pendentes=0`. A fila `.estado\fila-pralis.json` deve estar vazia. **`enviados` significa aceito pela API, não prova sozinho que os totais batem com o SIA.**
4. Compare um dia e um PDV no SIA, no Pralis e no Caixa Cicluz. Confira IDs de cupom, valor, itens cancelados e hora. Não faça backfill de uma única venda antiga: isso alteraria a data inicial da fonte por itens sem cobrir os demais cupons do período.

## 5. Recuo se algo falhar

Pare a tarefa do agente. Restaure **somente os cinco arquivos de código** do backup e retire temporariamente as três variáveis `PRALIS_` do `.env.producao` do agente; preserve `.estado/fila-pralis.json`. Reative o antigo remetente de vendas ao vivo se ele tinha sido desligado. Reinicie `Cicluz-CREARE-Sincronizacao` e confirme no log que o Caixa Cicluz voltou. Não restaure uma pasta inteira por cima do estado atual nem apague filas para esconder erros.
