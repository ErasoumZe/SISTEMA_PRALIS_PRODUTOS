/**
 * A grafia numérica do Creare — ida e volta.
 *
 * Mora sozinho, sem dependência nenhuma, porque os dois lados precisam dele: o
 * `TaxRuleService` para LER o cadastro de ECF e o mapper da planilha para
 * ESCREVER de volta. Deixá-lo em qualquer um dos dois criava import circular
 * entre os módulos `apoio` e `google-sheets`.
 *
 * O Creare guarda percentual como inteiro de largura fixa, com as casas
 * decimais implícitas — e a largura e as casas MUDAM por campo. Medido no
 * cadastro real, não inferido pelo tamanho:
 *
 *     REDUCAO_ICMS    `0000`  `5333`      4 caracteres, 2 casas  -> 53,33%
 *     ALIQUOTA CHEIA  `00000` `18000`     5 caracteres, 3 casas  -> 18,000%
 *     ALIQUOTA FCP    `0000`              4 caracteres, 2 casas
 *     PIS e COFINS    `00000000`          8 caracteres; a escala NÃO é
 *       verificável, porque as 3.122 linhas da fonte são zero — e zero é zero
 *       em qualquer escala. Se um valor diferente de zero aparecer um dia,
 *       confira a escala antes de confiar no número.
 */

/**
 * `"5333"` com 2 casas -> `53.33`.
 *
 * Aceita também o formato já pontuado (`"0,00"`), que aparece em `% NCM` e
 * `ICMS`. Texto que não é número — como o `"X"` que existe numa linha da
 * fonte — vira ausência, nunca zero: zero é uma afirmação fiscal.
 */
export const parseCampoCreare = (value: string, casas: number): number | null => {
  const bruto = String(value ?? '').trim();
  if (bruto === '') return null;
  if (bruto.includes(',') || bruto.includes('.')) {
    const n = Number(bruto.replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  if (!/^\d+$/.test(bruto)) return null;
  const n = Number(bruto) / 10 ** casas;
  return Number.isFinite(n) ? n : null;
};

/**
 * A volta: `53.33` com 2 casas e largura 4 -> `"5333"`.
 *
 * Existe porque as colunas da faixa fiscal da planilha nova estão formatadas
 * como `NUMBER #0` — INTEIRO, sem casas decimais. Gravar `53.33` ali exibe
 * `53` e perde os 0,33. Na origem, a coluna equivalente usa o padrão `0000` e
 * guarda `5333`; devolver a mesma grafia é reproduzir o cadastro, não convertê-lo.
 */
export const formatoCreare = (
  valor: number | null | undefined,
  casas: number,
  largura: number,
): string | null => {
  if (valor == null || !Number.isFinite(valor)) return null;
  return String(Math.round(valor * 10 ** casas)).padStart(largura, '0');
};
