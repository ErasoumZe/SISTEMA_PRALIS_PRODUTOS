import { describe, expect, it } from 'vitest';
import {
  agrupar,
  chaveForte,
  montarCandidato,
  type ItemFonte,
  type LojaFonte,
} from './unificacao.motor';

let seq = 0;
const item = (p: Partial<ItemFonte> & { fonte: string; loja: LojaFonte }): ItemFonte => ({
  id: `i${(seq += 1)}`,
  codInterno: '',
  codBarras: '',
  chaveBarras: '',
  nome: '',
  nomeNormalizado: '',
  ativo: null,
  grupo: null,
  custo: null,
  venda: null,
  ncm: null,
  cst: null,
  csosn: null,
  aliqEcf: null,
  reducao: null,
  icmsEfetivo: null,
  ...p,
});

const agruparSimples = (itens: ItemFonte[]) => agrupar({ itens, barrasConflitantes: new Set() });

describe('chave forte', () => {
  it('usa o codigo de barras quando existe', () => {
    expect(chaveForte(item({ fonte: 'sia_li', loja: 'LI', chaveBarras: '10000' }))).toBe('10000');
  });

  /*
   * As duas fontes TNP sem coluna de barras guardam no COD_INTERNO a MESMA
   * linhagem de codigo do Creare. Medido: o fiscal casa 900 de 940 pelo
   * COD_BARRAS do Compilart e ZERO pelo COD_INTERNO dele.
   */
  it('usa o COD_INTERNO como chave nas fontes TNP que nao tem barras', () => {
    expect(chaveForte(item({ fonte: 'fiscal_tnp', loja: 'TNP', codInterno: '10010' }))).toBe('10010');
    expect(chaveForte(item({ fonte: 'planilha_tnp', loja: 'TNP', codInterno: '010010' }))).toBe('10010');
  });

  it('NAO usa o COD_INTERNO como chave nas fontes que tem barras', () => {
    // o interno do Compilart e outra numeracao; usar aqui cruzaria coisas erradas
    expect(chaveForte(item({ fonte: 'compilart_tnp', loja: 'TNP', codInterno: '4396' }))).toBe('');
  });
});

describe('agrupamento', () => {
  it('nao transforma linha fiscal orfa e sem nome em produto vazio', () => {
    const fiscalOrfao = item({
      fonte: 'fiscal_tnp', loja: 'TNP', codInterno: '999999',
      nome: '', nomeNormalizado: '',
    });

    expect(agruparSimples([fiscalOrfao])).toEqual([]);
  });

  it('une LI e TNP pelo mesmo codigo de barras', () => {
    const grupos = agruparSimples([
      item({ fonte: 'sia_li', loja: 'LI', chaveBarras: '10000', nome: 'ABACAXI', nomeNormalizado: 'ABACAXI' }),
      item({ fonte: 'compilart_tnp', loja: 'TNP', chaveBarras: '10000', nome: 'ABACAXI', nomeNormalizado: 'ABACAXI' }),
    ]);

    expect(grupos).toHaveLength(1);
    expect(grupos[0]!.motivo).toBe('mesmo_cod_barras');
    expect(grupos[0]!.lojas).toEqual(['LI', 'TNP']);
  });

  it('nome igual com barras diferente vira SUGESTAO, nao certeza', () => {
    const grupos = agruparSimples([
      item({ fonte: 'sia_li', loja: 'LI', chaveBarras: '111', nome: 'AGUA', nomeNormalizado: 'AGUA' }),
      item({ fonte: 'compilart_tnp', loja: 'TNP', chaveBarras: '222', nome: 'AGUA', nomeNormalizado: 'AGUA' }),
    ]);

    expect(grupos).toHaveLength(1);
    expect(grupos[0]!.motivo).toBe('nome_parecido');
  });

  it('produtos sem nada em comum ficam separados', () => {
    const grupos = agruparSimples([
      item({ fonte: 'sia_li', loja: 'LI', chaveBarras: '111', nomeNormalizado: 'A' }),
      item({ fonte: 'sia_li', loja: 'LI', chaveBarras: '222', nomeNormalizado: 'B' }),
    ]);

    expect(grupos).toHaveLength(2);
    expect(grupos.every((g) => g.motivo === 'unico')).toBe(true);
  });

  it('codigo interno repetido na MESMA loja e motivo; em lojas diferentes nao cruza', () => {
    const mesmaLoja = agruparSimples([
      item({ fonte: 'pralis', loja: 'TNP', codInterno: '55', nomeNormalizado: 'X' }),
      item({ fonte: 'pralis', loja: 'TNP', codInterno: '55', nomeNormalizado: 'X' }),
    ]);
    expect(mesmaLoja[0]!.motivo).toBe('mesmo_cod_interno');

    // mesmo interno em lojas diferentes NAO pode ser o motivo do agrupamento
    const lojasDiferentes = agruparSimples([
      item({ fonte: 'pralis', loja: 'LI', codInterno: '55', nomeNormalizado: 'X' }),
      item({ fonte: 'pralis', loja: 'TNP', codInterno: '55', nomeNormalizado: 'X' }),
    ]);
    expect(lojasDiferentes[0]!.motivo).toBe('nome_parecido');
  });
});

