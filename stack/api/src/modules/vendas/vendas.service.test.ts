import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '@/config/api.replies';
import { deriveOperador, type VendasRepository } from './vendas.repository';
import { VendasService } from './vendas.service';

const venda = {
  DATA_VENDA: '18/05/2026',
  PRODUTO_CODIGO: '7890000000001',
  PRODUTO: 'PRODUTO TESTE',
  QUANTIDADE: '1,25',
  VALOR_UNITARIO: '5,45',
  TOTAL: '6,81',
  EMPRESA: 'TNP CENTRAL',
  ATUALIZADO_EM: '2026-05-18 07:48:50',
  HASH: 'a'.repeat(64),
};

function setup() {
  const repository = {
    importarVendas: vi.fn().mockResolvedValue({ recebidas: 1, inseridas: 1, atualizadas: 0, ignoradas: 0 }),
    importarFechamentos: vi.fn(),
    importarItensPdv: vi.fn().mockResolvedValue({ recebidas: 1, inseridas: 1, atualizadas: 0, ignoradas: 0 }),
  } as unknown as VendasRepository;
  return { repository, service: new VendasService(repository) };
}

describe('VendasService', () => {
  it('normaliza data e decimal brasileiro antes de persistir', async () => {
    const { repository, service } = setup();
    await service.importar({ tipo: 'venda_produto_dia', linhas: [venda] });
    expect(repository.importarVendas).toHaveBeenCalledWith([
      expect.objectContaining({ DATA_VENDA: '2026-05-18', QUANTIDADE: '1.25', TOTAL: '6.81' }),
    ]);
  });

  it('recusa o lote inteiro e informa todas as linhas inválidas', async () => {
    const { repository, service } = setup();
    const promise = service.importar({
      tipo: 'venda_produto_dia',
      linhas: [
        { ...venda, DATA_VENDA: '31/02/2026' },
        { ...venda, EMPRESA: 'HORA', HASH: 'b'.repeat(64) },
      ],
    });
    await expect(promise).rejects.toMatchObject<AppError>({
      code: 'SALES_BATCH_INVALID',
      statusCode: 422,
      details: { linhas: [{ linha: 1 }, { linha: 2 }] },
    });
    expect(repository.importarVendas).not.toHaveBeenCalled();
  });

  it('exige IDs originais de item e venda para aceitar detalhe por PDV', async () => {
    const { repository, service } = setup();
    const item = {
      ID_VENDA_BALCAO: '101', ID_ITEM_VENDA_BALCAO: '501', ID_DISPOSITIVO: '7', PDV: 'PDV 07',
      DATA_HORA_VENDA: '2026-09-24 14:30:15', PRODUTO_ID_ERP: '99', PRODUTO_CODIGO: '7891',
      PRODUTO: 'PRODUTO TESTE', QUANTIDADE: '2', VALOR_UNITARIO: '5,00', TOTAL: '10,00',
      ITEM_CANCELADO: false, VENDA_STATUS: 'F', VENDA_CONFIRMADA: true, EMPRESA: 'TNP CENTRAL',
      ATUALIZADO_EM: '2026-09-24 14:31:00',
    };
    await service.importar({ tipo: 'venda_item_pdv', linhas: [item] });
    expect(repository.importarItensPdv).toHaveBeenCalledWith([
      expect.objectContaining({ ID_VENDA_BALCAO: '101', ID_ITEM_VENDA_BALCAO: '501', TOTAL: '10.00' }),
    ]);
    await expect(service.importar({ tipo: 'venda_item_pdv', linhas: [{ ...item, ID_VENDA_BALCAO: '' }] }))
      .rejects.toMatchObject({ code: 'SALES_BATCH_INVALID', statusCode: 422 });
  });
});

describe('deriveOperador', () => {
  it('deriva posto, caixa e turno sem confiar nos campos enviados pelo robô', () => {
    expect(deriveOperador(' VND CAIXA PDV - 12t ')).toEqual({ natureza: 'posto', caixa: '12', turno: 'T' });
  });

  it('separa canal e operador nominal', () => {
    expect(deriveOperador('BURPIZ')).toEqual({ natureza: 'canal', caixa: null, turno: null });
    expect(deriveOperador('OPERADOR NOMINAL')).toEqual({ natureza: 'nominal', caixa: null, turno: null });
  });
});
