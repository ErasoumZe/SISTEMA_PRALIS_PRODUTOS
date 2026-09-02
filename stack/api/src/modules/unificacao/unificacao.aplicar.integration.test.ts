import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { CurrentUser } from '@/types/fastify-jwt';
import type { UnificacaoAplicarService } from './unificacao.aplicar.service';
import type { UnificacaoGruposService } from './unificacao.grupos.service';

/** ATENÇÃO: `@/db/databases` só por import dinâmico — ver nota nos outros testes. */
let container: StartedPostgreSqlContainer;
let aplicar: UnificacaoAplicarService;
let grupos: UnificacaoGruposService;
let db: {
  execute: (query: unknown) => Promise<{ rows: Record<string, unknown>[] }>;
  $client: { end: () => Promise<void> };
};
let sqlTag: typeof import('drizzle-orm')['sql'];

const admin: CurrentUser = { id: 'u1', name: 'Jose', email: 'a@a', loja: null, role: 'admin' };
const comum: CurrentUser = { id: 'u2', name: 'Comum', email: 'b@b', loja: 'TNP', role: 'user' };

/** Uma linha de fonte no staging, do jeito que o carregador grava. */
let fonte: (p: {
  id: string; fonte: string; barras?: string; interno?: string; nome?: string;
  ativo?: boolean | null; grupo?: string | null; custo?: number | null; venda?: number | null;
  ncm?: string | null; reducao?: number | null; icmsEfetivo?: number | null; loja?: string;
}) => Promise<void>;

const chaveDe = (v: string) => v.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
const normal = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:18.1-alpine').start();
  process.env.DATABASE_URL = container.getConnectionUri();
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  sqlTag = (await import('drizzle-orm')).sql;
  const dbModule = await import('@/db/databases');
  db = dbModule.db as unknown as typeof db;
  await migrate(dbModule.db, { migrationsFolder: './drizzle' });

  fonte = async (p) => {
    const barras = p.barras ?? '';
    await db.execute(sqlTag`
      INSERT INTO unif_fonte_produto (id, fonte, cod_interno, cod_barras, chave_barras, nome,
                                      nome_normalizado, ativo, grupo, custo, venda, ncm,
                                      reducao, icms_efetivo, raw)
      VALUES (${p.id}, ${p.fonte}, ${p.interno ?? ''}, ${barras}, ${chaveDe(barras)},
              ${p.nome ?? ''}, ${normal(p.nome ?? '')}, ${p.ativo ?? true}, ${p.grupo ?? null},
              ${p.custo ?? null}, ${p.venda ?? null}, ${p.ncm ?? null},
              ${p.reducao ?? null}, ${p.icmsEfetivo ?? null},
              ${JSON.stringify({ loja: p.loja ?? '' })}::jsonb)`);
  };

  // `products.created_by_user_id` tem FK para `users` — sem isto o insert falha
  await db.execute(sqlTag`
    INSERT INTO users (id, name, email, password_hash, role) VALUES
      ('u1', 'Jose', 'a@a', 'x', 'admin'),
      ('u2', 'Comum', 'b@b', 'x', 'user')`);

  const { UnificacaoAplicarService } = await import('./unificacao.aplicar.service');
  const { UnificacaoGruposService } = await import('./unificacao.grupos.service');
  const { ProductRepository } = await import('@/modules/product/product.repository');
  const { ProductSheetService } = await import('@/modules/google-sheets/product-sheet.service');
  const { container: di } = await import('tsyringe');
  await import('@/modules/google-sheets/google-sheets.di');

  grupos = new UnificacaoGruposService();
  aplicar = new UnificacaoAplicarService(new ProductRepository(), di.resolve(ProductSheetService));
}, 300_000);

afterAll(async () => {
  await db.$client.end();
  await container.stop();
});