describe('candidato consolidado — cada campo com dono', () => {
  const doSia = item({
    fonte: 'sia_li', loja: 'LI', chaveBarras: '10000', nome: 'ABACAXI SIA', nomeNormalizado: 'ABACAXI SIA',
    ativo: true, grupo: 'PRODUTOS DA CASA', ncm: '08043000', cst: '040', csosn: '102', aliqEcf: '3', reducao: 0,
  });
  const doCompilart = item({
    fonte: 'compilart_tnp', loja: 'TNP', chaveBarras: '10000', nome: 'ABACAXI COMP',
    nomeNormalizado: 'ABACAXI COMP', ativo: true, custo: 2, venda: 5,
  });
  const doPralis = item({
    fonte: 'pralis', loja: 'BASE', chaveBarras: '10000', nome: 'ABACAXI PRALIS',
    nomeNormalizado: 'ABACAXI PRALIS', ativo: true, custo: 3, venda: 7, grupo: 'HORTIFRUTI',
  });
  const doFiscalTnp = item({
    fonte: 'fiscal_tnp', loja: 'TNP', codInterno: '10000', ncm: '08043000', cst: '6', icmsEfetivo: 3.69,
  });

  it('o NOME vem do Pralis — e o que o Jose curou manda', () => {
    const c = montarCandidato([doSia, doCompilart, doPralis]);

    expect(c.nome).toBe('ABACAXI PRALIS');
    expect(c.nomeDe).toBe('pralis');
  });

  /*
   * Custo e venda seguem a ordem CONTRARIA: o Compilart e o catalogo vivo da
   * loja e o Pralis pode estar com valor velho. Vale para criar e atualizar.
   */
  it('CUSTO e VENDA vem do Compilart, mesmo com o Pralis presente', () => {
    const c = montarCandidato([doSia, doCompilart, doPralis]);

    expect(c.custo).toBe(2);
    expect(c.custoDe).toBe('compilart_tnp');
    expect(c.venda).toBe(5);
    expect(c.vendaDe).toBe('compilart_tnp');
  });

  it('sem Compilart, custo e venda ficam com o que o Pralis tem', () => {
    const c = montarCandidato([doSia, doPralis]);

    expect(c.custo).toBe(3);
    expect(c.custoDe).toBe('pralis');
  });

  it('sem Pralis, nome e custo vem do Compilart', () => {
    const c = montarCandidato([doSia, doCompilart]);

    expect(c.nome).toBe('ABACAXI COMP');
    expect(c.custo).toBe(2);
    expect(c.custoDe).toBe('compilart_tnp');
  });

  it('o grupo vem do SIA — e o SIA tem prioridade sobre o Pralis', () => {
    expect(montarCandidato([doSia, doPralis]).grupo).toBe('PRODUTOS DA CASA');
    expect(montarCandidato([doSia, doPralis]).grupoDe).toBe('sia_li');
  });

  it('sem SIA e sem Pralis o grupo fica NULO — A CLASSIFICAR, nao chutado', () => {
    const c = montarCandidato([doCompilart, doFiscalTnp]);

    expect(c.grupo).toBeNull();
    expect(c.grupoDe).toBeNull();
  });

  /* Fiscal e por loja e nunca derivado: LI do SIA, TNP da contabilidade. */
  it('separa o fiscal da LI do fiscal da TNP', () => {
    const c = montarCandidato([doSia, doCompilart, doFiscalTnp]);

    expect(c.fiscalLi).toMatchObject({ aliqEcf: '3', cst: '040', csosn: '102' });
    expect(c.fiscalTnp).toMatchObject({ cst: '6', icmsEfetivo: 3.69 });
  });

  it('sem fiscal da contabilidade, fiscalTnp fica NULO — nao copia o da LI', () => {
    const c = montarCandidato([doSia, doCompilart]);

    expect(c.fiscalLi).not.toBeNull();
    expect(c.fiscalTnp).toBeNull();
  });

  it('ativo se ALGUMA fonte ainda considera ativo; parado entra inativo', () => {
    const inativoEmTodas = [
      item({ fonte: 'sia_li', loja: 'LI', chaveBarras: '9', ativo: false }),
      item({ fonte: 'compilart_tnp', loja: 'TNP', chaveBarras: '9', ativo: false }),
    ];

    expect(montarCandidato([doSia, item({ fonte: 'compilart_tnp', loja: 'TNP', ativo: false })]).ativo).toBe(true);
    expect(montarCandidato(inativoEmTodas).ativo).toBe(false);
  });
});

