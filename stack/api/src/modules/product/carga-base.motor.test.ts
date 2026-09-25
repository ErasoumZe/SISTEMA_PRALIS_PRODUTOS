import { describe, expect, it } from 'vitest';
import { FISCAL_ZERADO, GRUPOS_DE_FABRICACAO_PROPRIA, planejarCarga } from './carga-base.motor';
import type { LinhaCarga } from './carga-base.planilha';

/**
 * Cada teste aqui nasceu de um valor MEDIDO na aba `(TNP/LI) CADASTRO
 * PRODUTOS` em 25/09/2026 — não de um caso imaginado. As contagens estão nos
 * comentários para quem vier conferir contra a planilha.
 */

const linha = (over: Partial<LinhaCarga> = {}): LinhaCarga => ({
  linha: 11,
  situacao: 'ATIVO',
  nome: 'ABACAXI UNID',
  codigoBarras: '10000',
  unidade: 'UN',
  grupo: 'MER ⁠MAT. PRIMA - ⁠FRUTAS',
  codigo: '10.000',
  estoqueMin: '1',
  estoqueMax: '3',
  custo: '6,5',
  precoVenda: '0,3',
  grupoId: '97',
  ...over,
});

const soImportados = (linhas: LinhaCarga[]) => planejarCarga(linhas).decisoes.filter((d) => d.acao === 'importar');

