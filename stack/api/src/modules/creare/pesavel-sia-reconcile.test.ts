import { describe, expect, it } from 'vitest';
import { lerPesavelSia, planejarPesavelSia } from './pesavel-sia-reconcile';

const cabecalho = ['Cód. produto', ...Array(10).fill(''), 'Pesável', 'Tecla', '', 'Validade'];
const linha = (codigo: string, pesavel: string, tecla = '000', validade = '5') =>
  [codigo, ...Array(10).fill(''), pesavel, tecla, '', validade];

describe('conciliação Pesável pela BASE SIA FULL', () => {
  it('lê S/N e valores de balança pelo cabeçalho, sem inferir por unidade', () => {
    const resultado = lerPesavelSia([cabecalho, linha('012535', 'S', '000', '10'), linha('001234', 'N')]);
    expect(resultado.problemas).toEqual([]);
    expect(resultado.registros.get('12535')).toMatchObject({ pesavel: 'S', teclaBalanca: 0, validadeBalanca: 10 });
    expect(resultado.registros.get('1234')?.pesavel).toBe('N');
  });

  it('recusa códigos repetidos e pesável sem validade', () => {
    const resultado = lerPesavelSia([cabecalho, linha('00012', 'N'), linha('12', 'S'), linha('13', 'S', '000', '')]);
    expect(resultado.registros.size).toBe(0);
    expect(resultado.problemas).toHaveLength(2);
  });

  it('preserva S/N existentes, sinaliza divergência e não classifica sem fonte ou código único', () => {
    const fonte = lerPesavelSia([cabecalho, linha('12535', 'N'), linha('14', 'N'), linha('15', 'S')]).registros;
    const plano = planejarPesavelSia([
      { id: 'preservado', codigoInterno: '12535', pesavel: 'S' },
      { id: 'novo', codigoInterno: '14', pesavel: null },
      { id: 'sem-fonte', codigoInterno: '16', pesavel: null },
      { id: 'duplicado1', codigoInterno: '15', pesavel: null },
      { id: 'duplicado2', codigoInterno: '00015', pesavel: null },
    ], fonte);
    expect(plano.atualizar).toEqual([{ id: 'novo', fonte: fonte.get('14') }]);
    expect(plano.resumo).toMatchObject({ jaClassificados: 1, conflitos: 1, semFonte: 1, codigoDuplicado: 2, atualizarN: 1 });
  });
});
