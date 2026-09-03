/**
 * Formato de dinheiro do sistema: SEMPRE duas casas decimais.
 *
 * `0,1` não é um valor monetário — é um número. Custo, preço e promoção se
 * escrevem `0,10`, e a falta da segunda casa faz a pessoa duvidar do que está
 * vendo (é dez centavos ou é um real?).
 *
 * Vive no contrato compartilhado, e não na tela, porque a regra é a mesma em
 * qualquer lugar que mostre dinheiro.
 */

/**
 * Arredonda para o centavo.
 *
 * O `+ Number.EPSILON` não é firula: `1.005` em ponto flutuante é
 * `1.00499999...`, e sem o empurrão `toFixed(2)` devolveria `1,00` — um centavo
 * a menos do que a pessoa digitou.
 */
export const arredondarMoeda = (valor: number | null | undefined): number | null => {
  const n = Number(valor);
  if (valor == null || !Number.isFinite(n)) return null;
  return Math.round((n + Number.EPSILON) * 100) / 100;
};

/** Número → texto pt-BR com duas casas. Nulo vira vazio, não "0,00". */
export const formatarMoeda = (valor: number | null | undefined): string => {
  const n = arredondarMoeda(valor);
  return n == null ? '' : n.toFixed(2).replace('.', ',');
};

/**
 * Texto digitado → número.
 *
 * Aceita os dois jeitos que as pessoas digitam: `0,10` (vírgula decimal, com
 * ponto de milhar) e `0.10` (ponto decimal, de teclado numérico ou colado de
 * outro sistema). Decidir pela presença da vírgula evita o erro clássico de
 * transformar `0.10` em `10` ao remover o ponto como se fosse milhar.
 *
 * Texto sem dígito nenhum devolve NULO, nunca zero: "abc" virando R$ 0,00
 * silenciosamente é pior que recusar.
 */
export const parseMoeda = (texto: string | null | undefined): number | null => {
  const bruto = String(texto ?? '').trim();
  if (bruto === '') return null;

  const comVirgula = bruto.includes(',');
  const normalizado = comVirgula
    ? bruto.replace(/\./g, '').replace(',', '.') // ponto era milhar
    : bruto; // ponto (se houver) é decimal

  const soNumero = normalizado.replace(/[^\d.-]/g, '');
  if (!/\d/.test(soNumero)) return null; // nenhum dígito: não é valor

  const numero = Number(soNumero);
  return Number.isFinite(numero) ? arredondarMoeda(numero) : null;
};
