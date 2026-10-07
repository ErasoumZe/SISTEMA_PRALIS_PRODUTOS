import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

let container: StartedPostgreSqlContainer;
let servico: import('./metas.service').MetasService;
let db: {
  execute: (query: unknown) => Promise<{ rows: Record<string, unknown>[] }>;
  $client: { end: () => Promise<void> };
};
let sqlTag: typeof import('drizzle-orm')['sql'];

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  process.env.DATABASE_URL = container.getConnectionUri();
  sqlTag = (await import('drizzle-orm')).sql;
  const database = await import('@/db/databases');
  db = database.db as unknown as typeof db;
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  await migrate(database.db, { migrationsFolder: './drizzle' });
  const { MetasService } = await import('./metas.service');
  const { MetasRepository } = await import('./metas.repository');
  const { FatorPontosService } = await import('./fator-pontos.service');
  const { FatorPontosRepository } = await import('./fator-pontos.repository');
  servico = new MetasService(new MetasRepository(), new FatorPontosService(new FatorPontosRepository()));
}, 300_000);

afterAll(async () => {
  await db?.$client.end();
  await container?.stop();
});

/**
 * Jul/2026 da TNP com dois caixas por turno, para a média ter de somar os
 * fechamentos antes de dividir pelos dias. Inclui uma linha de DELIVERY
 * (`natureza = 'canal'`, sem turno) que NÃO pode entrar em meta nenhuma.
 */
async function semearFechamentos() {
  const linhas: string[] = [];
  let id = 0;
  const por = (data: string, operador: string, natureza: string, caixa: string | null, turno: string | null, total: number) => {
    id += 1;
    linhas.push(`(
      'f${id}', 'TNP', '${data}', 'TNP-PC-CXPDV-${caixa ?? '9'}', 'disp-${caixa ?? '9'}', '${operador}', '${natureza}',
      ${caixa === null ? 'NULL' : `'${caixa}'`}, ${turno === null ? 'NULL' : `'${turno}'`},
      '${data} 06:10:00', '${data} 13:40:00', 100, ${total.toFixed(2)}, 'h${id}', '${data} 23:00:00'
    )`);
  };
  // 3 quartas e 3 sábados, com dois caixas em cada turno
  const quartas = ['2026-07-01', '2026-07-08', '2026-07-15'];
  const sabados = ['2026-07-04', '2026-07-11', '2026-07-18'];
  for (const data of quartas) {
    por(data, 'VND CAIXA PDV - 1M', 'posto', '1', 'M', 6_000);
    por(data, 'VND CAIXA PDV - 2M', 'posto', '2', 'M', 4_000);
    por(data, 'VND CAIXA PDV - 1T', 'posto', '1', 'T', 6_000);
    por(data, 'VND CAIXA PDV - 2T', 'posto', '2', 'T', 4_000);
  }
  for (const data of sabados) {
    por(data, 'VND CAIXA PDV - 1M', 'posto', '1', 'M', 5_000);
    por(data, 'VND CAIXA PDV - 1T', 'posto', '1', 'T', 2_000);
  }
  // delivery: tem faturamento, não tem turno, e não pode contaminar a meta
  por('2026-07-01', 'BURPIZ', 'canal', null, null, 9_999);

  await db.execute(sqlTag.raw(`
    INSERT INTO fechamento_caixa_dia
      (id, loja, data, pdv, dispositivo_id_erp, operador, natureza, caixa, turno,
       primeira_venda, ultima_venda, numero_vendas, total_pagamento, hash, origem_atualizada_em)
    VALUES ${linhas.join(',')}
  `));
}

beforeEach(async () => {
  await db.execute(sqlTag`DELETE FROM meta_dia_semana`);
  await db.execute(sqlTag`DELETE FROM meta_versao`);
  await db.execute(sqlTag`DELETE FROM fechamento_caixa_dia`);
  await semearFechamentos();
});

