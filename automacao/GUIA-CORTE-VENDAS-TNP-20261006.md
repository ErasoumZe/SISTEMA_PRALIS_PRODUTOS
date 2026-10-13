# TNP — ativar itens no Pralis e corrigir o biscoito 10824

**Correção de precisão de 07/10/2026:** a primeira versão do SQL arredondava a quantidade a duas casas, e a prévia do biscoito retornou `1,11` apesar de o bruto confirmado ser `1,114` kg. O arquivo `AJUSTE-SQL-BISCOITO-10824-20261007.zip` contém somente o SQL ajustado para três casas, compatível com `venda_produto_dia.quantidade` no Pralis. Quem já copiou o pacote anterior deve substituir apenas esse SQL na pasta `queries`, repetir a prévia e aplicar somente se ela mostrar `1,114` e `R$ 96,80`. As tentativas bloqueadas antes disso não enviaram nada.

**Atualização de 07/10/2026:** o diagnóstico da pasta ativa na padaria mostrou `Pralis no codigo: false` e 41 testes. Portanto, **antes deste guia**, aplicar o pacote `PATCH-AGENTE-PRALIS-TNP-20261007.zip` e seguir `GUIA-ATUALIZAR-AGENTE-PRALIS-TNP-20261007.md`. O pacote antigo de 06/10 sozinho não ativa o destino Pralis.

Este guia usa o pacote `PATCH-VENDAS-TNP-20261007.zip`. **Não substitua as pastas inteiras pelos ZIPs/RARs:** preserve `.env`, estado e logs da instalação ativa. O pacote do agente de 07/10 adiciona o destino opcional Pralis; os 43 testes e `Config OK` confirmam apenas código/configuração, não envio real. O agente continua entregando cupons completos ao Caixa Cicluz e passará a enviar também itens ao Pralis. O bot diário continua alimentando planilhas, agregados e fechamentos.

## Antes de começar

No PC da padaria, entre na conta que administra as tarefas. Separe 20–30 minutos sem interromper o caixa. Abra PowerShell **como administrador**. Não cole em chat `.env`, token ou senha. Confirme que o deploy da API contém a correção da PR #135 para atualização de cancelamentos de item; se não puder confirmar, pare antes do passo de ativação e peça conferência.

1. Localize as pastas instaladas. A pasta do agente vista no diagnóstico foi `C:\Users\Server-Pralis\Documents\integracoes-scripts`. Para achar o bot, abra **Agendador de Tarefas** → tarefa do Bot Padaria → **Ações** e veja a pasta do `rodar-uma-vez.js`/`rodar-vendas-ao-vivo.js`. Não use a cópia do Desktop do José como pasta instalada.
2. No Agendador, anote nome, estado e ação das tarefas do agente, bot diário e vendas ao vivo. Em PowerShell, `Get-ScheduledTask | Where-Object TaskName -Match 'Cicluz|Bot Padaria|Vendas' | Select-Object TaskName,State`. Se houver PM2, rode `pm2 list` e anote se existe `rodar-vendas-ao-vivo.js` também. **Se aparecerem múltiplas instalações ou nomes diferentes, pare e envie apenas nomes/ações, sem segredos.**
3. Desabilite temporariamente a tarefa `Cicluz-CREARE-Sincronizacao` e pare sua execução atual. Desabilite também **somente** a tarefa antiga `Bot Padaria - Vendas ao vivo`; se ela estiver no PM2, pare só esse processo. O bot diário/planilha pode continuar, mas pare-o por alguns minutos enquanto troca o SQL. Nunca desligue a integração do Caixa Cicluz definitivamente.
4. Pelo Explorador, copie as duas pastas instaladas para backups com data/hora, no mesmo disco. Confirme que os backups contêm `.env.producao`, `.estado` (agente) e `.runtime` (bot). **Não envie esses backups nem o RAR para GitHub.**

## Copiar somente os arquivos do pacote

Extraia `PATCH-VENDAS-TNP-20261007.zip` em uma pasta temporária. Copie:

| Do pacote | Para a instalação da padaria |
| --- | --- |
| `bot produtos/queries/CREARE_COMPILART_ITENS_VENDAS_DIARIAS.sql` | pasta `queries` do bot instalado |
| `bot produtos/CORRIGIR-BISCOITO-10824.cjs` | raiz do bot instalado |

