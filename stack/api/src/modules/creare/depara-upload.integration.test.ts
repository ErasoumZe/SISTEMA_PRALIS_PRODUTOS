import 'reflect-metadata';
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

/**
 * A importação do de-para pela tela, contra Postgres de verdade.
 *
 * O que estes testes guardam não é o "gravou": é a substituição ser completa
 * (a exportação é a verdade daquele momento) e as recusas acontecerem ANTES de
 * qualquer escrita. De-para ambíguo manda o produto errado para o PDV.
 */
let container: StartedPostgreSqlContainer;
let db: typeof import('@/db/databases')['db'];
let sqlTag: typeof import('drizzle-orm')['sql'];
let servico: InstanceType<typeof import('./depara-upload.service')['DeParaUploadService']>;

const FRASE = 'SUBSTITUIR O DE-PARA DESTA LOJA';

/** Um CSV no formato do SIA Supervisor. */
const csv = (linhas: Array<[string, string, string]>) => Buffer.from(
  ['CODITEM;COD_BARRAS;NOME;ATIVO;ALIQ_ECF;CST;CSOSN;NCM;REDUCAO;ALIQ_INTERNA;GRUPO;PESAVEL;TECLA;VALIDADE']
    .concat(linhas.map(([cod, barras, nome]) => `${cod};${barras};${nome};A;3;"040";102;08043000;0;18;MAT. PRIMA;N;0;0`))
    .join('\n'),
  'utf8',
);

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  process.env.DATABASE_URL = container.getConnectionUri();

  const dbModule = await import('@/db/databases');
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  sqlTag = (await import('drizzle-orm')).sql;
  db = dbModule.db;
  await migrate(dbModule.db, { migrationsFolder: './drizzle' });

  const { DeParaUploadService } = await import('./depara-upload.service');
  servico = new DeParaUploadService();
}, 180000);

afterAll(async () => {
  await db.$client.end();
  await container?.stop();
});

const linhasDe = async (loja: string) => {
  const r = await db.execute(sqlTag`SELECT coditem, chave_barras FROM sia_produto_depara WHERE loja = ${loja} ORDER BY coditem`);
  return (r.rows ?? []) as Array<{ coditem: string; chave_barras: string }>;
};

beforeEach(async () => {
  await db.execute(sqlTag`DELETE FROM sia_produto_depara`);
});

describe('previa', () => {
  it('conta o que entraria e o que já existe, sem gravar', async () => {
    await servico.aplicar('LI', csv([['10000', '7891000249239', 'ABACAXI UNID']]), 'a.csv', FRASE);

    const r = await servico.previa('LI', csv([
      ['10000', '7891000249239', 'ABACAXI UNID'],
      ['10001', '7891000249246', 'ACAFRAO KG'],
    ]), 'novo.csv');

    expect(r).toMatchObject({ loja: 'LI', linhas: 2, atuais: 1, arquivo: 'novo.csv' });
    expect(r.faixa).toEqual({ min: 10000, max: 10001 });
    // continua com a linha antiga: prévia não grava
    expect(await linhasDe('LI')).toHaveLength(1);
  });

  /*
   * A exportação traz, no fim, o mesmo produto cadastrado de novo para a
   * entrega, com código `700000 + o do catálogo`. Eles ficam de fora: o Pralis
   * não administra esses cadastros, e mantê-los cria produto disputando código.
   */
  it('deixa a entrega de fora e mostra a faixa só do catálogo', async () => {
    const r = await servico.previa('LI', csv([
      ['10000', '7891000249239', 'ABACAXI UNID'],
      ['13126', '7891000249246', 'IOGURTE ACTIVIA'],
      ['710000', '7891000249253', 'ABACAXI UNID DELIVERY'],
      ['719000', '7891000249260', 'IOGURTE ACTIVIA DELIVERY'],
    ]), 'a.csv');

    expect(r.faixa).toEqual({ min: 10000, max: 13126 });
    expect(r.linhas).toBe(2);
    expect(r.entrega).toBe(2);
  });

  /*
   * Por que o corte é pelo CÓDIGO e não pelo nome: o SIA trunca a descrição em
   * ~50 caracteres, e na exportação de 20/09 a palavra DELIVERY saiu cortada
   * ou sumiu em 216 das 1.208 linhas de entrega.
   */
  it('reconhece a entrega mesmo com o nome truncado pelo SIA', async () => {
    const r = await servico.previa('LI', csv([
      ['10000', '7891000249239', 'ABACAXI UNID'],
      ['710518', '7891000249253', 'IOGURTE ZERO LACTOSE FRUTAS VER ITAMBE 170G DELIVE'],
      ['710519', '7891000249260', 'IOGURTE ZERO LACTOSE FRUTAS VERMELHAS ITAMBE 600G'],
    ]), 'a.csv');

    expect(r.entrega).toBe(2);
    expect(r.linhas).toBe(1);
  });

  it('não tira do catálogo um produto cujo nome só cita entrega', async () => {
    const r = await servico.previa('LI', csv([
      ['10000', '7891000249239', 'CAIXA DELIVERY TERMICA 40L'],
    ]), 'a.csv');
    expect(r.entrega).toBe(0);
    expect(r.linhas).toBe(1);
  });

  it('grava só o catálogo', async () => {
    const r = await servico.aplicar('LI', csv([
      ['10000', '7891000249239', 'ABACAXI UNID'],
      ['710000', '7891000249253', 'ABACAXI UNID DELIVERY'],
    ]), 'a.csv', FRASE);

    expect(r).toMatchObject({ gravadas: 1, entrega: 1 });
    expect((await linhasDe('LI')).map((l) => l.coditem)).toEqual(['10000']);
  });

  /*
   * Colisão ENTRE linhas de entrega não pode travar a gravação de um bloco que
   * nem vai ser gravado.
   */
  it('não recusa por ambiguidade que só existe entre linhas de entrega', async () => {
    const r = await servico.aplicar('LI', csv([
      ['10000', '7891000249239', 'ABACAXI UNID'],
      ['710001', '7899999999999', 'UM DELIVERY'],
      ['710002', '7899999999999', 'OUTRO DELIVERY'],
    ]), 'a.csv', FRASE);

    expect(r.gravadas).toBe(1);
  });

  it('recusa quando o arquivo só tem entrega, dizendo o que falta', async () => {
    await expect(servico.aplicar('LI', csv([
      ['710000', '7891000249253', 'ABACAXI UNID DELIVERY'],
    ]), 'a.csv', FRASE)).rejects.toThrow(/só tem linhas de entrega/i);
  });

  it('mostra a ambiguidade em vez de escondê-la', async () => {
    const r = await servico.previa('LI', csv([
      ['10000', '7891000249239', 'UM'],
      ['10001', '7891000249239', 'OUTRO'],
    ]), 'a.csv');
    expect(r.barrasAmbiguas).toHaveLength(1);
    expect(r.barrasAmbiguas[0]!.coditens).toEqual(['10000', '10001']);
  });
});