beforeEach(async () => {
  await db.execute(sqlTag`DELETE FROM unif_decisao`);
  await db.execute(sqlTag`DELETE FROM unif_grupo_item`);
  await db.execute(sqlTag`DELETE FROM unif_grupo`);
  await db.execute(sqlTag`DELETE FROM unif_fonte_produto`);
  await db.execute(sqlTag`DELETE FROM product_sheet_sync`);
  await db.execute(sqlTag`DELETE FROM product_fiscal`);
  await db.execute(sqlTag`DELETE FROM products`);
});

/** Um produto que existe nas duas lojas, com fiscal de cada uma. */
const cenarioCompleto = async () => {
  await fonte({ id: 's1', fonte: 'sia_li', barras: '00000000010000', interno: '10000',
    nome: 'ABACAXI UNID', grupo: 'MAT. PRIMA (FARINHA)', reducao: 53.33 });
  await fonte({ id: 'c1', fonte: 'compilart_tnp', barras: '00000000010000', interno: '4396',
    nome: 'ABACAXI UNID', custo: 2.5, venda: 6.9 });
  await fonte({ id: 'f1', fonte: 'fiscal_tnp', interno: '10000', ncm: '08043000', icmsEfetivo: 3.69, ativo: null });
  await grupos.recalcular();
  const r = await grupos.listar({ q: 'ABACAXI' });
  return r.grupos[0]!;
};

