import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { CreareService } from './creare.service';

/**
 * ATENÇÃO: nada aqui pode importar `@/db/databases` nem `@/config/env` de forma
 * ESTÁTICA. O primeiro abre conexão no load — antes do `beforeAll` apontar para
 * o container. O segundo congela as variáveis de ambiente, e este teste precisa
 * ligar a exportação ANTES de o módulo ser lido.
 */
let container: StartedPostgreSqlContainer;
let service: CreareService;
let db: {
  execute: (query: unknown) => Promise<{ rows: Record<string, unknown>[] }>;
  $client: { end: () => Promise<void> };
};
let sqlTag: typeof import('drizzle-orm')['sql'];

const CONFIG_LI = {
  LI: {
    // mantido de propósito apontando para valores ERRADOS: com casamento no SIA
    // nenhum dos dois pode ser usado, e o teste prova isso
    groupCodes: { MERCEARIA: '9999' },
    ecfTaxCodesByGroup: { MERCEARIA: '99' },
    // padroes para as chaves que ZERO nao satisfaz no SIA (ver generator)
    ecfTaxCodePadrao: '03',
    pisCofinsCstPadrao: '99',
    categoryCodes: { '3': '000000003' },
    units: { UN: 'UN', KG: 'KG', G: 'UN', LT: 'LT', ML: 'UN' },
    decimalPlaces: {
      unitPrice: 2, icmsReduction: 2, fullTaxRate: 2, fcpRate: 2,
      pisRate: 4, cofinsRate: 4, maximumQuantity: 3, minimumQuantity: 3,
    },
    barcodeField: 'extended', // formato homologado pelo SIA: codigo no campo longo
    lineEnding: 'LF',
    noPromotionDate: '30/12/99',
    iat: 'A',
    ipptByProductType: { revenda: 'T', transformacao: 'P' },
    weighableByMeasure: { UN: 'N', KG: 'S', G: 'N', LT: 'N', ML: 'N' },
    stockControlledByProductType: { revenda: 'S', transformacao: 'S' },
  },
};

let produto: (id: string, nome: string, barras: string | null, codigoInterno?: string | null) => Promise<void>;
let siaLinha: (coditem: string, barras: string, ecf: string, grupo?: string) => Promise<void>;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:18.1-alpine').start();
  process.env.DATABASE_URL = container.getConnectionUri();
  process.env.CREARE_EXPORT_ENABLED = 'true';
  process.env.CREARE_STORE_CONFIG_JSON = JSON.stringify({
    ...CONFIG_LI,
    TNP: { ...CONFIG_LI.LI, barcodeField: 'automatic' },
  });

  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  sqlTag = (await import('drizzle-orm')).sql;
  const dbModule = await import('@/db/databases');
  db = dbModule.db as unknown as typeof db;
  await migrate(dbModule.db, { migrationsFolder: './drizzle' });

  produto = async (id, nome, barras, codigoInterno = null) => {
    await db.execute(sqlTag`
      INSERT INTO products (id, loja, codigo, nome, medida_base, tipo, status, quantidade, qt_cad,
                            habilitar_ajuda, auto, codigo_barras, codigo_interno, custo, v_venda_pontual)
      VALUES (${id}, 'LI', ${'PR-' + id}, ${nome}, 'UN', 'revenda', 'ativo', 1, 1,
              false, false, ${barras}, ${codigoInterno}, 1.00, 9.90)`);
    await db.execute(sqlTag`
      INSERT INTO product_fiscal (product_id, ncm, categoria, cst_pis_cofins)
      VALUES (${id}, '19059090', '3', '99')`);
  };

  siaLinha = async (coditem, barras, ecf, grupo = '0042') => {
    const chave = barras.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    await db.execute(sqlTag`
      INSERT INTO sia_produto_depara (id, loja, codigo_barras, chave_barras, coditem, descricao,
                                      cod_grupo, aliq_saida_ecf, cst_saida, csosn, ncm, ativo,
                                      pesavel, tecla_balanca, validade_balanca)
      VALUES (${'s-' + coditem}, 'LI', ${barras}, ${chave}, ${coditem}, 'DO SIA',
              ${grupo}, ${ecf}, '000', '101', '22030000', 'S', 'N', '0', '0')`);
  };

  const { CreareService } = await import('./creare.service');
  const { ProductRepository } = await import('@/modules/product/product.repository');
  const { CreareDeParaRepository } = await import('./creare.depara.repository');
  const { CreareExportRepository } = await import('./creare-export.repository');
  service = new CreareService(new ProductRepository(), new CreareDeParaRepository(), new CreareExportRepository());
});

afterAll(async () => {
  await db.$client.end();
  await container.stop();
});

