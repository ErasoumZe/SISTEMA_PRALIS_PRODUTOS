/**
 * Gera src/db/base-products.json a partir da planilha CENTRAL PRODUTOS
 * (aba "(BASE) CADASTRO PRODUTOS"). Passo de DESENVOLVIMENTO — requer a planilha
 * e o pacote `xlsx` (devDependency). O arquivo gerado é commitado e usado pelo
 * seed em runtime (sem depender da planilha em produção).
 *
 * Uso: npm run gen:base   (a partir de pralis/stack/api)
 */
import 'reflect-metadata';
import path from 'node:path';
import { writeFileSync } from 'node:fs';
import xlsx from 'xlsx';
import { ProductRequests } from '@pralis/shared';

const XLSX_PATH = path.resolve(
  process.cwd(),
  '../../../tabela/Cópia de CENTRAL PRODUTOS (BASE) - CICLUZ GESTÃO PROFISSIONAL  (1).xlsx',
);
const OUT_PATH = path.resolve(process.cwd(), 'src/db/base-products.json');
const SHEET = '(BASE) CADASTRO PRODUTOS';
const FIRST_ROW = 11; // primeira linha de produto

// ---- helpers ----
const str = (v: unknown): string => (v == null ? '' : String(v).trim());
const orNull = (v: unknown): string | null => str(v) || null;

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const clean = String(v).trim().replace(/\./g, '').replace(',', '.');
  const n = Number(clean);
  return Number.isFinite(n) ? n : null;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T | null): T | null {
  const s = str(v).toUpperCase();
  return (allowed as readonly string[]).includes(s) ? (s as T) : fallback;
}

const MEDIDA_BASE = ['UN', 'KG', 'G', 'LT', 'ML'] as const;
const MEDIDA_COMPRA = ['UN', 'KG', 'LT'] as const;
const EMBALAGEM = ['UN', 'KG', 'LT', 'MIL', 'FD', 'PCT', 'CX', 'POTE', 'EMB', 'SACO', 'BAND'] as const;
const UNIDADE_TR = ['UN', 'G', 'ML'] as const;
const PRECISAO = ['EXATOS', 'APROXIMADOS'] as const;

function buildFiscal(get: (col: string) => unknown): ProductRequests.CreateProductRequest['fiscal'] {
  const f = {
    ncm: orNull(get('CA')),
    cest: orNull(get('CE')),
    categoria: orNull(get('CB')),
    cstPisCofins: orNull(get('BV')),
    aliquotaCheia: num(get('BT')),
    aliquotaFcp: num(get('BU')),
    aliquotaPis: num(get('BW')),
    aliquotaCofins: num(get('BX')),
    reducaoIcms: num(get('BS')),
    icms: num(get('CD')),
    tributacaoSimples: null,
    aliquotaSimples: null,
    icmsRe: null,
    baseFiscal: null,
    codigoFiscal: null,
    produtoFiscal: null,
    cstReforma: null,
    cClassTrib: null,
    aliquotaIbs: null,
    aliquotaCbs: null,
    origemFiscal: null,
  };
  const hasAny = Object.values(f).some((v) => v !== null);
  return hasAny ? f : null;
}

function rowToPayload(get: (col: string) => unknown): ProductRequests.CreateProductRequest {
  const grupoT = orNull(get('T'));
  const ehTransformacao = !!grupoT || !!str(get('W')) || !!str(get('V')) || !!str(get('X'));
  const qtCadRaw = num(get('N'));
  const qtCad = qtCadRaw && qtCadRaw >= 1 ? Math.round(qtCadRaw) : 1;
  const quantidade = num(get('F'));

  return {
    nome: str(get('E')),
    quantidade: quantidade != null && quantidade >= 0 ? quantidade : 0,
    medidaBase: oneOf(get('G'), MEDIDA_BASE, 'UN')!,
    codigoBarras: orNull(get('J')),
    marca: orNull(get('K')),
    embalagem: oneOf(get('L'), EMBALAGEM, null),
    cDe: str(get('M')) === 'C/' ? 'C/' : str(get('M')) === 'DE' ? 'DE' : null,
    qtCad,
    medidaCompra: oneOf(get('O'), MEDIDA_COMPRA, null),
    codigoInterno: orNull(get('AC')),
    fotoUrl: null, // imagens estão embutidas na planilha; não hospedadas
    grupo: orNull(get('R')) ?? grupoT,
    tipo: ehTransformacao ? 'transformacao' : 'revenda',
    status: str(get('C')).toUpperCase() === 'INATIVO' ? 'inativo' : 'ativo',
    habilitarAjuda: str(get('CN')).toUpperCase() === 'SIM',
    estoqueMin: num(get('AE')),
    estoqueMax: num(get('AG')),
    setorEstoque: orNull(get('AI')),
    // A planilha base não tem coluna para setor de venda: entra nulo em vez de
    // reaproveitar o setor de estoque, que é outra coisa.
    setorVenda1: null,
    setorVenda2: null,
    custo: num(get('AJ')),
    margemPontual: num(get('AL')),
    vVendaPontual: num(get('AM')),
    auto: str(get('AN')).toUpperCase() === 'SIM',
    localVenda1: orNull(get('AQ')),
    localVenda2: orNull(get('AS')),
    promocoes: [],
    transformacao: ehTransformacao
      ? {
          precisao: oneOf(get('V'), PRECISAO, 'EXATOS')!,
          qtd: Math.max(0, num(get('W')) ?? 0),
          unidade: oneOf(get('X'), UNIDADE_TR, 'UN')!,
          produtoReceituario: orNull(get('Y')),
          refReceituario: orNull(get('Z')),
        }
      : null,
    fiscal: buildFiscal(get),
  };
}

function main() {
  const wb = xlsx.readFile(XLSX_PATH, { cellFormula: false, cellStyles: false });
  const ws = wb.Sheets[SHEET];
  if (!ws) throw new Error(`Aba "${SHEET}" não encontrada na planilha`);
  const range = xlsx.utils.decode_range(ws['!ref']!);

  const produtos: ProductRequests.CreateProductRequest[] = [];
  const errors: string[] = [];

  for (let r = FIRST_ROW; r <= range.e.r + 1; r++) {
    const get = (col: string) => {
      const cell = ws[col + r];
      return cell && cell.v !== undefined ? cell.v : '';
    };
    const nome = str(get('E'));
    if (!nome) continue;

    const parsed = ProductRequests.createProductSchema.safeParse(rowToPayload(get));
    if (!parsed.success) {
      errors.push(`linha ${r} ("${nome}"): ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
      continue;
    }
    produtos.push(parsed.data);
  }

  writeFileSync(OUT_PATH, JSON.stringify(produtos, null, 2) + '\n', 'utf8');
  console.log(`\n✅ ${produtos.length} produtos válidos gravados em ${path.relative(process.cwd(), OUT_PATH)}`);
  if (errors.length) {
    console.log(`\n⚠️  ${errors.length} linha(s) inválida(s) (ignoradas):`);
    for (const e of errors) console.log('   - ' + e);
  }
}

main();
