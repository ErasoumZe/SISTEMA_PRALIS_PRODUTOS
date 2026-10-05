-- Conciliacao diaria: o que o CREARE tem no dia, agregado por dispositivo (PDV).
-- Espelha a regra combinada: apenas venda FECHADA (STATUS = 'F'). Cancelada ('C') fica de fora.
-- ID_DISPOSITIVO e o mesmo identificador externo que a ingestao manda em Venda.idCaixa, entao a
-- API resolve o PDV pelo dicionario de vinculos ja existente.
SELECT
  vb.ID_DISPOSITIVO AS pdvIdentificador,
  COUNT(*) AS quantidadeVendas,
  COALESCE(SUM(vb.VALOR_TOTAL), 0) AS valorTotal
FROM venda_balcao vb
WHERE vb.DTHR_VENDABALCAO >= ?
  AND vb.DTHR_VENDABALCAO < DATE_ADD(?, INTERVAL 1 DAY)
  AND vb.STATUS = 'F'
GROUP BY vb.ID_DISPOSITIVO
ORDER BY vb.ID_DISPOSITIVO;
