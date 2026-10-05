import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import * as XLSX from 'xlsx';
import type { PesaveisMaintenanceService } from './pesaveis-maintenance.service';

/**
 * O caminho que GRAVA. O plano já tem teste unitário; o que falta provar é o
 * que só o banco responde: a transação, a trava otimista pelos dois hashes e o
 * fato de a manutenção nunca encostar em quem não está na exportação.
 *
 * Nada pode importar `@/db/databases` de forma estática — ele abre conexão no
 * load, antes de o `beforeAll` apontar para o container.
 */
let container: StartedPostgreSqlContainer;
let service: PesaveisMaintenanceService;
let db: {
  execute: (query: unknown) => Promise<{ rows: Record<string, unknown>[] }>;
  $client: { end: () => Promise<void> };
};
let sqlTag: typeof import('drizzle-orm')['sql'];

/** Uma exportação do SIA de mentira, no formato real: cabeçalho e linhas. */
function exportacao(linhas: Array<[string, string, string, string, string | number]>): Buffer {
  const aba = XLSX.utils.aoa_to_sheet([
    ['Cód. produto', 'Descrição', 'Status', 'Pesável', 'Validade'],
    ...linhas,
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, aba, 'sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/** O arquivo do dia: um pesável com validade em dias e um com 0, mais um N. */
const ARQUIVO = () => exportacao([
  ['10001', 'ACAFRAO KG', 'A', 'S', 0],
  ['12535', 'PAO DE QUEIJO KG', 'A', 'S', 3],
  ['20000', 'REFRIGERANTE LATA', 'A', 'N', 0],
]);

async function produto(id: string, codigoInterno: string, nome: string, extras: {
  pesavel?: string | null; tecla?: number | null; validade?: number | null; status?: string;
} = {}) {
  await db.execute(sqlTag`
    INSERT INTO products (id, loja, codigo, nome, medida_base, tipo, status,
      codigo_interno, pesavel, tecla_balanca, validade_balanca)
    VALUES (${id}, 'TNP', ${id}, ${nome}, 'KG', 'revenda', ${extras.status ?? 'ativo'},
      ${codigoInterno}, ${extras.pesavel ?? null}, ${extras.tecla ?? null}, ${extras.validade ?? null})
  `);
}

async function dePara(id: string, coditem: string, extras: {
  pesavel?: string | null; tecla?: string | null; validade?: string | null;
} = {}) {
  await db.execute(sqlTag`
    INSERT INTO sia_produto_depara (id, loja, codigo_barras, chave_barras, coditem,
      pesavel, tecla_balanca, validade_balanca)
    VALUES (${id}, 'TNP', ${`000${coditem}`}, ${`b${coditem}`}, ${coditem},
      ${extras.pesavel ?? null}, ${extras.tecla ?? null}, ${extras.validade ?? null})
  `);
}

const lerProduto = async (codigoInterno: string) => (await db.execute(sqlTag`
  SELECT pesavel, tecla_balanca, validade_balanca FROM products
  WHERE loja = 'TNP' AND codigo_interno = ${codigoInterno}
`)).rows[0];

const lerDePara = async (coditem: string) => (await db.execute(sqlTag`
  SELECT pesavel, tecla_balanca, validade_balanca FROM sia_produto_depara
  WHERE loja = 'TNP' AND coditem = ${coditem}
`)).rows[0];

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  process.env.DATABASE_URL = container.getConnectionUri();
  sqlTag = (await import('drizzle-orm')).sql;
  const database = await import('@/db/databases');
  db = database.db as unknown as typeof db;
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  await migrate(database.db, { migrationsFolder: './drizzle' });
  const { PesaveisMaintenanceService } = await import('./pesaveis-maintenance.service');
  service = new PesaveisMaintenanceService();
}, 300_000);

afterAll(async () => {
  await db?.$client.end();
  await container?.stop();
});

beforeEach(async () => {
  await db.execute(sqlTag`DELETE FROM sia_produto_depara`);
  await db.execute(sqlTag`DELETE FROM products`);
});

describe('prévia', () => {
  it('conta o que mudaria e não grava nada', async () => {
    await produto('p1', '10001', 'ACAFRAO KG', { pesavel: 'N' });
    await produto('p2', '12535', 'PAO DE QUEIJO KG', { pesavel: 'N' });
    await dePara('d1', '10001');
    await dePara('d2', '12535');

    const previa = await service.previa(ARQUIVO(), 'exportacao.xlsx');

    expect(previa).toMatchObject({
      loja: 'TNP', totalFonte: 3, pesaveisFonte: 2, validadeZero: 1,
      atualizarProdutos: 2, atualizarEspelhos: 2, jaCorretos: 0,
      semProduto: [], codigoAmbiguo: [], espelhoAmbiguo: [], semEspelho: [],
    });
    expect(await lerProduto('10001')).toMatchObject({ pesavel: 'N', validade_balanca: null });
  });

  it('separa quem não existe no cadastro, em vez de criar', async () => {
    await produto('p1', '10001', 'ACAFRAO KG', { pesavel: 'N' });
    const previa = await service.previa(ARQUIVO(), 'exportacao.xlsx');
    expect(previa.semProduto).toEqual(['12535']);
    expect(previa.atualizarProdutos).toBe(1);
  });

  it('avisa o pesável sem de-para sem inventar o vínculo', async () => {
    await produto('p1', '10001', 'ACAFRAO KG', { pesavel: 'N' });
    await produto('p2', '12535', 'PAO DE QUEIJO KG', { pesavel: 'N' });
    await dePara('d1', '10001');

    const previa = await service.previa(ARQUIVO(), 'exportacao.xlsx');
    expect(previa.semEspelho).toEqual(['12535']);
    expect(previa.atualizarEspelhos).toBe(1);
  });
});

describe('aplicar', () => {
  beforeEach(async () => {
    await produto('p1', '10001', 'ACAFRAO KG', { pesavel: 'N' });
    await produto('p2', '12535', 'PAO DE QUEIJO KG', { pesavel: 'N', validade: 99 });
    await dePara('d1', '10001');
    await dePara('d2', '12535', { pesavel: 'N', tecla: '001', validade: '99' });
  });

  const aplicar = async (arquivo = ARQUIVO()) => {
    const previa = await service.previa(arquivo, 'exportacao.xlsx');
    return service.aplicar(arquivo, 'exportacao.xlsx', 'ATUALIZAR PESAVEIS TNP',
      previa.hashArquivo, previa.hashPlano);
  };

  it('grava pesável, tecla 000 e a validade em dias nos dois lados', async () => {
    const r = await aplicar();
    expect(r).toMatchObject({ loja: 'TNP', produtosAtualizados: 2, espelhosAtualizados: 2 });

    expect(await lerProduto('10001')).toMatchObject({ pesavel: 'S', tecla_balanca: 0, validade_balanca: 0 });
    expect(await lerProduto('12535')).toMatchObject({ pesavel: 'S', tecla_balanca: 0, validade_balanca: 3 });
    expect(await lerDePara('10001')).toMatchObject({ pesavel: 'S', tecla_balanca: '000', validade_balanca: '0' });
    expect(await lerDePara('12535')).toMatchObject({ pesavel: 'S', tecla_balanca: '000', validade_balanca: '3' });
  });

  it('valida zero é gravado como zero, e não confundido com ausente', async () => {
    await aplicar();
    const linha = await lerProduto('10001');
    expect(linha!.validade_balanca).toBe(0);
    expect(linha!.validade_balanca).not.toBeNull();
  });

  it('não encosta em quem está marcado N na exportação', async () => {
    await produto('p3', '20000', 'REFRIGERANTE LATA', { pesavel: 'N', validade: 7 });
    await aplicar();
    expect(await lerProduto('20000')).toMatchObject({ pesavel: 'N', validade_balanca: 7 });
  });

  it('não encosta em produto ausente da exportação', async () => {
    await produto('p4', '30000', 'PRODUTO QUE NAO ESTA NO ARQUIVO', { pesavel: 'N' });
    await aplicar();
    expect(await lerProduto('30000')).toMatchObject({ pesavel: 'N' });
  });

  it('rodar duas vezes é inofensivo: a segunda não tem o que mudar', async () => {
    await aplicar();
    const segunda = await aplicar();
    expect(segunda).toMatchObject({ produtosAtualizados: 0, espelhosAtualizados: 0, jaCorretos: 2 });
  });

  it('recusa a frase errada antes de abrir transação', async () => {
    const arquivo = ARQUIVO();
    const previa = await service.previa(arquivo, 'exportacao.xlsx');
    await expect(service.aplicar(arquivo, 'exportacao.xlsx', 'atualizar',
      previa.hashArquivo, previa.hashPlano)).rejects.toMatchObject({ statusCode: 400 });
    expect(await lerProduto('10001')).toMatchObject({ pesavel: 'N' });
  });

  it('recusa prévia envelhecida quando o cadastro mudou no meio', async () => {
    const arquivo = ARQUIVO();
    const previa = await service.previa(arquivo, 'exportacao.xlsx');
    // alguém mexeu no cadastro entre conferir e aplicar
    await db.execute(sqlTag`UPDATE products SET validade_balanca = 42 WHERE codigo_interno = '12535'`);

    await expect(service.aplicar(arquivo, 'exportacao.xlsx', 'ATUALIZAR PESAVEIS TNP',
      previa.hashArquivo, previa.hashPlano)).rejects.toMatchObject({ statusCode: 409 });
    // e nada foi gravado: o 10001, que estava no mesmo plano, continua como estava
    expect(await lerProduto('10001')).toMatchObject({ pesavel: 'N' });
    expect(await lerProduto('12535')).toMatchObject({ validade_balanca: 42 });
  });

  it('recusa arquivo trocado depois da prévia', async () => {
    const previa = await service.previa(ARQUIVO(), 'exportacao.xlsx');
    const outro = exportacao([['10001', 'ACAFRAO KG', 'A', 'S', 5]]);
    await expect(service.aplicar(outro, 'exportacao.xlsx', 'ATUALIZAR PESAVEIS TNP',
      previa.hashArquivo, previa.hashPlano)).rejects.toMatchObject({ statusCode: 409 });
    expect(await lerProduto('10001')).toMatchObject({ pesavel: 'N' });
  });

  it('bloqueia tudo quando dois cadastros disputam o mesmo código', async () => {
    // zeros à esquerda fazem dois códigos internos distintos normalizarem igual
    await produto('p5', '0010001', 'ACAFRAO KG DUPLICADO', { pesavel: 'N' });
    const arquivo = ARQUIVO();
    const previa = await service.previa(arquivo, 'exportacao.xlsx');
    expect(previa.codigoAmbiguo).toEqual(['10001']);

    await expect(service.aplicar(arquivo, 'exportacao.xlsx', 'ATUALIZAR PESAVEIS TNP',
      previa.hashArquivo, previa.hashPlano)).rejects.toMatchObject({ statusCode: 422 });
    // o 12535, que não era ambíguo, também NÃO foi gravado: é tudo ou nada
    expect(await lerProduto('12535')).toMatchObject({ pesavel: 'N' });
  });

  it('recusa exportação sem as colunas que a regra exige', async () => {
    const aba = XLSX.utils.aoa_to_sheet([['Código', 'Nome'], ['10001', 'ACAFRAO']]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, aba, 'sheet1');
    const ruim = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    await expect(service.previa(ruim, 'exportacao.xlsx')).rejects.toMatchObject({ statusCode: 422 });
  });

  it('recusa o mesmo código repetido na exportação, sem escolher um', async () => {
    const repetido = exportacao([
      ['10001', 'ACAFRAO KG', 'A', 'S', 0],
      ['10001', 'ACAFRAO KG DE NOVO', 'A', 'S', 5],
    ]);
    await expect(service.previa(repetido, 'exportacao.xlsx')).rejects.toMatchObject({ statusCode: 422 });
  });
});

describe('loja', () => {
  it('não altera cadastro de outra loja com o mesmo código', async () => {
    await produto('p1', '10001', 'ACAFRAO KG', { pesavel: 'N' });
    await db.execute(sqlTag`
      INSERT INTO products (id, loja, codigo, nome, medida_base, tipo, codigo_interno, pesavel)
      VALUES ('pli', 'LI', 'pli', 'ACAFRAO KG LISBOA', 'KG', 'revenda', '10001', 'N')
    `);

    const arquivo = exportacao([['10001', 'ACAFRAO KG', 'A', 'S', 0]]);
    const previa = await service.previa(arquivo, 'exportacao.xlsx');
    await service.aplicar(arquivo, 'exportacao.xlsx', 'ATUALIZAR PESAVEIS TNP',
      previa.hashArquivo, previa.hashPlano);

    const li = (await db.execute(sqlTag`SELECT pesavel FROM products WHERE loja = 'LI'`)).rows[0];
    expect(li).toMatchObject({ pesavel: 'N' });
  });

  it('ignora o cadastro unificado, que não é mais o cadastro vivo', async () => {
    await produto('p1', '10001', 'ACAFRAO KG', { pesavel: 'N' });
    await produto('pv', '10001', 'ACAFRAO KG PERDEDOR', { pesavel: 'N', status: 'unificado' });

    const arquivo = exportacao([['10001', 'ACAFRAO KG', 'A', 'S', 0]]);
    const previa = await service.previa(arquivo, 'exportacao.xlsx');
    // sem o filtro de status, isto seria ambíguo e bloquearia a manutenção
    expect(previa.codigoAmbiguo).toEqual([]);
    expect(previa.atualizarProdutos).toBe(1);
  });
});
