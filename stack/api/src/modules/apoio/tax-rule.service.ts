import { inject, injectable } from 'tsyringe';
import { ProductRules } from '@pralis/shared';
import { env, credenciaisSheetsFaltando, destinoSheetsFaltando } from '@/config/env';
import { AppError } from '@/config/api.replies';
import { SHEETS_GATEWAY } from '@/modules/google-sheets/google-sheets.di';
import { a1, type SheetsGateway } from '@/modules/google-sheets/google-sheets.client';

export interface GroupTaxRule {
  grupo: string; cstPisCofins: string; tributacaoSimples: string;
  aliquotaSimples: number; icmsRe: number; baseFiscal: string;
  /**
   * Margem padrao do grupo, como FRACAO (0,2 = 20%). Nula quando a planilha
   * nao define — e a maioria: 3 de 76 grupos tem margem hoje. Sem ela, quem
   * cadastra escreve a margem na mao, que e o comportamento de sempre.
   */
  margemPadrao: number | null;
}
export interface FiscalClassification extends GroupTaxRule {
  ncm: string | null; codigoFiscal: string | null; produtoFiscal: string | null;
  cstReforma: string | null; cClassTrib: string | null; aliquotaIbs: number | null; aliquotaCbs: number | null;
  origem: 'produto' | 'plu_balanca' | 'grupo';
  /** Cadastro de ECF do produto, quando o nome casa. `null` = não encontrado. */
  ecf: RegistroEcf | null;
}
/**
 * Em que pé está o fiscal de um produto. É o que a tela, o health e o backfill
 * leem — e o que impede "cadastro salvo" ser lido como "fiscal resolvido".
 *
 * Os estados `pendente_*` são situações que só uma pessoa resolve; o
 * `fonte_indisponivel` é temporário e some sozinho quando o Google volta. A
 * diferença importa: um pede decisão, o outro pede paciência.
 */
export type EstadoFiscal =
  | 'completo'
  | 'parcial'
  | 'pendente_grupo_invalido'
  | 'pendente_sem_correspondencia'
  | 'pendente_ambiguo'
  | 'pendente_conflito'
  | 'fonte_indisponivel';

/** O que se sabe do produto na hora de classificar. */
export interface EntradaFiscal {
  nome?: string | null;
  codigoBarras?: string | null;
  codigoInterno?: string | null;
  grupo?: string | null;
  loja?: string | null;
}

export interface ResultadoFiscal {
  estado: EstadoFiscal;
  /** Frase curta, em português, para aparecer na tela sem tradução. */
  motivo: string;
  /** `null` quando o grupo não tem regra: aí não há classificação nenhuma. */
  classificacao: FiscalClassification | null;
  /**
   * Divergências entre fontes que ninguém deve resolver no código.
   * Cada uma vira uma pergunta para o contador.
   */
  conflitos: Array<{ campo: string; doGrupo: string; doEcf: string }>;
}

interface ProductTaxRule { codigo: string; ncm: string; cst: string; icmsRe: number; nome: string }
interface ReformRule { cst: string; cClassTrib: string; ibs: number; cbs: number }

/**
 * O cadastro fiscal de ECF de um produto, como está no Creare.
 *
 * Vem da aba `(TNP) FISCAL - CADASTRO ECF`, que é o cadastro antigo já
 * confrontado com o estudo tributário. É a ÚNICA fonte destes campos: nem o
 * de-para por produto nem a tabela por grupo os têm.
 *
 * Tudo aqui é COPIADO. Nada é derivado por semelhança fiscal — em especial a
 * alíquota de ECF, que só pode vir do cadastro.
 */
export interface RegistroEcf {
  reducaoIcms: number | null;
  aliquotaCheia: number | null;
  aliquotaFcp: number | null;
  aliquotaPis: number | null;
  aliquotaCofins: number | null;
  aliquotaEcf: string | null;
  aliquotaEcfId: string | null;
  categoria: string | null;
  icms: number | null;
  cest: string | null;
  /**
   * NCM e CST como o cadastro de ECF os traz.
   *
   * Não são a mesma coisa que os do produto: o NCM do produto vem do de-para
   * por código de barras, e o CST de PIS/COFINS vem da regra do GRUPO. Aqui
   * eles servem para CONFRONTAR as fontes — e o CST do ECF é `99` ("outras
   * operações") na maioria das linhas, marcação genérica que não substitui a
   * classificação de verdade.
   */
  ncm: string | null;
  cstEcf: string | null;
  /** `% NCM`: só 908 das 3.122 linhas têm. Ausência aqui é ausência mesmo. */
  pctNcm: number | null;
}

