-- =====================================================================
-- ITENS POR VENDA, COM PDV E HORA — o lote `venda_item_pdv` do Pralis.
--
-- Uma linha por ITEM de cupom, com o vínculo que o ERP prova:
--   item_venda_balcao.ID_VENDA_BALCAO -> venda_balcao -> dispositivo
--
-- Nomes de tabela/coluna vêm das consultas já em produção no robô
-- (ITENS_VENDAS_DIARIAS, ITENS_VENDAS_CANCELADAS, FECHAMENTO_CAIXA).
-- Os aliases de saída são o contrato do `POST /vendas/importar`
-- (tipo "venda_item_pdv") — não renomear sem mudar o servidor.
--
-- {{VALOR_DATA}} é o mesmo marcador das outras consultas do robô.
-- Para "quase tempo real", o robô roda esta consulta a cada minuto com
-- {{VALOR_DATA}} = hoje - DIAS_REPROCESSAR; o servidor descarta o que já
-- tem igual (chave loja + ID_ITEM_VENDA_BALCAO) e corrige o que mudou
-- (ATUALIZADO_EM mais novo). Reenviar não duplica.
--
-- A VALIDAR NA PADARIA antes de ligar (não dá para testar daqui):
--   1. o nome da chave primária do item — ID_ITEM_VENDA_BALCAO — e se ela
--      existe com esse nome em item_venda_balcao;
--   2. se existe um marcador de cancelamento POR ITEM (estorno de item
--      dentro de venda válida). Aqui o cancelado sai do STATUS da VENDA;
--   3. se DTHR_VENDABALCAO / DTHR_ITEM_VENDABALCAO estão na hora local;
--   4. quais valores STATUS assume além de 'F' (fechada) e 'C' (cancelada).
--      VENDA_CONFIRMADA abaixo é estrito: só 'F' conta como confirmada.
-- =====================================================================
SELECT
    CAST(ivb.ID_ITEM_VENDA_BALCAO AS CHAR)            AS ID_ITEM_VENDA_BALCAO,
    CAST(vb.ID_VENDA_BALCAO AS CHAR)                  AS ID_VENDA_BALCAO,
    CAST(COALESCE(vb.ID_DISPOSITIVO, '') AS CHAR)     AS ID_DISPOSITIVO,
    COALESCE(d.DESCRICAO, '')                         AS PDV,
    DATE_FORMAT(vb.DTHR_VENDABALCAO, '%Y-%m-%d %H:%i:%s')      AS DATA_HORA_VENDA,
    CAST(COALESCE(ivb.ID_PRODUTO, '') AS CHAR)        AS PRODUTO_ID_ERP,
    COALESCE(cp.CODIGO, '')                           AS PRODUTO_CODIGO,
    ivb.DESCRICAO_PRODUTO                             AS PRODUTO,
    ROUND(ivb.QUANTIDADE, 3)                          AS QUANTIDADE,
    ROUND(ivb.UNITARIO, 2)                            AS VALOR_UNITARIO,
    ROUND(ivb.TOTAL_ITEM_LIQUIDO_RATEIO, 2)           AS TOTAL,
    -- sem marcador por item confirmado no Creare: cancelado = venda cancelada
    (vb.STATUS = 'C')                                 AS ITEM_CANCELADO,
    COALESCE(vb.STATUS, '')                           AS VENDA_STATUS,
    (vb.STATUS = 'F')                                 AS VENDA_CONFIRMADA,
    -- a maior data que o item ou a venda carregam: é o que decide "mais novo"
    DATE_FORMAT(GREATEST(
        COALESCE(vb.DTHR_VENDABALCAO, ivb.DTHR_ITEM_VENDABALCAO),
        COALESCE(ivb.DTHR_ITEM_VENDABALCAO, vb.DTHR_VENDABALCAO)
    ), '%Y-%m-%d %H:%i:%s')                           AS ATUALIZADO_EM
FROM item_venda_balcao ivb
JOIN venda_balcao vb        ON vb.ID_VENDA_BALCAO = ivb.ID_VENDA_BALCAO
LEFT JOIN dispositivo d     ON d.ID_DISPOSITIVO = vb.ID_DISPOSITIVO
LEFT JOIN produto p         ON p.ID_PRODUTO = ivb.ID_PRODUTO
LEFT JOIN codigo_produto cp ON cp.ID_CODIGO_PRODUTO = p.ID_CODIGO_PRODUTO_PADRAO
WHERE DATE(vb.DTHR_VENDABALCAO) >= {{VALOR_DATA}}
ORDER BY vb.DTHR_VENDABALCAO, vb.ID_VENDA_BALCAO, ivb.ID_ITEM_VENDA_BALCAO;
