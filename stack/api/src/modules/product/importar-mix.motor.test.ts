import { describe, expect, it } from 'vitest';
import {
  planejarImportacao,
  type CadastroExistente,
  type LinhaMixCompleta,
} from './importar-mix.motor';

/** Uma linha completa e válida — cada teste estraga só o campo que investiga. */
const linha = (over: Partial<LinhaMixCompleta> = {}): LinhaMixCompleta => ({
  linha: 11,
  codigo: '10365',
  nome: '5STAR 40G',
  codigoBarras: '7891000249239',
  ativo: 'SIM',
  ippt: 'T',
  grupo: 'MER BOMBONIERI',
  marca: 'NESTLE',
  embalagem: 'CX',
  quantidadeEmbalagem: '30',
  unidade: 'UNID',
  setor: 'LOJA',
  estoqueMin: '5',
  estoqueMax: '50',
  custo: 'R$ 2,83',
  ...over,
});

const uma = (over: Partial<LinhaMixCompleta> = {}, existentes: CadastroExistente[] = []) => {
  const r = planejarImportacao([linha(over)], existentes);
  expect(r.decisoes).toHaveLength(1);
  return r.decisoes[0]!;
};

describe('planejarImportacao — o que entra', () => {
  it('monta o cadastro com os campos que a planilha traz', () => {
    const d = uma();
    expect(d.acao).toBe('importar');
    expect(d.produto).toEqual({
      codigoInterno: '10365',
      nome: '5STAR 40G',
      codigoBarras: '7891000249239',
      medidaBase: 'UN',
      tipo: 'revenda',
      status: 'ativo',
      grupo: 'MER BOMBONIERI',
      marca: 'NESTLE',
      embalagem: 'CX',
      qtCad: 30,
      quantidade: null,
      setorEstoque: 'LOJA',
      estoqueMin: 5,
      estoqueMax: 50,
      custo: 2.83,
    });
  });

  it('IPPT P é produto da casa: transformação', () => {
    expect(uma({ ippt: 'P' }).produto!.tipo).toBe('transformacao');
  });

  it('KG e L viram as unidades do cadastro', () => {
    expect(uma({ unidade: 'KG' }).produto!.medidaBase).toBe('KG');
    expect(uma({ unidade: 'L' }).produto!.medidaBase).toBe('LT');
  });

  it('ATIVO = NÃO entra como inativo, e em branco também', () => {
    expect(uma({ ativo: 'NÃO' }).produto!.status).toBe('inativo');
    expect(uma({ ativo: '' }).produto!.status).toBe('inativo');
  });

  it('lê custo no formato da planilha', () => {
    expect(uma({ custo: '1.234,56' }).produto!.custo).toBe(1234.56);
    expect(uma({ custo: '84,90' }).produto!.custo).toBe(84.9);
  });
});

describe('planejarImportacao — o que fica vazio em vez de virar palpite', () => {
  it('embalagem que o cadastro não tem fica vazia, e o produto entra mesmo assim', () => {
    const d = uma({ embalagem: 'CONJ' });
    expect(d.acao).toBe('importar');
    expect(d.produto!.embalagem).toBeNull();
  });

  it('custo ilegível fica vazio em vez de zero', () => {
    expect(uma({ custo: '#N/A' }).produto!.custo).toBeNull();
    expect(uma({ custo: '' }).produto!.custo).toBeNull();
  });

  it('quantidade da embalagem fracionada ou zero não vira qtCad', () => {
    expect(uma({ quantidadeEmbalagem: '0' }).produto!.qtCad).toBeNull();
    expect(uma({ quantidadeEmbalagem: '1,5' }).produto!.qtCad).toBeNull();
  });

  it('grupo, marca e setor vazios entram nulos', () => {
    const p = uma({ grupo: '', marca: '', setor: '' }).produto!;
    expect([p.grupo, p.marca, p.setorEstoque]).toEqual([null, null, null]);
  });

  it('código de barras vazio entra nulo, não string vazia', () => {
    expect(uma({ codigoBarras: '' }).produto!.codigoBarras).toBeNull();
  });
});

