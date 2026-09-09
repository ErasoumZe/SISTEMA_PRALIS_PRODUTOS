import { describe, it, expect } from 'vitest';
import { segredosInsegurosEmProducao, SEGREDOS_DE_DESENVOLVIMENTO } from './segredos';

/**
 * Os segredos de JWT e cookie têm valor padrão de desenvolvimento. Isso é
 * conveniente na máquina de quem programa e é uma porta aberta em produção:
 * quem conhece o padrão — está no repositório — assina um token válido.
 *
 * O boot não recusava esses valores. A auditoria de 08/09/2026 marcou como P1
 * e registrou que **não foi comprovado** que produção esteja usando o padrão;
 * a correção é fechar a possibilidade, não afirmar que aconteceu.
 */

const bons = {
  JWT_SECRET: 'K9x!p2Lm@7QwErTyUiOpAsDfGhJkZxCv',
  COOKIE_SECRET: 'Zm3#nB8vC4xL9qWeRtYuIoPaSdFgHjKl',
};

describe('segredos obrigatórios em produção', () => {
  it('recusa o padrão de desenvolvimento', () => {
    const achados = segredosInsegurosEmProducao({
      JWT_SECRET: SEGREDOS_DE_DESENVOLVIMENTO.JWT_SECRET,
      COOKIE_SECRET: bons.COOKIE_SECRET,
    });

    expect(achados).toContain('JWT_SECRET');
    expect(achados).not.toContain('COOKIE_SECRET');
  });

  it('recusa segredo vazio ou curto demais para ter entropia', () => {
    expect(segredosInsegurosEmProducao({ JWT_SECRET: '', COOKIE_SECRET: bons.COOKIE_SECRET }))
      .toContain('JWT_SECRET');
    expect(segredosInsegurosEmProducao({ JWT_SECRET: 'curto', COOKIE_SECRET: bons.COOKIE_SECRET }))
      .toContain('JWT_SECRET');
  });

  it('aceita segredos fortes', () => {
    expect(segredosInsegurosEmProducao(bons)).toEqual([]);
  });

  it('acusa os dois quando os dois estão ruins', () => {
    expect(segredosInsegurosEmProducao({ JWT_SECRET: '', COOKIE_SECRET: '' }))
      .toEqual(['JWT_SECRET', 'COOKIE_SECRET']);
  });

  /* O relatório vai para o log: nunca pode carregar o valor. */
  it('devolve NOMES, nunca valores', () => {
    const achados = segredosInsegurosEmProducao({ JWT_SECRET: 'segredo-fraco', COOKIE_SECRET: '' });

    expect(achados.join(' ')).not.toMatch(/segredo-fraco/);
  });
});
