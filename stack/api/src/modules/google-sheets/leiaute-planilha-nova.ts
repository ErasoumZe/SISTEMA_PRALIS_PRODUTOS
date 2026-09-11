import type { CellMap } from './product-sheet.mapper';
import { faixasDaAba, resolverDestino, normalizarCabecalho, type Faixa } from './sheet-traducao';

/**
 * Traduz o `CellMap` que o mapper produz — chaveado por LETRA da BASE antiga —
 * para as colunas da planilha nova.
 *
 * O mapper escreve por posição fixa, montada para o leiaute antigo. Na planilha
 * nova as mesmas letras significam outra coisa: `F` era QUANTIDADE e agora é
 * CODIGO BARRAS, `G` era MEDIDA BASE e agora é MARCAS. Escrever sem traduzir
 * grava gramatura dentro do código de barras.
 */

/**
 * Que campo cada letra da BASE antiga carrega.
 *
 * Gerado a partir da linha 5 da `(BASE) CADASTRO PRODUTOS` em 09/09/2026, não
 * transcrito à mão. As letras ausentes são colunas auxiliares que a planilha
 * antiga usava nas próprias fórmulas e que não têm sentido fora dela.
 */
export const CAMPO_DA_COLUNA: Readonly<Record<string, string>> = {
  C: 'A/I', D: 'LOJAS', E: 'NOME', F: 'QUANTIDADE', G: 'MEDIDA BASE',
  J: 'CODIGO BARRAS', K: 'MARCAS', L: 'EMB', M: 'C/DE', N: 'QT_CAD', O: 'MEDIDA',
  P: 'COMO SE COMPRA ESSE PRODUTO?',
  R: 'GRUPO MERCADORIAS (REVENDA)', T: 'GRUPO MERCADORIAS (TRANSFORMAÇÃO)',
  V: 'PRECISÃO', W: 'QT_TR', X: 'UN',
  Y: 'CADASTRO PRODUTO RECEITUARIO', Z: 'REFERENCIA PRODUTO RECEITUARIO',
  AC: 'CODIGO INT.', AE: 'ESTOQUE MIN', AG: 'ESTOQUE MAX', AI: 'SETOR ESTOQUE',
  AJ: 'CUSTO', AL: 'MARGEM PONTUAL %', AM: 'V. VENDA PONTUAL', AN: 'AUTO',
  AQ: 'LOCAL VENDA PRIMARIO', AS: 'LOCAL VENDA SECUNDARIO',
  AW: 'PROMOÇÃO VALOR', AZ: 'PROMOÇÃO DESC. %%', BA: 'DESCONTO ATÉ',
  BB: 'SEG', BC: 'TER', BD: 'QUA', BE: 'QUI', BF: 'SEX', BG: 'SAB', BH: 'DOM',
  BL: 'PROMOÇÃO H/INICIO', BO: 'PROMOÇÃO H/TERMINO', BP: 'REVISÃO',
  BS: 'REDUCAO_ICMS', BT: 'ALIQUOTA CHEIA', BU: 'ALIQUOTA FCP',
  BV: 'CST PIS/COFINS', BW: 'ALIQUOTA PIS', BX: 'ALIQUOTA COFINS',
  CA: 'NCM', CB: 'CATEGORIA', CD: 'ICMS', CE: 'CODIGO CEST',
  /*
   * `CF` e `CG` NÃO existem na BASE antiga — são chaves sintéticas.
   *
   * A faixa `CADASTRO - FISCAL` da planilha nova tem `ALIQUOTA ECF` e
   * `ALIQUOTA ECF ID`, que a BASE antiga não tinha e que nenhuma letra
   * carregava. Sem uma chave aqui, o mapper não teria onde pôr o valor e as
   * duas colunas continuariam vazias para sempre.
   *
   * As letras foram escolhidas entre as que a BASE antiga não usava, e não
   * entram em `INPUT_COLUMNS`: no leiaute antigo elas são simplesmente
   * ignoradas, então nada muda lá.
   */
  CF: 'ALIQUOTA ECF', CG: 'ALIQUOTA ECF ID', CH: '% NCM',
};

/*
 * OS DOIS CABEÇALHOS `REDUCAO_ICMS` DA FAIXA FISCAL — `DC` e `DP`.
 *
 * O que o dado mostra: não são dois dados, são o MESMO número em duas
 * notações. No cadastro de origem as duas colunas também existem (`AC` e `AZ`):
 *
 *     AC = 5333   6111       formato do Creare, 2 casas implícitas
 *     AZ = 53,33  61,11      o mesmo valor, escrito como percentual
 *
 * Das 709 linhas com `AZ` preenchido, `AC` e `AZ` coincidem como texto em 1 —
 * exatamente o que se espera de duas grafias do mesmo número.
 *
 * O que o dado NÃO mostra: qual das duas notações o consumidor da planilha
 * nova espera em cada coluna. As duas estão vazias em todas as linhas, então
 * não há precedente ali, e o TXT do Creare é gerado do BANCO, não da planilha.
 *
 * DECISÃO: escrevemos só `DC`, na grafia percentual que o sistema já usava, e
 * deixamos `DP` em branco. Passar a gravar `5333` seria mudar formato fiscal
 * com base em analogia de posição; escrever o percentual nas duas seria o
 * "mesmo valor nos dois lugares por conveniência". Entre errar o formato e
 * deixar uma coluna vazia, a coluna vazia é reversível.
 *
 * Para fechar isto falta UMA resposta: `DC` e `DP` devem receber `5333` e
 * `53,33`, ou o contrário?
 */

