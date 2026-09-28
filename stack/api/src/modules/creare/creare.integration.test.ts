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
    barcodeField: 'automatic',
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
  process.env.CREARE_STORE_CONFIG_JSON = JSON.stringify(CONFIG_LI);

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
                                      cod_grupo, aliq_saida_ecf, cst_saida, csosn, ncm, ativo)
      VALUES (${'s-' + coditem}, 'LI', ${barras}, ${chave}, ${coditem}, 'DO SIA',
              ${grupo}, ${ecf}, '000', '101', '22030000', 'S')`);
  };

  const { CreareService } = await import('./creare.service');
  const { ProductRepository } = await import('@/modules/product/product.repository');
  const { CreareDeParaRepository } = await import('./creare.depara.repository');
  service = new CreareService(new ProductRepository(), new CreareDeParaRepository());
});

afterAll(async () => {
  await db.$client.end();
  await container.stop();
});

beforeEach(async () => {
  await db.execute(sqlTag`DELETE FROM sia_produto_depara`);
  await db.execute(sqlTag`DELETE FROM product_fiscal`);
  await db.execute(sqlTag`DELETE FROM products`);
});

describe('exportação Criare: só sai o que casou no SIA', () => {
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
    const diagnostico = (await service.health()).lojas[0]!;

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
                            habilitar_ajuda, auto, codigo_barras, codigo_interno, grupo_id, custo, v_venda_pontual)
      VALUES ('p2', 'LI', 'PR-p2', 'INATIVO BISC LEVISSIMO', 'UN', 'revenda', 'inativo', 0, 1,
              false, false, '7', '00007', '102', 1.47, NULL)`);
    await db.execute(sqlTag`
      INSERT INTO product_fiscal (product_id, ncm, cest, categoria, cst_pis_cofins, aliquota_ecf_id)
      VALUES ('p2', '00000000', '0000000', NULL, '00', '00')`);

    const linhas = (await service.generate('LI')).toString('ascii').split('\n').filter((l) => l);
    const d = (await service.health()).lojas[0]!;

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
                            habilitar_ajuda, auto, codigo_barras, codigo_interno, grupo, custo, v_venda_pontual)
      VALUES ('p2', 'LI', 'PR-p2', 'LIMPADOR PERFUMADO CASAFLOR', 'UN', 'revenda', 'ativo', 0, 1,
              false, false, '886748404641', '13152', 'MER MERCEARIA - PRODUTOS DE LIMPEZA', 7.0, 8.9)`);

    const linhas = (await service.generate('LI')).toString('ascii').split('\n').filter((l) => l);
    const { Creare } = await import('@pralis/shared');
    const limpador = linhas.map((l) => Creare.parseCreareRecord(l)).find((r) => r.description.startsWith('LIMPADOR'))!;

    expect(limpador).toBeDefined();
    expect(limpador.groupCode).toBe('0061');
    expect(limpador.internalCode).toBe('013152');
    expect(limpador.ecfTaxCode).toBe('03'); // sem bloco fiscal: padrao da loja
    expect(limpador.pisCofinsCst).toBe('99');
    expect((await service.health()).lojas[0]!.invalidos).toBe(0);
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

    const d = (await service.health()).lojas[0]!;

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

    const d = (await service.health()).lojas[0]!;

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

    const d = (await service.health()).lojas[0]!;

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

    const d = (await service.health()).lojas[0]!;

    expect(d.casados).toBe(1);
    expect(d.amostraCusto).toHaveLength(0);
  });
});
