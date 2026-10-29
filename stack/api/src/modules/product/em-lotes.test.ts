import { describe, expect, it } from 'vitest';
import { emLotes } from './em-lotes';

describe('emLotes — o backup não pode abrir uma consulta por produto ao mesmo tempo', () => {
  it('nunca passa do tamanho do lote e devolve na mesma ordem', async () => {
    let emVoo = 0;
    let pico = 0;
    const itens = Array.from({ length: 237 }, (_, i) => i);
    const saida = await emLotes(itens, 25, async (n) => {
      emVoo += 1;
      pico = Math.max(pico, emVoo);
      await new Promise((r) => setTimeout(r, 1));
      emVoo -= 1;
      return n * 2;
    });
    expect(pico).toBeLessThanOrEqual(25);
    expect(saida).toEqual(itens.map((n) => n * 2));
  });

  it('lista vazia não chama nada', async () => {
    let chamadas = 0;
    expect(await emLotes([], 10, async () => { chamadas += 1; })).toEqual([]);
    expect(chamadas).toBe(0);
  });

  it('recusa lote inválido', async () => {
    await expect(emLotes([1], 0, async (n) => n)).rejects.toThrow();
  });
});
