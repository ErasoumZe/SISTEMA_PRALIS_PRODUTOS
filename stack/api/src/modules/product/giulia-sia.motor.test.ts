import { describe, expect, it } from 'vitest';
import { reconciliarGiuliaComSia } from './giulia-sia.motor';

const produto = (codigoBarras: string | null, nome = 'QUALQUER NOME') => ({ id: 'p1', loja: 'BASE', nome, codigoBarras, codigoInterno: '00001' });
const par = (coditem: string, chaveBarras = '7891234567890') => ({ loja: 'TNP', coditem, chaveBarras, descricao: 'OUTRO NOME', ativo: 'S' });

describe('reconciliarGiuliaComSia', () => {
  it('concilia apenas quando a barra casa, mesmo com nomes diferentes', () => {
    const [r] = reconciliarGiuliaComSia([produto('7891234567890', 'NOME DA GIULIA')], [par('12468')], 12970);
    expect(r?.situacao).toBe('conciliar-sia');
    expect(r?.codigoProposto).toBe('12468');
  });

  it('não usa nome como fallback e numera apenas barra válida sem par', () => {
    const [r] = reconciliarGiuliaComSia([produto('7890000000000', 'OUTRO NOME')], [par('12468')], 12970);
    expect(r?.situacao).toBe('novo-codigo');
    expect(r?.codigoProposto).toBe('12971');
  });

  it('não numera barra ausente ou curta', () => {
    const r = reconciliarGiuliaComSia([produto(null), produto('12792')], [], 12970);
    expect(r.map((x) => [x.situacao, x.codigoProposto])).toEqual([['pendente', null], ['pendente', null]]);
  });

  it('bloqueia quando o mesmo EAN aponta para códigos SIA distintos', () => {
    const [r] = reconciliarGiuliaComSia([produto('7891234567890')], [par('12001'), par('12002')], 12970);
    expect(r?.situacao).toBe('conflito-sia');
    expect(r?.codigoProposto).toBeNull();
  });
});
