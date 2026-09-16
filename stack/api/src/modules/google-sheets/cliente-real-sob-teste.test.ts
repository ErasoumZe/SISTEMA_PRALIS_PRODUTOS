import { describe, expect, it } from 'vitest';
import { GoogleSheetsClient, GoogleSheetsSobTesteError } from './google-sheets.client';

/**
 * Em 16/09/2026 a suite de integracao da unificacao resolveu o cliente REAL do
 * Google pelo container de injecao. O `.env` da maquina tinha
 * `GOOGLE_SHEETS_ENABLED=true` apontando para a planilha oficial, e cada
 * `unificar()` de teste gravou uma linha de verdade nela -- 123 linhas de
 * fixture no cadastro de producao, da 1335 a 1459.
 *
 * Nada no codigo recusava isso: o unico portao era `GOOGLE_SHEETS_ENABLED`, e
 * ele estava LIGADO de proposito, para o desenvolvimento local funcionar.
 *
 * Estes testes travam o portao que faltava. Eles rodam DENTRO do Vitest, entao
 * a propria condicao que estao verificando esta ativa aqui.
 */
describe('o cliente real do Google recusa rodar sob teste', () => {
  const cliente = new GoogleSheetsClient('conta@exemplo.iam.gserviceaccount.com', 'chave-falsa', 0);

  it('recusa LER', async () => {
    await expect(cliente.getSheets('planilha-qualquer')).rejects.toBeInstanceOf(GoogleSheetsSobTesteError);
  });

  it('recusa ESCREVER', async () => {
    await expect(
      cliente.batchUpdateValues('planilha-qualquer', [{ range: 'A1', values: [['x']] }], 'RAW'),
    ).rejects.toBeInstanceOf(GoogleSheetsSobTesteError);
  });

  it('recusa mudanca ESTRUTURAL', async () => {
    await expect(
      cliente.batchUpdate('planilha-qualquer', [{ deleteDimension: {} }]),
    ).rejects.toBeInstanceOf(GoogleSheetsSobTesteError);
  });

  /* A mensagem e o que a pessoa vai ler no log: tem de dizer o que fazer. */
  it('a recusa explica que o caminho e injetar um duble', async () => {
    await expect(cliente.getSheets('x')).rejects.toThrow(/dubl/i);
  });
});
