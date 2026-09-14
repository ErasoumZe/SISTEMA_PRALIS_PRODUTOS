import { describe, expect, it, vi } from 'vitest';
import { comPrazo, PrazoEsgotadoError } from './prazo';

describe('comPrazo — o Google não pode pendurar a requisição', () => {
  it('deixa passar o que responde a tempo', async () => {
    await expect(comPrazo(Promise.resolve('ok'), 50, 'leitura')).resolves.toBe('ok');
  });

  /**
   * Este é o caso real: medido em 14/09/2026, ler QUATRO células da aba
   * `(TNP/LI) CADASTRO PRODUTOS` não voltou em 30 segundos. Sem prazo, quem
   * clicou em "salvar" ficava olhando a tela girar até o navegador desistir —
   * e o produto já estava salvo no banco desde o primeiro instante.
   */
  it('desiste no prazo em vez de esperar para sempre', async () => {
    vi.useFakeTimers();
    try {
      const eterna = new Promise<string>(() => {});
      const corrida = comPrazo(eterna, 20000, 'leitura da coluna de IDs');
      const veredito = expect(corrida).rejects.toBeInstanceOf(PrazoEsgotadoError);
      await vi.advanceTimersByTimeAsync(20001);
      await veredito;
    } finally {
      vi.useRealTimers();
    }
  });

  it('a mensagem diz O QUE demorou, senão o erro na fila não ajuda ninguém', async () => {
    vi.useFakeTimers();
    try {
      const corrida = comPrazo(new Promise<never>(() => {}), 1000, 'escrita da linha 1198');
      const veredito = expect(corrida).rejects.toThrow(/escrita da linha 1198.*1000 ms|1000 ms.*escrita da linha 1198/s);
      await vi.advanceTimersByTimeAsync(1001);
      await veredito;
    } finally {
      vi.useRealTimers();
    }
  });

  it('erro de verdade continua chegando como veio — prazo não mascara falha', async () => {
    const explode = Promise.reject(new Error('Unable to parse range'));
    await expect(comPrazo(explode, 50, 'leitura')).rejects.toThrow('Unable to parse range');
  });

  /**
   * Prazo zero ou negativo desliga o relógio em vez de reprovar tudo na hora.
   * É a válvula para quando o operador precisa de uma rodada longa (um backfill
   * grande, por exemplo) e sabe o que está fazendo.
   */
  it('prazo desligado deixa a chamada correr', async () => {
    await expect(comPrazo(Promise.resolve('ok'), 0, 'leitura')).resolves.toBe('ok');
  });

  it('não deixa o processo de pé por causa do relógio', async () => {
    vi.useFakeTimers();
    try {
      await comPrazo(Promise.resolve('ok'), 60000, 'leitura');
      // se o timer não fosse cancelado, sobraria um pendente aqui
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