/**
 * O cadastro de ECF inteiro, com o que falhou junto.
 *
 * Antes isto era um `Map` e a ambiguidade era resolvida apagando a chave — o
 * produto ficava indistinguível de "não existe na fonte". São coisas
 * diferentes: um precisa de decisão humana, o outro simplesmente não tem
 * registro. Guardar as duas listas é o que permite dizer POR QUE o fiscal não
 * veio.
 */
export interface FonteEcf {
  porNome: Map<string, RegistroEcf>;
  /** Nomes com mais de uma linha. Escolher uma seria sortear imposto. */
  ambiguos: Set<string>;
  /** `true` quando a aba não pôde ser lida — falha temporária, não ausência. */
  indisponivel: boolean;
}

interface Cache {
  expiresAt: number;
  groups: GroupTaxRule[];
  products: Map<string, ProductTaxRule>;
  reform: Map<string, ReformRule>;
  cst: Map<string, { tributacao: string; aliquota: number }>;
  /** Chaveado pelo NOME normalizado; nomes repetidos ficam de fora. */
  ecf: FonteEcf;
}
const CACHE_MS = 5 * 60 * 1000;

/**
 * Uma definição só, no `@pralis/shared`: a tela precisa da MESMA chave para
 * casar produto com grupo, e duas cópias divergiriam sem ninguém notar.
 */
export const normalizeGroup = (value: string): string => ProductRules.normalizarGrupo(value);
export const parseSheetPercent = (value: string): number => { const parsed = Number(value.replace('%', '').replace(/\./g, '').replace(',', '.').trim()); return Number.isFinite(parsed) ? parsed : 0; };
const code = (value: string) => value.replace(/\D/g, '').replace(/^0+(?=\d)/, '');

/** Aba com o cadastro de ECF. Criada por `scripts/montar-aba-fiscal-ecf.ts`. */
export const ABA_ECF = '(TNP) FISCAL - CADASTRO ECF';

/**
 * Chave de nome para casar produto com o cadastro de ECF.
 *
 * SEM ACENTO de propósito: a planilha de cadastro escreve `AÇÚCAR` e o cadastro
 * do Creare escreve `AÇUCAR`. É a mesma palavra, e exigir o acento jogava fora
 * casamentos legítimos — medido: 537 subiram para 565 só tirando o acento.
 * Tirar acento não aproxima produtos diferentes, apenas junta grafias.
 */