/** Mesmo campo, nome diferente nas duas planilhas. Cada um provado no dado. */
export const APELIDO_NA_NOVA: Readonly<Record<string, string>> = {
  // a nova não tem coluna NOME: o nome do produto mora na descrição
  NOME: 'CADASTRO PRODUTOS ATUALIZADO NOVO',
  // a coluna de status chama-se só "V" na nova (a linha 11 traz "INATIVO")
  'A/I': 'V',
  QT_CAD: 'QT',
  QT_TR: 'QT',
  // a nova repete "PROMOÇÃO DESC. %" para a calculada e para a de entrada; a de
  // entrada é a que fica ao lado de DESCONTO ATÉ (provado: -50% junto de ATÉ 50%)
  'PROMOÇÃO DESC. %%': 'PROMOÇÃO DESC. %',
};

/** Desempate quando o nome existe em mais de uma faixa que não é de loja. */
export const FAIXA_DO_CAMPO: Readonly<Record<string, string>> = {
  QT_CAD: 'CADASTRO GERAL',
  QT_TR: 'TRANSFORMAÇÃO',
  UN: 'TRANSFORMAÇÃO',
};

/**
 * Campos da planilha antiga sem razão de existir na nova.
 *
 * `LOJAS` guardava a constante "TNP,LI,HORA" — não era dado do produto. Na
 * planilha nova, quem responde "quais lojas têm este produto" é o preenchimento
 * das faixas de loja, o que reflete o que a loja de fato importou.
 */
const IGNORADOS = new Set(['LOJAS']);

export interface LeiauteNovo {
  faixas: Faixa[];
  cabecalhos: readonly string[];
}

export function lerLeiaute(
  linhaFaixas: readonly string[],
  linhaCabecalhos: readonly string[],
  letra: (i: number) => string,
): LeiauteNovo {
  return {
    // a linha de rótulos vem mais curta: o Sheets corta as células vazias do fim
    faixas: faixasDaAba(linhaFaixas, letra, linhaCabecalhos.length),
    cabecalhos: linhaCabecalhos,
  };
}

export interface TraducaoNova {
  celulas: CellMap;
  /**
   * Campos que esta aba nao tem em lugar nenhum. Sao os que merecem aviso.
   */
  semDestino: string[];
  /**
   * Campos que existem, mas so nas faixas de loja — e este produto e da BASE.
   *
   * NAO sao falha: e o modelo. A BASE cadastra ate o grupo e a loja completa
   * custo, estoque e promocao ao importar. Separado de `semDestino` porque
   * senao todo produto da BASE apareceria com 23 campos "faltando" no health.
   */
  adiadosParaALoja: string[];
}

/**
 * `loja` decide as faixas por loja. Produto da BASE passa `null` e não escreve
 * nelas — quem preenche é a loja, ao importar e completar o cadastro.
 */
export function traduzirParaPlanilhaNova(
  celulas: CellMap,
  leiaute: LeiauteNovo,
  loja: string | null,
  letra: (i: number) => string,
): TraducaoNova {
  const saida: CellMap = {};
  const semDestino: string[] = [];
  const adiados: string[] = [];

  for (const [colunaAntiga, celula] of Object.entries(celulas)) {
    const campo = CAMPO_DA_COLUNA[colunaAntiga];
    if (!campo || IGNORADOS.has(campo)) continue;

    const destino = resolverDestino({
      nome: APELIDO_NA_NOVA[campo] ?? campo,
      loja,
      faixa: FAIXA_DO_CAMPO[campo],
      faixas: leiaute.faixas,
      cabecalhos: leiaute.cabecalhos,
      letra,
    });

    if (destino) { saida[destino] = celula; continue; }

    /*
     * Nao achou. E porque o campo e de loja e este produto e da BASE, ou
     * porque a aba nao tem o campo? Sonda com uma loja para saber — a
     * diferenca decide se isto vira aviso ou nao.
     */
    const existeEmFaixaDeLoja = !loja && resolverDestino({
      nome: APELIDO_NA_NOVA[campo] ?? campo,
      loja: 'TNP',
      faixa: FAIXA_DO_CAMPO[campo],
      faixas: leiaute.faixas,
      cabecalhos: leiaute.cabecalhos,
      letra,
    }) !== null;

    if (existeEmFaixaDeLoja) adiados.push(campo);
    else semDestino.push(campo);
  }

  return {
    celulas: saida,
    semDestino: [...new Set(semDestino)].sort(),
    adiadosParaALoja: [...new Set(adiados)].sort(),
  };
}

/** Coluna de um cabeçalho, sem olhar faixa — serve para achar o `ID`. */
export function colunaDoCampo(
  leiaute: LeiauteNovo,
  nome: string,
  letra: (i: number) => string,
): string | null {
  const procurado = normalizarCabecalho(nome);
  const i = leiaute.cabecalhos.findIndex((c) => normalizarCabecalho(c) === procurado);
  return i >= 0 ? letra(i) : null;
}
