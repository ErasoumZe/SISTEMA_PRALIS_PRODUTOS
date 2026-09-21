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

  it('marca como novo quando nada no SIA casa nem se parece', () => {
    const p = uma(
      [produto({ codigoBarras: '7899999999999', nome: 'PRODUTO QUE SO EXISTE AQUI' })],
      [par()],
    );
    expect(p.balde).toBe('novo');
    expect(p.candidatos).toEqual([]);
    expect(p.motivo).toMatch(/código de barras ou nome parecido/i);
  });

  /*
   * O SIA grava o próprio `coditem` no campo de código de barras quando o
   * produto não tem etiqueta — 2.139 das 2.984 linhas do catálogo são assim.
   * Quando o de-para CONFIRMA esse código, o casamento é por barras e já
   * funcionava; estes testes cobrem o caso em que ele NÃO confirma, porque a
   * exportação do SIA está atrasada (143 códigos, medidos em 21/09).
   */
  it('lê o código que o SIA esconde no campo de barras quando o de-para não o tem', () => {
    const p = uma(
      [produto({ codigoBarras: '00000000012067', codigoInterno: '00268', nome: 'BOLO REDONDO FORMIGUEIRO GD' })],
      [par({ coditem: '10419', chaveBarras: '10419', descricao: 'TRIDENTE TUTTI-FRUTTI 8G ROSA' })],
    );
    expect(p.balde).toBe('barras-tem-codigo');
    expect(p.codigoProposto).toBe('12067');
    // e NÃO oferece sugestão por nome: o número está escrito, não se adivinha
    expect(p.candidatos).toEqual([]);
  });

  it('um código de barras de verdade não é confundido com coditem', () => {
    const p = uma(
      [produto({ codigoBarras: '07891000460207', codigoInterno: '00322' })],
      [par({ coditem: '10419', chaveBarras: '10419', descricao: 'OUTRA COISA' })],
    );
    expect(p.balde).not.toBe('barras-tem-codigo');
  });

  /*
   * A armadilha do PR #62: `11151` CRU não é o formato do SIA, é código de
   * cadastro digitado no campo de barras. Sem os zeros à esquerda num campo
   * largo, a leitura não vale — senão esta correção ressuscita aquele bug.
   */
  it('número curto sem zeros à esquerda não é lido como código', () => {
    const p = uma(
      [produto({ codigoBarras: '11151', codigoInterno: '00268', nome: 'COXINHA DE COSTELA' })],
      [par({ coditem: '10419', chaveBarras: '10419', descricao: 'OUTRA COISA' })],
    );
    expect(p.balde).not.toBe('barras-tem-codigo');
  });

  /*
   * Duplicata é exatamente isto: dois cadastros com o mesmo número no campo de
   * barras. Se o lote os adotasse, os dois ficariam com o mesmo código interno
   * — e não há índice único em `products.codigo_interno` para reclamar depois.
   */
  it('dois cadastros com o mesmo código nas barras viram disputa, não adoção', () => {
    const propostas = reconciliarCodigoCadastro(
      [
        produto({ id: 'a', codigoBarras: '00000000012067', codigoInterno: '00268', nome: 'BOLO FORMIGUEIRO GD' }),
        produto({ id: 'b', codigoBarras: '00000000012067', codigoInterno: '00269', nome: 'BOLO FORMIGUEIRO GRANDE' }),
      ],
      [par({ coditem: '10419', chaveBarras: '10419', descricao: 'OUTRA COISA' })],
    );
    expect(propostas.map((p) => p.balde)).toEqual(['disputado', 'disputado']);
    expect(propostas.every((p) => p.codigoProposto === null)).toBe(true);
  });

  it('não propõe em lote um código que outro cadastro já tem', () => {
    const propostas = reconciliarCodigoCadastro(
      [
        produto({ id: 'a', codigoBarras: null, codigoInterno: '12067', nome: 'QUEM JA TEM' }),
        produto({ id: 'b', codigoBarras: '00000000012067', codigoInterno: '00269', nome: 'QUEM QUER' }),
      ],
      [par({ coditem: '10419', chaveBarras: '10419', descricao: 'OUTRA COISA' })],
    );
    const b = propostas.find((p) => p.produto.id === 'b')!;
    expect(b.balde).toBe('disputado');
    expect(b.motivo).toMatch(/já é de outro cadastro/i);
  });

  it('barras zeradas não viram código', () => {
    const p = uma(
      [produto({ codigoBarras: '0000000000000', codigoInterno: '00268', nome: 'SO EXISTE AQUI' })],
      [par({ coditem: '10419', chaveBarras: '10419', descricao: 'OUTRA COISA' })],
    );
    expect(p.balde).toBe('novo');
  });

  it('código de entrega escondido nas barras fica fora da faixa da rede', () => {
    const p = uma(
      [produto({ codigoBarras: '00000000712934', codigoInterno: '00268', nome: 'SO EXISTE AQUI' })],
      [par({ coditem: '10419', chaveBarras: '10419', descricao: 'OUTRA COISA' })],
    );
    expect(p.balde).toBe('novo');
  });

  it('quem já tem o código que está nas barras cai em falta-no-PDV, não em proposta', () => {
    const p = uma(
      [produto({ codigoBarras: '00000000012067', codigoInterno: '12067', nome: 'BOLO REDONDO FORMIGUEIRO GD' })],
      [par({ coditem: '10419', chaveBarras: '10419', descricao: 'OUTRA COISA' })],
    );
    expect(p.balde).toBe('fora-do-sia');
  });

  /*
   * O caso TRIDENT, encontrado pelo José em 21/09: o produto existe na rede com
   * código certo, mas nem ele nem a linha do SIA têm código de barras. Sem
   * sugestão por nome, o cadastro antigo ia para cunhagem e ganhava um número
   * novo — deixando dois códigos para o mesmo produto na rede.
   */
  it('sem barras dos dois lados, sugere pelo nome — mas não decide', () => {
    const p = uma(
      [produto({ codigoBarras: null, codigoInterno: '00253', nome: 'TRIDENTE TUTTI-FRUTTI 8G' })],
      [
        par({ coditem: '10419', chaveBarras: '10419', descricao: 'TRIDENTE TUTTI-FRUTTI 8G ROSA' }),
        par({ coditem: '11595', chaveBarras: '11595', descricao: 'MENTOS TUTTI FRUTTI 37,5G' }),
      ],
    );
    expect(p.balde).toBe('novo');
    // continua sendo decisão humana: nada é proposto de ofício
    expect(p.codigoProposto).toBeNull();
    expect(p.candidatos[0]).toMatchObject({ coditem: '10419' });
    expect(p.candidatos[0]!.semelhanca).toBeGreaterThan(85);
  });

  it('a sugestão vem ordenada da mais parecida para a menos', () => {
    const p = uma(
      [produto({ codigoBarras: null, codigoInterno: '00253', nome: 'TRIDENTE MORANGO 8G' })],
      [
        par({ coditem: '11857', chaveBarras: '11857', descricao: 'TRENTO MORANGO 32G' }),
        par({ coditem: '10418', chaveBarras: '10418', descricao: 'TRIDENTE MORANGO 8G VERMELHO' }),
      ],
    );
    expect(p.candidatos.map((c) => c.coditem)).toEqual(['10418', '11857']);
  });

  /*
   * Sugerir um código que outro cadastro já tem criaria o duplicado que o balde
   * `disputado` existe para impedir.
   */
  it('não sugere código que outro produto já tem', () => {
    const propostas = reconciliarCodigoCadastro(
      [
        produto({ id: 'a', codigoBarras: null, codigoInterno: '10419', nome: 'OUTRO QUALQUER' }),
        produto({ id: 'b', codigoBarras: null, codigoInterno: '00253', nome: 'TRIDENTE TUTTI-FRUTTI 8G' }),
      ],
      [par({ coditem: '10419', chaveBarras: '10419', descricao: 'TRIDENTE TUTTI-FRUTTI 8G ROSA' })],
    );
    const b = propostas.find((p) => p.produto.id === 'b')!;
    expect(b.candidatos).toEqual([]);
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

  /*
   * A mesma armadilha um passo adiante: o produto veio da planilha com código
   * certo, mas o PDV ainda não o cadastrou. Medido em 21/09: 161 produtos
   * nesse estado. Se caíssem em "sem par", a tela ofereceria cunhar 13138 por
   * cima do 10365 que eles acabaram de receber.
   */
  it('código da faixa da rede que o SIA ainda não tem não é "sem par"', () => {
    const p = uma(
      [produto({ codigoBarras: null, codigoInterno: '10365' })],
      // o SIA começa em 10000; 10365 está na faixa, mas o PDV não tem este item
      [par({ coditem: '10000', chaveBarras: '9999999999999' })],
    );
    expect(p.balde).toBe('fora-do-sia');
    expect(p.codigoProposto).toBeNull();
    expect(p.motivo).toMatch(/PDV ainda não cadastrou/);
  });

  it('código abaixo da faixa da rede continua sendo sem par', () => {
    const p = uma(
      [produto({ codigoBarras: null, codigoInterno: '00141' })],
      [par({ coditem: '10000', chaveBarras: '9999999999999' })],
    );
    expect(p.balde).toBe('novo');
  });

  it('produto sem código nenhum é sem par', () => {
    const p = uma(
      [produto({ codigoBarras: null, codigoInterno: null })],
      [par({ coditem: '10000', chaveBarras: '9999999999999' })],
    );
    expect(p.balde).toBe('novo');
  });

  /* O piso sai do próprio de-para, não de constante: se a rede renumerar, acompanha. */
  it('o piso da faixa vem do menor coditem do SIA', () => {
    const p = uma(
      [produto({ codigoBarras: null, codigoInterno: '05000' })],
      [par({ coditem: '04000', chaveBarras: '9999999999999' })],
    );
    expect(p.balde).toBe('fora-do-sia');
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

  /*
   * Este teste já existiu esperando `['exato', 'ja-correto']` — e estava
   * errado. `a` e `b` são dois cadastros do MESMO produto (mesmo código de
   * barras), e `b` já está com o 10365; deixar `a` adotar o 10365 também dava
   * aos dois o mesmo código interno, que é exatamente a duplicata que o José
   * está limpando à mão. Como a prévia só traz BASE e órfãos (cópia de loja
   * herda da BASE e fica fora), dois aqui são dois cadastros de verdade.
   */
  it('não adota um código que outro cadastro da prévia já tem', () => {
    const propostas = reconciliarCodigoCadastro(
      [produto({ id: 'a' }), produto({ id: 'b', codigoInterno: '10365' })],
      [par()],
    );
    expect(propostas.map((p) => p.balde)).toEqual(['disputado', 'ja-correto']);
    expect(propostas[0]!.motivo).toMatch(/já é de outro cadastro/i);
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
