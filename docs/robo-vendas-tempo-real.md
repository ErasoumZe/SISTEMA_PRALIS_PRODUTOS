# Vendas em (quase) tempo real — o que falta no robô da padaria

**Estado em 24/09/2026.** O sistema já está pronto para receber e mostrar
venda por venda: tabela `venda_item_pdv`, rota `POST /vendas/importar` com
`tipo: "venda_item_pdv"`, aba **Vendas** em `/vendas` (relê a cada 15 s, abre o
cupom ao clicar) e o detalhe por PDV. **Nada disso mostra dado até o robô da
loja enviar o novo lote.** O código do robô fica no PC da padaria
(`C:\Users\Server-Pralis\Documents\bot`) e não está neste repositório — por
isso este documento existe.

## Como é hoje

O robô acorda **uma vez por dia** (`HORARIO_EXECUCAO_TNP: "22:10"` no
`config.yaml`), roda as consultas de `queries/` no MySQL do Creare
(`localhost:3306`, banco `gerente`) e envia dois lotes ao Pralis: vendas por
produto × dia e fechamento de caixa × dia. Nenhum dos dois sabe o que é "uma
venda". Por isso não é tempo real — e nunca foi: é uma remessa diária.

## O que mudar no robô (quatro edições)

1. **Nova consulta.** Copiar `docs/robo/CREARE_COMPILART_ITENS_VENDA_PDV.sql`
   para `queries/`. Ela traz uma linha por item de cupom com o vínculo que o
   ERP prova (`item_venda_balcao → venda_balcao → dispositivo`), hora, código
   e descrição originais, quantidade, valor, status e cancelamento. Os aliases
   de saída são o contrato do servidor — não renomear.

2. **Registrar a tarefa** em `services/syncService.js`, na lista
   `CREARE_COMPILART`, ao lado das três existentes:
   `{ query: 'CREARE_COMPILART_ITENS_VENDA_PDV.sql', sheetName: 'VENDAS_ITENS_PDV' }`.
   Esta tarefa **não vai para o Google Sheets** — só para o Pralis. Se o
   `runQueryAutomation` gravar toda tarefa na planilha, marcar esta como
   `somentePralis: true` e pular a escrita na planilha para ela.

3. **Mapear o tipo** em `services/pralisSalesService.js`, no `SHEET_TYPES`:
   `VENDAS_ITENS_PDV: 'venda_item_pdv'`. O envio em lotes de 500 e o replay de
   pendentes já existentes servem como estão. A chave única no servidor é
   `loja + ID_ITEM_VENDA_BALCAO`: reenviar não duplica; `ATUALIZADO_EM` mais
   novo corrige o item.

4. **Frequência.** Para a aba ficar "ao vivo", esta tarefa precisa rodar a cada
   minuto — as outras continuam às 22:10. Sugestão: uma segunda entrada de
   `node-cron` em `index.js` (`* * * * *`) que roda **só** esta tarefa com
   `{{VALOR_DATA}} = hoje`, dentro do mesmo `withLock` para nunca cruzar com a
   execução diária. Um minuto de intervalo com o Creare no mesmo PC custa uma
   consulta indexada por data; se a máquina sofrer, subir para 2–5 min.

Também vale mandar `ID_DISPOSITIVO` no lote de fechamento
(`CREARE_COMPILART_FECHAMENTO_CAIXA.sql` já tem `d.ID_DISPOSITIVO` na
subconsulta): é o que permite ao detalhe do PDV confrontar itens e fechamento.

## O que validar ANTES de ligar — com dados reais, no PC da padaria

Não dá para testar daqui: não há acesso ao MySQL do Creare. Quatro pontos que
a consulta assume e precisam ser confirmados olhando o banco:

1. `item_venda_balcao.ID_ITEM_VENDA_BALCAO` existe com esse nome (é a chave do
   item; se for outro nome, trocar só o alias da primeira coluna).
2. Existe marcador de cancelamento **por item** (estorno de item numa venda
   válida)? A consulta hoje deriva `ITEM_CANCELADO` do `STATUS` da **venda**.
3. `DTHR_VENDABALCAO` está na hora local da loja (a tela assume
   America/Sao_Paulo e **não converte**).
4. Quais valores `venda_balcao.STATUS` assume além de `'F'` e `'C'`. Hoje só
   `'F'` conta como confirmada; venda em aberto aparece na lista sem somar.

## Ordem segura de implantação

1. Rodar a consulta nova **à mão** no MySQL da padaria para um dia conhecido e
   conferir 3 cupons contra o Creare (itens, hora, PDV, cancelamento).
2. Fazer as quatro edições no robô com `AMBIENTE: desenvolvimento` apontando
   para homologação; rodar uma vez; conferir em `/vendas` → aba Vendas.
3. Reenviar o mesmo dia e confirmar `inseridas: 0, ignoradas: N` na resposta.
4. Apontar para produção. Backfill por períodos curtos (uma semana por vez),
   comparando por dia o total dos itens com o fechamento — a diferença é
   informação (descontos, devoluções), não erro a corrigir.
5. Só então ligar o cron de 1 minuto.

Enquanto isso não acontece, a aba Vendas mostra **"Aguardando o robô da
loja"** — e é a verdade.