describe('flags de revisao — marcam, nao bloqueiam', () => {
  it('acusa nomes divergentes dentro do grupo', () => {
    const g = agruparSimples([
      item({ fonte: 'sia_li', loja: 'LI', chaveBarras: '789', nomeNormalizado: 'ICE TEA LIMAO' }),
      item({ fonte: 'compilart_tnp', loja: 'TNP', chaveBarras: '789', nomeNormalizado: 'ICE TEA PESSEGO' }),
    ])[0]!;

    expect(g.flags.nomesDivergentes).toBe(true);
  });

  it('so acusa buraco fiscal da TNP quando a TNP esta no grupo', () => {
    const soLisboa = agruparSimples([
      item({ fonte: 'sia_li', loja: 'LI', chaveBarras: '1', nomeNormalizado: 'A' }),
    ])[0]!;
    const comTnpSemFiscal = agruparSimples([
      item({ fonte: 'compilart_tnp', loja: 'TNP', chaveBarras: '2', nomeNormalizado: 'B' }),
    ])[0]!;

    expect(soLisboa.flags.semFiscalTnp).toBe(false);
    expect(comTnpSemFiscal.flags.semFiscalTnp).toBe(true);
  });

  it('acusa grupo ausente e presenca no Pralis', () => {
    const semGrupo = agruparSimples([
      item({ fonte: 'compilart_tnp', loja: 'TNP', chaveBarras: '3', nomeNormalizado: 'C' }),
    ])[0]!;
    const comPralis = agruparSimples([
      item({ fonte: 'pralis', loja: 'BASE', chaveBarras: '4', nomeNormalizado: 'D', grupo: 'MERCEARIA' }),
    ])[0]!;

    expect(semGrupo.flags.semGrupo).toBe(true);
    expect(semGrupo.flags.jaNoPralis).toBe(false);
    expect(comPralis.flags.semGrupo).toBe(false);
    expect(comPralis.flags.jaNoPralis).toBe(true);
  });

  it('marca o grupo cujo codigo de barras e conflitante na origem', () => {
    const g = agrupar({
      itens: [item({ fonte: 'compilart_tnp', loja: 'TNP', chaveBarras: '789', nomeNormalizado: 'X' })],
      barrasConflitantes: new Set(['789']),
    })[0]!;

    expect(g.flags.barrasConflitante).toBe(true);
  });

  it('acusa quando o grupo inteiro esta sem codigo de barras', () => {
    const g = agruparSimples([
      item({ fonte: 'planilha_tnp', loja: 'TNP', codInterno: '10000', nomeNormalizado: 'SO NA PLANILHA' }),
    ])[0]!;

    expect(g.flags.semBarras).toBe(true);
  });
});

/*
 * As chaves que a Central passou a usar para confrontar TUDO que ja foi
 * cadastrado um dia. Antes, dois registros do mesmo produto so se encontravam
 * pelo codigo de barras ou pelo nome — e nome e chave FRACA.
 */
