import { describe, expect, it } from 'vitest';
import { confrontarHistoricos, semelhancaNome } from './historical-duplicates.motor';

const produto = (id: string, codigoInterno: string, nome: string, codigoBarras: string | null = null) => ({ id, codigoInterno, nome, codigoBarras });

describe('confrontarHistoricos', () => {
  it('prioriza código de barras único, mesmo quando o nome diverge', () => {
    const [r] = confrontarHistoricos([produto('antigo', '00428', 'MAIONESE HELLMANN', '7891000000012')], [produto('sia', '10211', 'MAIONESE HELLMANNS BAG 2,8KG', '7891000000012')]);
    expect(r).toMatchObject({ tipo: 'barras-exatas', candidato: { id: 'sia' } });
  });

  it('aceita nome igual ignorando caixa, acento e pontuação', () => {
    const [r] = confrontarHistoricos([produto('antigo', '00001', 'Açúcar Refinado 1 Kg')], [produto('sia', '10000', 'ACUCAR REFINADO 1KG')]);
    expect(r).toMatchObject({ tipo: 'nome-exato', candidato: { id: 'sia' } });
  });

  it('não libera ação quando o código de barras aponta para mais de um SIA', () => {
    const [r] = confrontarHistoricos([produto('antigo', '00001', 'Bolo de cenoura', '7891234567890')], [produto('a', '10000', 'BOLO CENOURA', '7891234567890'), produto('b', '10001', 'BOLO CENOURA GRANDE', '7891234567890')]);
    expect(r.tipo).toBe('revisar');
  });

  it('mantém sem candidato quando não há evidência mínima', () => {
    const [r] = confrontarHistoricos([produto('antigo', '00001', 'FAROFA TRADICIONAL YOKI')], [produto('sia', '10000', 'ABACAXI UNID')]);
    expect(r).toMatchObject({ tipo: 'sem-par', candidato: null });
  });

  it('calcula semelhança somente como sugestão', () => {
    expect(semelhancaNome('QUEIJO PRATO 1KG', 'QUEIJO PRATO 500G')).toBeGreaterThan(0.4);
  });
});