beforeEach(async () => {
  await db.execute(sqlTag`DELETE FROM creare_export_batch`);
  await db.execute(sqlTag`DELETE FROM creare_export_state`);
  await db.execute(sqlTag`DELETE FROM creare_export_delivery_state`);
  await db.execute(sqlTag`DELETE FROM sia_produto_depara`);
  await db.execute(sqlTag`DELETE FROM product_fiscal`);
  await db.execute(sqlTag`DELETE FROM products`);
});

describe('lotes incrementais Criare', () => {
  it('repete o lote ate entrega verificada; entrega nao confirma importacao no SIA', async () => {
    await produto('p1', 'CERVEJA', '7891149100828');
    await siaLinha('012345', '7891149100828', '10');
    const primeiro = await service.pending('LI');
    const repetido = await service.pending('LI');
    expect(primeiro?.id).toBe(repetido?.id);
    expect(primeiro?.itens).toHaveLength(1);
    expect(primeiro?.conteudo).toHaveLength(364); // 363 + LF
    await expect(service.confirm('LI', primeiro!.id, '0'.repeat(64)))
      .rejects.toMatchObject({ code: 'CREARE_BATCH_HASH_MISMATCH' });
    expect((await service.pending('LI'))?.id).toBe(primeiro?.id);
    await expect(service.acknowledgeDelivery('LI', primeiro!.id, '0'.repeat(64)))
      .rejects.toMatchObject({ code: 'CREARE_BATCH_HASH_MISMATCH' });
    expect(await service.acknowledgeDelivery('LI', primeiro!.id, primeiro!.sha256))
      .toEqual({ count: 1, alreadyDelivered: false });
    expect(await service.acknowledgeDelivery('LI', primeiro!.id, primeiro!.sha256))
      .toEqual({ count: 1, alreadyDelivered: true });
    expect(await service.pending('LI')).toBeNull();
    const confirmado = await db.execute(sqlTag`SELECT count(*) AS total FROM creare_export_state`);
    expect(Number(confirmado.rows[0]?.total)).toBe(0);
    expect(await service.confirm('LI', primeiro!.id, primeiro!.sha256))
      .toEqual({ count: 1, alreadyConfirmed: false });
    expect(await service.confirm('LI', primeiro!.id, primeiro!.sha256))
      .toEqual({ count: 1, alreadyConfirmed: true });
    expect(await service.pending('LI')).toBeNull();
    expect((await service.generate('LI')).toString('ascii').split('\n').filter(Boolean)).toHaveLength(1);
  });

  it('manda somente produto novo ou alterado, inclusive inativacao', async () => {
    await produto('p1', 'CERVEJA', '7891149100828');
    await produto('p2', 'SUCO', '7891000100103');
    await siaLinha('012345', '7891149100828', '10');
    await siaLinha('067890', '7891000100103', '03');
    const baseline = (await service.pending('LI'))!;
    expect(baseline.itens).toHaveLength(2);
    await service.confirm('LI', baseline.id, baseline.sha256);

    await db.execute(sqlTag`UPDATE products SET v_venda_pontual = 8.50 WHERE id = 'p1'`);
    const alterado = (await service.pending('LI'))!;
    expect(alterado.itens.map((item) => item.productId)).toEqual(['p1']);
    await service.confirm('LI', alterado.id, alterado.sha256);

    await db.execute(sqlTag`UPDATE products SET status = 'inativo' WHERE id = 'p2'`);
    const inativo = (await service.pending('LI'))!;
    expect(inativo.itens.map((item) => item.productId)).toEqual(['p2']);
    const { Creare } = await import('@pralis/shared');
    expect(Creare.parseCreareRecord(inativo.conteudo.trimEnd()).active).toBe('N');
    await service.confirm('LI', inativo.id, inativo.sha256);

    await produto('p3', 'AGUA', '7899999999998', '13153');
    await siaLinha('013153', '7899999999998', '03');
    const novo = (await service.pending('LI'))!;
    expect(novo.itens.map((item) => item.productId)).toEqual(['p3']);
  });

  it('mudanca durante lote aberto espera o ACK e entra no lote seguinte', async () => {
    await produto('p1', 'CERVEJA', '7891149100828');
    await siaLinha('012345', '7891149100828', '10');
    const aberto = (await service.pending('LI'))!;
    await db.execute(sqlTag`UPDATE products SET v_venda_pontual = 7.75 WHERE id = 'p1'`);
    expect((await service.pending('LI'))?.id).toBe(aberto.id);
    await service.acknowledgeDelivery('LI', aberto.id, aberto.sha256);
    const seguinte = (await service.pending('LI'))!;
    expect(seguinte.id).not.toBe(aberto.id);
    expect(seguinte.itens.map((item) => item.productId)).toEqual(['p1']);
  });

  it('novos produtos seguem em novo TXT sem confirmar importacao do anterior', async () => {
    await produto('p1', 'CERVEJA', '7891149100828');
    await siaLinha('012345', '7891149100828', '10');
    const antigo = (await service.pending('LI'))!;
    await service.acknowledgeDelivery('LI', antigo.id, antigo.sha256);
    await produto('p2', 'SUCO', '7891000100103');
    await siaLinha('067890', '7891000100103', '03');
    const novo = (await service.pending('LI'))!;
    expect(novo.itens.map((item) => item.productId)).toEqual(['p2']);
    const confirmado = await db.execute(sqlTag`SELECT count(*) AS total FROM creare_export_state`);
    expect(Number(confirmado.rows[0]?.total)).toBe(0);
  });

  it('confirmacao tardia do SIA nao faz o cursor de entrega retroceder', async () => {
    await produto('p1', 'CERVEJA', '7891149100828');
    await siaLinha('012345', '7891149100828', '10');
    const antigo = (await service.pending('LI'))!;
    await service.acknowledgeDelivery('LI', antigo.id, antigo.sha256);
    await db.execute(sqlTag`UPDATE products SET v_venda_pontual = 8.50 WHERE id = 'p1'`);
    const novo = (await service.pending('LI'))!;
    await service.acknowledgeDelivery('LI', novo.id, novo.sha256);
    await service.confirm('LI', antigo.id, antigo.sha256);
    expect(await service.pending('LI')).toBeNull();
  });

  it('cancela lote pendente no formato defeituoso e gera outro sem perder auditoria', async () => {
    await produto('p1', 'CERVEJA', '7891149100828');
    await siaLinha('012345', '7891149100828', '10');
    const antigoId = 'lote-formato-anterior';
    const antigoHash = 'a'.repeat(64);
    await db.execute(sqlTag`INSERT INTO creare_export_batch (id, loja, conteudo, sha256, itens, formato_versao)
      VALUES (${antigoId}, 'LI', 'TXT ANTIGO', ${antigoHash}, '[]'::jsonb, 2)`);

    expect(await service.openBatch('LI')).toBeNull();
    await expect(service.confirm('LI', antigoId, antigoHash))
      .rejects.toMatchObject({ code: 'CREARE_BATCH_OUTDATED' });

    const corrigido = (await service.pending('LI'))!;
    expect(corrigido.id).not.toBe(antigoId);
    expect(corrigido.formatoVersao).toBe(3);
    const { Creare } = await import('@pralis/shared');
    const campos = Creare.parseCreareRecord(corrigido.conteudo.trimEnd());
    expect(campos.barcode).toBe('0000000000000');
    expect(campos.extendedBarcode).toBe('07891149100828');
    const antigo = await db.execute(sqlTag`SELECT cancelado_em FROM creare_export_batch WHERE id = ${antigoId}`);
    expect(antigo.rows[0]?.cancelado_em).not.toBeNull();
    await expect(service.confirm('LI', antigoId, antigoHash))
      .rejects.toMatchObject({ code: 'CREARE_BATCH_OUTDATED' });
  });

  it('substitui lote antigo mesmo quando o push de producao conservou o indice anterior', async () => {
    await produto('p1', 'CERVEJA', '7891149100828');
    await siaLinha('012345', '7891149100828', '10');
    await db.execute(sqlTag`DROP INDEX uq_creare_export_batch_aberto`);
    await db.execute(sqlTag`CREATE UNIQUE INDEX uq_creare_export_batch_aberto
      ON creare_export_batch (loja) WHERE confirmado_em IS NULL`);
    try {
      const antigoId = 'lote-antes-do-push';
      const antigoHash = 'b'.repeat(64);
      await db.execute(sqlTag`INSERT INTO creare_export_batch (id, loja, conteudo, sha256, itens)
        VALUES (${antigoId}, 'LI', 'TXT SEM BARRAS', ${antigoHash}, '[]'::jsonb)`);

      const novo = (await service.pending('LI'))!;
      expect(novo.id).not.toBe(antigoId);
      expect(novo.formatoVersao).toBe(3);
      const antigo = await db.execute(sqlTag`SELECT cancelado_em, confirmado_em
        FROM creare_export_batch WHERE id = ${antigoId}`);
      expect(antigo.rows[0]?.cancelado_em).not.toBeNull();
      expect(antigo.rows[0]?.confirmado_em).not.toBeNull();
      await expect(service.confirm('LI', antigoId, antigoHash))
        .rejects.toMatchObject({ code: 'CREARE_BATCH_OUTDATED' });
      const states = await db.execute(sqlTag`SELECT count(*) AS total FROM creare_export_state`);
      expect(Number(states.rows[0]?.total)).toBe(0);
    } finally {
      await db.execute(sqlTag`DROP INDEX uq_creare_export_batch_aberto`);
      await db.execute(sqlTag`CREATE UNIQUE INDEX uq_creare_export_batch_aberto
        ON creare_export_batch (loja) WHERE confirmado_em IS NULL AND cancelado_em IS NULL`);
    }
  });
});

