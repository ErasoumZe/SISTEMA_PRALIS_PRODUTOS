/**
 * Ensaio SOMENTE LEITURA do espelho nas abas `(TNP)` e `(LI) CADASTRO PRODUTOS`.
 *
 * Roda o serviço de verdade contra a planilha de verdade, mas com as escritas
 * interceptadas: mostra célula por célula o que SERIA gravado em cada aba, sem
 * gravar nada. Existe porque duas vezes o ensaio pegou defeito que teste com
 * planilha de mentira não pegaria — leiaute real tem surpresa.
 *
 * Uso: tsx scripts/ensaio-abas-de-loja.ts [linha]
 */
import 'reflect-metadata';
import 'dotenv/config';

const NOVA = '1iQGitC8CMl8OGgW05buMcfqr9xer0d9CexnT6U6Dwvw';

async function main() {
  const linha = Number(process.argv[2] ?? 1198);
  const { env } = await import('@/config/env');
  env.GOOGLE_SHEETS_SPREADSHEET_ID = NOVA;

  const { GoogleSheetsClient } = await import('@/modules/google-sheets/google-sheets.client');
  const { ProductSheetLojaService } = await import('@/modules/google-sheets/product-sheet-loja.service');

  const real = new GoogleSheetsClient();
  const escritas: Array<{ range: string; valor: unknown; modo: string }> = [];

  // gateway que LÊ de verdade e INTERCEPTA toda escrita
  const espiao = {
    getSheets: (id: string) => real.getSheets(id),
    batchGetValues: (id: string, faixas: string[], render?: never) => real.batchGetValues(id, faixas, render),
    batchUpdateValues: async (_id: string, dados: Array<{ range: string; values: unknown[][] }>, modo: string) => {
      for (const d of dados) escritas.push({ range: d.range, valor: d.values?.[0]?.[0], modo });
    },
    batchUpdate: async () => { escritas.push({ range: '(estrutural)', valor: '-', modo: '-' }); },
  } as never;

  const service = new ProductSheetLojaService(espiao);

  // O produto de teste, como está hoje na tela da LI.
  const produto = {
    id: '01a0891d-689e-7cca-a0cf-464c13226894', codigo: 'PR-TESTE', loja: 'LI',
    baseProductId: 'base-teste-ze', createdByName: null, createdAt: '',
    nome: 'TESTE ZE', quantidade: 2, medidaBase: 'LT', codigoBarras: '1313131313123',
    marca: 'teste ze', embalagem: 'FD', cDe: 'DE', qtCad: 12, medidaCompra: 'UN',
    compraAproximada: false, codigoInterno: '04091', fotoUrl: null,
    grupo: 'MER BEBIDAS - REFRIGERANTES', tipo: 'revenda', status: 'ativo',
    habilitarAjuda: false, estoqueMin: 12, estoqueMax: 48, setorEstoque: 'LJ - VITRINES',
    setorVenda1: 'teste', setorVenda2: 'teste', custo: 72, margemPontual: 0.7,
    vVendaPontual: 0, auto: true, localVenda1: 'teste', localVenda2: 'teste',
    promocoes: [], transformacao: null, fiscal: null,
  } as never;

  console.log(`=== ENSAIO (nada sera gravado) — linha ${linha} ===\n`);
  const resultado = await service.espelharNasAbasDeLoja([{ produto, linha }]);
  console.log(`resultado: ${resultado}\n`);

  for (const aba of ['(TNP) CADASTRO PRODUTOS', '(LI) CADASTRO PRODUTOS']) {
    const daAba = escritas.filter((e) => e.range.includes(aba));
    console.log(`--- ${aba}: ${daAba.length} celulas ---`);
    for (const e of daAba) {
      const col = /!([A-Z]+)\d+$/.exec(e.range)?.[1] ?? '?';
      console.log(`   ${col.padEnd(4)} ${String(e.valor ?? '(limpa)').slice(0, 44).padEnd(46)} ${e.modo}`);
    }
    console.log('');
  }
  process.exit(0);
}

main().catch((e) => { console.error('FALHOU:', e?.stack ?? e?.message ?? e); process.exit(1); });
