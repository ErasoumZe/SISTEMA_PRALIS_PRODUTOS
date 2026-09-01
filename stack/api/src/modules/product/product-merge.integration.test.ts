import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { CurrentUser } from '@/types/fastify-jwt';
import type { ProductMergeService } from './product-merge.service';

/** Import de `@/db/databases` só DENTRO do beforeAll — ver nota nos outros testes. */
let container: StartedPostgreSqlContainer;
let service: ProductMergeService;
let db: {
  execute: (query: unknown) => Promise<{ rows: Record<string, unknown>[] }>;
  $client: { end: () => Promise<void> };
};
let sqlTag: typeof import('drizzle-orm')['sql'];

const admin: CurrentUser = { id: 'u', name: 'Rodrigo', email: 'a@a', loja: null, role: 'admin' };
const comum: CurrentUser = { id: 'u2', name: 'Jose', email: 'b@b', loja: 'TNP', role: 'user' };

let produto: (id: string, loja: string, nome: string, base?: string | null) => Promise<void>;
let fiscal: (id: string, ncm: string) => Promise<void>;
let vinculo: (loja: string, codigo: string, nome: string, productId: string) => Promise<void>;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:18.1-alpine').start();
  process.env.DATABASE_URL = container.getConnectionUri();
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  sqlTag = (await import('drizzle-orm')).sql;
  const dbModule = await import('@/db/databases');
  db = dbModule.db as unknown as typeof db;
  await migrate(dbModule.db, { migrationsFolder: './drizzle' });

  produto = async (id, loja, nome, base = null) => {
    await db.execute(sqlTag`
      INSERT INTO products (id, loja, codigo, nome, medida_base, tipo, status, quantidade, qt_cad,
                            habilitar_ajuda, auto, base_product_id)
      VALUES (${id}, ${loja}, ${'PR-' + id}, ${nome}, 'UN', 'revenda', 'ativo', 1, 1, false, false, ${base})`);
  };
  fiscal = async (id, ncm) => {
    await db.execute(sqlTag`INSERT INTO product_fiscal (product_id, ncm) VALUES (${id}, ${ncm})`);
  };
  vinculo = async (loja, codigo, nome, productId) => {
    await db.execute(sqlTag`
      INSERT INTO produto_creare (id, loja, produto_codigo, produto, product_id)
      VALUES (${`${loja}-${codigo}-${nome}-${productId}`}, ${loja}, ${codigo}, ${nome}, ${productId})`);
  };

  const { ProductMergeService } = await import('./product-merge.service');
  // a planilha não é o assunto aqui: o duplo confirma que o perdedor sai dela
  const sheets = { async removeProduct() { return { outcome: 'removed' as const }; } };
  service = new ProductMergeService(sheets as never);
}, 180000);

afterAll(async () => {
  await db?.$client?.end().catch(() => {});
  await container?.stop();
});

beforeEach(async () => {
  await db.execute(sqlTag`DELETE FROM product_merge_recusa`);
  await db.execute(sqlTag`DELETE FROM product_merge`);
  await db.execute(sqlTag`DELETE FROM produto_creare`);
  await db.execute(sqlTag`DELETE FROM products`);
});