describe('exportação Criare: só sai o que casou no SIA', () => {
  it('preserva o Pesavel S de um produto UN pelo coditem, mesmo sem casar pelas barras', async () => {
    await produto('p1', 'PRODUTO DE BALANCA', '2999999999999', '13535');
    await siaLinha('13535', '2123456789012', '03');
    await db.execute(sqlTag`UPDATE sia_produto_depara SET pesavel = 'S', tecla_balanca = '35', validade_balanca = '3' WHERE coditem = '13535'`);
    const { Creare } = await import('@pralis/shared');
    const linha = (await service.generate('LI')).toString('ascii').split('\n')[0]!;
    expect(Creare.parseCreareRecord(linha)).toMatchObject({ weighable: 'S', scaleKey: '035', scaleValidity: '003' });
  });

  it('nao exporta produto com Pesavel desconhecido no espelho antigo', async () => {
    await produto('p1', 'PRODUTO DE BALANCA', '2123456789012', '13535');
    await siaLinha('13535', '2123456789012', '03');
    await db.execute(sqlTag`UPDATE sia_produto_depara SET pesavel = NULL WHERE coditem = '13535'`);
    const d = (await service.health()).lojas.find((loja) => loja.loja === 'LI')!;
    expect(d.invalidos).toBe(1);
    expect(d.exemplosInvalidos[0]?.motivo).toMatch(/Pesavel sem confirmacao/);
  });

  it('TNP usa campo longo homologado mesmo se ambiente pedir automatico', async () => {
    await produto('p1', 'DESENGORDURANTE MULTIUSO UAU', '7891242211506');
    await siaLinha('013153', '7891242211506', '12');
    await db.execute(sqlTag`UPDATE products SET loja = 'TNP' WHERE id = 'p1'`);
    await db.execute(sqlTag`UPDATE sia_produto_depara SET loja = 'TNP' WHERE id = 's-013153'`);
    const { Creare } = await import('@pralis/shared');
    const linha = (await service.generate('TNP')).toString('ascii').split('\n')[0]!;
    const campos = Creare.parseCreareRecord(linha);
    expect(linha).toHaveLength(363);
    expect(campos.barcode).toBe('0000000000000');
    expect(campos.extendedBarcode).toBe('07891242211506');
  });

  it('recusa exportar quando o de-para nem foi importado', async () => {
    await produto('p1', 'CERVEJA', '7891149100828');

    await expect(service.generate('LI')).rejects.toMatchObject({ code: 'CREARE_DEPARA_MISSING' });
  });

  it('exporta o produto casado e DEIXA DE FORA o que não casou', async () => {
    await produto('p1', 'CERVEJA', '7891149100828');
    await produto('p2', 'SEM PAR NO SIA', '9999999999999');
    await siaLinha('012345', '7891149100828', '10');

    const arquivo = (await service.generate('LI')).toString('ascii');
    const linhas = arquivo.split('\n').filter((l) => l.length > 0);

    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toHaveLength(363);
    const { Creare } = await import('@pralis/shared');
    const campos = Creare.parseCreareRecord(linhas[0]!);
    expect(campos.barcode).toBe('0000000000000');
    expect(campos.extendedBarcode).toBe('07891149100828');
  });

  it('usa o coditem, o grupo e a alíquota do SIA — nunca o de-para por grupo', async () => {
    await produto('p1', 'CERVEJA', '7891149100828');
    await siaLinha('012345', '7891149100828', '10', '0042');

    const { Creare } = await import('@pralis/shared');
    const linha = (await service.generate('LI')).toString('ascii').split('\n')[0]!;
    const campos = Creare.parseCreareRecord(linha);

    expect(campos.internalCode).toBe('012345');
    expect(campos.extendedInternalCode).toBe('000012345');
    expect(campos.groupCode).toBe('0042');
    expect(campos.ecfTaxCode).toBe('10'); // a config dizia 99
  });

  it('casa pesável pelo PLU da balança, sem regra separada', async () => {
    // EAN de balança: 2 + PLU(12862) + peso + dígito
    await produto('p1', 'PAO DE SAL', '2128620150003');
    await siaLinha('012862', '00000000012862', '03');

    const arquivo = (await service.generate('LI')).toString('ascii');

    expect(arquivo.split('\n').filter((l) => l).length).toBe(1);
  });

  /*
   * O risco que o importador cria: ele roda
   * `update produto set codbarra = null WHERE codbarra = :codbarra` antes de
   * gravar. Escrever no coditem errado faria o produto legítimo perder o
   * código de barras e sumir do caixa.
   */
  it('RECUSA o arquivo inteiro quando dois produtos casam no mesmo coditem', async () => {
    await produto('p1', 'CERVEJA LATA', '7891149100828');
    await produto('p2', 'CERVEJA LONG NECK', '07891149100828');
    await siaLinha('012345', '7891149100828', '10');

    await expect(service.generate('LI')).rejects.toMatchObject({ code: 'CREARE_CODITEM_COLLISION' });
  });

  it('deixa de fora — sem derrubar o arquivo — o produto que diverge do coditem', async () => {
    await produto('p1', 'CERVEJA', '7891149100828', '999999');
    await produto('p2', 'REFRIGERANTE', '7891000100103');
    await siaLinha('012345', '7891149100828', '10');
    await siaLinha('067890', '7891000100103', '03');

    const arquivo = (await service.generate('LI')).toString('ascii');
    const diagnostico = (await service.health()).lojas.find((loja) => loja.loja === 'LI')!;

    expect(arquivo.split('\n').filter((l) => l).length).toBe(1);
    expect(diagnostico.invalidos).toBe(1);
    expect(diagnostico.exemplosInvalidos[0]!.motivo).toMatch(/diverge do coditem/);
  });

  it('sem par no de-para, o codigo interno vale como coditem e o produto SAI', async () => {
    /*
     * O caso de 26/09/2026: a TNP tinha 2 produtos e o TXT saia com 1. O que
     * ficava de fora nao estava no de-para por barras -- mas tinha codigo
     * interno, que desde a carga E o coditem do SIA, e trazia grupo e fiscal
     * zerado no proprio cadastro.
     */
    await produto('p1', 'CERVEJA', '7891149100828');
    await siaLinha('012345', '7891149100828', '10');
    await db.execute(sqlTag`
      INSERT INTO products (id, loja, codigo, nome, medida_base, tipo, status, quantidade, qt_cad,
                            habilitar_ajuda, auto, codigo_barras, codigo_interno, grupo_id, custo, v_venda_pontual, pesavel)
      VALUES ('p2', 'LI', 'PR-p2', 'INATIVO BISC LEVISSIMO', 'UN', 'revenda', 'inativo', 0, 1,
              false, false, '7', '00007', '102', 1.47, NULL, 'N')`);
    await db.execute(sqlTag`
      INSERT INTO product_fiscal (product_id, ncm, cest, categoria, cst_pis_cofins, aliquota_ecf_id)
      VALUES ('p2', '00000000', '0000000', NULL, '00', '00')`);

    const linhas = (await service.generate('LI')).toString('ascii').split('\n').filter((l) => l);
    const d = (await service.health()).lojas.find((loja) => loja.loja === 'LI')!;

    expect(linhas).toHaveLength(2);
    expect(d.casados).toBe(2);
    expect(d.naoCasados).toBe(0);
    const { Creare } = await import('@pralis/shared');
    const inativo = linhas.map((l) => Creare.parseCreareRecord(l)).find((r) => r.description.startsWith('INATIVO'))!;
    expect(inativo.internalCode).toBe('000007');
    expect(inativo.groupCode).toBe('0102');
    // `00` e placeholder: o SIA recusa como chave inexistente, entao vale o padrao da loja
    expect(inativo.ecfTaxCode).toBe('03');
    expect(inativo.pisCofinsCst).toBe('99');
    expect(inativo.ncm).toBe('00000000');
    expect(inativo.categoryCode).toBe('000000000');
    expect(inativo.unitPrice).toBe('0000000010'); // sem preco: R$ 0,10
    expect(inativo.active).toBe('N');
  });

  it('produto sem id de grupo herda o id pelo NOME do grupo, aprendido da carga', async () => {
    /*
     * O LIMPADOR PERFUMADO de 28/09/2026: cadastrado pelo formulario, que so
     * tem o nome do grupo. Um produto da carga com o mesmo nome traz o id.
     */
    await produto('p1', 'CERVEJA', '7891149100828');
    await siaLinha('012345', '7891149100828', '10');
    // um produto da carga, em outra loja, com nome E id do grupo
    await db.execute(sqlTag`
      INSERT INTO products (id, loja, codigo, nome, medida_base, tipo, status, quantidade, qt_cad,
                            habilitar_ajuda, auto, codigo_interno, grupo, grupo_id, custo, v_venda_pontual)
      VALUES ('base1', 'BASE', 'PR-base1', 'VEJA MULTIUSO', 'UN', 'revenda', 'ativo', 0, 1,
              false, false, '10500', ${'MER ⁠MERCEARIA - ⁠PRODUTOS DE LIMPEZA'}, '61', 5.0, 9.0)`);
    // ^ com os dois U+2060 invisiveis que a carga trouxe da planilha: iguais na tela, diferentes para o `=`
    // o novo, na loja, com o nome e SEM o id
    await db.execute(sqlTag`
      INSERT INTO products (id, loja, codigo, nome, medida_base, tipo, status, quantidade, qt_cad,
                            habilitar_ajuda, auto, codigo_barras, codigo_interno, grupo, custo, v_venda_pontual, pesavel)
      VALUES ('p2', 'LI', 'PR-p2', 'LIMPADOR PERFUMADO CASAFLOR', 'UN', 'revenda', 'ativo', 0, 1,
              false, false, '886748404641', '13152', 'MER MERCEARIA - PRODUTOS DE LIMPEZA', 7.0, 8.9, 'N')`);

    const linhas = (await service.generate('LI')).toString('ascii').split('\n').filter((l) => l);
    const { Creare } = await import('@pralis/shared');
    const limpador = linhas.map((l) => Creare.parseCreareRecord(l)).find((r) => r.description.startsWith('LIMPADOR'))!;

    expect(limpador).toBeDefined();
    expect(limpador.groupCode).toBe('0061');
    expect(limpador.internalCode).toBe('013152');
    expect(limpador.ecfTaxCode).toBe('03'); // sem bloco fiscal: padrao da loja
    expect(limpador.pisCofinsCst).toBe('99');
    expect((await service.health()).lojas.find((loja) => loja.loja === 'LI')!.invalidos).toBe(0);
  });

  it('limite gera só os primeiros — a primeira importação real começa pequena', async () => {
    for (let i = 1; i <= 5; i += 1) {
      await produto(`p${i}`, `PRODUTO ${i}`, `789100010010${i}`);
      await siaLinha(`01234${i}`, `789100010010${i}`, '03');
    }

    const arquivo = (await service.generate('LI', 2)).toString('ascii');

    expect(arquivo.split('\n').filter((l) => l).length).toBe(2);
  });
});