describe('uniao pelo ID do sistema e pelo codigo interno', () => {
  it('a linha da planilha com ID encontra a BASE mesmo com nome e barras diferentes', () => {
    const grupos = agruparSimples([
      item({
        fonte: 'pralis', loja: 'BASE', idSistema: 'uuid-1', chaveBarras: '111',
        nome: 'ABACAXI PEROLA', nomeNormalizado: 'ABACAXI PEROLA',
      }),
      item({
        fonte: 'planilha_nova', loja: 'BASE', idSistema: 'uuid-1', chaveBarras: '222',
        nome: 'ABACAXI UNID', nomeNormalizado: 'ABACAXI UNID',
      }),
    ]);

    expect(grupos).toHaveLength(1);
    expect(grupos[0]!.motivo).toBe('mesmo_id_sistema');
  });

  /*
   * O ID e a chave MAIS forte que existe: foi o proprio sistema que a gravou na
   * planilha. Ela tem de ganhar do codigo de barras quando os dois discordam,
   * senao a linha que o espelho escreveu volta como se fosse outro produto.
   */
  it('o ID ganha do codigo de barras quando os dois estao presentes', () => {
    const grupos = agruparSimples([
      item({ fonte: 'pralis', loja: 'BASE', idSistema: 'uuid-9', chaveBarras: '111', nomeNormalizado: 'A' }),
      item({ fonte: 'planilha_nova', loja: 'BASE', idSistema: 'uuid-9', chaveBarras: '111', nomeNormalizado: 'B' }),
    ]);

    expect(grupos).toHaveLength(1);
    expect(grupos[0]!.motivo).toBe('mesmo_id_sistema');
  });

  it('linhas SEM ID nao se juntam por isso', () => {
    const grupos = agruparSimples([
      item({ fonte: 'planilha_nova', loja: 'BASE', chaveBarras: '111', nomeNormalizado: 'A' }),
      item({ fonte: 'planilha_nova', loja: 'BASE', chaveBarras: '222', nomeNormalizado: 'B' }),
    ]);

    expect(grupos).toHaveLength(2);
  });

  /*
   * O codigo interno era classificado como "correspondencia exata" na tela, mas
   * nao unia nada: dois registros com o MESMO interno e nomes diferentes
   * ficavam em grupos separados, e a tela prometia um casamento que o motor nao
   * fazia.
   */
  it('o mesmo codigo interno une a MESMA loja mesmo com nomes diferentes', () => {
    const grupos = agruparSimples([
      item({ fonte: 'pralis', loja: 'TNP', codInterno: '55', nomeNormalizado: 'REFRIGERANTE COLA' }),
      item({ fonte: 'compilart_tnp', loja: 'TNP', codInterno: '55', nomeNormalizado: 'REFRI COLA 2L' }),
    ]);

    expect(grupos).toHaveLength(1);
    expect(grupos[0]!.motivo).toBe('mesmo_cod_interno');
  });

  it('o zero a esquerda nao separa o mesmo codigo interno', () => {
    const grupos = agruparSimples([
      item({ fonte: 'pralis', loja: 'TNP', codInterno: '007', nomeNormalizado: 'A' }),
      item({ fonte: 'compilart_tnp', loja: 'TNP', codInterno: '7', nomeNormalizado: 'B' }),
    ]);

    expect(grupos).toHaveLength(1);
  });

  /* `soDigitos` zeraria um interno alfanumerico e uniria tudo que nao e numero. */
  it('codigo interno alfanumerico continua sendo ele mesmo', () => {
    const iguais = agruparSimples([
      item({ fonte: 'pralis', loja: 'TNP', codInterno: 'ab-10', nomeNormalizado: 'A' }),
      item({ fonte: 'compilart_tnp', loja: 'TNP', codInterno: 'AB-10', nomeNormalizado: 'B' }),
    ]);
    expect(iguais).toHaveLength(1);

    const diferentes = agruparSimples([
      item({ fonte: 'pralis', loja: 'TNP', codInterno: 'AB-10', nomeNormalizado: 'A' }),
      item({ fonte: 'compilart_tnp', loja: 'TNP', codInterno: 'CD-20', nomeNormalizado: 'B' }),
    ]);
    expect(diferentes).toHaveLength(2);
  });

  it('o codigo interno NAO cruza lojas diferentes', () => {
    const grupos = agruparSimples([
      item({ fonte: 'pralis', loja: 'LI', codInterno: '55', nomeNormalizado: 'A' }),
      item({ fonte: 'pralis', loja: 'TNP', codInterno: '55', nomeNormalizado: 'B' }),
    ]);

    expect(grupos).toHaveLength(2);
  });

  /*
   * Nas duas fontes TNP sem coluna de barras o campo "interno" guarda a
   * linhagem do codigo do Creare, que ja virou chave FORTE. Se ele tambem
   * entrasse como codigo interno, casaria com a numeracao propria do Compilart,
   * que e outra coisa com os mesmos digitos.
   */
  it('a numeracao do Compilart nao casa com a linhagem do Creare', () => {
    const grupos = agruparSimples([
      item({ fonte: 'compilart_tnp', loja: 'TNP', codInterno: '4396', nome: 'A', nomeNormalizado: 'A' }),
      item({ fonte: 'fiscal_tnp', loja: 'TNP', codInterno: '4396', nome: 'B', nomeNormalizado: 'B' }),
    ]);

    expect(grupos).toHaveLength(2);
  });
});