describe('unificar cadastros (Postgres real)', () => {
  it('NÃO apaga: o perdedor continua no banco, aposentado e apontando para o vencedor', async () => {
    await produto('v', 'TNP', 'COCA COLA 2L');
    await produto('p', 'TNP', 'REFRI COCA 2L');

    await service.unificar(admin, { vencedorProductId: 'v', perdedorProductId: 'p', fiscalConfirmado: false });

    const r = await db.execute(sqlTag`SELECT status, unificado_em_product_id FROM products WHERE id = 'p'`);
    expect(r.rows).toHaveLength(1); // continua existindo
    expect(r.rows[0]).toMatchObject({ status: 'unificado', unificado_em_product_id: 'v' });
  });

  it('grava a auditoria com o snapshot da linha inteira — é o desfazer', async () => {
    await produto('v', 'TNP', 'COCA COLA 2L');
    await produto('p', 'TNP', 'REFRI COCA 2L');
    await fiscal('p', '22021000');

    await service.unificar(admin, { vencedorProductId: 'v', perdedorProductId: 'p', fiscalConfirmado: true });

    const r = await db.execute(sqlTag`SELECT confirmado_por, snapshot FROM product_merge WHERE perdedor_product_id = 'p'`);
    const snap = r.rows[0]!.snapshot as Record<string, Record<string, unknown>>;
    expect(r.rows[0]!.confirmado_por).toBe('Rodrigo');
    expect(snap.produto!.nome).toBe('REFRI COCA 2L');
    expect(snap.fiscal!.ncm).toBe('22021000');
  });

  it('reaponta os vínculos de venda do perdedor — o trabalho manual não se perde', async () => {
    await produto('v', 'TNP', 'COCA');
    await produto('p', 'TNP', 'REFRI COCA');
    await vinculo('TNP', '123', 'COCA COLA', 'p');

    const r = await service.unificar(admin, { vencedorProductId: 'v', perdedorProductId: 'p', fiscalConfirmado: false });

    expect(r.vinculosReapontados).toBe(1);
    const v = await db.execute(sqlTag`SELECT product_id FROM produto_creare WHERE produto_codigo = '123'`);
    expect(v.rows[0]!.product_id).toBe('v');
  });

  it('dois produtos NÃO podem disputar o mesmo vínculo — o índice já impede', async () => {
    // uq_produto_creare_natural é (loja, produto_codigo, produto) e não inclui
    // product_id: uma venda só pode pertencer a um produto. Por isso reapontar
    // nunca colide. Este teste guarda essa premissa: se o índice mudar, ele
    // quebra e o UPDATE precisa voltar a tratar conflito.
    await produto('v', 'TNP', 'COCA');
    await produto('p', 'TNP', 'REFRI COCA');
    await vinculo('TNP', '123', 'COCA COLA', 'v');

    // o banco recusa; sobra exatamente um vínculo, o do 'v'
    await expect(vinculo('TNP', '123', 'COCA COLA', 'p')).rejects.toThrow();
    const r = await db.execute(sqlTag`SELECT product_id FROM produto_creare WHERE produto_codigo = '123'`);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.product_id).toBe('v');
  });

  it('reaponta vários vínculos de uma vez', async () => {
    await produto('v', 'TNP', 'COCA');
    await produto('p', 'TNP', 'REFRI COCA');
    await vinculo('TNP', '123', 'COCA LATA', 'p');
    await vinculo('TNP', '', 'COCA PESAVEL', 'p');

    const r = await service.unificar(admin, { vencedorProductId: 'v', perdedorProductId: 'p', fiscalConfirmado: false });

    expect(r.vinculosReapontados).toBe(2);
    const restam = await db.execute(sqlTag`SELECT count(*)::int c FROM produto_creare WHERE product_id = 'p'`);
    expect(restam.rows[0]!.c).toBe(0);
  });

  it('reaponta filhos que penduravam no perdedor — base_product_id não tem FK que avise', async () => {
    await produto('v', 'TNP', 'COCA');
    await produto('p', 'TNP', 'REFRI COCA');
    await produto('filho', 'TNP', 'COCA DA LOJA', 'p');

    const r = await service.unificar(admin, { vencedorProductId: 'v', perdedorProductId: 'p', fiscalConfirmado: false });

    expect(r.filhosReapontados).toBe(1);
    const f = await db.execute(sqlTag`SELECT base_product_id FROM products WHERE id = 'filho'`);
    expect(f.rows[0]!.base_product_id).toBe('v');
  });

  it('o perdedor some da listagem da loja', async () => {
    await produto('v', 'TNP', 'COCA');
    await produto('p', 'TNP', 'REFRI COCA');
    await service.unificar(admin, { vencedorProductId: 'v', perdedorProductId: 'p', fiscalConfirmado: false });

    const { ProductRepository } = await import('./product.repository');
    const lista = await new ProductRepository().list('TNP', {});

    expect(lista.map((x) => x.id)).toEqual(['v']);
  });

  it('espelha na planilha ao aposentar o perdedor', async () => {
    await produto('v', 'TNP', 'COCA');
    await produto('p', 'TNP', 'REFRI COCA');

    const r = await service.unificar(admin, { vencedorProductId: 'v', perdedorProductId: 'p', fiscalConfirmado: false });

    expect(r.sheetSync).toBe('removed');
  });
});