describe('diagnóstico antes de importar', () => {
  it('conta casados, não casados e a distribuição de alíquota', async () => {
    await produto('p1', 'CERVEJA', '7891149100828');
    await produto('p2', 'REFRIGERANTE', '7891000100103');
    await produto('p3', 'SEM PAR', '9999999999999');
    await siaLinha('012345', '7891149100828', '10');
    await siaLinha('067890', '7891000100103', '03');

    const d = (await service.health()).lojas.find((loja) => loja.loja === 'LI')!;

    expect(d.totalProdutos).toBe(3);
    expect(d.deParaCarregado).toBe(2);
    expect(d.casados).toBe(2);
    expect(d.naoCasados).toBe(1);
    expect(d.distribuicaoEcf).toEqual({ '10': 1, '03': 1 });
    expect(d.exemplosNaoCasados[0]!.nome).toBe('SEM PAR');
  });

  it('mostra a colisão de coditem antes de alguém tentar exportar', async () => {
    await produto('p1', 'CERVEJA LATA', '7891149100828');
    await produto('p2', 'CERVEJA LONG NECK', '07891149100828');
    await siaLinha('012345', '7891149100828', '10');

    const d = (await service.health()).lojas.find((loja) => loja.loja === 'LI')!;

    // a ordem da listagem não é garantida; o que importa é QUEM colide
    expect(d.colisoesCoditem).toHaveLength(1);
    expect(d.colisoesCoditem[0]!.coditem).toBe('012345');
    expect([...d.colisoesCoditem[0]!.produtos].sort()).toEqual(['PR-p1', 'PR-p2']);
  });

  it('não diz que está aprovado para produção só porque a flag está ligada', async () => {
    const h = await service.health();

    expect(h.enabled).toBe(true);
    expect(h.approvedForProduction).toBe(false);
  });
});