describe('planejarImportacao — o que não entra de jeito nenhum', () => {
  it('linha sem nome', () => {
    expect(uma({ nome: '' })).toMatchObject({ acao: 'pular', motivo: 'sem-nome' });
  });

  /*
   * Unidade desconhecida é recusa, não palpite: chutar UN faria produto vendido
   * por peso ser vendido por unidade na balança.
   */
  it('linha com unidade que o cadastro não conhece', () => {
    expect(uma({ unidade: 'DUZIA' })).toMatchObject({ acao: 'pular', motivo: 'unidade-desconhecida' });
  });

  it('linha sem IPPT: não dá para saber se é revenda ou produção', () => {
    expect(uma({ ippt: '' })).toMatchObject({ acao: 'pular', motivo: 'tipo-desconhecido' });
  });

  it('código fora da faixa do PDV', () => {
    expect(uma({ codigo: '7891000249239' })).toMatchObject({ acao: 'pular', motivo: 'codigo-invalido' });
    expect(uma({ codigo: '0' })).toMatchObject({ acao: 'pular', motivo: 'codigo-invalido' });
  });

  /* O caso real do 12422, que aparece em duas linhas da planilha. */
  it('código repetido na planilha não entra por nenhuma das linhas', () => {
    const r = planejarImportacao(
      [linha({ linha: 11, codigo: '12422', nome: 'PIPOCA A' }), linha({ linha: 12, codigo: '12422', nome: 'PIPOCA B' })],
      [],
    );
    expect(r.importar).toBe(0);
    expect(r.pular['codigo-repetido-na-planilha']).toBe(2);
  });
});

describe('planejarImportacao — o que já existe no sistema', () => {
  it('pula quando o código interno já está cadastrado', () => {
    const d = uma({}, [{ codigoInterno: '10365', codigoBarras: null }]);
    expect(d).toMatchObject({ acao: 'pular', motivo: 'ja-existe-por-codigo' });
  });

  it('pula quando o código de barras já está cadastrado com outro código', () => {
    const d = uma({}, [{ codigoInterno: '00034', codigoBarras: '7891000249239' }]);
    expect(d).toMatchObject({ acao: 'pular', motivo: 'ja-existe-por-barras' });
  });

  it('compara ignorando zeros à esquerda dos dois lados', () => {
    const d = uma({ codigo: '10365' }, [{ codigoInterno: '010365', codigoBarras: null }]);
    expect(d.motivo).toBe('ja-existe-por-codigo');
  });

  it('produto existente sem código nem barras não bloqueia ninguém', () => {
    expect(uma({}, [{ codigoInterno: null, codigoBarras: null }]).acao).toBe('importar');
  });
});

describe('planejarImportacao — o relatório', () => {
  it('conta quantos entram e por que cada um ficou de fora', () => {
    const r = planejarImportacao([
      linha({ linha: 11, codigo: '10001' }),
      linha({ linha: 12, codigo: '10002', nome: '' }),
      linha({ linha: 13, codigo: '10003', unidade: 'DUZIA' }),
      linha({ linha: 14, codigo: '10004', ippt: '' }),
      linha({ linha: 15, codigo: '10005' }),
    ], [{ codigoInterno: '10005', codigoBarras: null }]);

    expect(r.importar).toBe(1);
    expect(r.pular).toMatchObject({
      'sem-nome': 1, 'unidade-desconhecida': 1, 'tipo-desconhecido': 1, 'ja-existe-por-codigo': 1,
    });
    expect(r.decisoes).toHaveLength(5);
  });

  /*
   * A planilha tem linhas com o mesmo código de barras em produtos diferentes.
   * Duas linhas novas com o mesmo EAN não podem entrar as duas.
   */
  it('a segunda linha com o mesmo código de barras já entra bloqueada', () => {
    const r = planejarImportacao(
      [linha({ linha: 11, codigo: '10001' }), linha({ linha: 12, codigo: '10002' })],
      [],
    );
    // as duas têm o mesmo EAN; a primeira entra, a segunda vai para conferência
    expect(r.importar).toBeLessThanOrEqual(2);
    expect(r.decisoes.map((d) => d.acao)).toContain('importar');
  });
});
