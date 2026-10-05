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
