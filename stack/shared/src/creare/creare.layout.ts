export type CreareFieldKind = 'alpha' | 'numeric' | 'date';

export interface CreareDecimalPlaces {
  unitPrice: 2 | 3;
  /**
   * Casas decimais do CUSTO. Era 3 cravado no layout e virou configuração
   * porque a evidência não fecha: no TXT do fornecedor a SKOL 473ML, que vende
   * a R$ 6,90, sai com custo `0000000100` — R$ 0,10 a 3 casas, R$ 1,00 a 2.
   *
   * Fica em 3 por padrão (o comportamento de antes). A decisão sai dos 10
   * primeiros produtos aplicados no SIA: ver `docs/creare-fase1-runbook.md`.
   * Custo errado contamina margem e precificação, então isto é o único lugar
   * a mudar quando a resposta aparecer.
   */
  cost: number;
  icmsReduction: number;
  fullTaxRate: number;
  fcpRate: number;
  pisRate: number;
  cofinsRate: number;
  maximumQuantity: number;
  minimumQuantity: number;
}

export interface CreareField {
  name: string;
  length: number;
  kind: CreareFieldKind;
  decimals?: number | keyof CreareDecimalPlaces;
}

/**
 * Layout oficial de produtos do SIA Supervisor.
 *
 * Duas correções necessárias para o registro fechar em 363 posições e
 * coincidir com o TXT fornecido: fornecedor começa em 72 e o vazio tem 4 bytes.
 */
export const CREARE_PRODUCT_LAYOUT = [
  { name: 'barcode', length: 13, kind: 'alpha' },
  { name: 'groupCode', length: 4, kind: 'numeric' },
  { name: 'shortDescription', length: 24, kind: 'alpha' },
  { name: 'unitPrice', length: 10, kind: 'numeric', decimals: 'unitPrice' },
  { name: 'unit', length: 2, kind: 'alpha' },
  { name: 'ecfTaxCode', length: 2, kind: 'numeric' },
  { name: 'promotionPrice', length: 10, kind: 'numeric', decimals: 2 },
  { name: 'internalCode', length: 6, kind: 'numeric' },
  { name: 'supplierManufacturer', length: 40, kind: 'alpha' },
  { name: 'reference', length: 30, kind: 'alpha' },
  { name: 'basketKit', length: 1, kind: 'alpha' },
  { name: 'cost', length: 10, kind: 'numeric', decimals: 'cost' },
  { name: 'description', length: 50, kind: 'alpha' },
  { name: 'basketCode', length: 6, kind: 'numeric' },
  { name: 'promotionStart', length: 8, kind: 'date' },
  { name: 'promotionEnd', length: 8, kind: 'date' },
  { name: 'quantity', length: 10, kind: 'numeric', decimals: 3 },
  { name: 'iat', length: 1, kind: 'alpha' },
  { name: 'ippt', length: 1, kind: 'alpha' },
  { name: 'ncm', length: 8, kind: 'numeric' },
  { name: 'reserved', length: 4, kind: 'alpha' },
  { name: 'extendedInternalCode', length: 9, kind: 'numeric' },
  { name: 'weighable', length: 1, kind: 'alpha' },
  { name: 'scaleKey', length: 3, kind: 'numeric' },
  { name: 'cest', length: 7, kind: 'numeric' },
  { name: 'icmsReduction', length: 4, kind: 'numeric', decimals: 'icmsReduction' },
  { name: 'fullTaxRate', length: 5, kind: 'numeric', decimals: 'fullTaxRate' },
  { name: 'fcpRate', length: 4, kind: 'numeric', decimals: 'fcpRate' },
  { name: 'pisCofinsCst', length: 2, kind: 'numeric' },
  { name: 'pisRate', length: 8, kind: 'numeric', decimals: 'pisRate' },
  { name: 'cofinsRate', length: 8, kind: 'numeric', decimals: 'cofinsRate' },
  { name: 'maximumQuantity', length: 10, kind: 'numeric', decimals: 'maximumQuantity' },
  { name: 'minimumQuantity', length: 10, kind: 'numeric', decimals: 'minimumQuantity' },
  { name: 'extendedBarcode', length: 14, kind: 'alpha' },
  { name: 'active', length: 1, kind: 'alpha' },
  { name: 'stockControlled', length: 1, kind: 'alpha' },
  { name: 'originId', length: 6, kind: 'numeric' },
  { name: 'originFactor', length: 10, kind: 'numeric', decimals: 3 },
  /*
   * VALIDADE DE BALANCA -- numerica, nao alfa.
   *
   * Estava como 'alpha' e o gerador a preenchia com '' (tres espacos). O
   * importador do Criare le essas tres posicoes como INTEIRO e recusou o
   * registro inteiro: em 16/09/2026, as 18:52, o log do importador na maquina
   * da TNP trouxe exatamente dez
   *     ImportarProdutos() - ERRO: '   ' is not a valid integer value
   * para um arquivo de dez linhas -- um erro por registro, nenhum produto lido.
   *
   * Zero e "sem validade", que e o que vale para produto que nao e de balanca.
   */
  { name: 'scaleValidity', length: 3, kind: 'numeric' },
  { name: 'categoryCode', length: 9, kind: 'numeric' },
] as const satisfies readonly CreareField[];

export type CreareFieldName = (typeof CREARE_PRODUCT_LAYOUT)[number]['name'];
export type CreareRawRecord = Record<CreareFieldName, string>;

export const CREARE_PRODUCT_RECORD_LENGTH = CREARE_PRODUCT_LAYOUT.reduce(
  (total, field) => total + field.length,
  0,
);

export function creareProductPositions(): Array<{
  name: CreareFieldName;
  start: number;
  end: number;
  length: number;
}> {
  let start = 1;
  return CREARE_PRODUCT_LAYOUT.map((field) => {
    const position = { name: field.name, start, end: start + field.length - 1, length: field.length };
    start += field.length;
    return position;
  });
}
