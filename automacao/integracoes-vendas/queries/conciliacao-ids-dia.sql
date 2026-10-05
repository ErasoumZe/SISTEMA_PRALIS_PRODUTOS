-- IDs das vendas FECHADAS (STATUS='F') do dia, uma linha por venda, por dispositivo (PDV).
-- Mesma regua da conciliacao-dia.sql (so venda fechada), mas listando em vez de agregar: alimenta o
-- diagnostico "presente no CREARE, ausente no sistema" no e-mail/log de divergencia da conciliacao.
SELECT
  vb.ID_DISPOSITIVO AS pdvIdentificador,
  vb.ID_VENDA_BALCAO AS idVendaBalcao
FROM venda_balcao vb
WHERE vb.DTHR_VENDABALCAO >= ?
  AND vb.DTHR_VENDABALCAO < DATE_ADD(?, INTERVAL 1 DAY)
  AND vb.STATUS = 'F'
ORDER BY vb.ID_DISPOSITIVO, vb.ID_VENDA_BALCAO;