describe('geração da matriz', () => {
  it('monta a matriz dos fechamentos, com 15% e arredondada a R$ 100', async () => {
    const resultado = await servico.gerar({
      loja: 'TNP', referenciaInicio: '2026-07-01', referenciaFim: '2026-07-31',
      crescimento: 0.15, vigenciaInicio: '2026-08-01', previa: false,
    });

    expect(resultado.gravada).toBe(true);
    expect(resultado.versaoId).toBeTruthy();
    // A resposta sai em PONTOS (reais x 0,25), que é a unidade do Relatório Gerentes.
    // quarta: R$ 20.000/dia, metade de manhã -> R$ 23.000 (5.750 pts), R$ 11.500 de manhã
    const quarta = resultado.matriz.find((linha) => linha.diaSemana === 3);
    expect(quarta).toMatchObject({ sigla: 'QUA', ocorrencias: 3, meta: 5_750, metaManha: 2_875, metaTarde: 2_875 });
    // sábado: R$ 7.000/dia, 71,43% de manhã -> R$ 8.000 (2.000 pts), R$ 5.700 de manhã (1.425 pts)
    const sabado = resultado.matriz.find((linha) => linha.diaSemana === 6);
    expect(sabado).toMatchObject({ sigla: 'SÁB', ocorrencias: 3, meta: 2_000, metaManha: 1_425, metaTarde: 575 });
    // só os dias que existem no dado: nada de domingo ou segunda inventados
    expect(resultado.matriz.map((linha) => linha.diaSemana).sort()).toEqual([3, 6]);
  });

  it('o delivery não entra na meta, mesmo tendo faturado', async () => {
    const resultado = await servico.gerar({
      loja: 'TNP', referenciaInicio: '2026-07-01', referenciaFim: '2026-07-31',
      crescimento: 0, vigenciaInicio: '2026-08-01', previa: true,
    });
    // 01/07 é quarta: com delivery a média subiria de R$ 20.000 para R$ 23.333
    const quarta = resultado.matriz.find((linha) => linha.diaSemana === 3);
    expect(quarta!.referenciaMedia).toBe(5_000); // R$ 20.000 em pontos
    expect(quarta!.meta).toBe(5_000); // crescimento zero
  });

  it('prévia calcula e não grava', async () => {
    const resultado = await servico.gerar({
      loja: 'TNP', referenciaInicio: '2026-07-01', referenciaFim: '2026-07-31',
      crescimento: 0.15, vigenciaInicio: '2026-08-01', previa: true,
    });
    expect(resultado.gravada).toBe(false);
    expect(resultado.versaoId).toBeNull();
    const { rows } = await db.execute(sqlTag`SELECT count(*)::int AS total FROM meta_versao`);
    expect(rows[0]!.total).toBe(0);
  });

  it('recusa gerar sem fechamento no período, em vez de criar meta zerada', async () => {
    await expect(servico.gerar({
      loja: 'TNP', referenciaInicio: '2026-01-01', referenciaFim: '2026-01-31',
      crescimento: 0.15, vigenciaInicio: '2026-02-01', previa: false,
    })).rejects.toMatchObject({ code: 'METAS_SEM_REFERENCIA' });
  });

  it('gerar de novo para a mesma vigência corrige a versão, sem criar uma segunda', async () => {
    const pedido = {
      loja: 'TNP' as const, referenciaInicio: '2026-07-01', referenciaFim: '2026-07-31',
      vigenciaInicio: '2026-08-01', previa: false,
    };
    const primeira = await servico.gerar({ ...pedido, crescimento: 0.15 });
    const segunda = await servico.gerar({ ...pedido, crescimento: 0.3 });
    expect(segunda.versaoId).toBe(primeira.versaoId);
    const { rows } = await db.execute(sqlTag`SELECT count(*)::int AS total FROM meta_versao`);
    expect(rows[0]!.total).toBe(1);
    const quarta = segunda.matriz.find((linha) => linha.diaSemana === 3);
    expect(quarta!.meta).toBe(6_500); // R$ 20.000 x 1,3 = R$ 26.000 = 6.500 pts
  });
});

