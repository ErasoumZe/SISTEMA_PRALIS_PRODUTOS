import { describe, expect, it } from 'vitest';
import { createProductSchema, updateProductSchema } from './product.requests';

const base = {
  nome: 'PAO DE SAL',
  quantidade: 0,
  medidaBase: 'KG' as const,
  codigoBarras: null,
  marca: null,
  embalagem: null,
  cDe: null,
  qtCad: 1,
  medidaCompra: null,
  codigoInterno: null,
  fotoUrl: null,
  grupo: 'PADARIA',
  tipo: 'revenda' as const,
  status: 'ativo' as const,
  habilitarAjuda: false,
  estoqueMin: null,
  estoqueMax: null,
  setorEstoque: null,
  custo: 1,
  margemPontual: null,
  vVendaPontual: 2,
  auto: false,
  localVenda1: null,
  localVenda2: null,
};

const criar = (extras: Record<string, unknown>) => createProductSchema.safeParse({ ...base, ...extras });
const erros = (r: ReturnType<typeof criar>) =>
  r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);

describe('estoque mínimo e máximo em função da Qt. embalagem', () => {
  /*
   * O exemplo do dono: q = 10. Estoque vem em embalagem fechada, entao pedir 15
   * quando a caixa tem 10 nao existe no mundo real — ou sao 10, ou sao 20.
   */
  it('q=10: minimo 15 e invalido, 30 e valido', () => {
    expect(criar({ qtCad: 10, estoqueMin: 15, estoqueMax: 60 }).success).toBe(false);
    expect(criar({ qtCad: 10, estoqueMin: 30, estoqueMax: 60 }).success).toBe(true);
  });

  it('q=10: maximo 22 e invalido, 60 e valido', () => {
    expect(criar({ qtCad: 10, estoqueMin: 30, estoqueMax: 22 }).success).toBe(false);
    expect(criar({ qtCad: 10, estoqueMin: 30, estoqueMax: 60 }).success).toBe(true);
  });

  it('minimo menor que uma embalagem inteira e recusado', () => {
    const r = criar({ qtCad: 10, estoqueMin: 5, estoqueMax: 20 });

    expect(erros(r)[0]).toContain('não pode ser menor que a Qt. embalagem (10)');
  });

  it('a mensagem diz quais valores servem', () => {
    const r = criar({ qtCad: 10, estoqueMin: 15, estoqueMax: 60 });

    expect(erros(r)[0]).toContain('múltiplo da Qt. embalagem (10)');
    expect(erros(r)[0]).toContain('10, 20, 30');
  });

  it('maximo IGUAL ao minimo e recusado — nao e faixa nenhuma', () => {
    expect(criar({ qtCad: 10, estoqueMin: 30, estoqueMax: 30 }).success).toBe(false);
    expect(criar({ qtCad: 10, estoqueMin: 30, estoqueMax: 40 }).success).toBe(true);
  });

  it('maximo MENOR que o minimo e recusado', () => {
    const r = criar({ qtCad: 10, estoqueMin: 40, estoqueMax: 20 });

    expect(erros(r).some((e) => e.includes('maior que o mínimo'))).toBe(true);
  });

  it('q=1 (o padrao) so exige maximo maior que minimo', () => {
    expect(criar({ qtCad: 1, estoqueMin: 15, estoqueMax: 22 }).success).toBe(true);
    expect(criar({ qtCad: 1, estoqueMin: 15, estoqueMax: 15 }).success).toBe(false);
  });

  it('campo em branco nao e validado — quem nao controla estoque nao e barrado', () => {
    expect(criar({ qtCad: 10, estoqueMin: null, estoqueMax: null }).success).toBe(true);
    expect(criar({ qtCad: 10, estoqueMin: null, estoqueMax: 60 }).success).toBe(true);
    expect(criar({ qtCad: 10, estoqueMin: 30, estoqueMax: null }).success).toBe(true);
  });

  it('o erro aponta o CAMPO certo, para a tela marcar em vermelho', () => {
    const r = criar({ qtCad: 10, estoqueMin: 15, estoqueMax: 22 });
    const caminhos = r.success ? [] : r.error.issues.map((i) => i.path.join('.'));

    expect(caminhos).toContain('estoqueMin');
    expect(caminhos).toContain('estoqueMax');
  });
});

describe('a mesma regra vale na edição', () => {
  it('recusa multiplo errado tambem no update', () => {
    const r = updateProductSchema.safeParse({ qtCad: 10, estoqueMin: 15, estoqueMax: 60 });

    expect(r.success).toBe(false);
  });

  it('aceita o que respeita a embalagem', () => {
    expect(updateProductSchema.safeParse({ qtCad: 10, estoqueMin: 30, estoqueMax: 60 }).success).toBe(true);
  });

  /* Update parcial: sem a Qt. embalagem no payload nao da para saber o multiplo. */
  it('sem qtCad no payload, so checa maximo maior que minimo', () => {
    expect(updateProductSchema.safeParse({ estoqueMin: 15, estoqueMax: 22 }).success).toBe(true);
    expect(updateProductSchema.safeParse({ estoqueMin: 30, estoqueMax: 30 }).success).toBe(false);
  });
});

describe('criação sem os campos comerciais', () => {
  /*
   * O defeito de 28/09/2026: o formulário da Base omitia estoque, custo, preço
   * e locais de venda, e a criação devolvia "expected number, received
   * undefined" para oito campos. Cadastrar produto novo na Base tinha parado.
   * Ausente na criação vira `null`; a regra de estoque continua valendo sobre
   * o que vier.
   */
  it('aceita o payload sem os campos comerciais e preenche com null', () => {
    const semComercial = { ...base } as Record<string, unknown>;
    for (const campo of [
      'estoqueMin', 'estoqueMax', 'setorEstoque', 'custo', 'margemPontual',
      'vVendaPontual', 'auto', 'localVenda1', 'localVenda2',
    ]) delete semComercial[campo];

    const r = createProductSchema.safeParse(semComercial);

    expect(erros(r)).toEqual([]);
    expect(r.success && r.data).toMatchObject({
      estoqueMin: null, estoqueMax: null, setorEstoque: null, custo: null,
      margemPontual: null, vVendaPontual: null, auto: false, localVenda1: null, localVenda2: null,
    });
  });

  it('continua recusando valor inválido quando ele vem', () => {
    expect(erros(criar({ custo: -1 }))).toEqual(expect.arrayContaining([expect.stringMatching(/^custo:/)]));
  });
});
