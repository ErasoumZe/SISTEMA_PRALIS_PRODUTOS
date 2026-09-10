import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { ProductRepository } from './product.repository';

let container: StartedPostgreSqlContainer;
let repo: ProductRepository;
let dbClient: { $client: { end: () => Promise<void> } };
// handle do banco para semear venda e de-para direto, sem passar por repositorio
let db: { execute: (q: unknown) => Promise<unknown> };
let sqlTag: typeof import('drizzle-orm')['sql'];

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:18.1-alpine').start();
  process.env.DATABASE_URL = container.getConnectionUri();
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  const dbMod = await import('@/db/databases');
  dbClient = dbMod.db as unknown as typeof dbClient;
  db = dbMod.db as unknown as typeof db;
  ({ sql: sqlTag } = await import('drizzle-orm'));
  await migrate(dbMod.db, { migrationsFolder: './drizzle' });
  const { ProductRepository } = await import('./product.repository');
  repo = new ProductRepository();
}, 120000);

afterAll(async () => {
  await dbClient?.$client?.end().catch(() => {});
  await container?.stop();
});

const payload = {
  nome: 'BOLO TESTE', quantidade: 1, medidaBase: 'UN' as const, codigoBarras: '789', marca: 'PRALIS',
  embalagem: 'UN' as const, cDe: 'DE' as const, qtCad: 1, medidaCompra: 'UN' as const,
  codigoInterno: null, fotoUrl: null, grupo: null, tipo: 'revenda' as const, status: 'ativo' as const,
  habilitarAjuda: false, estoqueMin: 5, estoqueMax: 30, setorEstoque: 'PROD. - CONFEITARIA',
  custo: 8, margemPontual: 0.6, vVendaPontual: null, auto: true, localVenda1: null, localVenda2: null,
  promocoes: [{ tipo: 'desconto' as const, valor: null, descontoPct: 0.2, horaInicio: '12:00', horaFim: '15:00', dias: [true, true, true, true, true, false, false], descontoAte: null }],
  transformacao: null,
  fiscal: { ncm: '19059090', cest: null, categoria: 'PADARIA', cstPisCofins: '01', aliquotaCheia: 7, aliquotaFcp: null, aliquotaPis: 1.65, aliquotaCofins: 7.6, reducaoIcms: null, icms: 7 },
};

