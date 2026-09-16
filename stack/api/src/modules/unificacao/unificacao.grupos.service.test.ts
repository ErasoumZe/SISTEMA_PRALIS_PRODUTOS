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
  /** O teto por chamada também é contrato: cada criação escreve na planilha. */
  const limites: number[] = [];
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
      limit: (n: number) => { limites.push(n); return eu; },
      offset: segue,
      groupBy: segue,
      where: (w: SQL | undefined) => { wheres.push(w); return eu; },
      then: (ok: (v: unknown) => unknown, falha: (e: unknown) => unknown) =>
        Promise.resolve(linhas).then(ok, falha),
    });
    return eu;
  };

  return { wheres, limites, respostas, db: { select: () => cadeia() } };
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
  espiao.limites.length = 0;
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
  it('a prova da venda é a fonte dinâmica dos PDVs nos últimos 12 meses', () => {
    expect(FONTE_VENDIDOS).toBe('vendas_pdv_12m');
  });
});

/**
 * A ação em massa "criar todos os que faltam".
 *
 * O que se tranca aqui é o CONTRATO da confirmação, e ele é de SQL: a tela
 * mostra um número e depois manda criar. Se a contagem e a seleção não saíssem
 * da mesma peneira, o botão criaria coisa que ninguém contou — e ninguém
 * descobriria olhando a tela.
 */
describe('Central de produtos — "criar todos os que faltam"', () => {
  const respostaDaContagem = () => espiao.respostas.push([{ total: 0 }]);
  const respostaDosIds = () => espiao.respostas.push([]);

  it('a contagem e a seleção saem da MESMA peneira', async () => {
    respostaDaContagem();
    respostaDosIds();
    const filtros = { somenteVendidos: true, loja: 'TNP' as const, semGrupo: true };

    await servico.contarACriar(filtros);
    await servico.idsACriar(filtros, 50);

    expect(espiao.wheres).toHaveLength(2);
    const [contagem, selecao] = espiao.wheres.map((w) => render(w));
    expect(selecao, 'o botão criaria o que a contagem não prometeu').toEqual(contagem);
  });

  /* O botão promete agir sobre o que está À VISTA — os filtros da tela mandam. */
  it('carrega os filtros da listagem, não uma peneira própria', async () => {
    const filtros = { somenteVendidos: true, loja: 'TNP' as const, q: 'ARROZ' };
    respostaDaContagem();

    await servico.contarACriar(filtros);

    const daTela = render(and(...condicoesDeGrupos(filtros))).params;
    const doLote = render(espiao.wheres[0]).params;
    for (const p of daTela) {
      expect(doLote, `o lote ignorou o filtro ${String(p)} que está ligado na tela`).toContain(p);
    }
  });

  /*
   * As duas condições que fazem a ação ser idempotente e honesta: o que já está
   * no Pralis não FALTA, e o que já foi decidido não pode voltar para a fila —
   * é isso que impede o segundo clique de cadastrar tudo de novo.
   */
  it('só o que ainda não está no Pralis, e só o que ninguém decidiu', async () => {
    respostaDaContagem();

    await servico.contarACriar();

    const q = render(espiao.wheres[0]);
    expect(q.sql, 'ia recriar o que já está no catálogo').toContain('flag_ja_no_pralis');
    expect(q.sql, 'ia reprocessar grupo já decidido — o segundo clique duplicaria')
      .toContain('IS NULL');
  });

  /* Grupo sem nome em fonte nenhuma trava em UNIF_SEM_NOME e ficaria preso na fila. */
  it('não seleciona grupo sem nome', async () => {
    respostaDaContagem();

    await servico.contarACriar();

    expect(render(espiao.wheres[0]).sql).toContain('length(trim(');
  });

  /* Cada criação escreve na planilha: o teto por chamada é o que segura a cota. */
  it('a seleção tem teto por chamada, mesmo pedindo mais', async () => {
    respostaDosIds();

    await servico.idsACriar({}, 9999);

    expect(espiao.limites).toEqual([200]);
  });
});

/**
 * "Correspondência exata" na Central.
 *
 * O José definiu o caso direto com DOIS códigos, não um: "o que existir de
 * produto igual, mesmo codigo de barras OU codigo interno, devem poder ser
 * unificados diretamente". Um filtro preso em `mesmo_cod_barras` esconde o
 * produto que casa só pelo código interno — e ele cai na aba de análise, que é
 * justamente a fila que esta reforma existe para esvaziar.
 *
 * O teste é de SQL porque é ali que a peneira mora: a tela não filtra nada.
 */
describe('Central de produtos — correspondência exata', () => {
  const MOTIVOS_EXATOS = ['mesmo_cod_barras', 'mesmo_cod_interno'];

  it('cobre o casamento por código de barras E por código interno', () => {
    const q = render(and(...condicoesDeGrupos({ filtro: 'exatos' })));

    for (const motivo of MOTIVOS_EXATOS) {
      expect(q.params, `"exatos" deixou ${motivo} fora da correspondência direta`)
        .toContain(motivo);
    }
  });

  /* Continuar podendo olhar um motivo isolado é o que permite auditar o outro. */
  it('não atropela quem pede um motivo específico', () => {
    const q = render(and(...condicoesDeGrupos({ filtro: 'mesmo_cod_interno' })));

    expect(q.params).toContain('mesmo_cod_interno');
    expect(q.params).not.toContain('mesmo_cod_barras');
  });

  it('o recorte dos vendidos continua valendo por cima', () => {
    const q = render(and(...condicoesDeGrupos({ filtro: 'exatos', somenteVendidos: true })));

    expect(q.params).toContain(FONTE_VENDIDOS);
    expect(q.params).toContain('mesmo_cod_interno');
  });
});
