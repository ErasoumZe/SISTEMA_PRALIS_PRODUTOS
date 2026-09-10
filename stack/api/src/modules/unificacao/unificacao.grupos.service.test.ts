import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { and, type SQL } from 'drizzle-orm';

/**
 * O recorte "só os que já vendi" na Central de produtos.
 *
 * O defeito que este teste tranca não é a lista — é o CABEÇALHO. "Produtos
 * únicos" saía de `totais()`, que ignorava qualquer filtro: com o recorte
 * ligado, a tela mostraria as ~1.6k linhas vendidas embaixo de um total de
 * 7.924, e o José não teria como saber qual dos dois números é o dele.
 *
 * Por isso o teste olha as duas portas (lista e totais) e cobra a MESMA
 * peneira nas duas. Nada de banco: o que interessa é o SQL que o serviço monta,
 * e ele pode ser renderizado sem conexão nenhuma.
 */
const espiao = vi.hoisted(() => {
  const wheres: Array<SQL | undefined> = [];
  const respostas: unknown[][] = [];

  /** Cadeia do drizzle o bastante para o serviço rodar: encadeia e entrega linhas. */
  const cadeia = () => {
    const linhas = respostas.shift() ?? [];
    const eu: Record<string, unknown> = {};
    const segue = () => eu;
    Object.assign(eu, {
      from: segue,
      leftJoin: segue,
      orderBy: segue,
      limit: segue,
      offset: segue,
      groupBy: segue,
      where: (w: SQL | undefined) => { wheres.push(w); return eu; },
      then: (ok: (v: unknown) => unknown, falha: (e: unknown) => unknown) =>
        Promise.resolve(linhas).then(ok, falha),
    });
    return eu;
  };

  return { wheres, respostas, db: { select: () => cadeia() } };
});

vi.mock('@/db/databases', () => ({ db: espiao.db }));

const { UnificacaoGruposService, condicoesDeGrupos, FONTE_VENDIDOS } =
  await import('./unificacao.grupos.service');

const dialeto = new PgDialect();
const render = (w: SQL | undefined) => dialeto.sqlToQuery(w!);
const servico = new UnificacaoGruposService();

/** Linhas cruas que cada consulta do serviço espera de volta. */
const respostaDaLista = () => espiao.respostas.push([{ total: 0 }], []);
const respostaDosTotais = () => espiao.respostas.push([{ grupos: 0 }], []);

beforeEach(() => {
  espiao.wheres.length = 0;
  espiao.respostas.length = 0;
});

describe('Central de produtos — recorte "só os que já vendi"', () => {
  it('a LISTA cobra a fonte dos vendidos, na contagem e na página', async () => {
    respostaDaLista();

    await servico.listar({ somenteVendidos: true });

    // as duas consultas da listagem: o total da paginação e a página em si
    expect(espiao.wheres).toHaveLength(2);
    for (const w of espiao.wheres) {
      expect(w, 'a lista foi montada sem peneira nenhuma').toBeDefined();
      const q = render(w);
      expect(q.sql).toContain('@> ARRAY[');
      expect(q.params).toContain(FONTE_VENDIDOS);
    }
  });

  /* O caso que motivou tudo: o cabeçalho contava a base inteira. */
  it('os TOTAIS do cabeçalho caem no mesmo recorte da lista', async () => {
    respostaDosTotais();

    await servico.totais({ somenteVendidos: true });

    expect(espiao.wheres, 'o cabeçalho contou a base inteira').toHaveLength(2);
    for (const w of espiao.wheres) {
      expect(w, 'o cabeçalho contou a base inteira').toBeDefined();
      expect(render(w).params).toContain(FONTE_VENDIDOS);
    }
  });

  it('desligado, o cabeçalho volta a contar a base inteira', async () => {
    respostaDosTotais();

    await servico.totais();

    expect(espiao.wheres.every((w) => w === undefined)).toBe(true);
  });

  it('desligado, a lista não esconde nada', async () => {
    respostaDaLista();

    await servico.listar({});

    expect(espiao.wheres.every((w) => w === undefined)).toBe(true);
  });

  it('o recorte se soma aos outros filtros, não os substitui', () => {
    const q = render(and(...condicoesDeGrupos({
      loja: 'TNP', somenteVendidos: true, decisao: 'pendente',
    })));

    expect(q.params).toContain('TNP');
    expect(q.params).toContain(FONTE_VENDIDOS);
    expect(q.sql).toContain('IS NULL');
  });

  /*
   * A fonte é a prova da venda: ela já chega peneirada (preço-sentinela fora,
   * delivery fundido). Se alguém trocar o nome dela, é aqui que estoura — e não
   * numa tela mostrando produto que nunca vendeu.
   */
  it('a prova da venda é a fonte vendidos_tnp', () => {
    expect(FONTE_VENDIDOS).toBe('vendidos_tnp');
  });
});