describe('aplicar', () => {
  it('recusa espelho sem Pesavel antes de substituir o cadastro existente', async () => {
    await servico.aplicar('LI', csv([['10000', '7891000249239', 'ANTIGO']]), 'atual.csv', FRASE);
    const incompleto = Buffer.from('CODITEM;COD_BARRAS;NOME;ATIVO;ALIQ_ECF;CST;CSOSN;NCM;REDUCAO;ALIQ_INTERNA;GRUPO\n10001;7891000249246;NOVO;A;3;040;102;08043000;0;18;MAT. PRIMA', 'utf8');
    await expect(servico.aplicar('LI', incompleto, 'antigo.csv', FRASE))
      .rejects.toMatchObject({ code: 'CREARE_BALANCA_INCOMPLETA' });
    expect((await linhasDe('LI')).map((l) => l.coditem)).toEqual(['10000']);
  });

  /*
   * A exportação real do SIA traz a coluna TECLA em branco em todas as linhas.
   * Isso recusava o arquivo inteiro (365 "problemas" em 05/10/2026) por um campo
   * que já tem resposta: 000, a tecla confirmada com o consultor.
   */
  it('aceita pesavel sem tecla, grava 000 e conta na previa', async () => {
    const semTecla = Buffer.from(
      ['CODITEM;COD_BARRAS;NOME;ATIVO;ALIQ_ECF;CST;CSOSN;NCM;REDUCAO;ALIQ_INTERNA;GRUPO;PESAVEL;TECLA;VALIDADE',
        '10001;7891000249246;ACAFRAO KG;A;3;"040";102;08043000;0;18;MAT. PRIMA;S;;0',
        '10002;7891000249253;PAO DE QUEIJO KG;A;3;"040";102;08043000;0;18;MAT. PRIMA;S;;3',
        '10003;7891000249260;REFRIGERANTE;A;3;"040";102;08043000;0;18;MAT. PRIMA;N;;'].join('\n'),
      'utf8',
    );
    const previa = await servico.previa('LI', semTecla, 'sem-tecla.csv');
    expect(previa.semDadosBalanca).toBe(0);
    expect(previa.teclaAssumida).toBe(2);

    await servico.aplicar('LI', semTecla, 'sem-tecla.csv', FRASE);
    const balanca = (await db.execute(sqlTag`
      SELECT coditem, pesavel, tecla_balanca, validade_balanca FROM sia_produto_depara
      WHERE loja = 'LI' ORDER BY coditem
    `)).rows as Array<{ coditem: string; pesavel: string | null; tecla_balanca: string | null; validade_balanca: string | null }>;
    expect(balanca.find((l) => l.coditem === '10001')).toMatchObject({ pesavel: 'S', tecla_balanca: '000', validade_balanca: '0' });
    expect(balanca.find((l) => l.coditem === '10002')).toMatchObject({ pesavel: 'S', tecla_balanca: '000', validade_balanca: '3' });
    expect(balanca.find((l) => l.coditem === '10003')).toMatchObject({ pesavel: 'N', tecla_balanca: null });
  });

  it('pesavel sem VALIDADE continua recusado: validade nao tem padrao', async () => {
    const semValidade = Buffer.from(
      ['CODITEM;COD_BARRAS;NOME;ATIVO;ALIQ_ECF;CST;CSOSN;NCM;REDUCAO;ALIQ_INTERNA;GRUPO;PESAVEL;TECLA;VALIDADE',
        '10001;7891000249246;ACAFRAO KG;A;3;"040";102;08043000;0;18;MAT. PRIMA;S;;'].join('\n'),
      'utf8',
    );
    await expect(servico.aplicar('LI', semValidade, 'sem-validade.csv', FRASE))
      .rejects.toMatchObject({ code: 'CREARE_BALANCA_INCOMPLETA' });
  });

  it('grava as linhas da loja', async () => {
    const r = await servico.aplicar('LI', csv([
      ['10000', '7891000249239', 'ABACAXI UNID'],
      ['10001', '7891000249246', 'ACAFRAO KG'],
    ]), 'a.csv', FRASE);

    expect(r).toMatchObject({ loja: 'LI', gravadas: 2, substituidas: 0 });
    expect((await linhasDe('LI')).map((l) => l.coditem)).toEqual(['10000', '10001']);
  });

  /*
   * Substituição, não mesclagem: a exportação é a verdade daquele momento.
   * Mesclar deixaria para trás produto que o SIA apagou, e um de-para com
   * fantasma manda o TXT atualizar um item que não existe mais.
   */
  it('substitui a loja inteira, não mescla', async () => {
    await servico.aplicar('LI', csv([
      ['10000', '7891000249239', 'FICA'],
      ['10001', '7891000249246', 'SOME'],
    ]), 'a.csv', FRASE);

    const r = await servico.aplicar('LI', csv([['10000', '7891000249239', 'FICA']]), 'b.csv', FRASE);

    expect(r).toMatchObject({ gravadas: 1, substituidas: 2 });
    expect((await linhasDe('LI')).map((l) => l.coditem)).toEqual(['10000']);
  });

  it('não encosta no de-para das outras lojas', async () => {
    await servico.aplicar('TNP', csv([['20000', '7891111111111', 'DA TNP']]), 'tnp.csv', FRASE);
    await servico.aplicar('LI', csv([['10000', '7891000249239', 'DA LI']]), 'li.csv', FRASE);

    expect(await linhasDe('TNP')).toHaveLength(1);
    expect(await linhasDe('LI')).toHaveLength(1);
  });

  it('recusa código de barras que aponta para dois produtos, sem gravar nada', async () => {
    await expect(servico.aplicar('LI', csv([
      ['10000', '7891000249239', 'UM'],
      ['10001', '7891000249239', 'OUTRO'],
    ]), 'a.csv', FRASE)).rejects.toThrow(/mais de um produto/i);
    expect(await linhasDe('LI')).toHaveLength(0);
  });

  it('recusa sem apagar o que já estava lá', async () => {
    await servico.aplicar('LI', csv([['10000', '7891000249239', 'BOM']]), 'a.csv', FRASE);

    await expect(servico.aplicar('LI', csv([
      ['10002', '7891999999999', 'UM'],
      ['10003', '7891999999999', 'OUTRO'],
    ]), 'b.csv', FRASE)).rejects.toThrow(/mais de um produto/i);

    expect((await linhasDe('LI')).map((l) => l.coditem)).toEqual(['10000']);
  });

  it('recusa frase de confirmação errada', async () => {
    await expect(
      servico.aplicar('LI', csv([['10000', '7891000249239', 'X']]), 'a.csv', 'pode ir'),
    ).rejects.toThrow(/confirma/i);
    expect(await linhasDe('LI')).toHaveLength(0);
  });

  it('recusa arquivo sem nenhuma linha com código de barras', async () => {
    await expect(
      servico.aplicar('LI', csv([['10000', '', 'SEM BARRAS']]), 'a.csv', FRASE),
    ).rejects.toThrow(/nenhuma linha/i);
  });

  it('recusa arquivo que não é do SIA', async () => {
    await expect(
      servico.aplicar('LI', Buffer.from('nome;preco\nPAO;5,00', 'utf8'), 'errado.csv', FRASE),
    ).rejects.toThrow(/colunas do SIA/i);
  });
});