describe('o arquivo bate com o exemplo do fornecedor', () => {
  const CAMINHO = 'C:/Users/José/Downloads/arquivo_importar_tnp.txt';

  it('o registro gerado tem o mesmo tamanho e as mesmas fronteiras de campo', async () => {
    await produto('p1', 'CERVEJA', '7891149100828');
    await siaLinha('013120', '7891149100828', '10', '0005');

    const { Creare, CreareLayout } = await import('@pralis/shared');
    const gerado = (await service.generate('LI')).toString('ascii').split('\n')[0]!;

    let exemplo: string | null = null;
    try {
      exemplo = readFileSync(CAMINHO, 'ascii').split(/\r?\n/).find((l) => l.trim().length > 0) ?? null;
    } catch {
      exemplo = null; // o TXT do fornecedor não é versionado; o resto do teste ainda vale
    }

    expect(gerado).toHaveLength(363);
    expect(CreareLayout.CREARE_PRODUCT_RECORD_LENGTH).toBe(363);

    if (exemplo) {
      expect(exemplo).toHaveLength(363);
      const nosso = Creare.parseCreareRecord(gerado);
      const deles = Creare.parseCreareRecord(exemplo);
      // mesmos campos, mesmas larguras — e o exemplo real decodifica coerente
      expect(Object.keys(nosso)).toEqual(Object.keys(deles));
      expect(deles.ecfTaxCode).toBe('10');
      expect(deles.unit).toBe('UN');
      expect(deles.active).toBe('S');
      // o fornecedor preenche OS DOIS campos de código interno; nós também
      expect(deles.internalCode).toBe('013120');
      expect(deles.extendedInternalCode).toBe('000013120');
      expect(nosso.internalCode).toBe('013120');
      expect(nosso.extendedInternalCode).toBe('000013120');
    }
  });
});

