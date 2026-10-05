SELECT
  vb.ID_VENDA_BALCAO AS idVendaBalcao,
  vb.ID_DISPOSITIVO AS idDispositivo,
  COALESCE(NULLIF(d.DESCRICAO, ''), CONCAT('PDV ', vb.ID_DISPOSITIVO)) AS nomeCaixa,
  vb.ID_CLIENTE AS idCliente,
  c.NOME AS nomeCliente,
  c.CPFCNPJ AS documentoCliente,
  DATE_FORMAT(vb.DTHR_VENDABALCAO, '%Y-%m-%d %H:%i:%s') AS dataHoraVenda,
  vb.VALOR_SUBTOTAL AS valorSubtotal,
  vb.VALOR_DESCONTO AS valorDesconto,
  vb.VALOR_ACRESCIMO AS valorAcrescimo,
  vb.VALOR_TOTAL AS valorTotal,
  vb.VALOR_PAGO AS valorPago,
  vb.STATUS AS statusVenda,
  vb.NUMERO_NFCE AS numeroNotaFiscal,
  nfc.ID_USUARIO_CANCELAMENTO AS cancelamentoUsuarioId,
  uc.USUARIO AS cancelamentoUsuarioNome,
  nfc.JUSTIFICATIVA AS cancelamentoJustificativa,
  nfc.MOTIVO AS cancelamentoMotivo
FROM venda_balcao vb
LEFT JOIN dispositivo d ON d.ID_DISPOSITIVO = vb.ID_DISPOSITIVO
LEFT JOIN cliente c ON c.ID_CLIENTE = vb.ID_CLIENTE
LEFT JOIN nota_fiscal_consumidor nfc ON nfc.ORIGEM = CONCAT('VENDABALCAO_', vb.ID_VENDA_BALCAO)
LEFT JOIN usuario uc ON uc.ID_USUARIO = nfc.ID_USUARIO_CANCELAMENTO
WHERE vb.DTHR_VENDABALCAO >= ?
  AND vb.DTHR_VENDABALCAO < DATE_ADD(?, INTERVAL 1 DAY)
ORDER BY vb.DTHR_VENDABALCAO, vb.ID_VENDA_BALCAO;
