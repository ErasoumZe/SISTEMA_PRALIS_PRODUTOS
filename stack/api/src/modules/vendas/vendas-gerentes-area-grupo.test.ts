import { describe, expect, it } from 'vitest';
import { areaEfetiva, sugerirAreaPorGrupo } from './vendas-gerentes-area-grupo';
import type { ProdutoCadastro } from './vendas-margem';

describe('sugestão de área a partir do grupo', () => {
  it.each([
    ['MER \u2060BEBIDAS - \u2060REFRIGERANTES', 'bebidas'],
    ['MER LATÍCINIOS - LEITES UHT', 'laticinios'],
    ['MER BISCOITOS - DOCES', 'biscoitos'],
    ['MER FRIOS - QUEIJOS', 'frios'],
    ['MER MERCEARIA - ARROZ', 'mercearia'],
    ['MER BOMBONIERI - CHOCOLATES', 'mercearia'],
    ['MER FAB. PRÓPRIA - BEBIDAS/COPA', 'copa'],
    ['MER FAB. PRÓPRIA - LANCHES/CHAPA', 'chapa'],
    ['VITRINE GELADA', 'vitrine'],
    ['COPA', 'copa'],
    ['CHAPA', 'chapa'],
    ['PAES EMPACOTADOS', 'paes_empacotados'],
  ])('%s → %s', (grupo, area) => {
    expect(sugerirAreaPorGrupo(grupo)).toBe(area);
  });

  it.each(['PADRAO', 'MER FAB. PRÓPRIA - RECHEIOS', 'MER PÃES - DOCES', 'MER CIGARROS - TRADICIONAIS', 'MER HIGIENE - SABONETES', ''])
    ('mantém %s pendente quando o grupo não determina o ponto físico', (grupo) => {
      expect(sugerirAreaPorGrupo(grupo)).toBeNull();
    });

  it('a área manual prevalece mesmo quando o grupo sugere outra', () => {
    const produto = { grupo: 'MER BISCOITOS - DOCES', areaVenda: 'caixa' } as ProdutoCadastro;
    expect(areaEfetiva(produto)).toEqual({ area: 'caixa', inferida: false });
    expect(areaEfetiva({ ...produto, areaVenda: null })).toEqual({ area: 'biscoitos', inferida: true });
  });
});