describe('amostra de custo — para decidir 2 ou 3 casas olhando o SIA', () => {
  it('mostra o campo gravado e as DUAS leituras possiveis', async () => {
    await produto('p1', 'CERVEJA', '7891149100828'); // custo 1.00 na fixture
    await siaLinha('012345', '7891149100828', '10');

    const d = (await service.health()).lojas.find((loja) => loja.loja === 'LI')!;

    expect(d.amostraCusto).toHaveLength(1);
    expect(d.amostraCusto[0]).toMatchObject({
      nome: 'CERVEJA',
      custoNoPralis: 1,
      casasConfiguradas: 3,
      campoGravado: '0000001000',
      seSiaLerCom2Casas: 10,
      seSiaLerCom3Casas: 1,
    });
  });

  it('nao gasta a amostra com produto de custo zero — nao distingue nada', async () => {
    await produto('p1', 'SEM CUSTO', '7891149100828');
    await db.execute(sqlTag`UPDATE products SET custo = 0 WHERE id = 'p1'`);
    await siaLinha('012345', '7891149100828', '10');

    const d = (await service.health()).lojas.find((loja) => loja.loja === 'LI')!;

    expect(d.casados).toBe(1);
    expect(d.amostraCusto).toHaveLength(0);
  });
});

/*
 * Defeito de 07/10/2026: o MINI PAO DOCE GOTAS DE CHOCOLATE (13179) foi
 * cadastrado, o health dizia "7181 casados, 0 invalidos", e ele nunca saiu em
 * TXT nenhum. A causa era um lote aberto que nunca teve a entrega registrada:
 * `pending` devolve o lote aberto ANTES de olhar o catalogo, e ninguem tinha
 * como ver isso.
 */