describe('ProductRepository multi-loja (Postgres real via Testcontainers)', () => {
  it('cria na loja TNP, lê, lista por loja (isolado), detecta duplicado, exclui', async () => {
    const created = await repo.create(payload, { loja: 'TNP', codigo: 'PR-TEST-0001', createdByUserId: null, createdByName: 'José' });
    expect(created.loja).toBe('TNP');
    expect(created.codigo).toBe('PR-TEST-0001');
    expect(created.createdByName).toBe('José');
    expect(created.custo).toBe(8);
    expect(created.promocoes[0]?.descontoPct).toBe(0.2);
    expect(created.fiscal?.ncm).toBe('19059090');

    // aparece na TNP, não na LI (isolamento por loja)
    expect((await repo.list('TNP', {})).some((p) => p.id === created.id)).toBe(true);
    expect((await repo.list('LI', {})).some((p) => p.id === created.id)).toBe(false);

    // duplicado por NOME (case-insensitive)
    const dupNome = await repo.findDuplicate('TNP', 'bolo teste', null);
    expect(dupNome?.id).toBe(created.id);
    expect(dupNome?.createdByName).toBe('José');

    // duplicado por CÓDIGO DE BARRAS
    const dupCod = await repo.findDuplicate('TNP', 'NOME DIFERENTE', '789');
    expect(dupCod?.id).toBe(created.id);

    // não é duplicado em outra loja
    expect(await repo.findDuplicate('LI', 'bolo teste', '789')).toBeNull();

    expect(await repo.delete(created.id)).toBe(true);
    expect(await repo.findById(created.id)).toBeNull();
  });
  /*
   * F03 da auditoria de 08/09/2026. O aviso de "codigo de barras ja
   * cadastrado" chamava a listagem com `q`, e `q` procura em nome, marca e
   * codigo do sistema — nunca em codigo de barras. O duplicado so aparecia por
   * coincidencia, quando o numero calhava de bater com outro campo.
   */
  it('acha pelo codigo de barras, que a busca textual nao alcanca', async () => {
    const criado = await repo.create(
      { ...payload, nome: 'AGUA COM GAS 500ML', codigoBarras: '7891000100103' },
      { loja: 'TNP', codigo: 'PR-BARRAS-01', createdByUserId: null, createdByName: 'Jose' },
    );

    // a busca textual NAO acha: o numero nao esta em nome, marca nem codigo
    const porTexto = await repo.list('TNP', { q: '7891000100103' });
    expect(porTexto.find((p) => p.id === criado.id)).toBeUndefined();

    // o filtro proprio acha — e SO ele. Sem o filtro a listagem devolveria
    // tudo e um `toContain` acertaria por acaso; por isso um segundo produto.
    const outro = await repo.create(
      { ...payload, nome: 'CHA MATE 1L', codigoBarras: '7890000000009' },
      { loja: 'TNP', codigo: 'PR-BARRAS-01B', createdByUserId: null, createdByName: 'Jose' },
    );

    const porBarras = await repo.list('TNP', { codigoBarras: '7891000100103' });

    expect(porBarras.map((p) => p.id)).toEqual([criado.id]);

    await repo.delete(criado.id);
    await repo.delete(outro.id);
  });

  /* "0000789" e "789" sao o mesmo produto: mesma normalizacao do fiscal e das vendas. */
  it('ignora zeros a esquerda, como o resto do sistema', async () => {
    const criado = await repo.create(
      { ...payload, nome: 'PAO DE FORMA', codigoBarras: '789' },
      { loja: 'TNP', codigo: 'PR-BARRAS-02', createdByUserId: null, createdByName: 'Jose' },
    );

    // segundo produto de novo: sem ele, a listagem sem filtro passaria por acaso
    const outro = await repo.create(
      { ...payload, nome: 'LEITE INTEGRAL 1L', codigoBarras: '7899999123456' },
      { loja: 'TNP', codigo: 'PR-BARRAS-02B', createdByUserId: null, createdByName: 'Jose' },
    );

    const achados = await repo.list('TNP', { codigoBarras: '0000789' });

    expect(achados.map((p) => p.id)).toEqual([criado.id]);

    await repo.delete(criado.id);
    await repo.delete(outro.id);
  });

  it('codigo de barras de outra loja nao aparece', async () => {
    const criado = await repo.create(
      { ...payload, nome: 'SUCO UVA 1L', codigoBarras: '7899999000001' },
      { loja: 'LI', codigo: 'PR-BARRAS-03', createdByUserId: null, createdByName: 'Jose' },
    );

    expect(await repo.list('TNP', { codigoBarras: '7899999000001' })).toEqual([]);
    expect((await repo.list('LI', { codigoBarras: '7899999000001' })).map((p) => p.id))
      .toContain(criado.id);

    await repo.delete(criado.id);
  });
  /*
   * F09 da auditoria de 08/09/2026. `proximoCodigoInterno` fazia MAX + 1 e o
   * codigo era gerado FORA da transacao da criacao. Dois cadastros ao mesmo
   * tempo liam o mesmo MAX e recebiam o mesmo numero — e o codigo interno e o
   * que o SIA usa para casar produto.
   *
   * O teste dispara as criacoes em paralelo de proposito: em serie o defeito
   * nao aparece.
   */
  it('duas criacoes simultaneas NAO recebem o mesmo codigo interno', async () => {
    const criar = (n: number) => repo.create(
      { ...payload, nome: `SIMULTANEO ${n}`, codigoBarras: null },
      { loja: 'BASE', codigo: `PR-CONC-${n}`, createdByUserId: null, createdByName: 'Jose' },
    );

    const criados = await Promise.all([criar(1), criar(2), criar(3), criar(4)]);
    const codigos = criados.map((p) => p.codigoInterno);

    expect(new Set(codigos).size).toBe(codigos.length);
    expect(codigos.every((c) => c && /^[0-9]{5}$/.test(c))).toBe(true);

    for (const p of criados) await repo.delete(p.id);
  });

  /* A copia da loja herda o codigo da BASE: nao pode ganhar um numero novo. */
  it('copia de loja mantem o codigo interno da base', async () => {
    const base = await repo.create(
      { ...payload, nome: 'PAO COM HERANCA', codigoBarras: null },
      { loja: 'BASE', codigo: 'PR-HER-01', createdByUserId: null, createdByName: 'Jose' },
    );

    const copia = await repo.create(
      { ...payload, nome: 'PAO COM HERANCA', codigoBarras: null },
      {
        loja: 'TNP', codigo: 'PR-HER-01T', createdByUserId: null, createdByName: 'Jose',
        codigoInterno: base.codigoInterno, baseProductId: base.id,
      },
    );

    expect(copia.codigoInterno).toBe(base.codigoInterno);

    await repo.delete(copia.id);
    await repo.delete(base.id);
  });
  /*
   * A base tem milhares de produtos que passaram por algum cadastro; o que a
   * loja opera e bem menos. O filtro separa os dois — e a prova de "ja vendeu"
   * e o codigo do PDV batendo com o codigo de barras, que e como 93% casam.
   */
  it('somenteVendidos deixa passar so o que tem venda', async () => {
    const vendido = await repo.create(
      { ...payload, nome: 'PAO FRANCES VENDIDO', codigoBarras: '7891111000011' },
      { loja: 'TNP', codigo: 'PR-VEND-01', createdByUserId: null, createdByName: 'Jose' },
    );
    const nuncaVendido = await repo.create(
      { ...payload, nome: 'PRODUTO ENCALHADO', codigoBarras: '7892222000022' },
      { loja: 'TNP', codigo: 'PR-VEND-02', createdByUserId: null, createdByName: 'Jose' },
    );

    await db.execute(sqlTag`
      INSERT INTO venda_produto_dia
        (id, loja, data, produto_codigo, produto, quantidade, valor_unitario, total, hash, origem_atualizada_em)
      VALUES (gen_random_uuid()::text, 'TNP', '2026-01-15', '00007891111000011',
              'PAO FRANCES VENDIDO', 3, 1.50, 4.50, 'h-vend-01', now())`);

    const so = await repo.list('TNP', { somenteVendidos: true });
    const todos = await repo.list('TNP', {});

    expect(so.map((p) => p.id)).toContain(vendido.id);
    expect(so.map((p) => p.id)).not.toContain(nuncaVendido.id);
    // sem o filtro os dois aparecem — senao o teste passaria por acidente
    expect(todos.map((p) => p.id)).toEqual(expect.arrayContaining([vendido.id, nuncaVendido.id]));

    await db.execute(sqlTag`DELETE FROM venda_produto_dia WHERE hash = 'h-vend-01'`);
    await repo.delete(vendido.id);
    await repo.delete(nuncaVendido.id);
  });

  /* Produto a granel nao tem codigo: o de-para confirmado a mao e a prova dele. */
  it('de-para confirmado tambem conta como vendido', async () => {
    const granel = await repo.create(
      { ...payload, nome: 'BROA DE FUBA KG', codigoBarras: null },
      { loja: 'TNP', codigo: 'PR-VEND-03', createdByUserId: null, createdByName: 'Jose' },
    );

    expect((await repo.list('TNP', { somenteVendidos: true })).map((p) => p.id)).not.toContain(granel.id);

    await db.execute(sqlTag`
      INSERT INTO produto_creare (id, loja, produto_codigo, produto, product_id)
      VALUES (gen_random_uuid()::text, 'TNP', '', 'BROA DE FUBA KG', ${granel.id})`);

    expect((await repo.list('TNP', { somenteVendidos: true })).map((p) => p.id)).toContain(granel.id);

    await db.execute(sqlTag`DELETE FROM produto_creare WHERE product_id = ${granel.id}`);
    await repo.delete(granel.id);
  });
});