describe('unificar — o que é recusado', () => {
  it('não-admin não unifica', async () => {
    await produto('v', 'TNP', 'A'); await produto('p', 'TNP', 'B');
    await expect(service.unificar(comum, { vencedorProductId: 'v', perdedorProductId: 'p', fiscalConfirmado: false }))
      .rejects.toMatchObject({ code: 'ONLY_ADMIN_MERGE' });
  });

  it('lojas diferentes: a Coca da TNP e a da LI não são duplicata', async () => {
    await produto('v', 'TNP', 'COCA'); await produto('p', 'LI', 'COCA');
    await expect(service.unificar(admin, { vencedorProductId: 'v', perdedorProductId: 'p', fiscalConfirmado: false }))
      .rejects.toMatchObject({ code: 'PRODUCT_OTHER_STORE' });
  });

  it('catálogo BASE está fora do escopo (caso D3)', async () => {
    await produto('v', 'BASE', 'COCA'); await produto('p', 'BASE', 'REFRI COCA');
    await expect(service.unificar(admin, { vencedorProductId: 'v', perdedorProductId: 'p', fiscalConfirmado: false }))
      .rejects.toMatchObject({ code: 'BASE_MERGE_NOT_ALLOWED' });
  });

  it('fiscal divergente SEM confirmação é recusado — nunca inventar alíquota', async () => {
    await produto('v', 'TNP', 'COCA'); await produto('p', 'TNP', 'REFRI COCA');
    await fiscal('v', '22021000'); await fiscal('p', '22029900');

    await expect(service.unificar(admin, { vencedorProductId: 'v', perdedorProductId: 'p', fiscalConfirmado: false }))
      .rejects.toMatchObject({ code: 'FISCAL_DIVERGE' });
    // e nada foi alterado
    const r = await db.execute(sqlTag`SELECT status FROM products WHERE id = 'p'`);
    expect(r.rows[0]!.status).toBe('ativo');
  });

  it('com confirmação explícita do admin, o fiscal divergente passa', async () => {
    await produto('v', 'TNP', 'COCA'); await produto('p', 'TNP', 'REFRI COCA');
    await fiscal('v', '22021000'); await fiscal('p', '22029900');

    await expect(service.unificar(admin, { vencedorProductId: 'v', perdedorProductId: 'p', fiscalConfirmado: true }))
      .resolves.toMatchObject({ perdedorProductId: 'p' });
  });

  it('o mesmo produto dos dois lados é recusado', async () => {
    await produto('v', 'TNP', 'COCA');
    await expect(service.unificar(admin, { vencedorProductId: 'v', perdedorProductId: 'v', fiscalConfirmado: false }))
      .rejects.toMatchObject({ code: 'SAME_PRODUCT' });
  });

  it('produto inexistente é recusado antes de qualquer escrita', async () => {
    await produto('v', 'TNP', 'COCA');
    await expect(service.unificar(admin, { vencedorProductId: 'v', perdedorProductId: 'nao-existe', fiscalConfirmado: false }))
      .rejects.toMatchObject({ code: 'PRODUCT_NOT_FOUND' });
  });

  it('unificar duas vezes o mesmo perdedor é recusado', async () => {
    await produto('v', 'TNP', 'COCA'); await produto('p', 'TNP', 'REFRI');
    await service.unificar(admin, { vencedorProductId: 'v', perdedorProductId: 'p', fiscalConfirmado: false });

    await expect(service.unificar(admin, { vencedorProductId: 'v', perdedorProductId: 'p', fiscalConfirmado: false }))
      .rejects.toMatchObject({ code: 'ALREADY_MERGED' });
  });
});

