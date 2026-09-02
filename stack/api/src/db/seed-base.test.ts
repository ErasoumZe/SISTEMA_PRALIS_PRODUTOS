import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProductRequests } from '@pralis/shared';

const arquivo = path.resolve(process.cwd(), 'src/db/base-products.json');
const base = JSON.parse(readFileSync(arquivo, 'utf8')) as unknown[];

/**
 * O `start:prod` encadeia com `&&`:
 *   drizzle push && seed-base && backfill && server
 *
 * Em 02/09/2026 o seed passou a falhar e o servidor NUNCA subiu — 33 reinícios,
 * ninguém conseguia logar. Duas causas somadas, as duas mergeadas no mesmo dia:
 *  - colunas novas (`setorVenda1/2`) entraram OBRIGATÓRIAS no schema, e o
 *    arquivo de seed não as tinha: 149 produtos x 2 campos;
 *  - a regra de estoque por embalagem passou a valer também na importação, e 6
 *    produtos antigos da base a violam.
 *
 * Estes testes trancam as duas portas.
 */
describe('o arquivo de seed da base tem que passar no boot', () => {
  it('parseia com o schema de IMPORTAÇÃO — é o que o seed usa', () => {
    const r = ProductRequests.importProductSchema.array().safeParse(base);

    expect(
      r.success ? [] : r.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`),
    ).toEqual([]);
  });

  it('coluna nova NÃO pode ser obrigatória no payload', () => {
    // o arquivo não tem setorVenda1/2; o default é o que impede a queda
    expect(base.every((p) => !(p as Record<string, unknown>).setorVenda1)).toBe(true);
    expect(ProductRequests.importProductSchema.array().safeParse(base).success).toBe(true);
  });

  it('nenhum produto da base viola a regra de estoque hoje', () => {
    // não é obrigatório (o seed não aplica a regra), mas se voltar a violar é
    // sinal de que a planilha base regrediu — melhor descobrir aqui
    const ruins = (base as Array<Record<string, number>>).filter(
      (p) => p.estoqueMin > 0 && p.estoqueMax > 0 && p.estoqueMax <= p.estoqueMin,
    );

    expect(ruins).toEqual([]);
  });
});

describe('a regra de estoque separa entrada de usuário de dado legado', () => {
  const legadoTorto = {
    nome: 'CADASTRO ANTIGO TORTO',
    quantidade: 0,
    medidaBase: 'UN' as const,
    codigoBarras: null,
    marca: null,
    embalagem: null,
    cDe: null,
    qtCad: 10,
    medidaCompra: null,
    codigoInterno: null,
    fotoUrl: null,
    grupo: 'MERCEARIA',
    tipo: 'revenda' as const,
    status: 'ativo' as const,
    habilitarAjuda: false,
    estoqueMin: 30,
    estoqueMax: 30, // máximo igual ao mínimo: a regra do usuário recusa
    setorEstoque: null,
    custo: 1,
    margemPontual: null,
    vVendaPontual: 2,
    auto: false,
    localVenda1: null,
    localVenda2: null,
  };

  it('a IMPORTAÇÃO aceita — dado velho não pode derrubar a subida', () => {
    expect(ProductRequests.importProductSchema.safeParse(legadoTorto).success).toBe(true);
  });

  it('a REQUISIÇÃO do usuário continua recusando — a regra segue valendo', () => {
    expect(ProductRequests.createProductSchema.safeParse(legadoTorto).success).toBe(false);
  });
});
