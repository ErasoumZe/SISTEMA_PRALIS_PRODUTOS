import { describe, expect, it } from 'vitest';
import {
  calcularProximoCodigoCadastro,
  codigoCadastroValido,
  reconciliarCodigoCadastro,
  type ParSia,
  type ProdutoParaReconciliar,
} from './codigo-cadastro.motor';

const par = (over: Partial<ParSia> = {}): ParSia => ({
  loja: 'LI',
  coditem: '10365',
  chaveBarras: '7891000249239',
  descricao: '5STAR 40G',
  ...over,
});

const produto = (over: Partial<ProdutoParaReconciliar> = {}): ProdutoParaReconciliar => ({
  id: 'p1',
  loja: 'BASE',
  nome: '5STAR',
  codigoBarras: '7891000249239',
  codigoInterno: '00034',
  ...over,
});

const uma = (produtos: ProdutoParaReconciliar[], pares: ParSia[]) => {
  const propostas = reconciliarCodigoCadastro(produtos, pares);
  expect(propostas).toHaveLength(1);
  return propostas[0]!;
};

describe('reconciliarCodigoCadastro', () => {
  it('adota o coditem do SIA quando o código de barras casa', () => {
    const p = uma([produto()], [par()]);
    expect(p.balde).toBe('exato');
    expect(p.codigoProposto).toBe('10365');
  });

  it('não propõe troca quando o produto já está com o coditem', () => {
    const p = uma([produto({ codigoInterno: '10365' })], [par()]);
    expect(p.balde).toBe('ja-correto');
    expect(p.codigoProposto).toBeNull();
  });

  it('compara ignorando zeros à esquerda', () => {
    const p = uma([produto({ codigoInterno: '010365' })], [par({ coditem: '10365' })]);
    expect(p.balde).toBe('ja-correto');
  });

  it('marca como novo quando nenhum produto do SIA tem esse código de barras', () => {
    const p = uma([produto({ codigoBarras: '7899999999999' })], [par()]);
    expect(p.balde).toBe('novo');
    expect(p.candidatos).toEqual([]);
  });

  it('produto sem código de barras nenhum cai em novo', () => {
    const p = uma([produto({ codigoBarras: null, codigoInterno: '00034' })], [par()]);
    expect(p.balde).toBe('novo');
  });

  /*
   * A armadilha que quase custou caro: 2.139 das 2.968 linhas do de-para não
   * têm código de barras (o SIA guarda o próprio código nesse campo), então os
   * produtos que vieram delas entram sem barras. Sem esta regra eles cairiam em
   * "sem par", onde a tela ofereceria cunhar um número novo POR CIMA do código
   * certo que eles já têm.
   */
  it('sem barras, mas com código que já é coditem do SIA, está correto', () => {
    const p = uma(
      [produto({ codigoBarras: null, codigoInterno: '10365' })],
      [par({ coditem: '10365', chaveBarras: '10365' })],
    );
    expect(p.balde).toBe('ja-correto');
    expect(p.codigoProposto).toBeNull();
    expect(p.motivo).toMatch(/já é o do produto no SIA/);
  });

  it('compara o código ignorando zeros à esquerda', () => {
    const p = uma([produto({ codigoBarras: null, codigoInterno: '010365' })], [par({ coditem: '10365' })]);
    expect(p.balde).toBe('ja-correto');
  });

  it('código que não existe no SIA continua sendo sem par', () => {
    const p = uma([produto({ codigoBarras: null, codigoInterno: '99999' })], [par({ coditem: '10365' })]);
    expect(p.balde).toBe('novo');
  });

  it('o casamento por barras ganha do código quando os dois existem', () => {
    const p = uma(
      [produto({ codigoBarras: '7891000249239', codigoInterno: '11111' })],
      [par({ coditem: '10365' }), par({ coditem: '11111', chaveBarras: '9999999999999' })],
    );
    expect(p.balde).toBe('exato');
    expect(p.codigoProposto).toBe('10365');
  });

  it('o mesmo coditem nas duas lojas continua sendo adoção exata', () => {
    const p = uma([produto()], [par({ loja: 'LI' }), par({ loja: 'TNP' })]);
    expect(p.balde).toBe('exato');
    expect(p.codigoProposto).toBe('10365');
    expect(p.candidatos).toHaveLength(2);
  });

  it('lojas discordando do coditem viram conflito, não adoção', () => {
    const p = uma([produto()], [par({ loja: 'LI', coditem: '10365' }), par({ loja: 'TNP', coditem: '11111' })]);
    expect(p.balde).toBe('conflito-sia');
    expect(p.codigoProposto).toBeNull();
    expect(p.motivo).toMatch(/discordam/i);
  });

  /*
   * O caso que derrubou o PR #62: o `codigo_barras` do produto guardava um
   * código de cadastro (11151), não um código de barras.
   */
  it('número curto demais para ser código de barras não vira adoção', () => {
    const p = uma(
      [produto({ codigoBarras: '11151', nome: 'COXINHA DE COSTELA' })],
      [par({ chaveBarras: '11151', coditem: '10784', descricao: 'OUTRA COISA' })],
    );
    expect(p.balde).toBe('conflito-sia');
    expect(p.motivo).toMatch(/curt/i);
  });

  /*
   * A porta lateral do mesmo problema: a força da chave tem que ser do lado do
   * PRODUTO. Se bastasse o SIA reconhecer, uma etiqueta de balança cujo PLU
   * fosse 11151 promoveria a chave e o produto seria adotado sem clique.
   */
  it('chave curta não vira forte só porque o SIA tem uma etiqueta de balança com esse PLU', () => {
    const p = uma(
      [produto({ codigoBarras: '11151', nome: 'COXINHA DE COSTELA' })],
      [par({ chaveBarras: '11151', coditem: '10784' })],
    );
    expect(p.balde).not.toBe('exato');
  });

  it('casa a etiqueta de balança do produto com o PLU do SIA', () => {
    const p = uma(
      [produto({ codigoBarras: '2001234000005' })],
      [par({ chaveBarras: '123', coditem: '11050' })],
    );
    expect(p.balde).toBe('exato');
    expect(p.codigoProposto).toBe('11050');
  });

  it('ignora par do SIA com coditem fora da faixa do PDV', () => {
    const p = uma([produto()], [par({ coditem: '7891000249239' })]);
    expect(p.balde).toBe('novo');
  });

  /*
   * Dois cadastros do Pralis apontando para o mesmo coditem. Adotar os dois
   * criaria código repetido — e não existe índice único para reclamar depois.
   */
  it('rebaixa para disputado quando dois produtos querem o mesmo código', () => {
    const propostas = reconciliarCodigoCadastro(
      [produto({ id: 'a' }), produto({ id: 'b' })],
      [par()],
    );
    expect(propostas.map((p) => p.balde)).toEqual(['disputado', 'disputado']);
    expect(propostas.every((p) => p.codigoProposto === null)).toBe(true);
    expect(propostas[0]!.motivo).toMatch(/também aponta/i);
  });

  it('não rebaixa quando o segundo produto já está com o código', () => {
    const propostas = reconciliarCodigoCadastro(
      [produto({ id: 'a' }), produto({ id: 'b', codigoInterno: '10365' })],
      [par()],
    );
    expect(propostas.map((p) => p.balde)).toEqual(['exato', 'ja-correto']);
  });

  it('classifica cada produto da lista uma vez só, na ordem recebida', () => {
    const propostas = reconciliarCodigoCadastro(
      [produto({ id: 'a' }), produto({ id: 'b', codigoBarras: '7899999999999' })],
      [par()],
    );
    expect(propostas.map((p) => [p.produto.id, p.balde])).toEqual([['a', 'exato'], ['b', 'novo']]);
  });
});

describe('codigoCadastroValido', () => {
  it('aceita a faixa real e recusa o que não é código', () => {
    expect(codigoCadastroValido('10000')).toBe(true);
    expect(codigoCadastroValido('13439')).toBe(true);
    expect(codigoCadastroValido('0')).toBe(false);
    expect(codigoCadastroValido('')).toBe(false);
    // código de barras digitado na coluna do código
    expect(codigoCadastroValido('7891000249239')).toBe(false);
  });
});

describe('calcularProximoCodigoCadastro', () => {
  it('continua do teto da planilha quando o banco está atrás', () => {
    expect(calcularProximoCodigoCadastro(13439, 1335)).toBe('13440');
  });

  it('continua do banco quando ele já passou do teto conhecido', () => {
    expect(calcularProximoCodigoCadastro(13439, 13500)).toBe('13501');
  });

  it('recusa cunhar sem teto — 00001 colidiria com o cadastro inteiro', () => {
    expect(() => calcularProximoCodigoCadastro(0, 0)).toThrow(/teto/i);
  });

  it('recusa estourar o limite de 9 dígitos do PDV', () => {
    expect(() => calcularProximoCodigoCadastro(999_999_999, 0)).toThrow(/limite/i);
  });
});
