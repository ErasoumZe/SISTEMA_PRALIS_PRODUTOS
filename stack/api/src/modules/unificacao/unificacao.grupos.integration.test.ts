import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { UnificacaoGruposService } from './unificacao.grupos.service';
import type { UnificacaoService } from './unificacao.service';
import type { CurrentUser } from '@/types/fastify-jwt';

/**
 * ATENÇÃO: nada de importar `@/db/databases` estaticamente — ver nota nos
 * outros testes de integração.
 *
 * Carrega as fontes REAIS uma vez e agrupa. O gate da fatia é este: cada filtro
 * tem que devolver contagem coerente sobre os ~4.300, não sobre os 147 do
 * catálogo vivo.
 */
let container: StartedPostgreSqlContainer;
let staging: UnificacaoService;
let grupos: UnificacaoGruposService;
let db: {
  execute: (query: unknown) => Promise<{ rows: Record<string, unknown>[] }>;
  $client: { end: () => Promise<void> };
};
let sqlTag: typeof import('drizzle-orm')['sql'];
const admin: CurrentUser = { id: 'u1', name: 'Jose', email: 'a@a', loja: null, role: 'admin' };

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:18.1-alpine').start();
  process.env.DATABASE_URL = container.getConnectionUri();
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  sqlTag = (await import('drizzle-orm')).sql;
  const dbModule = await import('@/db/databases');
  db = dbModule.db as unknown as typeof db;
  await migrate(dbModule.db, { migrationsFolder: './drizzle' });
  await db.execute(sqlTag`
    INSERT INTO venda_produto_dia
      (id, loja, data, produto_codigo, produto, produto_id_erp, quantidade,
       valor_unitario, total, hash, origem_atualizada_em)
    VALUES
      ('venda-central-12m', 'TNP', CURRENT_DATE, '10000', 'ABACAXI UNID',
       'erp-abacaxi', 1, 1, 1, 'hash-central-12m', now())
  `);

  const { UnificacaoService } = await import('./unificacao.service');
  const { UnificacaoGruposService } = await import('./unificacao.grupos.service');
  const { ProductRepository } = await import('@/modules/product/product.repository');
  staging = new UnificacaoService(new ProductRepository());
  grupos = new UnificacaoGruposService();

  await staging.carregar();
  await grupos.recalcular();
}, 300_000);

afterAll(async () => {
  await db.$client.end();
  await container.stop();
});

describe('agrupamento sobre as fontes reais', () => {
  it('produz a ordem de grandeza do catalogo unico, nao dos 147 do Pralis', async () => {
    const t = await grupos.totais();

    /*
     * Eram ~4.322 com quatro fontes. Com a planilha nova (1.187) e os vendidos
     * da TNP (1.677) sao ~4.906: a maioria casa com o que ja existia, e o que
     * nao casa vira grupo proprio — que e justamente o confronto aparecendo.
     * A margem continua larga porque o numero se mexe quando as fontes mudam;
     * o que o teste protege e a ORDEM DE GRANDEZA, nao o valor exato.
     */
    expect(t.grupos).toBeGreaterThan(4000);
    expect(t.grupos).toBeLessThan(5500);
  });

  it('une o mesmo produto de LI e TNP num grupo so', async () => {
    const r = await grupos.listar({ q: 'ABACAXI UNID' });
    const abacaxi = r.grupos.find((g) => g.chave === '10000')!;

    expect(abacaxi).toBeDefined();
    /*
     * BASE entrou porque a planilha nova tambem tem ABACAXI, e ela e o catalogo
     * base no modelo novo — a aba (TNP/LI) substituiu a (BASE). Ver a fonte
     * nova no mesmo grupo do SIA e do Compilart e o confronto funcionando.
     */
    expect(abacaxi.lojas.sort()).toEqual(['BASE', 'LI', 'TNP']);
    expect(abacaxi.fontes).toContain('planilha_nova');
    expect(abacaxi.fontes).toContain('sia_li');
    expect(abacaxi.fontes).toContain('compilart_tnp');
    expect(abacaxi.motivo).toBe('mesmo_cod_barras');
  });

  it('o grupo do produto de LI herda o grupo do SIA', async () => {
    const r = await grupos.listar({ q: 'ABACAXI UNID' });
    const abacaxi = r.grupos.find((g) => g.chave === '10000')!;

    expect(abacaxi.grupo).toBeTruthy();
    expect((abacaxi.candidato as { grupoDe: string }).grupoDe).toBe('sia_li');
  });
});

