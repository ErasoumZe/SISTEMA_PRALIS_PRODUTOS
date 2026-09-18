/**
 * Custo do produto a partir da base de discriminação de mercadorias.
 *
 * Motor PURO. A regra não é minha: está no **DB-05** do `docs/backlog.md` —
 * *"preparar/oculto para buscar último custo da base de discriminação"*. A aba
 * `TNP - DISCRIMINAÇÃO MERCADORIAS (MER)` é essa base, e cada linha dela é um
 * **lançamento de compra**, não um cadastro: o mesmo produto aparece uma vez por
 * nota. O custo do produto é o `VALOR CUSTO UN` da compra **mais recente**.
 *
 * A chave é o NOME, porque a aba não tem código. Isso normalmente seria fraco
 * demais para decidir — aqui vale porque os nomes são os mesmos do PDV
 * (conferido: `COCA COLA 600ML`, `SPRITE LATA 220ML` e `ICE TEA LEAO PESSEGO
 * 450ML` batem letra a letra entre a discriminação, a MIX e o de-para do SIA).
 * Mesmo assim, nome ambíguo dos dois lados NÃO recebe custo: fica sem, e a
 * prévia mostra quantos ficaram.
 */

/** Um lançamento de compra da aba de discriminação. */
export interface LancamentoMer {
  linha: number;
  /** Coluna `PRODUTOS` — o nome, como está na nota. */
  produto: string;
  /** Coluna `VALOR CUSTO UN`. */
  custoUnitario: string;
  /** Coluna `DATA REF` (dd/mm/aa) — é ela que diz qual compra é a mais recente. */
  dataRef: string;
}

export interface ProdutoParaCustear {
  id: string;
  nome: string;
  /** O custo que já está no cadastro, para não regravar o mesmo valor. */
  custo: string | null;
  /**
   * Quantos itens vêm na embalagem de compra.
   *
   * É o que converte o custo unitário da nota no campo `custo` do cadastro —
   * ver o comentário de `planejarCusto`. Ausente ou inválido vale 1.
   */
  qtCad: number | string | null;
}

export type MotivoSemCusto = 'sem-lancamento' | 'nome-ambiguo-no-cadastro' | 'custo-ilegivel' | 'ja-esta-certo';

export interface PropostaCusto {
  productId: string;
  nome: string;
  custoAtual: number | null;
  custoNovo: number | null;
  /** O valor unitário como está na nota, antes de virar custo de embalagem. */
  custoUnitario: number | null;
  /** Por quanto o unitário foi multiplicado (a embalagem do cadastro). */
  qtCad: number;
  /** De qual compra veio: a data e a linha da planilha. */
  fonte: string | null;
  motivo?: MotivoSemCusto;
}

const texto = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim();

const normalizarNome = (v: unknown): string => texto(v)
  .normalize('NFD')
  .replace(/\p{M}/gu, '')
  // a planilha tem espaços invisíveis colados em alguns nomes de grupo
  .replace(/\p{Cf}/gu, '')
  .toUpperCase()
  .replace(/[^A-Z0-9]+/g, ' ')
  .trim();

/**
 * Dinheiro no formato da planilha (`1.234,56`) para número.
 *
 * Devolve `null` quando não dá para ler com certeza. Custo ilegível vira campo
 * vazio, nunca zero: zero seria um número e o cálculo do preço de venda o
 * trataria como um.
 */
