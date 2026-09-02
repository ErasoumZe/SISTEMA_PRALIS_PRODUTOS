import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { ProductExportService } from './product-export.service';

/**
 * ATENÇÃO: nada aqui pode importar `@/db/databases` de forma ESTÁTICA. O módulo
 * abre a conexão no load, ou seja, ANTES do `beforeAll` trocar a DATABASE_URL
 * para o container — e a migration rodaria no banco de desenvolvimento de quem
 * está rodando o teste. Só `import type` no topo.
 */
let container: StartedPostgreSqlContainer;
let service: ProductExportService;
let db: {
  execute: (query: unknown) => Promise<{ rows: Record<string, unknown>[] }>;
  $client: { end: () => Promise<void> };
};
let sqlTag: typeof import('drizzle-orm')['sql'];

type Extras = {
  status?: string;
  barras?: string | null;
  interno?: string | null;
  custo?: number | null;
  base?: string | null;
};

let produto: (id: string, loja: string, nome: string, codigo: string, extras?: Extras) => Promise<void>;
let fiscal: (id: string) => Promise<void>;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:18.1-alpine').start();
  process.env.DATABASE_URL = container.getConnectionUri();
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  sqlTag = (await import('drizzle-orm')).sql;
  const dbModule = await import('@/db/databases');
  db = dbModule.db as unknown as typeof db;
  await migrate(dbModule.db, { migrationsFolder: './drizzle' });

  produto = async (id, loja, nome, codigo, extras = {}) => {
    // `'custo' in extras` e não `??`: passar custo: null tem que gravar NULL,
    // e o `??` devolveria o padrão — foi exatamente o que mascarou o teste
    const custo = 'custo' in extras ? extras.custo : 1.5;
    await db.execute(sqlTag`
      INSERT INTO products (id, loja, codigo, nome, medida_base, tipo, status, quantidade, qt_cad,
                            habilitar_ajuda, auto, codigo_barras, codigo_interno, custo,
                            v_venda_pontual, margem_pontual, grupo, base_product_id)
      VALUES (${id}, ${loja}, ${codigo}, ${nome}, 'UN', 'revenda', ${extras.status ?? 'ativo'}, 2, 1,
              false, false, ${extras.barras ?? null}, ${extras.interno ?? null},
              ${custo}, 9.9, 0.4, 'MERCEARIA', ${extras.base ?? null})`);
  };

  fiscal = async (id) => {
    await db.execute(sqlTag`
      INSERT INTO product_fiscal (product_id, ncm, cest, categoria, cst_pis_cofins,
                                  icms, reducao_icms, aliquota_pis, aliquota_cofins)
      VALUES (${id}, '19059090', '1706203', '3', '01', 18, 53.33, 1.65, 7.6)`);
  };

  const { ProductExportService } = await import('./product-export.service');
  const { ProductRepository } = await import('./product.repository');
  service = new ProductExportService(new ProductRepository());
});

afterAll(async () => {
  await db.$client.end();
  await container.stop();
});

beforeEach(async () => {
  await db.execute(sqlTag`DELETE FROM product_fiscal`);
  await db.execute(sqlTag`DELETE FROM products`);
});

/** Divide respeitando que todo campo de texto sai entre aspas. */
const linhas = (csv: string) => csv.replace(/^﻿/, '').trim().split('\r\n');

