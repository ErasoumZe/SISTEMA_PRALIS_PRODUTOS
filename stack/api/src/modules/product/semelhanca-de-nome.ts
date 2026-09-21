/**
 * Semelhança 0..100 entre dois nomes, por bigramas (coeficiente de Dice).
 *
 * Cópia PURA da função de `vendas-margem.ts`, que não pode ser importada aqui:
 * aquele módulo puxa `tax-rule.service`, que puxa tsyringe, e o motor do código
 * de cadastro é puro de propósito — é o que permite testá-lo sem subir nada.
 *
 * Serve só para ORDENAR sugestões na tela. **Nunca para decidir sozinha**: dois
 * nomes parecidos podem ser produtos diferentes, e dar a um produto o código de
 * outro erra o que o PDV recebe.
 */
export function semelhanca(a: string, b: string): number {
  const normalizar = (s: string) => s
    .normalize('NFD').replace(/\p{M}/gu, '')
    .toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  const x = normalizar(a);
  const y = normalizar(b);
  if (!x || !y) return 0;
  if (x === y) return 100;

  const bigramas = (s: string) => {
    const out = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i += 1) {
      const par = s.slice(i, i + 2);
      out.set(par, (out.get(par) ?? 0) + 1);
    }
    return out;
  };
  const ba = bigramas(x);
  const bb = bigramas(y);
  if (ba.size === 0 || bb.size === 0) return 0;

  let comuns = 0;
  for (const [par, n] of ba) comuns += Math.min(n, bb.get(par) ?? 0);
  const total = [...ba.values()].reduce((s, n) => s + n, 0)
    + [...bb.values()].reduce((s, n) => s + n, 0);
  return Math.round((2 * comuns * 100) / total);
}
