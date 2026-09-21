import { semelhanca } from './semelhanca-de-nome';

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
  /**
   * Só nas SUGESTÕES por nome: 0..100 de parecença. Ausente quando o candidato
   * veio de casamento por código de barras, que não é parecido — é igual.
   */
  semelhanca?: number;
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
export type BaldeCodigo =
  | 'ja-correto'
  | 'exato'
  /** O código está escrito no campo de barras, mas o de-para não o confirma. */
  | 'barras-tem-codigo'
  | 'conflito-sia'
  | 'disputado'
  | 'fora-do-sia'
  | 'novo';

export interface PropostaCodigo {
  produto: ProdutoParaReconciliar;
  balde: BaldeCodigo;
  codigoProposto: string | null;
  /** Os pares do SIA que casaram — o que a pessoa lê para decidir. */
  candidatos: ParSia[];
  motivo: string;
  /**
   * De onde saiu a proposta, para o histórico de troca de código.
   *
   * Vive aqui e não no service porque só o motor sabe qual caminho decidiu:
   * derivar depois, a partir dos candidatos, dava frase errada justamente no
   * caminho que não tem candidato nenhum (o código lido do campo de barras).
   */
  fonte: string;
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

/**
 * Quantas sugestões oferecer. Mais que isso vira lista, não sugestão — mesmo
 * teto do de-para de vendas, que resolve o mesmo problema.
 */
const MAX_SUGESTOES = 5;

/**
 * Abaixo disso o nome não se parece o bastante para valer o clique.
 *
 * O número e a razão são os mesmos do de-para de vendas
 * (`vendas-depara.service.ts`), que já apanhou desse problema: numa tela de
 * confirmação, sugestão ruim não é neutra — ela convida ao clique errado, e
 * aqui o clique errado dá a um produto o código de outro no PDV.
 */
const SEMELHANCA_MINIMA = 55;

/**
 * O código de cadastro que o SIA guarda DENTRO do campo de código de barras.
 *
 * O SIA preenche o campo de barras com o próprio `coditem` alinhado à direita
 * em 14 casas quando o produto não tem etiqueta: `00000000012067` é o produto
 * 12067, não um código de barras. Medido na exportação de 21/09: 2.139 das
 * 2.984 linhas do catálogo (72%) são assim — é a regra, não a exceção.
 *
 * O que identifica o formato é o ALINHAMENTO À DIREITA NUM CAMPO LARGO: campo
 * comprido (14 casas), valor curto, zeros no meio. Os dois lados importam.
 *
 * - campo comprido descarta `11151` cru, que é a armadilha do PR #62: aquele
 *   número não estava zero-preenchido, era o código de cadastro digitado no
 *   campo errado, e casou com o PLU de outro produto por coincidência;
 * - valor curto descarta etiqueta de verdade zero-preenchida — medido: quando
 *   o campo é o coditem o valor tem 5 ou 6 dígitos, quando é etiqueta tem 8 ou
 *   mais (os 48 EAN-8 do tipo `00000078939318`). Zero sobreposição, e é o mesmo
 *   `MENOR_CODIGO_DE_BARRAS` que separa as duas leituras.
 *
 * O piso vem do de-para (é o que barra `0000000000000`, que vira `0`). O teto
 * NÃO: é a fronteira da entrega. Usar o maior coditem conhecido derrubaria
 * justamente os códigos que faltam — e é por estarem faltando que este caminho
 * existe. Um export atrasado não pode estreitar a faixa que ele mesmo não cobre.
 */
export const PRIMEIRO_CODIGO_DE_ENTREGA = 700_000;

const codigoNasBarras = (
  codigoBarras: string | null | undefined,
  pisoDaRede: number,
): string | null => {
  const crus = String(codigoBarras ?? '').replace(/\D/g, '');
  const n = digitos(crus);
  if (!n || n.length >= MENOR_CODIGO_DE_BARRAS) return null;
  // sem zeros à esquerda num campo largo não é o formato do SIA, é outra coisa
  if (crus.length < MENOR_CODIGO_DE_BARRAS || crus.length === n.length) return null;
  if (pisoDaRede <= 0) return null;
  const valor = Number(n);
  return valor >= pisoDaRede && valor < PRIMEIRO_CODIGO_DE_ENTREGA ? n : null;
};

/** Os nomes mais parecidos no SIA, excluindo código que outro produto já tem. */
const sugerirPorNome = (
  nome: string,
  pares: ParSia[],
  codigosOcupados: Set<string>,
): ParSia[] => {
  if (!nome.trim()) return [];
  const vistos = new Set<string>();
  return pares
    .filter((p) => {
      const cod = digitos(p.coditem);
      // código que já é de outro cadastro não pode ser sugerido a ninguém
      if (codigosOcupados.has(cod)) return false;
      if (vistos.has(cod)) return false;
      vistos.add(cod);
      return true;
    })
    .map((p) => ({ ...p, semelhanca: semelhanca(nome, p.descricao) }))
    .filter((p) => p.semelhanca >= SEMELHANCA_MINIMA)
    .sort((a, b) => b.semelhanca - a.semelhanca)
    .slice(0, MAX_SUGESTOES);
};

const decidir = (
  produto: ProdutoParaReconciliar,
  porChave: Map<string, ParSia[]>,
  porCoditem: Map<string, ParSia[]>,
  /** Menor coditem visto no SIA: onde começa a numeração da rede. */
  pisoDaRede: number,
  todos: ParSia[],
  codigosOcupados: Set<string>,
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
        fonte: 'Nada a gravar: o código já é o do SIA.',
      };
    }
    /*
     * O código do produto está ESCONDIDO no campo de código de barras.
     *
     * Caso levantado pelo José em 21/09: ROCAMBOLE PRESTIGIO GR carrega
     * `00000000012563` no campo de barras e o código velho `00322` no campo do
     * código. O 12563 é o `coditem` do produto no SIA — o de-para é que não o
     * lista, porque a exportação usada está atrasada (medido: 143 códigos que
     * a MIX conhece e a exportação não).
     *
     * Antes disto o produto caía em `novo` e a tela oferecia CUNHAR, ou pior:
     * depois da sugestão por nome, oferecia adotar `11488` com 92% de
     * parecença — um produto diferente. Dar ao PDV o código de outro produto é
     * o estrago que esta tela existe para impedir.
     *
     * Por isso a leitura das barras vem ANTES da sugestão por nome: quando o
     * número está escrito no cadastro, não se adivinha por semelhança.
     */
    const nasBarras = codigoNasBarras(produto.codigoBarras, pisoDaRede);
    if (nasBarras && digitos(nasBarras) !== digitos(produto.codigoInterno)) {
      const codigo = formatarCodigoCadastro(nasBarras);
      return {
        produto,
        balde: 'barras-tem-codigo',
        codigoProposto: codigo,
        candidatos: [],
        motivo: `O campo de código de barras guarda ${codigo}, que é o código deste produto no SIA. O de-para carregado não lista esse código — provavelmente a exportação do SIA está atrasada.`,
        fonte: `Código lido do campo de barras do próprio cadastro (${codigo})`,
      };
    }

    /*
     * Sem par, mas o produto JÁ TEM um código dentro da faixa da rede.
     *
     * É o caso de quem veio da planilha e o PDV ainda não cadastrou: medido em
     * 21/09, 161 produtos da MIX têm código que o SIA não conhece — `10365
     * 5STAR 40G`, `10372 BATON BRANCO 16G`. O código deles está certo; o que
     * falta é o produto existir no PDV.
     *
     * Eles não podem dividir balde com quem precisa de número novo. Oferecer
     * cunhagem aqui trocaria 10365 por 13138 e quebraria o alinhamento que a
     * importação acabou de construir.
     */
    if (pisoDaRede > 0 && Number(digitos(produto.codigoInterno)) >= pisoDaRede) {
      return {
        produto,
        balde: 'fora-do-sia',
        codigoProposto: null,
        candidatos: [],
        motivo: `Já tem o código ${formatarCodigoCadastro(produto.codigoInterno)}, mas o PDV ainda não cadastrou este produto.`,
        fonte: 'Nada a gravar: o código já é da faixa da rede.',
      };
    }
    if (fracos.length === 0) {
      /*
       * Última tentativa antes de mandar para cunhagem: procurar pelo NOME.
       *
       * É o caso do TRIDENT, que o José encontrou em 21/09. O produto existe na
       * rede com código certo (`10419 TRIDENTE TUTTI-FRUTTI 8G ROSA`), mas nem
       * ele nem a linha do SIA têm código de barras — não há chave nenhuma para
       * casar. Sem isto, o cadastro antigo (`00253`) ia para cunhagem e ganharia
       * um 13138 novo, deixando dois números para o mesmo produto na rede.
       *
       * Sugestão NUNCA decide: o balde continua sendo o de decisão humana, e
       * a semelhança vai junto na tela para a pessoa ver o quanto é parecido.
       */
      const sugestoes = sugerirPorNome(produto.nome, todos, codigosOcupados);
      if (sugestoes.length) {
        return {
          produto,
          balde: 'novo',
          codigoProposto: null,
          candidatos: sugestoes,
          motivo: 'Sem código de barras dos dois lados. Estes são os nomes mais parecidos no SIA — confira antes de escolher.',
          fonte: 'Sugestão por semelhança de nome, escolhida a mão.',
        };
      }
      return {
        produto,
        balde: 'novo',
        codigoProposto: null,
        candidatos: [],
        motivo: 'Nenhum produto do SIA tem este código de barras ou nome parecido.',
        fonte: 'Sem par no SIA: só resta cunhar.',
      };
    }
    return {
      produto,
      balde: 'conflito-sia',
      codigoProposto: null,
      candidatos: fracos,
      motivo: 'O número deste produto é curto demais para ser código de barras — casou por coincidência.',
      fonte: 'Casamento fraco por barras, escolhido a mão.',
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
      fonte: 'Desempate entre lojas, escolhido a mão.',
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
      fonte: 'Nada a gravar: o produto já está certo.',
    };
  }
  return {
    produto,
    balde: 'exato',
    codigoProposto: codigo,
    candidatos: fortes,
    motivo: `Código de barras casa com ${fortes.map((p) => p.loja).join('/')} no SIA.`,
    fonte: `SIA ${fortes.map((p) => p.loja).join('/')} (código de barras exato)`,
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

  /*
   * O piso da faixa da rede sai do PRÓPRIO de-para — o menor `coditem` que o
   * SIA usa. Nada de constante: se a rede renumerar, o piso acompanha.
   */
  const pisoDaRede = [...porCoditem.keys()].reduce((menor, c) => {
    const n = Number(c);
    return Number.isFinite(n) && (menor === 0 || n < menor) ? n : menor;
  }, 0);

  /*
   * Códigos que algum cadastro JÁ tem: nenhum deles pode ser sugerido a outro
   * produto, senão a sugestão cria o duplicado que o balde `disputado` existe
   * para impedir.
   */
  const codigosOcupados = new Set(
    produtos.map((p) => digitos(p.codigoInterno)).filter(Boolean),
  );

  const propostas = produtos.map(
    (produto) => decidir(produto, porChave, porCoditem, pisoDaRede, pares, codigosOcupados),
  );

  /*
   * O passe de injetividade vale para TODO balde que propõe código, não só
   * `exato` — `barras-tem-codigo` também propõe, e dois cadastros com o mesmo
   * número no campo de barras (que é o que duplicata é) passariam direto pelo
   * botão de lote.
   */
  const propoe = (p: PropostaCodigo) => (p.balde === 'exato' || p.balde === 'barras-tem-codigo')
    && !!p.codigoProposto;

  const quantosQuerem = new Map<string, number>();
  for (const p of propostas) {
    if (!propoe(p)) continue;
    quantosQuerem.set(p.codigoProposto!, (quantosQuerem.get(p.codigoProposto!) ?? 0) + 1);
  }

  /*
   * E ninguém pode receber um código que outro cadastro JÁ TEM. O `decidir`
   * barra isso item a item; sem esta linha, o lote não barrava.
   */
  const jaGravados = new Set(
    propostas.map((p) => digitos(p.produto.codigoInterno)).filter(Boolean),
  );

  return propostas.map((p) => {
    if (!propoe(p)) return p;
    const querem = quantosQuerem.get(p.codigoProposto!) ?? 0;
    const doOutro = jaGravados.has(digitos(p.codigoProposto))
      && digitos(p.produto.codigoInterno) !== digitos(p.codigoProposto);
    if (querem <= 1 && !doOutro) return p;
    return {
      ...p,
      balde: 'disputado' as const,
      codigoProposto: null,
      motivo: doOutro
        ? `O código ${p.codigoProposto} já é de outro cadastro do Pralis. Unifique os dois antes de numerar.`
        : `Outro cadastro do Pralis também aponta para o código ${p.codigoProposto}. Unifique antes de numerar.`,
    };
  });
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