describe('unificar — grava no catalogo mestre', () => {
  it('cria o BASE e as copias das lojas presentes', async () => {
    const g = await cenarioCompleto();

    const r = await aplicar.unificar(admin, g.id);

    expect(r.lojasCriadas.sort()).toEqual(['LI', 'TNP']);
    const linhas = await db.execute(sqlTag`
      SELECT loja, nome, grupo, codigo_interno, base_product_id FROM products ORDER BY loja`);
    expect(linhas.rows).toHaveLength(3);
    expect(linhas.rows.map((x) => x.loja)).toEqual(['BASE', 'LI', 'TNP']);
  });

  it('o codigo interno e o MESMO nas tres linhas', async () => {
    const g = await cenarioCompleto();
    await aplicar.unificar(admin, g.id);

    const r = await db.execute(sqlTag`SELECT DISTINCT codigo_interno FROM products`);
    expect(r.rows).toHaveLength(1);
  });

  /*
   * O ponto mais sensivel: fiscal e POR LOJA e copiado da fonte. A LI leva o do
   * SIA, a TNP o da contabilidade, e nenhum herda do outro nem do grupo.
   */
  it('grava o fiscal de cada loja da fonte certa', async () => {
    const g = await cenarioCompleto();
    await aplicar.unificar(admin, g.id);

    const r = await db.execute(sqlTag`
      SELECT p.loja, f.ncm, f.reducao_icms, f.icms
      FROM products p LEFT JOIN product_fiscal f ON f.product_id = p.id ORDER BY p.loja`);
    const [base, li, tnp] = r.rows as any[];

    expect(base.loja).toBe('BASE');
    expect(base.ncm).toBeNull(); // BASE nao tem fiscal: fiscal e da loja
    expect(li).toMatchObject({ loja: 'LI', ncm: null });
    expect(Number(li.reducao_icms)).toBe(53.33); // do SIA
    expect(tnp).toMatchObject({ loja: 'TNP', ncm: '08043000' }); // da contabilidade
    expect(Number(tnp.icms)).toBe(3.69);
  });

  /*
   * A exportacao do SIA passou a trazer NCM (4.186 linhas, 8 digitos). Este
   * teste trava o caminho: o NCM da LI vem do SIA, com o zero a esquerda.
   */
  it('o NCM do SIA chega na LI, com o zero a esquerda', async () => {
    await fonte({ id: 's2', fonte: 'sia_li', barras: '00000000020000', interno: '20000',
      nome: 'ABACATE KG', grupo: 'MAT. PRIMA (FARINHA)', ncm: '08043000', reducao: 0 });
    await fonte({ id: 'c2', fonte: 'compilart_tnp', barras: '00000000020000', interno: '77',
      nome: 'ABACATE KG', custo: 4 });
    await grupos.recalcular();
    const g = (await grupos.listar({ q: 'ABACATE' })).grupos[0]!;

    await aplicar.unificar(admin, g.id);

    const r = await db.execute(sqlTag`
      SELECT f.ncm FROM products p JOIN product_fiscal f ON f.product_id = p.id
      WHERE p.loja = 'LI'`);
    expect(r.rows[0]!.ncm).toBe('08043000');
  });

  it('NAO copia o fiscal de uma loja para a outra', async () => {
    const g = await cenarioCompleto();
    await aplicar.unificar(admin, g.id);

    const r = await db.execute(sqlTag`
      SELECT p.loja, f.ncm, f.reducao_icms FROM products p
      JOIN product_fiscal f ON f.product_id = p.id WHERE p.loja IN ('LI','TNP')`);
    const li = (r.rows as any[]).find((x) => x.loja === 'LI');
    const tnp = (r.rows as any[]).find((x) => x.loja === 'TNP');

    expect(li.ncm).toBeNull(); // o NCM e da contabilidade (TNP), nao vaza para a LI
    expect(tnp.reducao_icms).toBeNull(); // a reducao e do SIA (LI), nao vaza para a TNP
  });

  it('nada de cstPisCofins inventado — o classify() nao roda aqui', async () => {
    const g = await cenarioCompleto();
    await aplicar.unificar(admin, g.id);

    const r = await db.execute(sqlTag`
      SELECT count(*) FILTER (WHERE cst_pis_cofins IS NOT NULL)::int c FROM product_fiscal`);
    expect(r.rows[0]!.c).toBe(0);
  });

  it('o grupo do SIA entra como texto; sem grupo vira A CLASSIFICAR', async () => {
    const g = await cenarioCompleto();
    await aplicar.unificar(admin, g.id);
    const comGrupo = await db.execute(sqlTag`SELECT DISTINCT grupo FROM products`);
    expect(comGrupo.rows[0]!.grupo).toBe('MAT. PRIMA (FARINHA)');

    await db.execute(sqlTag`DELETE FROM products`);
    await db.execute(sqlTag`DELETE FROM unif_decisao`);
    await db.execute(sqlTag`DELETE FROM unif_fonte_produto`);
    await fonte({ id: 'c9', fonte: 'compilart_tnp', barras: '999', nome: 'SO NA TNP', custo: 1 });
    await grupos.recalcular();
    const semGrupo = (await grupos.listar({ q: 'SO NA TNP' })).grupos[0]!;

    await aplicar.unificar(admin, semGrupo.id);

    const r = await db.execute(sqlTag`SELECT DISTINCT grupo FROM products`);
    expect(r.rows[0]!.grupo).toBe('A CLASSIFICAR');
  });

  /* Sem isto o unificado nunca chegaria ao Sheets nem ao Criare. */
  it('enfileira o espelho da planilha para o BASE', async () => {
    const g = await cenarioCompleto();
    const r = await aplicar.unificar(admin, g.id);

    const sync = await db.execute(sqlTag`
      SELECT product_id FROM product_sheet_sync WHERE product_id = ${r.productId}`);
    expect(sync.rows).toHaveLength(1);
  });
});

