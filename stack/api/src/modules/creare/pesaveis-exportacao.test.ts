import { describe, expect, it } from 'vitest';
import { lerPesaveisExportacao } from './pesaveis-exportacao';

const cabecalho = ['Cód. produto', 'Descrição', 'Status', 'Pesável', 'Validade'];

describe('exportação de pesáveis do SIA', () => {
  it('lê validade 0 como valor real e ignora somente os marcados N', () => {
    const r = lerPesaveisExportacao([cabecalho,
      [12535, 'PUDIM', 'A', 'S', 0],
      ['00012658', 'BOLO', 'I', 'S', 6],
      [10000, 'ABACAXI', 'A', 'N', 0],
    ]);
    expect(r.problemas).toEqual([]);
    expect(r.produtos).toBe(3);
    expect(r.pesaveis).toEqual([
      { codigoInterno: '12535', nome: 'PUDIM', status: 'A', validadeDias: 0, linha: 2 },
      { codigoInterno: '12658', nome: 'BOLO', status: 'I', validadeDias: 6, linha: 3 },
    ]);
  });

  it('recusa duplicidade e validade desconhecida, sem inferir dias', () => {
    const r = lerPesaveisExportacao([cabecalho,
      ['00001', 'UM', 'A', 'S', 3], ['1', 'OUTRO', 'A', 'N', 0],
      ['2', 'DOIS', 'A', 'S', ''],
    ]);
    expect(r.problemas).toHaveLength(2);
  });
});