describe('lote abandonado nao prende o catalogo', () => {
  const envelhecer = async (id: string, minutos: number) => {
    await db.execute(sqlTag`
      UPDATE creare_export_batch SET criado_em = now() - ${`${minutos} minutes`}::interval WHERE id = ${id}`);
  };

  it('produto novo continua preso enquanto o lote aberto esta no prazo', async () => {
    await produto('p1', 'CERVEJA', '7891149100828');
    await siaLinha('012345', '7891149100828', '10');
    const aberto = (await service.pending('LI'))!;

    await produto('p2', 'MINI PAO DOCE GOTAS DE CHOCOLATE', '7891149100835', '13179');
    await siaLinha('013179', '7891149100835', '10');
    await envelhecer(aberto.id, 5);

    // dentro do prazo o lote tem que se repetir: e isso que impede dois
    // downloads de produzirem dois arquivos diferentes
    expect((await service.pending('LI'))?.id).toBe(aberto.id);
    expect((await service.pending('LI'))?.itens).toHaveLength(1);
  });

  it('passado o prazo, o lote abandonado e reciclado e o produto novo SAI', async () => {
    await produto('p1', 'CERVEJA', '7891149100828');
    await siaLinha('012345', '7891149100828', '10');
    const abandonado = (await service.pending('LI'))!;

    await produto('p2', 'MINI PAO DOCE GOTAS DE CHOCOLATE', '7891149100835', '13179');
    await siaLinha('013179', '7891149100835', '10');
    await envelhecer(abandonado.id, 16);

    const novo = (await service.pending('LI'))!;
    expect(novo.id).not.toBe(abandonado.id);
    // nenhum dos dois teve entrega registrada, entao os dois voltam
    expect(novo.itens).toHaveLength(2);
    expect(novo.conteudo).toContain('13179');

    // o lote velho sai da vaga sem perder a auditoria
    const velho = await db.execute(sqlTag`
      SELECT cancelado_em, conteudo FROM creare_export_batch WHERE id = ${abandonado.id}`);
    expect(velho.rows[0]?.cancelado_em).not.toBeNull();
    expect(velho.rows[0]?.conteudo).toBe(abandonado.conteudo);
    // a vaga de lote aberto passa a ser do novo, nunca mais do abandonado
    expect((await service.openBatch('LI'))?.id).toBe(novo.id);
  });

  it('reciclar nao avanca o cursor: o produto do lote perdido nao e dado como entregue', async () => {
    await produto('p1', 'CERVEJA', '7891149100828');
    await siaLinha('012345', '7891149100828', '10');
    const perdido = (await service.pending('LI'))!;
    await envelhecer(perdido.id, 16);

    const novo = (await service.pending('LI'))!;
    expect(novo.itens).toHaveLength(1);
    const entregue = await db.execute(sqlTag`SELECT count(*) AS total FROM creare_export_delivery_state`);
    expect(Number(entregue.rows[0]?.total)).toBe(0);
  });

  it('a entrega de um lote reciclado e recusada, para o robo nao avancar o cursor errado', async () => {
    await produto('p1', 'CERVEJA', '7891149100828');
    await siaLinha('012345', '7891149100828', '10');
    const abandonado = (await service.pending('LI'))!;
    await envelhecer(abandonado.id, 16);
    await service.pending('LI');

    await expect(service.acknowledgeDelivery('LI', abandonado.id, abandonado.sha256))
      .rejects.toMatchObject({ code: 'CREARE_BATCH_OUTDATED' });
  });
});