describe('unificar — o que ele recusa', () => {
  /*
   * Unificar um grupo que ja esta no Pralis nunca foi "criar de novo": e
   * completar aquele cadastro. Antes isso dava UNIF_DUPLICADO e travava os 147.
   */
  it('produto ja existente na BASE e ATUALIZADO, nao recusado', async () => {
    const g = await cenarioCompleto();
    await db.execute(sqlTag`
      INSERT INTO products (id, loja, codigo, nome, medida_base, tipo, status, quantidade, qt_cad,
                            habilitar_ajuda, auto, codigo_barras)
      VALUES ('ja', 'BASE', 'PR-JA', 'ABACAXI UNID', 'UN', 'revenda', 'ativo', 1, 1, false, false, '00000000010000')`);

    const r = await aplicar.unificar(admin, g.id);

    expect(r.modo).toBe('atualizado');
    expect(r.productId).toBe('ja');
    const base = await db.execute(sqlTag`SELECT count(*)::int c FROM products WHERE loja = 'BASE'`);
    expect(base.rows[0]!.c).toBe(1); // nao criou um segundo BASE
  });

  it('com forcar, cria mesmo assim — a decisao continua sendo humana', async () => {
    const g = await cenarioCompleto();
    await db.execute(sqlTag`
      INSERT INTO products (id, loja, codigo, nome, medida_base, tipo, status, quantidade, qt_cad,
                            habilitar_ajuda, auto, codigo_barras)
      VALUES ('ja', 'BASE', 'PR-JA', 'ABACAXI UNID', 'UN', 'revenda', 'ativo', 1, 1, false, false, '00000000010000')`);

    await expect(aplicar.unificar(admin, g.id, true)).resolves.toMatchObject({ lojasCriadas: expect.any(Array) });
  });

  it('recusa o segundo clique — dois cliques nao geram dois cadastros', async () => {
    const g = await cenarioCompleto();
    await aplicar.unificar(admin, g.id);

    await expect(aplicar.unificar(admin, g.id)).rejects.toMatchObject({ code: 'UNIF_JA_DECIDIDO' });
  });

  it('recusa grupo sem nome em fonte nenhuma', async () => {
    await fonte({ id: 'f9', fonte: 'fiscal_tnp', interno: '55555', ncm: '12345678', ativo: null });
    await grupos.recalcular();
    const g = (await grupos.listar({})).grupos[0]!;

    await expect(aplicar.unificar(admin, g.id)).rejects.toMatchObject({ code: 'UNIF_SEM_NOME' });
  });

  it('usuario comum nao unifica', async () => {
    const g = await cenarioCompleto();

    await expect(aplicar.unificar(comum, g.id)).rejects.toMatchObject({ code: 'ONLY_ADMIN_UNIF' });
  });
});

describe('marcar e reabrir', () => {
  it('"nao e o mesmo" tira da fila sem criar nada', async () => {
    const g = await cenarioCompleto();

    await aplicar.marcar(admin, g.id, 'nao_e_o_mesmo');

    const prod = await db.execute(sqlTag`SELECT count(*)::int c FROM products`);
    expect(prod.rows[0]!.c).toBe(0);
    const pend = await grupos.listar({ decisao: 'pendente' });
    expect(pend.grupos.some((x) => x.id === g.id)).toBe(false);
  });

  it('registra quem decidiu, para auditar', async () => {
    const g = await cenarioCompleto();
    await aplicar.marcar(admin, g.id, 'ignorado');

    const r = await db.execute(sqlTag`SELECT acao, usuario_nome, grupo_chave FROM unif_decisao`);
    expect(r.rows[0]).toMatchObject({ acao: 'ignorado', usuario_nome: 'Jose', grupo_chave: '10000' });
  });

  it('reabrir devolve para a fila', async () => {
    const g = await cenarioCompleto();
    await aplicar.marcar(admin, g.id, 'ignorado');

    await aplicar.reabrir(admin, g.id);

    const pend = await grupos.listar({ decisao: 'pendente' });
    expect(pend.grupos.some((x) => x.id === g.id)).toBe(true);
  });

  it('NAO reabre o que ja virou produto — apagar cadastro e outra decisao', async () => {
    const g = await cenarioCompleto();
    await aplicar.unificar(admin, g.id);

    await expect(aplicar.reabrir(admin, g.id)).rejects.toMatchObject({ code: 'UNIF_JA_CRIADO' });
  });

  it('a decisao sobrevive ao recalculo dos grupos', async () => {
    const g = await cenarioCompleto();
    await aplicar.marcar(admin, g.id, 'nao_e_o_mesmo');

    await grupos.recalcular();

    const feitas = await grupos.listar({ decisao: 'feita' });
    expect(feitas.total).toBe(1);
  });
});

/**
 * Os 147 produtos que ja existem no Pralis. Unificar aqui e COMPLETAR o
 * cadastro com o fiscal e o que as outras fontes trazem — nunca recriar.
 */
