-- Substituto para o SQL homônimo do bot legado da loja.
-- O fechamento de caixa considera apenas venda finalizada; o agregado de
-- produtos precisa usar a mesma população e retirar itens cancelados.
-- NÃO instalar sem comparar um dia/PDV no SIA e no Pralis.
SELECT
    DATE_FORMAT(ivb.DTHR_ITEM_VENDABALCAO, '%d/%m/%Y') AS DATA_VENDA,
    cp.CODIGO AS PRODUTO_CODIGO,
    ivb.DESCRICAO_PRODUTO AS PRODUTO,
    -- Pesaveis usam tres casas; o Pralis tambem armazena quantidade com escala 3.
    ROUND(SUM(ivb.QUANTIDADE), 3) AS QUANTIDADE,
    ROUND(AVG(ivb.UNITARIO), 2) AS VALOR_UNITARIO,
    ROUND(SUM(ivb.TOTAL_ITEM_LIQUIDO_RATEIO), 2) AS TOTAL
FROM item_venda_balcao ivb
JOIN venda_balcao vb
    ON vb.ID_VENDA_BALCAO = ivb.ID_VENDA_BALCAO
LEFT JOIN produto p
    ON ivb.ID_PRODUTO = p.ID_PRODUTO
LEFT JOIN codigo_produto cp
    ON cp.ID_CODIGO_PRODUTO = p.ID_CODIGO_PRODUTO_PADRAO
WHERE DATE(ivb.DTHR_ITEM_VENDABALCAO) >= {{VALOR_DATA}}
  AND vb.STATUS = 'F'
  AND UPPER(TRIM(CAST(COALESCE(ivb.ITEM_CANCELADO, '0') AS CHAR)))
      NOT IN ('1', 'C', 'S', 'SIM', 'TRUE')
GROUP BY
    ivb.ID_PRODUTO,
    cp.CODIGO,
    ivb.DESCRICAO_PRODUTO,
    DATE(ivb.DTHR_ITEM_VENDABALCAO)
ORDER BY
    DATE(ivb.DTHR_ITEM_VENDABALCAO) DESC,
    ivb.DESCRICAO_PRODUTO;
