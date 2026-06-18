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
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

function up(s: unknown): string {
  return String(s ?? '').trim().toUpperCase();
}

// ---- R1 — Descrição (NOME + QUANTIDADE(3 casas) + MEDIDA) ----
export function montarDescricao(nome: string, quantidade: number | string, medidaBase: string): string {
  const partes = [up(nome), '', up(medidaBase)];
  const qtdNum = parseFloat(String(quantidade).replace(',', '.')) || 0;
  if (up(nome) || up(medidaBase) || qtdNum > 0) partes[1] = fmtQtd3(quantidade);
  return partes.filter(Boolean).join(' ');
}

// ---- R2 — Como se compra (embalagem) ----
export function montarComoSeCompra(
  embalagem: string,
  cDe: string | null,
  qtCad: number,
  descricao: string,
): string {
  const emb = up(embalagem);
  const d = String(descricao ?? '');
  if (!emb && !d) return '';
  if (cDe === 'C/') return `1 ${emb} C/ (${d})`;
  if (cDe === 'DE') return `1 ${emb} DE${qtCad ?? ''} (${d})`;
  return '';
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
