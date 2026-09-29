import { afterEach, describe, expect, it } from 'vitest';
import { env } from '@/config/env';
import type { SheetsGateway } from '@/modules/google-sheets/google-sheets.client';
import { chaveDeGrupo, grupoIdPreenchido, GrupoIdPlanilha, lerGrupoIds } from './grupo-id-planilha';

const anterior = {
  id: env.GOOGLE_SHEETS_SPREADSHEET_ID,
  aba: env.GOOGLE_SHEETS_GRUPO_IDS_TAB,
  email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  chave: env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
};

afterEach(() => {
  env.GOOGLE_SHEETS_SPREADSHEET_ID = anterior.id;
  env.GOOGLE_SHEETS_GRUPO_IDS_TAB = anterior.aba;
  env.GOOGLE_SERVICE_ACCOUNT_EMAIL = anterior.email;
  env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = anterior.chave;
});

describe('grupo ID oficial da planilha', () => {
  it('trata zero do layout como ID não preenchido', () => {
    expect(grupoIdPreenchido('0000')).toBe(false);
    expect(grupoIdPreenchido('0')).toBe(false);
    expect(grupoIdPreenchido('60')).toBe(true);
  });
  it('lê AC/AD como texto e casa o nome sem os separadores invisíveis', () => {
    const mapa = lerGrupoIds([
      ['NOME GRUPO', 'ID GRUPO'],
      ['MER \u2060MERCEARIA - \u2060HIGIENE PESSOAL', '60'],
      ['MER \u2060MERCEARIA - \u2060PRODUTOS DE LIMPEZA', '0061'],
    ]);
    expect(mapa?.get(chaveDeGrupo('MER MERCEARIA - HIGIENE PESSOAL'))).toBe('60');
    expect(mapa?.get(chaveDeGrupo('MER MERCEARIA - PRODUTOS DE LIMPEZA'))).toBe('0061');
  });

  it('não aceita cabeçalho trocado, ID inválido ou de-para ambíguo', () => {
    expect(lerGrupoIds([['ID GRUPO', 'NOME GRUPO'], ['60', 'HIGIENE']])).toBeNull();
    const mapa = lerGrupoIds([
      ['NOME GRUPO', 'ID GRUPO'],
      ['HIGIENE', '60'], ['HIGIENE', '61'], ['OUTRO', 'ABC'],
    ]);
    expect(mapa?.get('HIGIENE')).toBeNull();
    expect(mapa?.has('OUTRO')).toBe(false);
  });

  it('consulta a aba correta e reutiliza o mapa em cache', async () => {
    env.GOOGLE_SHEETS_SPREADSHEET_ID = 'planilha-de-teste';
    env.GOOGLE_SHEETS_GRUPO_IDS_TAB = 'GRUPOS/REF';
    env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'teste@example.com';
    env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = 'chave-de-teste';
    const chamadas: string[][] = [];
    const sheets = {
      async batchGetValues(_id: string, ranges: string[]) {
        chamadas.push(ranges);
        return [[['NOME GRUPO', 'ID GRUPO'], ['MER \u2060MERCEARIA - \u2060HIGIENE PESSOAL', '60']]];
      },
    } as SheetsGateway;
    const fonte = new GrupoIdPlanilha(sheets);
    expect(await fonte.buscar('MER MERCEARIA - HIGIENE PESSOAL')).toEqual({ estado: 'encontrado', id: '60' });
    expect(await fonte.buscar('MER MERCEARIA - HIGIENE PESSOAL')).toEqual({ estado: 'encontrado', id: '60' });
    expect(await fonte.buscar('SEM GRUPO')).toEqual({ estado: 'ausente' });
    expect(chamadas).toEqual([["'GRUPOS/REF'!AC5:AD"]]);
  });
});