Não copie `.env`, `.estado`, `.runtime`, logs nem `node_modules` do pacote ou de outro PC. Não execute `npm ci`: não mudamos dependências.

## Configurar o destino Pralis sem expor token

Abra, no Bloco de Notas, o `.env.producao` **do bot instalado** e o `.env.producao` **do agente instalado**. O ZIP recebido do bot tem `PRALIS_VENDAS_API_URL` e `PRALIS_VENDAS_API_TOKEN`; **confirme que as duas linhas também estão preenchidas no bot instalado**. Se não estiverem, pare e peça orientação. Copie essas duas linhas do bot instalado para o agente, sem modificar os valores. No agente acrescente `PRALIS_EMPRESA=TNP CENTRAL`. Salve o arquivo. Não coloque aspas extras, não deixe duas definições da mesma variável e não envie foto do conteúdo. O token da API é segredo.

## Testes e prévias — sem gravar vendas

Abra PowerShell na pasta instalada do agente:

```powershell
cd 'C:\Users\Server-Pralis\Documents\integracoes-scripts'
npm.cmd run check
npm.cmd test
```

Os testes devem terminar sem falhas. Eles não enviam vendas. Não reenvie agora apenas a venda antiga 588985: isso faria o relatório trocar para a fonte de cupons a partir de 15/09, mesmo sem os outros cupons do período, reduzindo falsamente os totais.

Na pasta **real** do bot, rode primeiro:

```powershell
node .\CORRIGIR-BISCOITO-10824.cjs
```

A prévia deve mostrar **15/09/2026, código 10824, quantidade 1.114 e total R$ 96,80**. Se mostrar R$ 880 mil ou outro valor, pare: o SQL corrigido não foi instalado ou os dados mudaram.

## Aplicar, um passo por vez

Na pasta real do bot, rode:

```powershell
node .\CORRIGIR-BISCOITO-10824.cjs --aplicar
```

Isso envia **uma única linha agregada corrigida** de 15/09 do produto 10824 ao Pralis, sem alterar a planilha. Espere `Um agregado diario enviado`. Se falhar, não apague `.runtime\pralis-pending`.

## Retomar automação e conferir

1. Reative o bot diário/planilha se o parou. **Deixe desabilitado o antigo `Bot Padaria - Vendas ao vivo`**, evitando dois remetentes de itens com regras diferentes.
2. Reative e inicie `Cicluz-CREARE-Sincronizacao`. O Caixa Cicluz continua como antes, agora com o destino Pralis adicional.
3. Aguarde dois ciclos (cerca de 2–3 minutos). Veja `integracoes-scripts\logs\agente-saida.log`: procure `[sincronizar]` e `[pralis] ... enviados=... pendentes=0`. Confira `agente-erros.log`. `.estado\fila-pralis.json` deve ser `[]` ou não conter pendências. **Não** faça backfill parcial de setembro; qualquer carga histórica por itens exige cobertura completa e conciliação antes de alterar o início da fonte do relatório.
4. Atualize o Relatório de vendas da TNP para 06/09–05/10 e confira o 10824. O item cancelado de R$ 880.470,80 deve sumir do total; o valor do período pode não ser exatamente R$ 2.293,60 porque o print e a consulta do Creare foram feitos em momentos diferentes e pode haver outros dias defasados.
5. Faça a conciliação de **um dia e um PDV** com o relatório oficial do SIA: número de vendas, faturamento e itens cancelados. Habilitar itens não completa por si só fechamentos/metas, e o histórico de outros produtos pode ainda precisar correção.

## Se algo der errado

- Falhou somente o Pralis: pare a tarefa do agente, retire **apenas** as três linhas `PRALIS_` adicionadas ao `.env.producao` do agente, reinicie a tarefa e reative o runner antigo de vendas ao vivo. O Caixa permanece ativo. Preserve `.estado\fila-pralis.json` para investigação.
- Falhou o bot diário: restaure **somente** o SQL do backup e reative a tarefa diária. Não restaure pastas inteiras por cima do estado atual.
- Nunca altere manualmente `ITEM_CANCELADO` no Creare, nem apague vendas no Pralis para “limpar” o relatório. Guarde o output e peça diagnóstico.