describe('recusar — “não são o mesmo produto”', () => {
  it('guarda a recusa com o par ORDENADO, para A-B e B-A serem a mesma', async () => {
    await produto('a', 'TNP', 'PAO FRANCES');
    await produto('b', 'TNP', 'PAO DE FORMA');

    await service.recusar(admin, 'b', 'a'); // ordem invertida de propósito

    const r = await db.execute(sqlTag`SELECT produto_a_id, produto_b_id, recusado_por FROM product_merge_recusa`);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ produto_a_id: 'a', produto_b_id: 'b', recusado_por: 'Rodrigo' });
  });

  it('recusar duas vezes não duplica nem estoura', async () => {
    await produto('a', 'TNP', 'X'); await produto('b', 'TNP', 'Y');
    await service.recusar(admin, 'a', 'b');

    await expect(service.recusar(admin, 'b', 'a')).resolves.toBeUndefined();
    const r = await db.execute(sqlTag`SELECT count(*)::int c FROM product_merge_recusa`);
    expect(r.rows[0]!.c).toBe(1);
  });

  it('o par recusado SOME das sugestões por nome — não volta toda semana', async () => {
    await produto('a', 'TNP', 'PAO FRANCES KG');
    await produto('b', 'TNP', 'PAO FRANCES QUILO');

    const { ProductDuplicadosService } = await import('./product-duplicados.service');
    const diag = new ProductDuplicadosService();

    const antes = await diag.diagnosticar('TNP', 60);
    expect(antes.grupos.some((g) => g.motivo === 'nome')).toBe(true);

    await service.recusar(admin, 'a', 'b');

    const depois = await diag.diagnosticar('TNP', 60);
    expect(depois.grupos.some((g) => g.motivo === 'nome')).toBe(false);
  });

  it('não-admin não julga', async () => {
    await produto('a', 'TNP', 'X'); await produto('b', 'TNP', 'Y');
    await expect(service.recusar(comum, 'a', 'b')).rejects.toMatchObject({ code: 'ONLY_ADMIN_MERGE' });
  });

  it('lojas diferentes não formam par', async () => {
    await produto('a', 'TNP', 'X'); await produto('b', 'LI', 'X');
    await expect(service.recusar(admin, 'a', 'b')).rejects.toMatchObject({ code: 'PRODUCT_OTHER_STORE' });
  });
});

describe('ligar à Base (caso D2)', () => {
  it('preenche o vínculo sem copiar custo nem preço — esses são da loja', async () => {
    await produto('base1', 'BASE', 'COCA COLA 2L');
    await produto('loja1', 'TNP', 'COCA COLA 2L');
    await db.execute(sqlTag`UPDATE products SET custo = 9 WHERE id = 'base1'`);
    await db.execute(sqlTag`UPDATE products SET custo = 5 WHERE id = 'loja1'`);

    await service.ligarBase(admin, 'loja1', 'base1');

    const r = await db.execute(sqlTag`SELECT base_product_id, custo FROM products WHERE id = 'loja1'`);
    expect(r.rows[0]!.base_product_id).toBe('base1');
    expect(Number(r.rows[0]!.custo)).toBe(5); // o custo da LOJA permanece
  });

  it('o órfão some da fila de sem-base depois de ligado', async () => {
    await produto('base1', 'BASE', 'COCA COLA 2L');
    await produto('loja1', 'TNP', 'COCA COLA 2L');
    const { ProductDuplicadosService } = await import('./product-duplicados.service');
    const diag = new ProductDuplicadosService();

    expect((await diag.diagnosticar('TNP', 75)).totais.semBase).toBe(1);
    await service.ligarBase(admin, 'loja1', 'base1');
    expect((await diag.diagnosticar('TNP', 75)).totais.semBase).toBe(0);
  });

  it('sugere a BASE por código de barras com 100%', async () => {
    await produto('base1', 'BASE', 'COCA COLA DOIS LITROS');
    await produto('loja1', 'TNP', 'REFRI COCA');
    await db.execute(sqlTag`UPDATE products SET codigo_barras = '7891000100103' WHERE id IN ('base1','loja1')`);

    const { ProductDuplicadosService } = await import('./product-duplicados.service');
    const r = await new ProductDuplicadosService().diagnosticar('TNP', 90);
    const orfao = r.grupos.find((g) => g.motivo === 'sem_base')!;

    expect(orfao.sugestoesBase[0]).toMatchObject({ productId: 'base1', semelhanca: 100, porCodigoBarras: true });
  });

  it('recusa ligar num produto que não é da BASE', async () => {
    await produto('loja1', 'TNP', 'X'); await produto('loja2', 'TNP', 'Y');
    await expect(service.ligarBase(admin, 'loja1', 'loja2'))
      .rejects.toMatchObject({ code: 'NOT_A_BASE_PRODUCT' });
  });

  it('recusa ligar um produto que já é da BASE', async () => {
    await produto('base1', 'BASE', 'X'); await produto('base2', 'BASE', 'Y');
    await expect(service.ligarBase(admin, 'base1', 'base2'))
      .rejects.toMatchObject({ code: 'NOT_A_STORE_PRODUCT' });
  });

  it('não-admin não liga', async () => {
    await produto('base1', 'BASE', 'X'); await produto('loja1', 'TNP', 'X');
    await expect(service.ligarBase(comum, 'loja1', 'base1')).rejects.toMatchObject({ code: 'ONLY_ADMIN_MERGE' });
  });
});