describe('health: o cursor incremental deixou de ser invisivel', () => {
  const envelhecer = async (id: string, minutos: number) => {
    await db.execute(sqlTag`
      UPDATE creare_export_batch SET criado_em = now() - ${`${minutos} minutes`}::interval WHERE id = ${id}`);
  };
  const diag = async () => (await service.health()).lojas.find((loja) => loja.loja === 'LI')!;

  it('nomeia o produto que esta esperando o proximo download', async () => {
    await produto('p2', 'MINI PAO DOCE GOTAS DE CHOCOLATE', '7891149100835', '13179');
    await siaLinha('013179', '7891149100835', '10');

    const d = await diag();
    expect(d.casados).toBe(1);
    expect(d.incremental.pendentes).toBe(1);
    expect(d.incremental.exemplosPendentes).toEqual([
      { codigoInterno: '13179', nome: 'MINI PAO DOCE GOTAS DE CHOCOLATE' },
    ]);
    expect(d.incremental.loteAberto).toBeNull();
    expect(d.incremental.diagnostico).toContain('aguardando o próximo download');
  });

  it('mostra que o produto novo esta preso atras de um lote aberto', async () => {
    await produto('p1', 'CERVEJA', '7891149100828');
    await siaLinha('012345', '7891149100828', '10');
    const aberto = (await service.pending('LI'))!;
    await produto('p2', 'MINI PAO DOCE GOTAS DE CHOCOLATE', '7891149100835', '13179');
    await siaLinha('013179', '7891149100835', '10');

    const d = await diag();
    // o flagrante: dois pendentes, e o lote aberto carrega um so
    expect(d.incremental.pendentes).toBe(2);
    expect(d.incremental.loteAberto).toMatchObject({ id: aberto.id, registros: 1, abandonado: false });
    expect(d.incremental.cursorEntregue).toBe(0);
    expect(d.incremental.diagnostico).toContain('aguardando o robô salvar');
  });

  it('acusa o lote abandonado com a idade dele', async () => {
    await produto('p1', 'CERVEJA', '7891149100828');
    await siaLinha('012345', '7891149100828', '10');
    const aberto = (await service.pending('LI'))!;
    await envelhecer(aberto.id, 47);

    const d = await diag();
    expect(d.incremental.loteAberto).toMatchObject({ abandonado: true, idadeMinutos: 47 });
    expect(d.incremental.diagnostico).toContain('sem registro de entrega');
  });

  it('depois da entrega diz que esta em dia e conta o cursor', async () => {
    await produto('p1', 'CERVEJA', '7891149100828');
    await siaLinha('012345', '7891149100828', '10');
    const lote = (await service.pending('LI'))!;
    await service.acknowledgeDelivery('LI', lote.id, lote.sha256);

    const d = await diag();
    expect(d.incremental.pendentes).toBe(0);
    expect(d.incremental.loteAberto).toBeNull();
    expect(d.incremental.cursorEntregue).toBe(1);
    expect(d.incremental.cursorConfirmado).toBe(0);
    expect(d.incremental.ultimaEntrega).toMatchObject({ loteId: lote.id, registros: 1 });
    expect(d.incremental.diagnostico).toContain('Nada pendente');

    await service.confirm('LI', lote.id, lote.sha256);
    expect((await diag()).incremental.cursorConfirmado).toBe(1);
  });

  it('alterar um produto ja entregue volta a aparecer como pendente', async () => {
    await produto('p1', 'CERVEJA', '7891149100828');
    await siaLinha('012345', '7891149100828', '10');
    const lote = (await service.pending('LI'))!;
    await service.acknowledgeDelivery('LI', lote.id, lote.sha256);
    expect((await diag()).incremental.pendentes).toBe(0);

    await db.execute(sqlTag`UPDATE products SET nome = 'CERVEJA LATA 350' WHERE id = 'p1'`);
    expect((await diag()).incremental.pendentes).toBe(1);
  });

  it('a contagem de pendentes do health bate com o que o download entrega', async () => {
    // a TNP forca `barcodeField: extended`; com a config crua o registro
    // apurado aqui teria outro hash e o health mentiria sobre a TNP
    await produto('p1', 'CERVEJA', '7891149100828');
    await siaLinha('012345', '7891149100828', '10');
    await produto('p2', 'MINI PAO DOCE GOTAS DE CHOCOLATE', '7891149100835', '13179');
    await siaLinha('013179', '7891149100835', '10');

    const antes = (await diag()).incremental.pendentes;
    const lote = (await service.pending('LI'))!;
    expect(lote.itens).toHaveLength(antes);

    await service.acknowledgeDelivery('LI', lote.id, lote.sha256);
    expect((await diag()).incremental.pendentes).toBe(0);
  });
});
