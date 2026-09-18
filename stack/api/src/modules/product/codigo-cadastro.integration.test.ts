import 'reflect-metadata';
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

/**
 * O SQL do `codigo-cadastro.repository` contra Postgres de verdade.
 *
 * Os testes unitários provam a classificação e o relatório; nada neles toca a
 * transação, a propagação BASE→loja, a guarda otimista nem a trava da cunhagem.
 * Essas quatro coisas só existem em SQL — e são exatamente as que, se falharem,
 * falham em silêncio: código sobrescrito sem histórico, número repetido, decisão
 * de uma pessoa apagando a da outra.
 */
let container: StartedPostgreSqlContainer;
let db: typeof import('@/db/databases')['db'];
let sqlTag: typeof import('drizzle-orm')['sql'];
let repo: InstanceType<typeof import('./codigo-cadastro.repository')['CodigoCadastroRepository']>;

/** Espelho falso: registra quem foi enfileirado para a coluna AC. */
const espelho = { enfileirados: [] as string[], falhar: false };

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  process.env.DATABASE_URL = container.getConnectionUri();

  const dbModule = await import('@/db/databases');
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  sqlTag = (await import('drizzle-orm')).sql;
  db = dbModule.db;
  await migrate(dbModule.db, { migrationsFolder: './drizzle' });

  const { CodigoCadastroRepository } = await import('./codigo-cadastro.repository');
  repo = new CodigoCadastroRepository({
    async registerPending(id: string) {
      if (espelho.falhar) throw new Error('Google fora do ar');
      espelho.enfileirados.push(id);
    },
  } as never);
}, 180000);

afterAll(async () => {
  await db.$client.end();
  await container?.stop();
});

