/**
 * Reconciliação do código de cadastro com a numeração real da rede.
 *
 * Motor PURO: recebe os produtos e o de-para do SIA já lidos e devolve uma
 * proposta por produto. Não conhece banco, Google nem HTTP.
 *
 * ## Por que o `coditem` do SIA é a régua
 *
 * Medido em 18/09/2026, cruzando a aba `MIX PRODUTOS LOJA E PRODUÇÃO
 * ASSOCIAÇÃO` com o de-para do SIA: **2.962 linhas têm o mesmo código E o mesmo
 * nome** (`10000` = `ABACAXI UNID` nos dois). O `COD INTERNO` da planilha e o
 * `coditem` do PDV são a mesma numeração — não são dois campos.
 *
 * E o `codigo_interno` **alimenta o PDV**: `creare.generator.ts` recusa o
 * produto (`CreareValidationError`, que o `creare.service.ts` transforma em
 * "produto inválido") quando o código interno do Pralis diverge do `coditem`
 * do SIA para o mesmo código de barras; quando não há par no SIA, ele escreve
 * o `codigo_interno` direto como código do PDV. Ou seja: alinhar os dois não é
 * arrumação cosmética, é o que faz a exportação do Creare voltar a exportar.
 */

/** Uma linha do de-para do SIA, reduzida ao que decide o código. */
export interface ParSia {
  loja: string;
  coditem: string;
  /** Código de barras já normalizado — é a chave de casamento. */
  chaveBarras: string;
  descricao: string;
}

export interface ProdutoParaReconciliar {
  id: string;
  loja: string;
  nome: string;
  codigoBarras: string | null;
  codigoInterno: string | null;
}

/**
 * Onde cada produto cai.
 *
 * Só `exato` é adotado sem clique humano. `disputado` existe porque duas linhas
 * do cadastro do Pralis podem apontar para o mesmo `coditem` — e nesse caso
 * adotar os dois criaria código repetido, que é o defeito que nenhum índice
 * pega hoje.
 */
export type BaldeCodigo = 'ja-correto' | 'exato' | 'conflito-sia' | 'disputado' | 'novo';

export interface PropostaCodigo {
  produto: ProdutoParaReconciliar;
  balde: BaldeCodigo;
  codigoProposto: string | null;
  /** Os pares do SIA que casaram — o que a pessoa lê para decidir. */
  candidatos: ParSia[];
  motivo: string;
}

const digitos = (valor: unknown): string => String(valor ?? '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');

/** Código de cadastro com cinco casas, como a planilha e a coluna AC. */
export const formatarCodigoCadastro = (valor: unknown): string => digitos(valor).padStart(5, '0');

/**
 * Faixa aceitável para um código de cadastro.
 *
 * O teto de 9 dígitos é do layout do Creare (`creare.generator.ts`): acima
 * disso o produto é derrubado do TXT. O piso existe porque `0` não é código.
 * Sem esta faixa, um código de barras digitado por engano na coluna do código
 * (o erro que o PR #62 documentou) viraria o teto da numeração e a cunhagem
 * seguinte sairia na casa dos trilhões.
 */
export const MAIOR_CODIGO_CADASTRO = 999_999_999;

export const codigoCadastroValido = (valor: unknown): boolean => {
  const n = Number(digitos(valor));
  return Number.isInteger(n) && n > 0 && n <= MAIOR_CODIGO_CADASTRO;
};

/**
 * Menor número de dígitos para tratar um valor como código de barras. EAN-8 é
 * o menor padrão real; abaixo disso é PLU, código de cadastro digitado no campo
 * errado, ou sobra de importação.
 *
 * Foi por ignorar esse piso que a tentativa anterior (PR #62) ligou COXINHA DE
 * COSTELA a um produto sem relação: os dois lados guardavam `11151`, que não é
 * código de barras de ninguém.
 */
const MENOR_CODIGO_DE_BARRAS = 8;

/**
 * Chaves pelas quais o código de barras de um produto pode casar, e se cada uma
 * é forte o bastante para decidir sozinha.
 *
 * A força é do lado do PRODUTO, de propósito. Se bastasse o de-para reconhecer
 * a chave, uma única etiqueta de balança no SIA cujo PLU fosse `11151` faria o
 * produto que guarda `11151` no campo de barras ser adotado sem clique humano —
 * o caso do PR #62 voltando pela porta lateral.
 *
 * A regra da balança (13 dígitos começando em 2, PLU nos dígitos 2 a 6) é a
 * mesma de `barcodeCandidates` (`tax-rule.service.ts`), que é como o Creare já
 * casa produto com SIA.
 */
const chavesDeBarras = (codigoBarras: string | null | undefined): Map<string, boolean> => {
  const crus = String(codigoBarras ?? '').replace(/\D/g, '');
  const chaves = new Map<string, boolean>();
  if (!crus) return chaves;
  chaves.set(digitos(crus), crus.length >= MENOR_CODIGO_DE_BARRAS);
  if (crus.length === 13 && crus.startsWith('2')) chaves.set(digitos(crus.slice(1, 6)), true);
  return chaves;
};