describe('modo atualizacao — grupo que ja esta no Pralis', () => {
  /** BASE + espelho da LI ja no catalogo, e a linha `pralis` no staging. */
  const jaNoPralis = async (opcoes: { comEspelhoLi?: boolean; nomeCurado?: string } = {}) => {
    await db.execute(sqlTag`
      INSERT INTO products (id, loja, codigo, nome, medida_base, tipo, status, quantidade, qt_cad,
                            habilitar_ajuda, auto, codigo_barras, codigo_interno, custo, v_venda_pontual, grupo)
      VALUES ('base1', 'BASE', 'PR-B1', ${opcoes.nomeCurado ?? 'ABACAXI UNID'}, 'UN', 'revenda', 'ativo',
              1, 1, false, false, '00000000010000', '00042', 99.00, 199.00, 'GRUPO CURADO')`);
    if (opcoes.comEspelhoLi) {
      await db.execute(sqlTag`
        INSERT INTO products (id, loja, codigo, nome, medida_base, tipo, status, quantidade, qt_cad,
                              habilitar_ajuda, auto, codigo_barras, codigo_interno, base_product_id)
        VALUES ('li1', 'LI', 'PR-L1', 'ABACAXI UNID', 'UN', 'revenda', 'ativo', 1, 1, false, false,
                '00000000010000', '00042', 'base1')`);
      await db.execute(sqlTag`
        INSERT INTO product_fiscal (product_id, cst_pis_cofins) VALUES ('li1', '06')`);
    }
    // a linha `pralis` do staging carrega o id do produto no `raw`
    await db.execute(sqlTag`
      INSERT INTO unif_fonte_produto (id, fonte, cod_interno, cod_barras, chave_barras, nome,
                                      nome_normalizado, ativo, raw)
      VALUES ('p1', 'pralis', '00042', '00000000010000', '10000', 'ABACAXI UNID',
              'ABACAXI UNID', true, ${JSON.stringify({ id: 'base1', loja: 'BASE' })}::jsonb)`);
  };

  it('atualiza o fiscal do espelho existente com o da fonte da loja', async () => {
    await jaNoPralis({ comEspelhoLi: true });
    const g = await cenarioCompleto();

    const r = await aplicar.unificar(admin, g.id);

    expect(r.modo).toBe('atualizado');
    expect(r.lojasAtualizadas).toContain('LI');
    const li = await db.execute(sqlTag`
      SELECT f.reducao_icms, f.cst_pis_cofins FROM product_fiscal f WHERE f.product_id = 'li1'`);
    expect(Number(li.rows[0]!.reducao_icms)).toBe(53.33); // veio do SIA
    expect(li.rows[0]!.cst_pis_cofins).toBe('06'); // o que ja existia NAO foi jogado fora
  });

  it('cria o espelho que FALTA em vez de recriar o BASE', async () => {
    await jaNoPralis({ comEspelhoLi: true });
    const g = await cenarioCompleto();

    const r = await aplicar.unificar(admin, g.id);

    expect(r.lojasCriadas).toContain('TNP'); // nao existia
    expect(r.lojasAtualizadas).toContain('LI'); // existia
    const tnp = await db.execute(sqlTag`
      SELECT f.ncm FROM products p JOIN product_fiscal f ON f.product_id = p.id WHERE p.loja = 'TNP'`);
    expect(tnp.rows[0]!.ncm).toBe('08043000'); // da contabilidade
  });

  /* Decisao do dono: o Compilart e o catalogo vivo e manda no preco. */
  it('puxa custo e venda do Compilart POR CIMA do que o Pralis tinha', async () => {
    await jaNoPralis();
    const g = await cenarioCompleto();

    await aplicar.unificar(admin, g.id);

    const r = await db.execute(sqlTag`SELECT custo, v_venda_pontual FROM products WHERE id = 'base1'`);
    expect(Number(r.rows[0]!.custo)).toBe(2.5); // era 99, virou o do Compilart
    expect(Number(r.rows[0]!.v_venda_pontual)).toBe(6.9); // era 199
  });

  it('NAO sobrescreve nome nem grupo que o Jose curou', async () => {
    await jaNoPralis({ nomeCurado: 'ABACAXI PEROLA CURADO' });
    await fonte({ id: 's1', fonte: 'sia_li', barras: '00000000010000', interno: '10000',
      nome: 'ABACAXI UNID', grupo: 'MAT. PRIMA (FARINHA)', reducao: 53.33 });
    await grupos.recalcular();
    const g = (await grupos.listar({ q: 'ABACAXI' })).grupos[0]!;

    await aplicar.unificar(admin, g.id);

    const r = await db.execute(sqlTag`SELECT nome, grupo FROM products WHERE id = 'base1'`);
    expect(r.rows[0]).toMatchObject({ nome: 'ABACAXI PEROLA CURADO', grupo: 'GRUPO CURADO' });
  });

  it('reenfileira o espelho da planilha para a atualizacao chegar no Sheets', async () => {
    await jaNoPralis();
    const g = await cenarioCompleto();

    await aplicar.unificar(admin, g.id);

    const s = await db.execute(sqlTag`
      SELECT count(*)::int c FROM product_sheet_sync WHERE product_id = 'base1'`);
    expect(s.rows[0]!.c).toBe(1);
  });

  it('registra modo=atualizado na auditoria, com o caminho usado', async () => {
    await jaNoPralis();
    const g = await cenarioCompleto();

    await aplicar.unificar(admin, g.id);

    const r = await db.execute(sqlTag`SELECT detalhe, product_id FROM unif_decisao`);
    expect(r.rows[0]!.product_id).toBe('base1');
    expect(r.rows[0]!.detalhe).toMatchObject({ modo: 'atualizado', encontradoPor: 'fonte_pralis' });
  });

  /* O caso real que travava: 5STAR ja no Pralis e com nomes divergentes. */
  it('5STAR (ja no Pralis, nomes divergentes) atualiza em vez de dar erro', async () => {
    await db.execute(sqlTag`
      INSERT INTO products (id, loja, codigo, nome, medida_base, tipo, status, quantidade, qt_cad,
                            habilitar_ajuda, auto, codigo_barras, codigo_interno)
      VALUES ('b5', 'BASE', 'PR-B5', '5STAR', 'UN', 'revenda', 'ativo', 1, 1, false, false,
              '00000000010365', '00365')`);
    await db.execute(sqlTag`
      INSERT INTO unif_fonte_produto (id, fonte, cod_interno, cod_barras, chave_barras, nome,
                                      nome_normalizado, ativo, raw)
      VALUES ('pp5', 'pralis', '00365', '00000000010365', '10365', '5STAR', '5STAR', true,
              ${JSON.stringify({ id: 'b5', loja: 'BASE' })}::jsonb)`);
    await fonte({ id: 'ss5', fonte: 'sia_li', barras: '00000000010365', interno: '10365',
      nome: '5STAR 40G', grupo: 'BOMBONIERI', ncm: '18069000' });
    await fonte({ id: 'cc5', fonte: 'compilart_tnp', barras: '00000000010365', interno: '9',
      nome: '5 STAR CHOCOLATE 40G', custo: 1.9, venda: 3.5 });
    await grupos.recalcular();
    const g = (await grupos.listar({ q: '5STAR' })).grupos.find((x) => x.chave === '10365')!;

    expect(g.flagNomesDivergentes).toBe(true);
    const r = await aplicar.unificar(admin, g.id);

    expect(r.modo).toBe('atualizado');
    expect(r.productId).toBe('b5');
  });

  it('forcar continua criando um separado, mesmo existindo', async () => {
    await jaNoPralis();
    const g = await cenarioCompleto();

    const r = await aplicar.unificar(admin, g.id, true);

    expect(r.modo).toBe('criado');
    expect(r.productId).not.toBe('base1');
  });
});