const ID = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-7${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;

const criarProduto = async (opts: {
  id: string; nome: string; loja?: string; codigoInterno?: string | null;
  baseProductId?: string | null; status?: string; codigoBarras?: string | null;
}) => {
  await db.execute(sqlTag`
    INSERT INTO products (id, codigo, loja, nome, medida_base, tipo, status, codigo_interno, base_product_id, codigo_barras)
    VALUES (${opts.id}, ${`PR-${opts.id.slice(0, 4)}`}, ${opts.loja ?? 'BASE'}, ${opts.nome}, 'UN', 'revenda',
            ${opts.status ?? 'ativo'}, ${opts.codigoInterno ?? null}, ${opts.baseProductId ?? null}, ${opts.codigoBarras ?? null})
  `);
};

const historico = async (productId?: string) => {
  const r = productId
    ? await db.execute(sqlTag`SELECT * FROM product_codigo_interno_history WHERE product_id = ${productId} ORDER BY alterado_em`)
    : await db.execute(sqlTag`SELECT * FROM product_codigo_interno_history ORDER BY alterado_em`);
  return (r.rows ?? []) as Array<Record<string, string | null>>;
};

const codigoDe = async (id: string) => {
  const r = await db.execute(sqlTag`SELECT codigo_interno FROM products WHERE id = ${id}`);
  return (r.rows?.[0] as { codigo_interno: string | null } | undefined)?.codigo_interno ?? null;
};

const AUTOR = { alteradoPorUserId: null as unknown as string, alteradoPorNome: 'José' };

beforeEach(async () => {
  await db.execute(sqlTag`DELETE FROM product_codigo_interno_history`);
  await db.execute(sqlTag`DELETE FROM products`);
  await db.execute(sqlTag`DELETE FROM sia_produto_depara`);
  espelho.enfileirados = [];
  espelho.falhar = false;
});

describe('listarProdutos', () => {
  it('traz a BASE e os órfãos, e deixa a cópia de loja de fora', async () => {
    await criarProduto({ id: ID(1), nome: 'BASE' });
    await criarProduto({ id: ID(2), nome: 'COPIA LI', loja: 'LI', baseProductId: ID(1) });
    await criarProduto({ id: ID(3), nome: 'ORFAO TNP', loja: 'TNP' });

    const nomes = (await repo.listarProdutos()).map((p) => p.nome).sort();
    expect(nomes).toEqual(['BASE', 'ORFAO TNP']);
  });

  it('deixa de fora o cadastro aposentado por unificação', async () => {
    await criarProduto({ id: ID(1), nome: 'VIVO' });
    await criarProduto({ id: ID(2), nome: 'APOSENTADO', status: 'unificado' });

    expect((await repo.listarProdutos()).map((p) => p.nome)).toEqual(['VIVO']);
  });
});

describe('trocar', () => {
  it('grava o código, o histórico e enfileira o espelho, tudo junto', async () => {
    await criarProduto({ id: ID(1), nome: 'KITKAT', codigoInterno: '00034' });

    const r = await repo.trocar({
      productId: ID(1), loja: 'BASE', codigoAnteriorEsperado: '00034', codigoNovo: '10365',
      fonte: 'SIA LI', ...AUTOR,
    });

    expect(r).toBe('trocado');
    expect(await codigoDe(ID(1))).toBe('10365');
    const h = await historico(ID(1));
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ codigo_anterior: '00034', codigo_novo: '10365', fonte: 'SIA LI' });
    expect(espelho.enfileirados).toEqual([ID(1)]);
  });

  /*
   * A guarda otimista. Se o `WHERE` do código anterior sair do SQL, este teste
   * passa a gravar por cima — que é o defeito que ele existe para pegar.
   */
  it('não troca quando o código mudou embaixo, e não deixa histórico', async () => {
    await criarProduto({ id: ID(1), nome: 'KITKAT', codigoInterno: '99999' });

    const r = await repo.trocar({
      productId: ID(1), loja: 'BASE', codigoAnteriorEsperado: '00034', codigoNovo: '10365',
      fonte: 'SIA LI', ...AUTOR,
    });

    expect(r).toBe('mudou-embaixo');
    expect(await codigoDe(ID(1))).toBe('99999');
    expect(await historico()).toHaveLength(0);
    expect(espelho.enfileirados).toEqual([]);
  });

  it('casa código anterior nulo sem confundir com string vazia', async () => {
    await criarProduto({ id: ID(1), nome: 'SEM CODIGO', codigoInterno: null });

    expect(await repo.trocar({
      productId: ID(1), loja: 'BASE', codigoAnteriorEsperado: null, codigoNovo: '10365', fonte: 'SIA', ...AUTOR,
    })).toBe('trocado');
    expect(await codigoDe(ID(1))).toBe('10365');
  });

  /*
   * O que a revisão cobrou: a cópia perdia o código anterior sem deixar rastro.
   */
  it('propaga para as cópias da loja COM histórico de cada uma', async () => {
    await criarProduto({ id: ID(1), nome: 'KITKAT', codigoInterno: '00034' });
    await criarProduto({ id: ID(2), nome: 'KITKAT', loja: 'LI', baseProductId: ID(1), codigoInterno: '00777' });
    await criarProduto({ id: ID(3), nome: 'KITKAT', loja: 'TNP', baseProductId: ID(1), codigoInterno: null });

    await repo.trocar({
      productId: ID(1), loja: 'BASE', codigoAnteriorEsperado: '00034', codigoNovo: '10365',
      fonte: 'SIA LI', ...AUTOR,
    });

    expect(await codigoDe(ID(2))).toBe('10365');
    expect(await codigoDe(ID(3))).toBe('10365');

    const li = await historico(ID(2));
    expect(li).toHaveLength(1);
    expect(li[0]!.codigo_anterior).toBe('00777');
    expect(li[0]!.loja).toBe('LI');
    expect(li[0]!.fonte).toMatch(/Propagação da BASE/);

    const tnp = await historico(ID(3));
    expect(tnp[0]!.codigo_anterior).toBeNull();

    expect(await historico()).toHaveLength(3);
    expect(espelho.enfileirados.sort()).toEqual([ID(1), ID(2), ID(3)].sort());
  });

  it('não propaga a partir de um produto de loja', async () => {
    await criarProduto({ id: ID(1), nome: 'BASE', codigoInterno: '00034' });
    await criarProduto({ id: ID(2), nome: 'ORFAO', loja: 'LI', codigoInterno: '00777' });

    await repo.trocar({
      productId: ID(2), loja: 'LI', codigoAnteriorEsperado: '00777', codigoNovo: '10365', fonte: 'SIA', ...AUTOR,
    });

    expect(await codigoDe(ID(1))).toBe('00034');
    expect(await historico()).toHaveLength(1);
  });

  /*
   * Enfileirar o espelho é conveniência; trocar o código é o que não pode voltar
   * atrás. Google fora do ar não pode desfazer a gravação.
   */
  it('mantém a troca mesmo quando o espelho falha', async () => {
    await criarProduto({ id: ID(1), nome: 'KITKAT', codigoInterno: '00034' });
    espelho.falhar = true;

    expect(await repo.trocar({
      productId: ID(1), loja: 'BASE', codigoAnteriorEsperado: '00034', codigoNovo: '10365', fonte: 'SIA', ...AUTOR,
    })).toBe('trocado');
    expect(await codigoDe(ID(1))).toBe('10365');
    expect(await historico(ID(1))).toHaveLength(1);
  });
});