describe('os filtros funcionam sobre a base inteira', () => {
  const naoVazio = async (filtro: Parameters<UnificacaoGruposService['listar']>[0], rotulo: string) => {
    const r = await grupos.listar({ ...filtro, tamanho: 5 });
    expect(r.total, `filtro ${rotulo} veio zerado`).toBeGreaterThan(0);
    return r;
  };

  it('filtra por motivo, e cada motivo tem gente', async () => {
    const barras = await naoVazio({ filtro: 'mesmo_cod_barras' }, 'mesmo_cod_barras');
    const nome = await naoVazio({ filtro: 'nome_parecido' }, 'nome_parecido');
    const unico = await naoVazio({ filtro: 'unico' }, 'unico');

    expect(barras.grupos.every((g) => g.motivo === 'mesmo_cod_barras')).toBe(true);
    expect(nome.grupos.every((g) => g.motivo === 'nome_parecido')).toBe(true);
    expect(unico.grupos.every((g) => g.motivo === 'unico')).toBe(true);
  });

  it('filtra por loja', async () => {
    const li = await naoVazio({ loja: 'LI' }, 'loja=LI');
    const tnp = await naoVazio({ loja: 'TNP' }, 'loja=TNP');

    expect(li.grupos.every((g) => g.lojas.includes('LI'))).toBe(true);
    expect(tnp.grupos.every((g) => g.lojas.includes('TNP'))).toBe(true);
  });

  it('filtra por status', async () => {
    const ativos = await naoVazio({ status: 'ativo' }, 'status=ativo');
    const inativos = await naoVazio({ status: 'inativo' }, 'status=inativo');

    expect(ativos.grupos.every((g) => g.ativo)).toBe(true);
    expect(inativos.grupos.every((g) => !g.ativo)).toBe(true);
  });

  it('filtra o buraco fiscal da TNP — e ele e grande', async () => {
    const r = await naoVazio({ semFiscalTnp: true }, 'semFiscalTnp');

    expect(r.total).toBeGreaterThan(2000); // medido: ~3.400 sem fiscal
    expect(r.grupos.every((g) => g.flagSemFiscalTnp)).toBe(true);
  });

  it('filtra os que ficariam A CLASSIFICAR', async () => {
    const r = await naoVazio({ semGrupo: true }, 'semGrupo');

    expect(r.grupos.every((g) => g.flagSemGrupo)).toBe(true);
  });

  it('filtra so os que pedem olho humano', async () => {
    const r = await naoVazio({ revisar: true }, 'revisar');

    expect(r.grupos.every((g) =>
      g.flagNomesDivergentes || g.flagSemFiscalTnp || g.flagSemGrupo || g.flagBarrasConflitante)).toBe(true);
  });

  /*
   * O recorte que o Jose pediu na Central: ver so o que ja vendeu. A fonte
   * `vendas_pdv_12m` ja chega agrupada por identidade do ERP no periodo,
   * entao estar nela E a prova da venda — nao se reconta venda aqui.
   */
  it('filtra so o que ja vendeu ao menos uma vez', async () => {
    const todos = await grupos.totais();
    const r = await naoVazio({ somenteVendidos: true }, 'somenteVendidos');

    expect(r.grupos.every((g) => g.fontes.includes('vendas_pdv_12m'))).toBe(true);
    // A venda semeada acima prova o recorte dinâmico sem depender de um CSV
    // congelado ou da data em que a suíte for executada.
    expect(r.total).toBe(1);
    expect(r.total).toBeLessThan(todos.grupos);
  });

  /* O KPI "Produtos unicos" tem de contar EXATAMENTE a lista que aparece embaixo dele. */
  it('o cabecalho conta o mesmo recorte da lista', async () => {
    const lista = await grupos.listar({ somenteVendidos: true, tamanho: 5 });
    const cabecalho = await grupos.totais({ somenteVendidos: true });

    expect(cabecalho.grupos).toBe(lista.total);
    expect(cabecalho.grupos).toBeLessThan((await grupos.totais()).grupos);
  });

  it('busca por texto acha pelo nome', async () => {
    const r = await naoVazio({ q: 'ACUCAR' }, 'q=ACUCAR');

    expect(r.grupos.some((g) => g.nomeNormalizado.includes('ACUCAR'))).toBe(true);
  });

  it('tudo pendente antes de alguem decidir', async () => {
    const pendentes = await naoVazio({ decisao: 'pendente' }, 'decisao=pendente');
    const feitas = await grupos.listar({ decisao: 'feita' });

    expect(feitas.total).toBe(0);
    expect(pendentes.total).toBe((await grupos.totais()).grupos);
  });

  it('combina filtros sem se perder', async () => {
    const r = await grupos.listar({ loja: 'TNP', status: 'ativo', semFiscalTnp: true, tamanho: 5 });

    expect(r.total).toBeGreaterThan(0);
    expect(r.grupos.every((g) => g.lojas.includes('TNP') && g.ativo && g.flagSemFiscalTnp)).toBe(true);
  });
});