export const chaveNomeEcf = (value: string): string => String(value ?? '')
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/\p{Cf}/gu, '')
  .replace(/[^A-Za-z0-9 ]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .toUpperCase();

/**
 * Campo do Creare com casas decimais IMPLÍCITAS para número.
 *
 * A escala não é uniforme e não dá para adivinhar pelo tamanho: `18000` em
 * ALIQUOTA CHEIA é 18,000% (3 casas) e `5333` em REDUCAO_ICMS é 53,33% (2
 * casas). Por isso a escala é dita por quem chama, a partir do que os dados
 * mostram — e não inferida aqui.
 *
 * Também aceita o formato já pontuado (`0,00`), que aparece em % NCM e ICMS.
 */
export const parseCampoCreare = (value: string, casas: number): number | null => {
  const bruto = String(value ?? '').trim();
  if (bruto === '') return null;
  if (bruto.includes(',') || bruto.includes('.')) {
    const n = Number(bruto.replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  if (!/^\d+$/.test(bruto)) return null; // "X" e afins: lixo, não zero
  const n = Number(bruto) / 10 ** casas;
  return Number.isFinite(n) ? n : null;
};

/**
 * NCM tem 8 dígitos FIXOS, e o zero à esquerda faz parte do código.
 *
 * O `code()` acima serve para código de barras, onde zero à esquerda é ruído —
 * e é exatamente por isso que não serve aqui: ele transformava `04051000` em
 * `4051000`. A planilha também já chega assim em 77 dos 940 produtos, porque o
 * Excel trata NCM como número e come o zero.
 *
 * Só completa o que é curto: 8 dígitos passa intacto, e nada que tenha mais de
 * 8 ou que esteja vazio é inventado.
 */
export const ncmCode = (value: string): string => {
  const digitos = String(value ?? '').replace(/\D/g, '');
  if (!digitos) return '';
  return digitos.length < 8 ? digitos.padStart(8, '0') : digitos;
};
export const barcodeCandidates = (barcode: string | null | undefined): string[] => {
  const digits = (barcode ?? '').replace(/\D/g, ''); const out = new Set<string>();
  if (digits) out.add(code(digits));
  if (digits.length === 13 && digits.startsWith('2')) out.add(code(digits.slice(1, 6)));
  return [...out];
};

@injectable()
export class TaxRuleService {
  private cache: Cache | null = null;
  constructor(@inject(SHEETS_GATEWAY) private sheets: SheetsGateway) {}

  /**
   * Margem padrão por grupo, da aba de grupos oficiais (coluna M = grupo,
   * N = margem).
   *
   * Lido numa chamada SEPARADA e com `catch` de propósito. Já aconteceu de uma
   * faixa fora da grade derrubar o lote inteiro e levar junto as tabelas
   * fiscais que continuavam existindo — e a margem é conveniência, enquanto a
   * regra fiscal é o que impede cadastro errado. Aba quebrada devolve mapa
   * vazio e a margem volta a ser digitada na mão, sem derrubar nada.
   *
   * O valor é FRAÇÃO (`0,2` = 20%). Se vier com `%`, é convertido.
   */
  private async margensPorGrupo(): Promise<Map<string, number>> {
    try {
      const ranges = await this.sheets.batchGetValues(
        env.GOOGLE_SHEETS_SPREADSHEET_ID,
        [a1(env.GOOGLE_SHEETS_GRUPOS_TAB, 'M5:N130')],
        'FORMATTED_VALUE',
      );
      const mapa = new Map<string, number>();
      for (const [grupo = '', margem = ''] of ranges[0] ?? []) {
        const chave = normalizeGroup(grupo);
        const bruto = String(margem).trim();
        if (!chave || bruto === '') continue;
        const valor = parseSheetPercent(bruto);
        if (!Number.isFinite(valor) || valor <= 0) continue;
        const fracao = bruto.includes('%') ? valor / 100 : valor;
        /*
         * Limite de sanidade: margem acima de 500% não existe no varejo — é
         * sinal de coluna lida errado. Recusar em silêncio é melhor que
         * preencher o cadastro com um preço absurdo. Os valores reais hoje são
         * 0,1 / 0,2 / 0,3.
         */
        if (fracao > 5) continue;
        mapa.set(chave, fracao);
      }
      return mapa;
    } catch {
      return new Map();
    }
  }

  private async load(): Promise<Cache> {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache;
    const missing = [...destinoSheetsFaltando(), ...credenciaisSheetsFaltando()];
    if (missing.length) throw new AppError(`Regras fiscais indisponíveis: configuração incompleta (${missing.join(', ')}).`, 503, 'TAX_RULES_UNAVAILABLE');
    const FAIXA_GRUPOS = 'AB4:AG79';
    const demais = ['A4:E2000', 'H4:M200', 'O4:Q20'].map((r) => a1(env.GOOGLE_SHEETS_FISCAL_TAB, r));
    let ranges: string[][][];
    try {
      ranges = await this.sheets.batchGetValues(
        env.GOOGLE_SHEETS_SPREADSHEET_ID,
        [a1(env.GOOGLE_SHEETS_FISCAL_TAB, FAIXA_GRUPOS), ...demais],
        'FORMATTED_VALUE',
      );
    } catch {
      // UMA faixa fora da grade derruba o LOTE inteiro — e levava junto as três
      // tabelas que continuam existindo. Relê sem a faixa de grupos: se o resto
      // vier, o problema é só ela, e o erro abaixo diz exatamente qual.
      const semGrupos = await this.sheets
        .batchGetValues(env.GOOGLE_SHEETS_SPREADSHEET_ID, demais, 'FORMATTED_VALUE')
        .catch(() => null);
      if (!semGrupos) {
        // Não expõe o erro bruto do Google (traz URL e IDs internos).
        throw new AppError(
          `Não foi possível ler a aba fiscal "${env.GOOGLE_SHEETS_FISCAL_TAB}".`,
          503,
          'TAX_RULES_SOURCE_INVALID',
        );
      }
      ranges = [[], ...semGrupos];
    }
    const [groupRows = [], productRows = [], reformRows = [], cstRows = []] = ranges;
    const unique = new Map<string, GroupTaxRule>();
    for (const row of groupRows ?? []) {
      const [grupo = '', cst = '', tributacao = '', aliquota = '', icms = '', base = ''] = row; const key = normalizeGroup(grupo);
      if (key && cst) unique.set(key, { grupo: grupo.replace(/\p{Cf}/gu, '').replace(/\s+/g, ' ').trim(), cstPisCofins: cst.trim(), tributacaoSimples: tributacao.trim(), aliquotaSimples: parseSheetPercent(aliquota), icmsRe: parseSheetPercent(icms), baseFiscal: base.trim(), margemPadrao: null });
    }

    /*
     * A margem entra DEPOIS e só onde o grupo já existe na tabela fiscal.
     * Casar contra os grupos conhecidos é a proteção: sem isso, uma faixa
     * lida errado injetaria "margem" a partir de qualquer coluna numérica —
     * foi o que um teste pegou, com o CST virando margem de 600%.
     */
    for (const [chave, margem] of await this.margensPorGrupo()) {
      const regra = unique.get(chave);
      if (regra) regra.margemPadrao = margem;
    }
    const products = new Map<string, ProductTaxRule>();
    for (const [codigo = '', ncm = '', cst = '', icms = '', nome = ''] of productRows ?? []) if (code(codigo) && ncm) products.set(code(codigo), { codigo: code(codigo), ncm: ncmCode(ncm), cst: cst.trim(), icmsRe: parseSheetPercent(icms), nome: nome.trim() });
    const reform = new Map<string, ReformRule>();
    for (const [ncm = '', , cst = '', classe = '', ibs = '', cbs = ''] of reformRows ?? []) if (ncmCode(ncm)) reform.set(ncmCode(ncm), { cst: cst.trim(), cClassTrib: classe.trim(), ibs: parseSheetPercent(ibs), cbs: parseSheetPercent(cbs) });
    const cstMap = new Map<string, { tributacao: string; aliquota: number }>();
    for (const [cst = '', tributacao = '', aliquota = ''] of cstRows ?? []) if (cst) cstMap.set(cst.trim(), { tributacao: tributacao.trim(), aliquota: parseSheetPercent(aliquota) });
    const groups = [...unique.values()].sort((a, b) => a.grupo.localeCompare(b.grupo, 'pt-BR'));
    if (!groups.length) {
      throw new AppError(
        `A tabela de regras por grupo não foi encontrada em "${env.GOOGLE_SHEETS_FISCAL_TAB}"!${FAIXA_GRUPOS}. ` +
        'Restaure nessa faixa as colunas grupo, CST PIS/COFINS, tributação (Simples), alíquota, % ICMS RE e base fiscal.',
        503,
        'TAX_RULES_EMPTY',
      );
    }
    const ecf = await this.carregarEcf();
    this.cache = { expiresAt: Date.now() + CACHE_MS, groups, products, reform, cst: cstMap, ecf }; return this.cache;
  }

  /**
   * Cadastro de ECF por produto, em leitura SEPARADA e à prova de falha.
   *
   * Separada de propósito: uma faixa fora da grade derruba o lote inteiro do
   * Sheets, e já aconteceu de a aba fiscal sumir e levar junto todas as tabelas
   * — o cadastro parou de salvar por completo. Aqui, se a aba não existir ou
   * vier vazia, o resultado é um mapa vazio e o cadastro segue exatamente como
   * era antes: sem os campos de ECF, nunca quebrado.
   *
   * Colunas, na ordem que `montar-aba-fiscal-ecf.ts` grava (linha 1 = cabeçalho):
   *   A COD INTERNO · B NOME · C NOME NO ESTUDO · D CASOU POR
   *   E REDUCAO_ICMS · F ALIQUOTA CHEIA · G ALIQUOTA FCP · H CST PIS/COFINS
   *   I ALIQUOTA PIS · J ALIQUOTA COFINS · K ALIQUOTA ECF · L ALIQUOTA ECF ID
   *   M NCM · N CATEGORIA · O % NCM · P ICMS · Q CODIGO CEST
   */
  private async carregarEcf(): Promise<FonteEcf> {
    let linhas: string[][];
    try {
      const [lido] = await this.sheets.batchGetValues(
        env.GOOGLE_SHEETS_SPREADSHEET_ID, [a1(ABA_ECF, 'A2:Q4000')], 'FORMATTED_VALUE',
      );
      linhas = (lido ?? []) as string[][];
    } catch {
      // falha de LEITURA, não ausência de registro: quem chama precisa saber a
      // diferença para não marcar como "sem correspondência" o que só não pôde
      // ser consultado agora
      return { porNome: new Map(), ambiguos: new Set(), indisponivel: true };
    }

    /*
     * Nome repetido NÃO entra. Duas linhas com o mesmo nome são dois produtos
     * diferentes, e escolher uma delas seria atribuir imposto por sorteio.
     * Melhor deixar o campo vazio e a pessoa preencher.
     */
    const vistos = new Set<string>();
    const ambiguos = new Set<string>();
    const mapa = new Map<string, RegistroEcf>();

    for (const l of linhas) {
      const chave = chaveNomeEcf(String(l?.[1] ?? ''));
      if (!chave) continue;
      if (vistos.has(chave)) { ambiguos.add(chave); continue; }
      vistos.add(chave);
      const t = (i: number) => String(l?.[i] ?? '').trim() || null;
      mapa.set(chave, {
        ncm: ncmCode(String(l?.[12] ?? '')) || null,
        cstEcf: t(7),
        pctNcm: parseCampoCreare(String(l?.[14] ?? ''), 2),
        // escalas medidas no dado real: 5333 = 53,33% e 18000 = 18,000%
        reducaoIcms: parseCampoCreare(String(l?.[4] ?? ''), 2),
        aliquotaCheia: parseCampoCreare(String(l?.[5] ?? ''), 3),
        aliquotaFcp: parseCampoCreare(String(l?.[6] ?? ''), 2),
        // PIS e COFINS são zero em todas as 3.122 linhas de hoje: a escala não
        // é verificável no dado, e zero é zero em qualquer escala. Se um valor
        // diferente de zero aparecer, confira a escala antes de confiar.
        aliquotaPis: parseCampoCreare(String(l?.[8] ?? ''), 4),
        aliquotaCofins: parseCampoCreare(String(l?.[9] ?? ''), 4),
        aliquotaEcf: t(10),
        aliquotaEcfId: t(11),
        categoria: t(13),
        icms: parseCampoCreare(String(l?.[15] ?? ''), 2),
        cest: t(16),
      });
    }
    for (const chave of ambiguos) mapa.delete(chave);
    return { porNome: mapa, ambiguos, indisponivel: false };
  }

  async list(): Promise<GroupTaxRule[]> { return (await this.load()).groups; }
  async requireForGroup(group: string): Promise<GroupTaxRule> { const rule = (await this.list()).find((item) => normalizeGroup(item.grupo) === normalizeGroup(group)); if (!rule) throw new AppError(`O grupo "${group}" não possui regra fiscal cadastrada.`, 422, 'TAX_RULE_NOT_FOUND'); return rule; }
  /**
   * `nome` é opcional e serve só para o cadastro de ECF, que não tem código de
   * barras: a coluna REFERENCIA do Creare é `0000000000000000` em todas as
   * 3.122 linhas. Sem o nome, a classificação continua exatamente como era —
   * grupo e de-para por barras —, apenas sem os campos de ECF.
   */
  /**
   * A classificação com o PORQUÊ junto — é esta que os cadastros usam.
   *
   * `classify()` continua existindo para quem só quer a regra e sabe lidar com
   * a exceção; aqui nada lança, porque o cadastro não pode ser derrubado por
   * fiscal: o produto é salvo e a pendência fica visível.
   *
   * A ordem das decisões é a ordem em que elas se tornam impossíveis:
   *  1. sem grupo com regra não existe classificação nenhuma;
   *  2. sem nome não há como consultar o cadastro de ECF;
   *  3. nome ambíguo na fonte não escolhe linha;
   *  4. fonte fora do ar não é o mesmo que produto sem registro;
   *  5. CST do grupo contra CST da fonte é divergência, não preferência.
   */
  async classificar(entrada: EntradaFiscal): Promise<ResultadoFiscal> {
    const grupo = entrada.grupo?.trim();
    if (!grupo) {
      return {
        estado: 'pendente_grupo_invalido',
        motivo: 'Produto sem grupo de mercadorias: não há regra fiscal para aplicar.',
        classificacao: null,
        conflitos: [],
      };
    }

    let cache: Cache;
    let classificacao: FiscalClassification;
    try {
      cache = await this.load();
      classificacao = await this.classify(grupo, entrada.codigoBarras, entrada.nome);
    } catch (e) {
      const semRegra = e instanceof AppError && e.code === 'TAX_RULE_NOT_FOUND';
      return {
        estado: semRegra ? 'pendente_grupo_invalido' : 'fonte_indisponivel',
        motivo: semRegra
          ? `O grupo "${grupo}" não está entre as regras fiscais oficiais. Corrija o grupo na BASE.`
          : 'Não consegui ler a tabela fiscal agora. O cadastro foi salvo; o fiscal será completado sozinho.',
        classificacao: null,
        conflitos: [],
      };
    }

    const chave = entrada.nome ? chaveNomeEcf(entrada.nome) : '';
    if (!chave) {
      return {
        estado: 'parcial',
        motivo: 'Sem nome para consultar o cadastro de ECF: só a regra do grupo foi aplicada.',
        classificacao,
        conflitos: [],
      };
    }
    if (cache.ecf.ambiguos.has(chave)) {
      return {
        estado: 'pendente_ambiguo',
        motivo: 'Há mais de um registro de ECF com este nome. Escolher um seria sortear imposto.',
        classificacao,
        conflitos: [],
      };
    }
    if (!classificacao.ecf) {
      return {
        estado: cache.ecf.indisponivel ? 'fonte_indisponivel' : 'parcial',
        motivo: cache.ecf.indisponivel
          ? 'Cadastro de ECF indisponível agora. O fiscal será completado sozinho depois.'
          : 'Este produto não existe no cadastro de ECF: alíquota e código de ECF ficam em branco até serem cadastrados lá.',
        classificacao,
        conflitos: [],
      };
    }

    /*
     * CST do GRUPO contra CST da fonte de ECF.
     *
     * O `99` do ECF é "outras operações" — marcação genérica do cadastro antigo,
     * não classificação. Só vira conflito quando a fonte afirma um CST de
     * verdade e ele discorda do grupo. Medido hoje: 1 produto.
     */
    const conflitos: ResultadoFiscal['conflitos'] = [];
    const cstEcf = classificacao.ecf.cstEcf;
    if (cstEcf && cstEcf !== '99' && cstEcf !== classificacao.cstPisCofins) {
      conflitos.push({ campo: 'cstPisCofins', doGrupo: classificacao.cstPisCofins, doEcf: cstEcf });
    }
    if (conflitos.length) {
      return {
        estado: 'pendente_conflito',
        motivo: `O grupo diz CST ${classificacao.cstPisCofins} e o cadastro de ECF diz CST ${cstEcf}. `
          + 'Nenhum dos dois foi escolhido sozinho: precisa de decisão fiscal.',
        classificacao,
        conflitos,
      };
    }

    return { estado: 'completo', motivo: 'Fiscal completo.', classificacao, conflitos: [] };
  }

  async classify(group: string, barcode?: string | null, nome?: string | null): Promise<FiscalClassification> {
    const cache = await this.load(); const groupRule = await this.requireForGroup(group); const candidates = barcodeCandidates(barcode);
    const matchIndex = candidates.findIndex((candidate) => cache.products.has(candidate)); const product = matchIndex >= 0 ? cache.products.get(candidates[matchIndex]!)! : null;
    const cst = product?.cst || groupRule.cstPisCofins; const cstRule = cache.cst.get(cst); const reform = product?.ncm ? cache.reform.get(product.ncm) : null;
    const ecf = nome ? cache.ecf.porNome.get(chaveNomeEcf(nome)) ?? null : null;
    return { ...groupRule, cstPisCofins: cst, icmsRe: product?.icmsRe ?? groupRule.icmsRe, tributacaoSimples: cstRule?.tributacao || groupRule.tributacaoSimples, aliquotaSimples: cstRule?.aliquota ?? groupRule.aliquotaSimples, ncm: product?.ncm ?? null, codigoFiscal: product?.codigo ?? null, produtoFiscal: product?.nome ?? null, cstReforma: reform?.cst || null, cClassTrib: reform?.cClassTrib || null, aliquotaIbs: reform?.ibs ?? null, aliquotaCbs: reform?.cbs ?? null, origem: product ? (matchIndex === 0 ? 'produto' : 'plu_balanca') : 'grupo', ecf };
  }
}
