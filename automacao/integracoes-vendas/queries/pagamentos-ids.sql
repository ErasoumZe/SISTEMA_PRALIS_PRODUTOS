SELECT
  fvb.ID_FORMAPGTO_VENDABALCAO AS idFormaPgtoVendaBalcao,
  fvb.ID_VENDA_BALCAO AS idVendaBalcao,
  fvb.ID_FORMAPGTO AS idFormaPagamento,
  COALESCE(NULLIF(fp.DESCRICAO, ''), CONCAT('Forma ', fvb.ID_FORMAPGTO)) AS descricaoFormaPagamento,
  COALESCE(fvb.VALOR_LIQUIDO, fvb.VALOR_FORMA, 0) AS valor
FROM formapgto_venda_balcao fvb
LEFT JOIN forma_pagamento fp ON fp.ID_FORMAPGTO = fvb.ID_FORMAPGTO
WHERE fvb.ID_VENDA_BALCAO IN (/*IDS*/)
ORDER BY fvb.ID_VENDA_BALCAO, fvb.ID_FORMAPGTO_VENDABALCAO;