describe('paginacao no servidor', () => {
  it('nao devolve a base inteira e as paginas nao se repetem', async () => {
    const p1 = await grupos.listar({ pagina: 1, tamanho: 10 });
    const p2 = await grupos.listar({ pagina: 2, tamanho: 10 });

    expect(p1.grupos).toHaveLength(10);
    expect(p1.total).toBe(p2.total);
    expect(p1.paginas).toBeGreaterThan(100);
    expect(p1.grupos.map((g) => g.id)).not.toEqual(p2.grupos.map((g) => g.id));
  });

  it('cada grupo vem com as linhas de origem lado a lado', async () => {
    const r = await grupos.listar({ q: 'ABACAXI UNID' });
    const abacaxi = r.grupos.find((g) => g.chave === '10000')!;

    expect(abacaxi.itens.length).toBeGreaterThanOrEqual(2);
    expect(abacaxi.itens.map((i) => i.fonte)).toContain('sia_li');
  });
});

describe('recalcular', () => {
  it('preserva o grupo definido manualmente na Central', async () => {
    const antes = await grupos.listar({ semGrupo: true, tamanho: 50 });
    const escolhido = antes.grupos.find((g) => g.nome.trim() !== '')!;

    await grupos.definirGrupo(admin, escolhido.id, 'MER TESTE OFICIAL');
    let alterado = (await grupos.listar({ q: escolhido.chave, tamanho: 50 })).grupos
      .find((g) => g.chave === escolhido.chave)!;
    expect(alterado.grupo).toBe('MER TESTE OFICIAL');
    expect(alterado.flagSemGrupo).toBe(false);

    await grupos.recalcular();
    alterado = (await grupos.listar({ q: escolhido.chave, tamanho: 50 })).grupos
      .find((g) => g.chave === escolhido.chave)!;
    expect(alterado.grupoManual).toBe('MER TESTE OFICIAL');
    expect((alterado.candidato as { grupoDe: string }).grupoDe).toBe('central_manual');
  });

  it('lote automatico contem apenas casamento forte sem alertas de identidade ou grupo', async () => {
    const ids = await grupos.idsAutomaticos(10);
    expect(ids).toHaveLength(10);
    const r = await db.execute(sqlTag`
      SELECT motivo, flag_nomes_divergentes, flag_barras_conflitante, flag_sem_grupo
      FROM unif_grupo WHERE id IN (${sqlTag.join(ids.map((id) => sqlTag`${id}`), sqlTag`, `)})`);
    expect(r.rows.every((g) => g.motivo === 'mesmo_cod_barras'
      && !g.flag_nomes_divergentes && !g.flag_barras_conflitante && !g.flag_sem_grupo)).toBe(true);
  });

  /*
   * A contagem alimenta o rotulo do botao "Unificar todos por codigo de barras".
   * Se ela e a selecao divergissem, a tela prometeria um numero e o botao faria
   * outro — por isso as duas saem da MESMA condicao, e este teste e quem
   * garante que continuam saindo.
   */
  it('a contagem do lote e a mesma condicao da selecao', async () => {
    const total = await grupos.contarAutomaticos();
    const direto = await db.execute(sqlTag`
      SELECT count(*)::int c FROM unif_grupo
      WHERE motivo = 'mesmo_cod_barras'
        AND NOT flag_nomes_divergentes AND NOT flag_barras_conflitante AND NOT flag_sem_grupo
        AND decisao IS NULL AND length(trim(nome)) > 0`);

    expect(total).toBe(direto.rows[0].c);
    expect(total).toBeGreaterThan(0);
  });

  /* A tela repete a chamada ate acabar; o teto por chamada e o que protege a cota. */
  it('a selecao respeita o teto por chamada, mesmo pedindo mais', async () => {
    expect(await grupos.idsAutomaticos(5)).toHaveLength(5);
    expect(await grupos.idsAutomaticos(9999)).toHaveLength(200);
  });

  it('grupo com alerta de identidade fica FORA da contagem', async () => {
    const antes = await grupos.contarAutomaticos();

    // um item que estava no lote passa a ter nome divergente
    const [alvo] = await grupos.idsAutomaticos(1);
    await db.execute(sqlTag`UPDATE unif_grupo SET flag_nomes_divergentes = true WHERE id = ${alvo}`);

    expect(await grupos.contarAutomaticos()).toBe(antes - 1);
    expect(await grupos.idsAutomaticos(200)).not.toContain(alvo);

    await db.execute(sqlTag`UPDATE unif_grupo SET flag_nomes_divergentes = false WHERE id = ${alvo}`);
  });

  it('grupo ja decidido sai da contagem — o botao nao reprocessa o que ja passou', async () => {
    const antes = await grupos.contarAutomaticos();
    const [alvo] = await grupos.idsAutomaticos(1);

    await db.execute(sqlTag`
      UPDATE unif_grupo SET decisao = 'unificado', decidido_por = 'Jose', decidido_em = now()
      WHERE id = ${alvo}`);

    expect(await grupos.contarAutomaticos()).toBe(antes - 1);

    await db.execute(sqlTag`
      UPDATE unif_grupo SET decisao = NULL, decidido_por = NULL, decidido_em = NULL
      WHERE id = ${alvo}`);
  });

  it('nao cria grupo para linha fiscal orfa sem nome', async () => {
    const r = await db.execute(sqlTag`
      SELECT count(*)::int c FROM unif_grupo
      WHERE trim(nome) = '' AND fontes = ARRAY['fiscal_tnp']::text[]`);
    expect(r.rows[0]!.c).toBe(0);
  });

  it('NAO apaga decisao ja tomada — casa pela chave', async () => {
    await db.execute(sqlTag`
      UPDATE unif_grupo SET decisao = 'unificado', decidido_por = 'Jose', decidido_em = now()
      WHERE chave = '10000'`);

    await grupos.recalcular();

    const r = await db.execute(sqlTag`SELECT decisao, decidido_por FROM unif_grupo WHERE chave = '10000'`);
    expect(r.rows[0]).toMatchObject({ decisao: 'unificado', decidido_por: 'Jose' });

    await db.execute(sqlTag`UPDATE unif_grupo SET decisao = NULL, decidido_por = NULL WHERE chave = '10000'`);
  });

  it('recalcular duas vezes da o mesmo numero de grupos', async () => {
    const a = await grupos.recalcular();
    const b = await grupos.recalcular();

    expect(b.grupos).toBe(a.grupos);
  });

  it('NAO encosta na tabela products', async () => {
    const antes = await db.execute(sqlTag`SELECT count(*)::int c FROM products`);
    await grupos.recalcular();
    const depois = await db.execute(sqlTag`SELECT count(*)::int c FROM products`);

    expect(depois.rows[0]).toEqual(antes.rows[0]);
  });
});