describe('exportação da base de produtos', () => {
  it('traz TODAS as lojas, ativos e inativos, numa linha cada', async () => {
    await produto('p1', 'BASE', 'ARROZ', 'PR-1');
    await produto('p2', 'TNP', 'FEIJAO', 'PR-2', { status: 'inativo' });
    await produto('p3', 'LI', 'CAFE', 'PR-3');

    const linhasCsv = linhas(await service.gerarCsv());

    expect(linhasCsv).toHaveLength(4); // cabeçalho + 3
    const corpo = linhasCsv.slice(1).join('\n');
    expect(corpo).toContain('ARROZ');
    expect(corpo).toContain('FEIJAO');
    expect(corpo).toContain('CAFE');
    expect(corpo).toContain('"inativo"');
  });

  it('traz o fiscal junto do produto', async () => {
    await produto('p1', 'BASE', 'ARROZ', 'PR-1');
    await fiscal('p1');

    const linha = linhas(await service.gerarCsv())[1]!;

    expect(linha).toContain('"19059090"'); // ncm
    expect(linha).toContain('"1706203"'); // cest
    expect(linha).toContain('"01"'); // cst pis/cofins
    expect(linha).toContain('53,33'); // redução com vírgula decimal
    expect(linha).toContain('1,65'); // alíquota pis
  });

  it('produto sem fiscal sai com as colunas vazias, sem quebrar a linha', async () => {
    await produto('p1', 'BASE', 'SEM FISCAL', 'PR-1');

    const linhasCsv = linhas(await service.gerarCsv());
    const colunas = linhasCsv[0]!.split(';').length;

    expect(linhasCsv[1]!.split(';')).toHaveLength(colunas);
    expect(linhasCsv[1]).toContain('"";""'); // ncm e cest vazios, lado a lado
  });

  /*
   * Sem o `="..."` o Excel lê 00123 como número e grava 123 — aí o arquivo
   * deixa de casar com o cadastro do SIA, que é justamente o motivo de existir.
   */
  it('protege codigo, codigo de barras e codigo interno do zero a esquerda', async () => {
    await produto('p1', 'BASE', 'ARROZ', '00123', { barras: '0007891149100828', interno: '00456' });

    const linha = linhas(await service.gerarCsv())[1]!;

    expect(linha).toContain('="00123"');
    expect(linha).toContain('="0007891149100828"');
    expect(linha).toContain('="00456"');
  });

  it('sai no formato que o Excel pt-BR abre: BOM, ponto e virgula, CRLF', async () => {
    await produto('p1', 'BASE', 'ARROZ', 'PR-1');

    const csv = await service.gerarCsv();

    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('\r\n');
    expect(csv.replace(/^﻿/, '').split('\r\n')[0]).toBe(
      'id;loja;codigo;codigo_barras;codigo_interno;base_product_id;nome;grupo;tipo;status;'
      + 'custo;v_venda_pontual;margem_pontual;quantidade;medida_base;qt_cad;'
      + 'ncm;cest;categoria;cst_pis_cofins;icms;reducao_icms;aliquota_pis;aliquota_cofins',
    );
  });

  it('cadastro aposentado por unificacao NAO entra — nao e mais um produto', async () => {
    await produto('p1', 'TNP', 'VENCEDOR', 'PR-1');
    await produto('p2', 'TNP', 'APOSENTADO', 'PR-2', { status: 'unificado' });

    const corpo = linhas(await service.gerarCsv()).slice(1).join('\n');

    expect(corpo).toContain('VENCEDOR');
    expect(corpo).not.toContain('APOSENTADO');
  });

  it('custo ausente sai vazio, nao zero — zero e um custo, ausente nao', async () => {
    await produto('p1', 'BASE', 'SEM CUSTO', 'PR-1', { custo: null });
    await produto('p2', 'BASE', 'CUSTO ZERO', 'PR-2', { custo: 0 });

    const corpo = linhas(await service.gerarCsv()).slice(1);
    const semCusto = corpo.find((l) => l.includes('SEM CUSTO'))!.split(';');
    const custoZero = corpo.find((l) => l.includes('CUSTO ZERO'))!.split(';');
    const iCusto = 10; // 11a coluna

    expect(semCusto[iCusto]).toBe('');
    expect(custoZero[iCusto]).toBe('0');
  });

  it('base vazia devolve so o cabecalho', async () => {
    expect(linhas(await service.gerarCsv())).toHaveLength(1);
  });
});