export const dinheiro = (v: unknown): number | null => {
  const cru = texto(v).replace(/R\$\s*/i, '');
  if (!cru) return null;
  const normal = cru.includes(',') ? cru.replace(/\./g, '').replace(',', '.') : cru;
  const n = Number(normal);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * `dd/mm/aa` para uma data comparável.
 *
 * Ano de dois dígitos vira 20xx — a base de discriminação é de compras, não tem
 * lançamento do século passado. Data ilegível devolve `null`, e um lançamento
 * sem data nunca ganha de um com data.
 */
export const dataDaCompra = (v: unknown): number | null => {
  const m = texto(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!m) return null;
  const [, d, mes, ano] = m;
  const anoCheio = ano!.length === 2 ? 2000 + Number(ano) : Number(ano);
  const dia = Number(d);
  const mesN = Number(mes);
  if (mesN < 1 || mesN > 12 || dia < 1 || dia > 31) return null;
  return anoCheio * 10000 + mesN * 100 + dia;
};

export interface ResumoCusto {
  comCusto: number;
  semCusto: Record<MotivoSemCusto, number>;
  propostas: PropostaCusto[];
}

const zerado = (): Record<MotivoSemCusto, number> => ({
  'sem-lancamento': 0, 'nome-ambiguo-no-cadastro': 0, 'custo-ilegivel': 0, 'ja-esta-certo': 0,
});

/**
 * Casa cada produto com a compra mais recente que tenha o mesmo nome.
 *
 * Dois produtos do cadastro com o MESMO nome normalizado não recebem custo:
 * não dá para saber a qual deles a nota se refere, e atribuir o custo ao errado
 * erra o preço de venda dos dois.
 */
export const planejarCusto = (
  produtos: ProdutoParaCustear[],
  lancamentos: LancamentoMer[],
): ResumoCusto => {
  /** Por nome, a compra mais recente com custo legível. */
  const maisRecente = new Map<string, { custo: number; data: number | null; linha: number; dataTexto: string }>();
  for (const l of lancamentos) {
    const nome = normalizarNome(l.produto);
    if (!nome) continue;
    const custo = dinheiro(l.custoUnitario);
    if (custo === null) continue;
    const data = dataDaCompra(l.dataRef);
    const atual = maisRecente.get(nome);
    // sem data nunca ganha de com data; entre duas com data, a maior vence
    const ganha = !atual
      || (data !== null && (atual.data === null || data > atual.data))
      || (data === null && atual.data === null && l.linha > atual.linha);
    if (ganha) maisRecente.set(nome, { custo, data, linha: l.linha, dataTexto: texto(l.dataRef) });
  }

  const quantosComEsseNome = new Map<string, number>();
  for (const p of produtos) {
    const n = normalizarNome(p.nome);
    if (n) quantosComEsseNome.set(n, (quantosComEsseNome.get(n) ?? 0) + 1);
  }

  const semCusto = zerado();
  const propostas: PropostaCusto[] = [];

  for (const p of produtos) {
    const nome = normalizarNome(p.nome);
    const custoAtual = dinheiro(p.custo);
    const qtCadBruto = Number(String(p.qtCad ?? '').replace(',', '.'));
    const qtCad = Number.isFinite(qtCadBruto) && qtCadBruto >= 1 ? qtCadBruto : 1;

    const recusar = (motivo: MotivoSemCusto, custoUnitario: number | null = null) => {
      semCusto[motivo] += 1;
      propostas.push({
        productId: p.id, nome: p.nome, custoAtual, custoNovo: null, custoUnitario, qtCad, fonte: null, motivo,
      });
    };

    if ((quantosComEsseNome.get(nome) ?? 0) > 1) { recusar('nome-ambiguo-no-cadastro'); continue; }
    const compra = maisRecente.get(nome);
    if (!compra) { recusar('sem-lancamento'); continue; }

    /*
     * A conversão que faltava, e que errou 540 produtos na primeira carga.
     *
     * O campo `custo` do cadastro é o custo da EMBALAGEM: `product.rules.ts`
     * calcula o preço com `custo / qtCad`, e os cadastros feitos à mão
     * confirmam (BUDWEISER custo 124 / qtCad 24 = R$ 5,17 a garrafa). A nota da
     * discriminação traz o valor UNITÁRIO. Gravar o unitário direto fazia o
     * sistema dividir de novo, e o preço saía qtCad vezes menor.
     */
    const custoNovo = Math.round(compra.custo * qtCad * 100) / 100;
    if (custoAtual !== null && Math.abs(custoAtual - custoNovo) < 0.005) {
      recusar('ja-esta-certo', compra.custo);
      continue;
    }

    propostas.push({
      productId: p.id,
      nome: p.nome,
      custoAtual,
      custoNovo,
      custoUnitario: compra.custo,
      qtCad,
      fonte: `Discriminação (MER), linha ${compra.linha}${compra.dataTexto ? `, compra de ${compra.dataTexto}` : ''}`
        + (qtCad > 1 ? ` — ${compra.custo.toFixed(2)} × ${qtCad} da embalagem` : ''),
    });
  }

  return { comCusto: propostas.filter((p) => p.custoNovo !== null).length, semCusto, propostas };
};