describe('consulta dos cartões', () => {
  beforeEach(async () => {
    await servico.gerar({
      loja: 'TNP', referenciaInicio: '2026-07-01', referenciaFim: '2026-07-31',
      crescimento: 0.15, vigenciaInicio: '2026-07-01', previa: false,
    });
  });

  it('compara o realizado só com os dias apurados, não com o mês inteiro', async () => {
    const metas = await servico.consultar('TNP', { inicio: '2026-07-01', fim: '2026-07-31' });

    // 6 dias apurados (3 quartas + 3 sábados) de 9 dias abertos no mês
    expect(metas.fonte.diasApurados).toBe(6);
    expect(metas.fonte.diasAbertos).toBe(9);
    expect(metas.fonte.ultimoDiaApurado).toBe('2026-07-18');

    // manhã realizada: 3x10.000 + 3x5.000 = R$ 45.000 (11.250 pts)
    // meta até agora:  3x11.500 + 3x5.700 = R$ 51.600 (12.900 pts)
    expect(metas.turnos.manha.realizado).toBe(11_250);
    expect(metas.turnos.manha.metaAteAgora).toBe(12_900);
    expect(metas.turnos.manha.diferenca).toBe(-1_650);
    // ritmo é razão: o fator de pontos se cancela e o número é o mesmo em reais
    expect(metas.turnos.manha.ritmo).toBeCloseTo(45_000 / 51_600, 6);

    // o total é a soma dos dois turnos, sempre
    expect(metas.turnos.total.realizado).toBe(metas.turnos.manha.realizado + metas.turnos.tarde.realizado);
    expect(metas.turnos.total.metaPeriodo).toBe(metas.turnos.manha.metaPeriodo + metas.turnos.tarde.metaPeriodo);
  });

  it('a meta do período conta quantas quartas e sábados o mês tem', async () => {
    const metas = await servico.consultar('TNP', { inicio: '2026-07-01', fim: '2026-07-31' });
    // julho/2026: 5 quartas (1,8,15,22,29) e 4 sábados (4,11,18,25), em pontos
    expect(metas.turnos.total.metaPeriodo).toBe(5 * 5_750 + 4 * 2_000);
  });

  it('dia sem meta aparece como fechado, com zero, e não derruba a conta', async () => {
    const metas = await servico.consultar('TNP', { inicio: '2026-07-05', fim: '2026-07-05' }); // domingo
    expect(metas.dias).toHaveLength(1);
    expect(metas.dias[0]).toMatchObject({ aberto: false, meta: 0 });
    expect(metas.turnos.total.metaPeriodo).toBe(0);
    expect(metas.turnos.total.ritmo).toBeNull();
  });

  it('sem matriz gravada a tela recebe versao nula, em vez de erro', async () => {
    await db.execute(sqlTag`DELETE FROM meta_versao`);
    const metas = await servico.consultar('TNP', { inicio: '2026-07-01', fim: '2026-07-31' });
    expect(metas.versao).toBeNull();
    expect(metas.matriz).toEqual([]);
    expect(metas.turnos.total.metaPeriodo).toBe(0);
  });

  it('usa a matriz vigente no início do período, não uma que começou no meio', async () => {
    await servico.gerar({
      loja: 'TNP', referenciaInicio: '2026-07-01', referenciaFim: '2026-07-31',
      crescimento: 1, vigenciaInicio: '2026-07-20', previa: false,
    });
    const metas = await servico.consultar('TNP', { inicio: '2026-07-01', fim: '2026-07-31' });
    expect(metas.versao!.vigenciaInicio).toBe('2026-07-01');
    expect(metas.versao!.crescimento).toBeCloseTo(0.15, 4);
  });

  it('só manda reais para quem pode ver dinheiro', async () => {
    const semDinheiro = await servico.consultar('TNP', { inicio: '2026-07-01', fim: '2026-07-31' });
    expect(semDinheiro.turnos.manha.reais).toBeNull();

    const comDinheiro = await servico.consultar('TNP', { inicio: '2026-07-01', fim: '2026-07-31' }, true);
    expect(comDinheiro.turnos.manha.reais).toMatchObject({ realizado: 45_000, metaAteAgora: 51_600 });
    // e os pontos continuam os mesmos nos dois casos
    expect(comDinheiro.turnos.manha.realizado).toBe(semDinheiro.turnos.manha.realizado);
  });

  it('recusa período maior que o teto', async () => {
    await expect(servico.consultar('TNP', { inicio: '2024-01-01', fim: '2026-12-31' }))
      .rejects.toMatchObject({ code: 'PERIOD_TOO_LARGE' });
  });
});