describe('planejarCarga', () => {
  it('lê o código com separador de milhar da planilha e o guarda com cinco casas', () => {
    // a coluna X vem formatada como `10.000`, não como `10000`
    expect(soImportados([linha()])[0]?.produto?.codigoInterno).toBe('10000');
  });

  it('entra ativo ou inativo exatamente como a coluna C manda', () => {
    const r = planejarCarga([linha({ situacao: 'ATIVO' }), linha({ codigo: '10.001', situacao: 'INATIVO' })]);
    expect(r.ativos).toBe(1);
    expect(r.inativos).toBe(1);
    expect(r.decisoes[1]?.produto?.status).toBe('inativo');
  });

  it('recusa situação que não seja ATIVO nem INATIVO em vez de escolher uma', () => {
    const r = planejarCarga([linha({ situacao: '' })]);
    expect(r.importar).toBe(0);
    expect(r.recusas['situacao-desconhecida']).toBe(1);
  });

  it('copia o campo de barras como está na planilha, mesmo sendo o código interno', () => {
    /*
     * 6.434 das 7.347 linhas preenchidas têm F igual a X. É o que o SIA guarda
     * quando o produto não tem etiqueta, e o José pediu o dado igual ao da
     * planilha — copiar é o que faz o cadastro voltar igual para o PDV.
     */
    const r = soImportados([linha({ codigo: '10.000', codigoBarras: '10000' })]);
    expect(r[0]?.produto?.codigoBarras).toBe('10000');
  });

  it('copia valor curto no campo de barras em vez de jogar fora', () => {
    expect(soImportados([linha({ codigoBarras: '7' })])[0]?.produto?.codigoBarras).toBe('7');
  });

  it('deixa vazio só quando a coluna F está vazia', () => {
    // 22 linhas não têm nada em F
    expect(soImportados([linha({ codigoBarras: '' })])[0]?.produto?.codigoBarras).toBeNull();
  });

  it('avisa quando o mesmo código de barras aparece em duas linhas, sem recusar nenhuma', () => {
    const r = planejarCarga([
      linha({ codigo: '1', codigoBarras: '7898959762024' }),
      linha({ codigo: '2', codigoBarras: '7898959762024' }),
    ]);
    expect(r.importar).toBe(2);
    expect(r.barrasRepetidas).toEqual([{ codigoBarras: '7898959762024', codigos: ['1', '2'] }]);
  });

  it('guarda o código de barras de verdade quando existe', () => {
    const r = planejarCarga([linha({ codigo: '10.007', codigoBarras: '7898959762024' })]);
    expect(r.decisoes[0]?.produto?.codigoBarras).toBe('7898959762024');
    expect(r.comBarras).toBe(1);
  });

  it('traduz as três unidades medidas na coluna H', () => {
    const r = soImportados([
      linha({ codigo: '1', unidade: 'UN' }),
      linha({ codigo: '2', unidade: 'KG' }),
      linha({ codigo: '3', unidade: 'LT' }),
    ]);
    expect(r.map((d) => d.produto?.medidaBase)).toEqual(['UN', 'KG', 'LT']);
  });

  it('recusa unidade desconhecida em vez de chutar UN', () => {
    // chutar aqui transforma produto de peso em produto de unidade: preço errado na balança
    const r = planejarCarga([linha({ unidade: 'CAIXA' })]);
    expect(r.importar).toBe(0);
    expect(r.recusas['unidade-desconhecida']).toBe(1);
  });

  it('recusa linha sem id de grupo, que o TXT do Creare exige', () => {
    const r = planejarCarga([linha({ grupoId: '' })]);
    expect(r.recusas['sem-id-de-grupo']).toBe(1);
  });

  it('marca como transformação só os grupos de fabricação própria', () => {
    const r = soImportados([
      linha({ codigo: '1', grupoId: '65', grupo: 'MER FAB. PRÓPRIA - ⁠PANIFICAÇÃO' }),
      linha({ codigo: '2', grupoId: '97', grupo: '' }),
      linha({ codigo: '3', grupoId: '102', grupo: 'MER INATIVOS' }),
    ]);
    expect(r.map((d) => d.produto?.tipo)).toEqual(['transformacao', 'revenda', 'revenda']);
    expect(GRUPOS_DE_FABRICACAO_PROPRIA).toContain('65');
  });

  it('lê custo e preço no formato brasileiro', () => {
    const p = soImportados([linha({ custo: '1.234,56', precoVenda: '12,9' })])[0]?.produto;
    expect(p?.custo).toBe(1234.56);
    expect(p?.precoVenda).toBe(12.9);
  });

  it('deixa vazio o que a planilha não preencheu, em vez de virar zero', () => {
    /*
     * Estoque e preço estão em branco nos inativos. Zero ali seria um valor
     * afirmado: "o preço deste produto é R$ 0,00".
     */
    const p = soImportados([linha({ estoqueMin: '', estoqueMax: '', custo: '', precoVenda: '' })])[0]?.produto;
    expect(p?.estoqueMin).toBeNull();
    expect(p?.estoqueMax).toBeNull();
    expect(p?.custo).toBeNull();
    expect(p?.precoVenda).toBeNull();
  });

  it('preserva o zero que a planilha escreveu de verdade', () => {
    // 2.037 linhas têm custo `0`; isso é um valor, não uma ausência
    expect(soImportados([linha({ custo: '0' })])[0]?.produto?.custo).toBe(0);
  });

  it('recusa as duas linhas quando o código se repete na planilha', () => {
    const r = planejarCarga([linha({ codigo: '10.000' }), linha({ codigo: '10.000' })]);
    expect(r.importar).toBe(0);
    expect(r.recusas['codigo-repetido-na-planilha']).toBe(2);
  });

  it('recusa linha sem nome e linha sem código', () => {
    const r = planejarCarga([linha({ nome: '' }), linha({ codigo: '' })]);
    expect(r.recusas['sem-nome']).toBe(1);
    expect(r.recusas['codigo-invalido']).toBe(1);
  });

  it('resume a carga por grupo, herdando o nome de quem o tiver', () => {
    /*
     * 24 dos 69 ids não têm nome nenhum na coluna M. O resumo mostra o id
     * assim mesmo, para o grupo sem nome aparecer em vez de sumir.
     */
    const r = planejarCarga([
      linha({ codigo: '1', grupoId: '97', grupo: '' }),
      linha({ codigo: '2', grupoId: '97', grupo: 'MER ⁠MAT. PRIMA - ⁠FRUTAS' }),
      linha({ codigo: '3', grupoId: '65', grupo: 'MER FAB. PRÓPRIA - ⁠PANIFICAÇÃO' }),
    ]);
    expect(r.porGrupo).toEqual([
      { grupoId: '65', grupo: 'MER FAB. PRÓPRIA - ⁠PANIFICAÇÃO', tipo: 'transformacao', quantidade: 1 },
      { grupoId: '97', grupo: 'MER ⁠MAT. PRIMA - ⁠FRUTAS', tipo: 'revenda', quantidade: 2 },
    ]);
  });
});

describe('FISCAL_ZERADO', () => {
  it('usa a largura exata que o layout posicional do Creare exige', () => {
    expect(FISCAL_ZERADO.ncm).toHaveLength(8);
    expect(FISCAL_ZERADO.cest).toHaveLength(7);
    expect(FISCAL_ZERADO.cstPisCofins).toHaveLength(2);
    expect(FISCAL_ZERADO.aliquotaEcfId).toHaveLength(2);
  });

  it('deixa rastro de que o fiscal ainda não é o de verdade', () => {
    expect(FISCAL_ZERADO.estado).toBe('zerado-na-carga');
    expect(FISCAL_ZERADO.motivo).toMatch(/backfill/i);
  });
});
