/**
 * Regras de negócio do produto — port em TypeScript do regras.js validado
 * (ver ../docs/03-regras-de-negocio.md). Funções PURAS, reutilizáveis pela API e pelo front.
 *
 * Confirmações do domínio:
 *  - margem em FRAÇÃO (0,30 = 30%)
 *  - V. Venda usa custo UNITÁRIO (custo ÷ qtCad)
 *  - V. Venda Final aplica promoção por dia da semana + janela de horário
 */

function arred(n: number, casas = 0): number {
  const f = Math.pow(10, casas);
  return Math.round((Number(n) || 0) * f) / f;
}

function fmtQtd3(v: number | string): string {
  const n = parseFloat(String(v ?? 0).replace(',', '.')) || 0;
  // sem zeros à direita: 25,000 -> "25"; 25,5 -> "25,5" (até 3 casas quando houver)
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
}

function up(s: unknown): string {
  return String(s ?? '').trim().toUpperCase();
}

// ---- R1 — Descrição (NOME + QUANTIDADE(3 casas) + MEDIDA) ----
/**
 * Gramatura ZERO ou vazia não entra na descrição.
 *
 * Antes saía `QUEIJO MINAS FRESCAL 0 KG` — e esse texto não fica só na tela:
 * é a descrição que vai para a planilha e para o SIA. "0 KG" é informação
 * falsa sobre o produto, não um detalhe de exibição.
 */
export function montarDescricao(nome: string, quantidade: number | string, medidaBase: string): string {
  const qtdNum = parseFloat(String(quantidade ?? '').replace(',', '.')) || 0;
  return [up(nome), qtdNum > 0 ? fmtQtd3(quantidade) : '', up(medidaBase)]
    .filter(Boolean)
    .join(' ');
}

// ---- R2 — Como se compra (embalagem) ----
/** Nome por extenso da embalagem. Sigla desconhecida sai como veio. */
const EMBALAGEM_POR_EXTENSO: Record<string, string> = {
  SACO: 'SACO', PCT: 'PACOTE', CX: 'CAIXA', UN: 'UNIDADE', FD: 'FARDO',
  POTE: 'POTE', BAND: 'BANDEJA', EMB: 'EMBALAGEM', MIL: 'MILHEIRO', KG: 'KG', LT: 'LITRO',
};

export interface ComoSeCompraInput {
  embalagem: string;
  cDe: string | null;
  qtCad: number;
  medidaCompra: string;
  descricao: string;
  /** Compra aproximada escreve "APROXIMADAMENTE"; exata não escreve nada. */
  aproximado: boolean;
}

/**
 * Frase de como o produto é comprado.
 *
 * Formato definido pelo José em 09/09/2026, a partir do exemplo dele:
 * `queijo minas frescal kg - caixa com queijo minas frescal kg aproximadamente 20kg`
 *
 * A palavra "aproximadamente" existe porque para peso a quantidade da
 * embalagem é uma estimativa — uma caixa de queijo não tem 20 kg exatos. Dizer
 * "20KG" seco, quando não é exato, faz a conferência de entrada acusar
 * diferença que não existe.
 *
 * Uma definição só: a tela tinha a própria cópia desta regra, e as duas já
 * produziam textos diferentes.
 */
export function montarComoSeCompra(input: ComoSeCompraInput): string {
  const emb = up(input.embalagem);
  if (!emb) return '';
  const d = String(input.descricao ?? '').trim();
  const nome = EMBALAGEM_POR_EXTENSO[emb] ?? emb;
  const ligacao = input.cDe === 'C/' ? 'COM' : 'DE';
  const quantidade = [
    input.aproximado ? 'APROXIMADAMENTE' : '',
    `${input.qtCad ?? ''}${up(input.medidaCompra)}`,
  ].filter(Boolean).join(' ');

  return [d, '-', nome, ligacao, d, quantidade].filter(Boolean).join(' ');
}

// ---- R3 — Validação de quantidade (transformação) ----
export function montarValidacaoQtd(
  descricao: string,
  precisao: string,
  qtd: number,
  unidade: string,
): string {
  const d = String(descricao ?? '');
  if (!d) return '';
  return `DENTRO DA EMB (${d}) TEM ${up(precisao)} ${qtd ?? ''} ${up(unidade)}`;
}

// ---- R4 — Valor de venda ----
export interface CalcVVendaInput {
  auto: boolean;
  custo: number;
  qtCad: number;
  margemPontual: number | null; // fração
  margemGrupo: number; // fração
  vVendaPontual: number;
  descricao?: string;
}
/**
 * Chave de comparação para nome de grupo — **nunca** o texto a exibir.
 *
 * Os nomes vindos da planilha carregam `U+2060` (word joiner), que não aparece
 * na tela. Cruzar por nome sem tirar isso não casa nunca, e o motivo é
 * invisível para quem está olhando. `\p{Cf}` pega essa e as demais marcas de
 * formatação; o `NFKC` junta variantes de composição.
 */