const decidir = (
  produto: ProdutoParaReconciliar,
  porChave: Map<string, ParSia[]>,
  porCoditem: Map<string, ParSia[]>,
): PropostaCodigo => {
  const vistos = new Set<string>();
  const fortes: ParSia[] = [];
  const fracos: ParSia[] = [];
  for (const [chave, forte] of chavesDeBarras(produto.codigoBarras)) {
    for (const par of porChave.get(chave) ?? []) {
      const id = `${par.loja}:${par.coditem}`;
      if (vistos.has(id)) continue;
      vistos.add(id);
      (forte ? fortes : fracos).push(par);
    }
  }

  if (fortes.length === 0) {
    /*
     * Sem casamento por barras, mas o código que o produto JÁ TEM é um
     * `coditem` de verdade no SIA. Então ele está alinhado — e não pode cair em
     * "sem par", onde a tela ofereceria cunhar um número novo POR CIMA do
     * código certo.
     *
     * Isto não é caso raro: 2.139 das 2.968 linhas do de-para não têm código de
     * barras (o SIA guarda o próprio código nesse campo), e os produtos que
     * vieram delas entram no Pralis sem barras nenhuma. É só pelo código que
     * dá para reconhecê-los.
     */
    const peloCodigo = porCoditem.get(digitos(produto.codigoInterno));
    if (peloCodigo?.length) {
      return {
        produto,
        balde: 'ja-correto',
        codigoProposto: null,
        candidatos: peloCodigo,
        motivo: `O código ${formatarCodigoCadastro(produto.codigoInterno)} já é o do produto no SIA.`,
      };
    }
    return fracos.length === 0
      ? {
        produto,
        balde: 'novo',
        codigoProposto: null,
        candidatos: [],
        motivo: 'Nenhum produto do SIA tem este código de barras, e o código atual não existe no PDV.',
      }
      : {
        produto,
        balde: 'conflito-sia',
        codigoProposto: null,
        candidatos: fracos,
        motivo: 'O número deste produto é curto demais para ser código de barras — casou por coincidência.',
      };
  }

  /*
   * Lojas diferentes com `coditem` diferente para o mesmo código de barras: a
   * numeração da rede é uma só (DB-04), então divergência aqui é dado sujo no
   * SIA de alguma loja. Quem decide é gente.
   */
  const codigos = new Set(fortes.map((p) => formatarCodigoCadastro(p.coditem)));
  if (codigos.size > 1) {
    return {
      produto,
      balde: 'conflito-sia',
      codigoProposto: null,
      candidatos: fortes,
      motivo: `As lojas discordam do código no SIA: ${[...codigos].join(', ')}.`,
    };
  }

  const codigo = [...codigos][0]!;
  if (digitos(codigo) === digitos(produto.codigoInterno)) {
    return {
      produto,
      balde: 'ja-correto',
      codigoProposto: null,
      candidatos: fortes,
      motivo: 'O produto já está com o código do PDV.',
    };
  }
  return {
    produto,
    balde: 'exato',
    codigoProposto: codigo,
    candidatos: fortes,
    motivo: `Código de barras casa com ${fortes.map((p) => p.loja).join('/')} no SIA.`,
  };
};

/**
 * Uma proposta por produto, na ordem em que os produtos chegaram.
 *
 * Depois de decidir item a item, rebaixa para `disputado` todo grupo em que
 * DOIS produtos querem o mesmo código. Sem esse segundo passe, o botão que
 * adota em lote gravaria o mesmo código em dois cadastros — e não há índice
 * único em `products.codigo_interno` para reclamar depois.
 */
export const reconciliarCodigoCadastro = (
  produtos: ProdutoParaReconciliar[],
  pares: ParSia[],
): PropostaCodigo[] => {
  const porChave = new Map<string, ParSia[]>();
  const porCoditem = new Map<string, ParSia[]>();
  for (const par of pares) {
    if (!codigoCadastroValido(par.coditem)) continue;
    const cod = digitos(par.coditem);
    porCoditem.set(cod, [...(porCoditem.get(cod) ?? []), par]);
    const chave = digitos(par.chaveBarras);
    if (!chave) continue;
    porChave.set(chave, [...(porChave.get(chave) ?? []), par]);
  }

  const propostas = produtos.map((produto) => decidir(produto, porChave, porCoditem));

  const quantosQuerem = new Map<string, number>();
  for (const p of propostas) {
    if (p.balde !== 'exato' || !p.codigoProposto) continue;
    quantosQuerem.set(p.codigoProposto, (quantosQuerem.get(p.codigoProposto) ?? 0) + 1);
  }
  return propostas.map((p) => (
    p.balde === 'exato' && p.codigoProposto && (quantosQuerem.get(p.codigoProposto) ?? 0) > 1
      ? {
        ...p,
        balde: 'disputado' as const,
        codigoProposto: null,
        motivo: `Outro cadastro do Pralis também aponta para o código ${p.codigoProposto}. Unifique antes de numerar.`,
      }
      : p
  ));
};

/**
 * Próximo código a cunhar.
 *
 * O teto vem da leitura AO VIVO (planilha e banco), nunca de constante: o topo
 * sobe toda vez que alguém cadastra na rede, e cunhar abaixo dele criaria
 * código duplicado com um produto que já existe.
 */
export const calcularProximoCodigoCadastro = (tetoConhecido: number, maiorNoBanco: number): string => {
  const base = Math.max(
    Number.isFinite(tetoConhecido) ? tetoConhecido : 0,
    Number.isFinite(maiorNoBanco) ? maiorNoBanco : 0,
  );
  if (base <= 0) {
    throw new Error('Teto da numeração ausente: não dá para cunhar sem saber onde a numeração está.');
  }
  const proximo = base + 1;
  if (proximo > MAIOR_CODIGO_CADASTRO) {
    throw new Error(`Numeração estourou o limite do PDV (${MAIOR_CODIGO_CADASTRO}).`);
  }
  return formatarCodigoCadastro(proximo);
};
