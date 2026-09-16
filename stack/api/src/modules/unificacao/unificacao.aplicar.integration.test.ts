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
  const { ProductSheetRepository } = await import('@/modules/google-sheets/product-sheet.repository');
  const { FakeSheetsGateway } = await import('@/modules/google-sheets/fake-sheets.gateway');

  /*
   * O gateway e um DUBLE, nunca o cliente real.
   *
   * Este arquivo resolvia o `ProductSheetService` pelo container de injecao, e
   * o container entrega o `GoogleSheetsClient` DE VERDADE. Com
   * `GOOGLE_SHEETS_ENABLED=true` no .env da maquina, cada `unificar()` daqui
   * gravou uma linha real na planilha oficial: em 16/09/2026 foram 123 linhas
   * de fixture no cadastro de producao. O cliente real agora recusa rodar sob
   * teste, e este arquivo passa o duble explicitamente.
   */
  const repositorio = new ProductRepository();
  const sheets = new FakeSheetsGateway().comCabecalhos().comLinhaModelo(12);
  const espelho = new ProductSheetService(repositorio, new ProductSheetRepository(), sheets);

  grupos = new UnificacaoGruposService();
  aplicar = new UnificacaoAplicarService(repositorio, espelho, grupos);
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
  /*
   * A REGRA do Jose: a Central para na Base Geral. Da Base ele importa para
   * cada loja quando quiser, e e a importacao que preenche a faixa da loja na
   * planilha. Antes a Central criava LI e TNP sozinha, no mesmo clique — e por
   * isso a loja recebia cadastro que ninguem mandou importar.
   */
  it('cria SOMENTE o BASE — nenhuma copia de loja', async () => {
    const g = await cenarioCompleto();

    const r = await aplicar.unificar(admin, g.id);

    expect(r.modo).toBe('criado');
    const linhas = await db.execute(sqlTag`
      SELECT loja, nome, grupo, codigo_interno, base_product_id FROM products ORDER BY loja`);
    expect(linhas.rows).toHaveLength(1);
    expect(linhas.rows.map((x) => x.loja)).toEqual(['BASE']);
  });

  it('o BASE nasce com codigo interno proprio, que a loja herda ao importar', async () => {
    const g = await cenarioCompleto();
    await aplicar.unificar(admin, g.id);

    const r = await db.execute(sqlTag`SELECT DISTINCT codigo_interno FROM products`);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.codigo_interno).toBeTruthy();
  });

  /*
   * Fiscal continua sendo DA LOJA — e a Central nao tem mais loja para gravar.
   *
   * Antes ela copiava NCM/reducao do SIA para a LI e o ICMS da contabilidade
   * para a TNP, no mesmo clique em que criava as copias. Sem as copias, esse
   * caminho deixou de existir: quem classifica o produto da loja e o backfill
   * fiscal (`BackfillFiscalService`), que pega justamente quem esta sem linha
   * fiscal nenhuma e le a tabela fiscal oficial. Este teste trava que a Central
   * nao inventa fiscal em lugar nenhum — nem no BASE.
   */
  it('a Central nao grava fiscal: o BASE nasce sem carga fiscal', async () => {
    const g = await cenarioCompleto();
    await aplicar.unificar(admin, g.id);

    const r = await db.execute(sqlTag`
      SELECT p.loja, f.ncm, f.reducao_icms, f.icms
      FROM products p LEFT JOIN product_fiscal f ON f.product_id = p.id ORDER BY p.loja`);
    const [base] = r.rows as any[];

    expect(r.rows).toHaveLength(1);
    expect(base.loja).toBe('BASE');
    expect(base.ncm).toBeNull();
    expect(base.reducao_icms).toBeNull();
    expect(base.icms).toBeNull();
  });

  /*
   * O NCM do SIA e a reducao da LI continuam existindo nas FONTES e aparecem na
   * tela do grupo. O que este teste trava e que eles nao viram cadastro por
   * conta propria: nenhuma linha fiscal nasce da unificacao.
   */
  it('o fiscal das fontes NAO vira linha fiscal sozinho', async () => {
    await fonte({ id: 's2', fonte: 'sia_li', barras: '00000000020000', interno: '20000',
      nome: 'ABACATE KG', grupo: 'MAT. PRIMA (FARINHA)', ncm: '08043000', reducao: 0 });
    await fonte({ id: 'c2', fonte: 'compilart_tnp', barras: '00000000020000', interno: '77',
      nome: 'ABACATE KG', custo: 4 });
    await grupos.recalcular();
    const g = (await grupos.listar({ q: 'ABACATE' })).grupos[0]!;

    await aplicar.unificar(admin, g.id);

    const r = await db.execute(sqlTag`SELECT count(*)::int c FROM product_fiscal`);
    expect(r.rows[0]!.c).toBe(0);
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

    await expect(aplicar.unificar(admin, g.id, true)).resolves.toMatchObject({ modo: 'criado' });
  });

  it('recusa o segundo clique — dois cliques nao geram dois cadastros', async () => {
    const g = await cenarioCompleto();
    await aplicar.unificar(admin, g.id);

    await expect(aplicar.unificar(admin, g.id)).rejects.toMatchObject({ code: 'UNIF_JA_DECIDIDO' });
  });

  /*
   * Linha do fiscal da contabilidade que nao casa com nenhum catalogo nao e um
   * produto: o arquivo dela nem tem coluna NOME. Antes virava um "grupo" sem
   * nome que so podia ser recusado; agora nao vira grupo nenhum, e some da fila
   * em vez de ocupar espaco. Sao 6 casos na base real.
   */
  it('linha fiscal orfa NAO vira grupo — nao e produto', async () => {
    await fonte({ id: 'f9', fonte: 'fiscal_tnp', interno: '55555', ncm: '12345678', ativo: null });

    await grupos.recalcular();

    expect((await grupos.listar({})).total).toBe(0);
  });

  it('mas o fiscal orfa CONTINUA no grupo quando ha um produto de verdade', async () => {
    await fonte({ id: 'c9', fonte: 'compilart_tnp', barras: '00000000055555', interno: '77',
      nome: 'PRODUTO DE VERDADE', custo: 1 });
    await fonte({ id: 'f9', fonte: 'fiscal_tnp', interno: '55555', ncm: '12345678', ativo: null });

    await grupos.recalcular();
    const g = (await grupos.listar({})).grupos[0]!;

    expect(g.fontes.sort()).toEqual(['compilart_tnp', 'fiscal_tnp']);
    expect(g.nome).toBe('PRODUTO DE VERDADE');
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

  /*
   * O catalogo da loja e da loja. A Central atualiza o BASE e para ai — mesmo
   * quando o espelho da loja ja existe e a fonte tem fiscal para ele. Quem
   * mexe no cadastro da LI e a propria LI, importando da Base.
   */
  it('NAO encosta no espelho da loja que ja existe', async () => {
    await jaNoPralis({ comEspelhoLi: true });
    const g = await cenarioCompleto();

    const r = await aplicar.unificar(admin, g.id);

    expect(r.modo).toBe('atualizado');
    const li = await db.execute(sqlTag`
      SELECT f.reducao_icms, f.cst_pis_cofins FROM product_fiscal f WHERE f.product_id = 'li1'`);
    expect(li.rows[0]!.reducao_icms).toBeNull(); // o SIA nao entrou por aqui
    expect(li.rows[0]!.cst_pis_cofins).toBe('06'); // e o que existia continua intacto
  });

  it('NAO cria o espelho que falta — isso e a importacao da loja', async () => {
    await jaNoPralis({ comEspelhoLi: true });
    const g = await cenarioCompleto();

    await aplicar.unificar(admin, g.id);

    const lojas = await db.execute(sqlTag`SELECT loja FROM products ORDER BY loja`);
    expect(lojas.rows.map((x) => x.loja)).toEqual(['BASE', 'LI']); // TNP nao apareceu
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

  /*
   * Sem nome escolhido — o caso do lote automatico e do "criar todos os que
   * faltam" — o nome que o motor deduziu NAO pode passar por cima do que o
   * Jose curou no Pralis. Seria apagar curadoria em massa sem clique humano.
   */
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

  /*
   * O outro lado da mesma regra: quando o Jose ESCOLHE o nome na tela, a
   * escolha dele manda — e por isso que a Central mostra os nomes das fontes.
   * O grupo curado continua intocado: so o nome foi escolhido.
   */
  it('o nome ESCOLHIDO na tela sobrescreve o que estava no Pralis', async () => {
    await jaNoPralis({ nomeCurado: 'ABACAXI PEROLA CURADO' });
    await fonte({ id: 's1', fonte: 'sia_li', barras: '00000000010000', interno: '10000',
      nome: 'ABACAXI UNID', grupo: 'MAT. PRIMA (FARINHA)', reducao: 53.33 });
    await grupos.recalcular();
    const g = (await grupos.listar({ q: 'ABACAXI' })).grupos[0]!;

    await aplicar.unificar(admin, g.id, false, 'ABACAXI UNID');

    const r = await db.execute(sqlTag`SELECT nome, grupo FROM products WHERE id = 'base1'`);
    expect(r.rows[0]).toMatchObject({ nome: 'ABACAXI UNID', grupo: 'GRUPO CURADO' });
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

/**
 * A acao em MASSA da Central: criar de uma vez todos os grupos que ainda nao
 * estao no Pralis, sob os filtros que estiverem ligados na tela.
 *
 * Tres coisas tem de valer ao mesmo tempo, e sao elas que estes testes trancam:
 * a contagem prometida bate com o que e criado; rodar duas vezes nao duplica; e
 * o filtro da tela e respeitado (o botao nunca mexe fora do que esta a vista).
 */
describe('criar todos os que faltam — acao em massa', () => {
  /** Tres produtos so na TNP. O terceiro tambem aparece na fonte dos vendidos. */
  const tresFaltando = async () => {
    await fonte({ id: 'm1', fonte: 'compilart_tnp', barras: '00000000011111', interno: '11',
      nome: 'MASSA UM', custo: 1, venda: 2 });
    await fonte({ id: 'm2', fonte: 'compilart_tnp', barras: '00000000022222', interno: '22',
      nome: 'MASSA DOIS', custo: 1, venda: 2 });
    await fonte({ id: 'm3', fonte: 'compilart_tnp', barras: '00000000033333', interno: '33',
      nome: 'MASSA TRES', custo: 1, venda: 2 });
    await fonte({ id: 'v3', fonte: 'vendas_pdv_12m', barras: '00000000033333', interno: '33',
      nome: 'MASSA TRES' });
    await grupos.recalcular();
  };

  const basesNoCatalogo = async () => {
    const r = await db.execute(sqlTag`SELECT count(*)::int c FROM products WHERE loja = 'BASE'`);
    return r.rows[0]!.c as number;
  };

  /*
   * O contrato da confirmacao: a tela diz "vai criar N" ANTES de escrever. Se a
   * contagem e a execucao divergissem, o numero mostrado seria chute.
   */
  it('a contagem prometida e exatamente o que e criado', async () => {
    await tresFaltando();

    const prometido = await grupos.contarACriar({});
    const r = await aplicar.criarFaltantes(admin, {}, 100);

    expect(prometido).toBe(3);
    expect(r.selecionados).toBe(3);
    expect(r.criados).toBe(prometido);
    expect(r.falhas).toBe(0);
    expect(await basesNoCatalogo()).toBe(prometido);
    expect(r.restantes).toBe(0);
  });

  /* Idempotencia: o segundo clique (ou o F5 no meio) nao pode gerar cadastro em dobro. */
  it('rodar duas vezes NAO duplica produto', async () => {
    await tresFaltando();

    const primeira = await aplicar.criarFaltantes(admin, {}, 100);
    const segunda = await aplicar.criarFaltantes(admin, {}, 100);

    expect(primeira.criados).toBe(3);
    expect(segunda.selecionados).toBe(0);
    expect(segunda.criados).toBe(0);
    expect(await basesNoCatalogo()).toBe(3);
    // e cada grupo virou UM produto, nao dois
    const porNome = await db.execute(sqlTag`
      SELECT nome, count(*)::int c FROM products WHERE loja = 'BASE' GROUP BY nome ORDER BY nome`);
    expect(porNome.rows.every((x) => x.c === 1)).toBe(true);
  });

  /*
   * O botao promete "os que faltam DENTRO DO FILTRO". Com "so os que ja vendi"
   * ligado, os outros dois tem de continuar intocados — e continuar contando
   * como faltando quando o filtro sai.
   */
  it('respeita o filtro da tela — nao cria o que esta fora dele', async () => {
    await tresFaltando();

    const prometido = await grupos.contarACriar({ somenteVendidos: true });
    const r = await aplicar.criarFaltantes(admin, { somenteVendidos: true }, 100);

    expect(prometido).toBe(1);
    expect(r.criados).toBe(1);
    const criados = await db.execute(sqlTag`SELECT nome FROM products WHERE loja = 'BASE'`);
    expect(criados.rows.map((x) => x.nome)).toEqual(['MASSA TRES']);
    // os de fora do filtro seguem faltando
    expect(await grupos.contarACriar({})).toBe(2);
  });

  it('a busca por texto tambem vale como filtro do lote', async () => {
    await tresFaltando();

    const r = await aplicar.criarFaltantes(admin, { q: 'MASSA DOIS' }, 100);

    expect(r.criados).toBe(1);
    const criados = await db.execute(sqlTag`SELECT nome FROM products WHERE loja = 'BASE'`);
    expect(criados.rows.map((x) => x.nome)).toEqual(['MASSA DOIS']);
  });

  /* "Faltam" sao os que NAO estao no Pralis — o que ja existe nao entra na conta. */
  it('grupo que ja esta no Pralis fica FORA da conta e do lote', async () => {
    await tresFaltando();
    await db.execute(sqlTag`
      INSERT INTO products (id, loja, codigo, nome, medida_base, tipo, status, quantidade, qt_cad,
                            habilitar_ajuda, auto, codigo_barras, codigo_interno)
      VALUES ('jaum', 'BASE', 'PR-JU', 'MASSA UM', 'UN', 'revenda', 'ativo', 1, 1, false, false,
              '00000000011111', '00011')`);
    await db.execute(sqlTag`
      INSERT INTO unif_fonte_produto (id, fonte, cod_interno, cod_barras, chave_barras, nome,
                                      nome_normalizado, ativo, raw)
      VALUES ('pu', 'pralis', '00011', '00000000011111', '11111', 'MASSA UM', 'MASSA UM', true,
              ${JSON.stringify({ id: 'jaum', loja: 'BASE' })}::jsonb)`);
    await grupos.recalcular();

    const prometido = await grupos.contarACriar({});
    const r = await aplicar.criarFaltantes(admin, {}, 100);

    expect(prometido).toBe(2); // MASSA UM ja existe: nao FALTA
    // o lote nao pega ninguem alem do que foi prometido na confirmacao
    expect(r.selecionados).toBe(prometido);
    // nem vai "completar" as escondidas o que a contagem deixou de fora
    expect(r.pulados).toBe(0);
    expect(r.criados).toBe(2); // MASSA DOIS e MASSA TRES
    expect(await basesNoCatalogo()).toBe(3); // os 2 novos + o que ja existia
    expect(await grupos.contarACriar({})).toBe(0);
  });

  /* O teto por chamada e o que protege a cota do Google; a tela repete ate acabar. */
  it('o teto por chamada corta o lote e diz quantos sobraram', async () => {
    await tresFaltando();

    const primeiro = await aplicar.criarFaltantes(admin, {}, 2);

    expect(primeiro.selecionados).toBe(2);
    expect(primeiro.criados).toBe(2);
    expect(primeiro.restantes).toBe(1);

    const segundo = await aplicar.criarFaltantes(admin, {}, 2);
    expect(segundo.criados).toBe(1);
    expect(segundo.restantes).toBe(0);
  });

  /*
   * Regra dura do projeto: sem grupo entra A CLASSIFICAR, e NUNCA se deriva
   * regra fiscal do grupo. O lote em massa nao pode ser a porta dos fundos disso.
   */
  it('quem entra sem grupo vira A CLASSIFICAR, e sem fiscal inventado', async () => {
    await tresFaltando();

    await aplicar.criarFaltantes(admin, {}, 100);

    const g = await db.execute(sqlTag`SELECT DISTINCT grupo FROM products`);
    expect(g.rows.map((x) => x.grupo)).toEqual(['A CLASSIFICAR']);
    const f = await db.execute(sqlTag`
      SELECT count(*) FILTER (WHERE cst_pis_cofins IS NOT NULL)::int c FROM product_fiscal`);
    expect(f.rows[0]!.c).toBe(0);
  });

  it('deixa a auditoria de sempre — quem criou e a partir de qual grupo', async () => {
    await tresFaltando();

    await aplicar.criarFaltantes(admin, {}, 100);

    const r = await db.execute(sqlTag`
      SELECT count(*)::int c FROM unif_decisao WHERE acao = 'unificado' AND usuario_nome = 'Jose'`);
    expect(r.rows[0]!.c).toBe(3);
  });

  it('usuario comum nao dispara o lote', async () => {
    await tresFaltando();

    await expect(aplicar.criarFaltantes(comum, {}, 100)).rejects.toMatchObject({ code: 'ONLY_ADMIN_UNIF' });
    expect(await basesNoCatalogo()).toBe(0);
  });
});

/**
 * A unificação não pode ficar pendurada esperando a planilha.
 *
 * Foi o que travou a tela em "0 de 114": cada unificação chamava `syncProduct`
 * direto e esperava sem prazo. Com a planilha de produção levando 20 a 30
 * segundos por gravação, um lote de 100 itens passa de meia hora numa única
 * requisição — o proxy derruba antes, a barra nunca anda, e quem está na tela
 * conclui que não funcionou.
 *
 * O produto já está no banco quando o espelho começa, e a linha já está na
 * outbox. Desistir da espera não perde nada: a fila de reenvio termina.
 */
describe('unificar — planilha lenta não pendura a requisição', () => {
  it('desiste do espelho no prazo e devolve pending, com o produto criado', async () => {
    const grupo = await cenarioCompleto();

    const { UnificacaoAplicarService } = await import('./unificacao.aplicar.service');
    const { ProductRepository } = await import('@/modules/product/product.repository');
    const planilhaQueTrava = {
      async registerPending() {},
      syncProduct: () => new Promise(() => {}), // nunca responde, como hoje
    } as never;
    const servicoLento = new UnificacaoAplicarService(
      new ProductRepository(), planilhaQueTrava, grupos,
    );

    const inicio = Date.now();
    const r = await servicoLento.unificar(
      { id: 'u1', name: 'Jose', role: 'admin' } as never, grupo.id, false,
    );
    const levou = Date.now() - inicio;

    expect(r.modo).toBe('criado');
    expect(r.productId).toBeTruthy();
    expect(r.sheetSync).toBe('pending');
    // o ponto: devolveu em segundos, não em minutos
    expect(levou).toBeLessThan(15000);

    // e o produto está no banco de verdade, com a linha esperando na outbox
    const [produto] = (await db.execute(
      sqlTag`SELECT id FROM products WHERE id = ${r.productId}`,
    )).rows;
    expect(produto).toBeTruthy();
  }, 60_000);
});