export function normalizarGrupo(valor: string | null | undefined): string {
  return String(valor ?? '')
    .normalize('NFKC')
    .replace(/\p{Cf}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleUpperCase('pt-BR');
}

/**
 * Margem digitada na tela (%) para a fração que o domínio usa.
 *
 * **Vazio é ausência; zero é decisão.** São coisas diferentes e mudam o preço:
 * ausência faz `calcularVVenda` herdar a margem do grupo, zero manda vender
 * pelo custo. A conversão vivia espalhada como `valor ? conta : null`, e teste
 * de verdadeiro trata `0` como vazio — uma margem de 0% escolhida à mão virava
 * "sem margem" e o produto passava a herdar a do grupo sem ninguém pedir.
 *
 * Aceita vírgula porque é o que sai do teclado em pt-BR.
 */
export function margemPctParaFracao(pct: number | string | null | undefined): number | null {
  if (pct == null) return null;
  const texto = String(pct).trim().replace(',', '.');
  if (texto === '') return null;
  const n = Number(texto);
  // texto que não é número é ausência, nunca zero: zero é uma afirmação
  if (!Number.isFinite(n)) return null;
  return n / 100;
}

/** A volta: fração do domínio para o % da tela, preservando a mesma distinção. */
export function fracaoParaMargemPct(fracao: number | null | undefined): number | null {
  if (fracao == null || !Number.isFinite(fracao)) return null;
  // arredonda na 2ª casa do PERCENTUAL (0.075 -> 7.5), sem inventar precisão
  return Math.round(fracao * 10000) / 100;
}

export function calcularVVenda(input: CalcVVendaInput): number {
  const { auto, custo = 0, qtCad = 1, margemPontual, margemGrupo = 0, vVendaPontual = 0 } = input;
  const temProduto = input.descricao == null ? true : String(input.descricao).trim() !== '';

  if (!auto) return arred(vVendaPontual, 2);
  if (!temProduto) return 0;

  const custoUnit = custo / (qtCad || 1);
  const margem = margemPontual != null ? margemPontual : margemGrupo;
  return arred(custoUnit * (1 + margem), 2);
}

// ---- R5 — Valor de venda final (com promoção) ----
export interface PromocaoRule {
  tipo: 'valor' | 'desconto';
  valor?: number | null;
  descontoPct?: number | null; // fração
  horaInicio?: string | null; // 'HH:MM'
  horaFim?: string | null;
  dias?: boolean[] | null; // [SEG..DOM]
}
export interface CalcVVendaFinalInput {
  vVenda: number;
  promocoes?: PromocaoRule[];
  agora?: Date;
}
export function calcularVVendaFinal(input: CalcVVendaFinalInput): number {
  const vVenda = Number(input.vVenda) || 0;
  const promos = input.promocoes ?? [];
  const agora = input.agora ?? new Date();

  const idxSegDom = (agora.getDay() + 6) % 7; // Seg=0 ... Dom=6
  const minutosAgora = agora.getHours() * 60 + agora.getMinutes();

  const toMin = (hhmm?: string | null): number | null => {
    if (!hhmm) return null;
    const [h, m] = String(hhmm).split(':');
    return (parseInt(h ?? '0', 10) || 0) * 60 + (parseInt(m ?? '0', 10) || 0);
  };

  for (const p of promos) {
    const diaOk = !p.dias || p.dias[idxSegDom] === true;
    const ini = toMin(p.horaInicio);
    const fim = toMin(p.horaFim);
    const horaOk =
      (ini == null && fim == null) ||
      (minutosAgora >= (ini ?? -Infinity) && minutosAgora <= (fim ?? Infinity));
    if (diaOk && horaOk) {
      if (p.tipo === 'desconto' && p.descontoPct != null) {
        return arred(vVenda * (1 - Number(p.descontoPct)), 2);
      }
      if (p.tipo === 'valor' && p.valor != null) {
        return arred(Number(p.valor), 2);
      }
    }
  }
  return arred(vVenda, 2);
}

// ---- R6 — Lookups (viram joins no banco) ----
export function resolverMargemGrupo(
  grupoNome: string,
  tabelaGrupos: { nome: string; margem: number }[],
): number {
  const g = tabelaGrupos.find((x) => x.nome === grupoNome);
  return g ? Number(g.margem) || 0 : 0;
}
export function resolverSetorVenda(
  localCodigo: string,
  tabelaLocais: { codigo: string; setor?: string }[],
): string {
  const l = tabelaLocais.find((x) => x.codigo === localCodigo);
  return l ? l.setor ?? '' : '';
}