describe('cunhar', () => {
  it('cunha a partir do maior entre o teto e o banco', async () => {
    await criarProduto({ id: ID(1), nome: 'SO AQUI', codigoInterno: '00034' });

    const r = await repo.cunhar({
      productId: ID(1), loja: 'BASE', codigoAnteriorEsperado: '00034', fonte: 'cunhado', ...AUTOR,
    }, 13439);

    expect(r).toMatchObject({ resultado: 'trocado', codigo: '13440' });
    expect(await codigoDe(ID(1))).toBe('13440');
  });

  it('continua do banco quando ele já passou do teto', async () => {
    await criarProduto({ id: ID(1), nome: 'A', codigoInterno: '13500' });
    await criarProduto({ id: ID(2), nome: 'B', codigoInterno: '00034' });

    const r = await repo.cunhar({
      productId: ID(2), loja: 'BASE', codigoAnteriorEsperado: '00034', fonte: 'cunhado', ...AUTOR,
    }, 13439);

    expect(r.codigo).toBe('13501');
  });

  /*
   * Duas cunhagens ao mesmo tempo. Sem a trava, as duas leem o mesmo MAX e
   * geram o MESMO número — e a guarda por código anterior não vê nada de errado,
   * porque ela protege a linha, não o número.
   */
  it('duas cunhagens concorrentes não geram o mesmo número', async () => {
    await criarProduto({ id: ID(1), nome: 'A', codigoInterno: '00001' });
    await criarProduto({ id: ID(2), nome: 'B', codigoInterno: '00002' });

    const [a, b] = await Promise.all([
      repo.cunhar({ productId: ID(1), loja: 'BASE', codigoAnteriorEsperado: '00001', fonte: 'cunhado', ...AUTOR }, 13439),
      repo.cunhar({ productId: ID(2), loja: 'BASE', codigoAnteriorEsperado: '00002', fonte: 'cunhado', ...AUTOR }, 13439),
    ]);

    expect(a.resultado).toBe('trocado');
    expect(b.resultado).toBe('trocado');
    expect(a.codigo).not.toBe(b.codigo);
    expect([a.codigo, b.codigo].sort()).toEqual(['13440', '13441']);
  });

  it('não cunha quando o código mudou embaixo', async () => {
    await criarProduto({ id: ID(1), nome: 'A', codigoInterno: '99999' });

    const r = await repo.cunhar({
      productId: ID(1), loja: 'BASE', codigoAnteriorEsperado: '00034', fonte: 'cunhado', ...AUTOR,
    }, 13439);

    expect(r.resultado).toBe('mudou-embaixo');
    expect(await codigoDe(ID(1))).toBe('99999');
    expect(await historico()).toHaveLength(0);
  });
});

describe('tetoSia e listarPares', () => {
  const inserirPar = async (loja: string, coditem: string, chave: string, descricao = 'X') => {
    await db.execute(sqlTag`
      INSERT INTO sia_produto_depara (id, loja, codigo_barras, chave_barras, coditem, descricao)
      VALUES (${`${loja}-${coditem}`}, ${loja}, ${chave.padStart(14, '0')}, ${chave}, ${coditem}, ${descricao})
    `);
  };

  it('lê o de-para de todas as lojas', async () => {
    await inserirPar('LI', '10365', '7891000249239', '5STAR 40G');
    await inserirPar('TNP', '10365', '7891000249239', '5STAR 40G');

    const pares = await repo.listarPares();
    expect(pares.map((p) => p.loja).sort()).toEqual(['LI', 'TNP']);
    expect(pares[0]!.coditem).toBe('10365');
  });

  it('o teto é o maior coditem da rede', async () => {
    await inserirPar('LI', '10365', '111');
    await inserirPar('TNP', '13439', '222');

    expect(await repo.tetoSia()).toBe(13439);
  });

  /*
   * Coditem fora da faixa do PDV é dado sujo — deixar virar teto faria a
   * cunhagem seguinte sair na casa dos trilhões.
   */
  it('ignora coditem fora da faixa do PDV ao calcular o teto', async () => {
    await inserirPar('LI', '10365', '111');
    await inserirPar('TNP', '7891000249239', '222');

    expect(await repo.tetoSia()).toBe(10365);
  });
});
