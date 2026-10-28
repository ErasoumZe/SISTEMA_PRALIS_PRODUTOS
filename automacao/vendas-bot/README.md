# Consulta diária de vendas do bot legado

O `bot produtos.zip` recebido em 05/10/2026 trazia a consulta diária somando
também itens cancelados e vendas não finalizadas, enquanto o fechamento filtrava
`STATUS='F'`. O SQL desta pasta corrige essa **divergência de população**.

Este arquivo é uma proposta versionada, **não instalada** no PC da padaria e
**não executada** no MySQL real. Primeiro conferir o tipo e os valores de
`item_venda_balcao.ITEM_CANCELADO` e conciliar um dia com o SIA. Fazer backup
do SQL atual do bot antes de copiar. O robô antigo contém `.env` e credenciais:
copiar só o `.sql`, nunca a pasta inteira nem o ZIP para o GitHub.

**Limite importante:** a API legada recebe agregados por produto e faz upsert.
Se todos os itens de um produto forem cancelados depois, a consulta deixa de
devolver aquele produto, mas o agregado antigo permanece no banco. Portanto
trocar o SQL sozinho **não corrige o histórico nem garante totais exatos**;
precisa de reconciliação por snapshot do dia ou da fonte de cupons item a item.

O novo destino opcional do `integracoes-scripts` cobre os itens dos cupons
recentes; o bot legado ainda alimenta planilhas e fechamentos por operador.
Não desligar a rotina diária até esses dois fluxos serem substituídos e
homologados. Ver `C:\projetos\PRALIS\20 - Revisão 2026-10-05 - vendas e pendências.md`.

## Diagnóstico do fechamento quase vazio (28/10/2026)

Desde a última semana de outubro o fechamento de caixa chega ao Pralis com
4 a 8 vendas por dia, quando a loja faz cerca de 1.400. Os itens dos cupons
chegam inteiros. O ano de 2026 todo foi reescrito, a partir de `01/01/2026`
(o `VALOR_DATA_DEFAULT`): em 08/10, o dia 06/10 ainda estava certo.

Enquanto isso, o Pralis troca sozinho o fechamento pelos itens em todo dia cujo
fechamento some menos da metade dos produtos vendidos
(`stack/api/src/modules/vendas/fechamento-confiavel.ts`).

`diagnostico-fechamento-pagamentos.js` é **somente leitura** e descobre a causa
no PC da padaria:

1. copie o arquivo para `C:\Users\Server-Pralis\Documents\bot`, ao lado do
   `index.js` (ele usa os `services/` e o `.env` do próprio robô);
2. rode `node diagnostico-fechamento-pagamentos.js`;
3. mande de volta o `diagnostico-fechamento-AAAAMMDD-HHMM.txt` gerado.

Ele não grava nada no banco, na planilha nem no Pralis e não imprime senha nem
token. Mostra:
- vendas x pagamentos em `formapgto_venda_balcao`, por dia e por mês;
- as tabelas candidatas a guardar o pagamento agora;
- as tarefas agendadas do robô e o fim dos logs.
