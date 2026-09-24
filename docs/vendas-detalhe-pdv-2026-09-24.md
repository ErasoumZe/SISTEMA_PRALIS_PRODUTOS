# Vendas por PDV — contrato e implantação segura

## Fonte conferida

- No SISTEMA_PRALIS, `venda_produto_dia` recebe **produto × dia × loja**. Carrega código, descrição, quantidade e total, mas não o ID da venda nem o PDV.
- `fechamento_caixa_dia` recebe **dia × PDV × operador × loja**. Carrega primeira/última venda, número de vendas e pagamentos, mas não os itens.
- O robô atual publica lotes autenticados em `POST /vendas/importar`. A planilha é espelho, não a fonte do relatório da API. O código do robô instalado na padaria não está neste checkout e **não foi alterado nesta PR**.
- Como evidência auxiliar da estrutura Creare, as consultas versionadas em `ErasoumZe/SISTEMA_INTELIGENTE_PRALIS` (`integracoes-scripts/queries/itens-dia.sql` e `vendas-dia.sql`) ligam `item_venda_balcao.ID_VENDA_BALCAO` a `venda_balcao.ID_VENDA_BALCAO`. O item traz `ID_ITEM_VENDA_BALCAO`, `ID_PRODUTO`, `DESCRICAO_PRODUTO` e hora; a venda traz `ID_DISPOSITIVO`, `DTHR_VENDABALCAO` e `STATUS`. Esse outro integrador **não prova** que o robô da padaria já envia essas colunas. Validar no banco da loja antes de ativar.

## Novo contrato (desligado até o robô enviar)

`POST /vendas/importar` aceita `tipo: "venda_item_pdv"` e até 1.000 linhas por lote. Cada linha deve trazer `ID_ITEM_VENDA_BALCAO`, `ID_VENDA_BALCAO`, `ID_DISPOSITIVO`, `PDV`, `DATA_HORA_VENDA` (`aaaa-mm-dd hh:mm:ss`, hora local da loja), `PRODUTO_ID_ERP`, `PRODUTO_CODIGO`, `PRODUTO`, `QUANTIDADE`, `VALOR_UNITARIO`, `TOTAL`, `ITEM_CANCELADO`, `VENDA_STATUS`, `VENDA_CONFIRMADA` (booleano apurado na fonte), `EMPRESA` e `ATUALIZADO_EM`. IDs devem ser strings para não perder precisão. Os IDs de item e venda não podem faltar. O ID do dispositivo pode estar vazio, mas então não há vínculo com um PDV específico.

Grão persistido: **loja × ID original do item**. A chave única torna o reenvio idempotente. Uma versão posterior de `ATUALIZADO_EM` corrige o item; versão igual/antiga não regride o banco. A tabela nova não substitui nem recalcula o histórico diário. Cancelamentos permanecem guardados para auditoria, mas não entram no detalhe de vendidos: somente `VENDA_CONFIRMADA = true` e `ITEM_CANCELADO = false` são somados. O robô **não pode presumir** que todo status diferente de `C` é confirmado sem validar a regra com amostras reais do Creare.

O fechamento pode receber opcionalmente `ID_DISPOSITIVO`. O ID é gravado sem apagar valores existentes quando o robô antigo ainda enviar linhas sem ele. Sem esse ID, o ranking legado continua disponível, mas não se tenta casar por descrição. A consulta de detalhe usa **somente o ID original do dispositivo**, nunca nome, horário parecido ou rateio.

O detalhe usa período local `[início, fim + 1 minuto)`: selecionar 14:30 a 14:31 inclui até 14:31:59. O fechamento diário só é comparado quando o período cobre dias completos (00:00 a 23:59) e a linha já tem o ID do dispositivo. Diferença entre soma dos itens e fechamento é exibida como diferença, não corrigida artificialmente: descontos, cancelamentos, devoluções e lançamentos exigem conciliação na fonte.

## Pendências antes de ativar na loja

1. Ler as queries **efetivamente instaladas** no PC da padaria e conferir com dados reais a ligação item → venda → dispositivo, o fuso/hora e o significado de `STATUS`/`ITEM_CANCELADO`.
2. Atualizar o robô para enviar o novo lote e incluir `ID_DISPOSITIVO` no fechamento. Publicar primeiro em homologação; conferir IDs, quantidade, totais e cancelamentos de alguns cupons conhecidos.
3. Aplicar a migração `0026_*` em ambiente de teste e repetir o mesmo lote, uma correção mais nova e uma versão antiga. Testar acesso TNP/LI e ausência de vazamento monetário.
4. Planejar backfill por períodos pequenos, com contagem e reconciliação por dia/PDV. Não executar automaticamente no deploy. A visão histórica por hora permanece indisponível enquanto não houver detalhe daquela época.
5. Só então ativar o envio na padaria e acompanhar cobertura, diferenças e falhas de importação. A planilha e as duas tabelas diárias antigas continuam intactas.

**Estado desta PR:** contrato, armazenamento e leitura preparados; fonte externa e backfill não implantados. Portanto, produtos por PDV **não estão homologados em produção**.
