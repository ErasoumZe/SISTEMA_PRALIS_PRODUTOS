import { describe, expect, it } from 'vitest';
import {
  GRUPOS_LEGADOS, grupoOficialDe, grupoOficialEm, type EquivalenciaDeGrupo,
} from './grupos-legados';

/** Decisões de mentira, só para exercitar a busca. */
const DECIDIDO: Record<string, EquivalenciaDeGrupo> = {
  'SORVETES': { oficial: 'MER SORVETES - POTES', decidido: '2026-01-01', por: 'teste' },
  'MAT. PRIMA (FARINHA)': { oficial: 'MER MAT. PRIMA - FARINHAS', decidido: '2026-01-01', por: 'teste' },
};

describe('de-para de grupos legados', () => {
  it('traduz o grupo decidido para o oficial, exatamente como a tabela escreve', () => {
    expect(grupoOficialEm(DECIDIDO, 'SORVETES')?.oficial).toBe('MER SORVETES - POTES');
  });

  it('ignora caixa e espaço sobrando — a planilha antiga tem os dois', () => {
    expect(grupoOficialEm(DECIDIDO, '  sorvetes ')?.oficial).toBe('MER SORVETES - POTES');
  });

  /**
   * Ponto e parênteses fazem parte da chave. `MAT. PRIMA (FARINHA)` e
   * `MAT PRIMA FARINHA` seriam o mesmo se a normalização comesse pontuação — e
   * aí um grupo decidido passaria a valer por outro que ninguém decidiu.
   */
  it('não come pontuação: chave parecida não é a mesma chave', () => {
    expect(grupoOficialEm(DECIDIDO, 'MAT. PRIMA (FARINHA)')?.oficial).toBe('MER MAT. PRIMA - FARINHAS');
    expect(grupoOficialEm(DECIDIDO, 'MAT PRIMA FARINHA')).toBeNull();
  });

  it('grupo não decidido continua sem equivalência — nada é adivinhado', () => {
    expect(grupoOficialEm(DECIDIDO, 'BOMBONIERI')).toBeNull();
    expect(grupoOficialEm(DECIDIDO, '')).toBeNull();
    expect(grupoOficialEm(DECIDIDO, null)).toBeNull();
  });

  it('a função de produção lê o mapa de produção', () => {
    for (const chave of Object.keys(GRUPOS_LEGADOS)) {
      expect(grupoOficialDe(chave)).toEqual(GRUPOS_LEGADOS[chave]);
    }
    // um grupo que nunca vai existir: prova que a busca não inventa resposta
    expect(grupoOficialDe('GRUPO QUE NAO EXISTE EM LUGAR NENHUM')).toBeNull();
  });

  /**
   * A equivalência é uma AFIRMAÇÃO fiscal e precisa de autor e data. Sem isso,
   * daqui a um ano ninguém sabe se aquela linha foi decidida pelo contador ou
   * chutada por alguém com pressa.
   */
  it('toda decisão registrada tem oficial, data e autor', () => {
    for (const [chave, e] of Object.entries(GRUPOS_LEGADOS)) {
      expect(e.oficial.trim(), `${chave} sem grupo oficial`).not.toBe('');
      expect(e.decidido, `${chave} sem data`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.por.trim(), `${chave} sem autor`).not.toBe('');
      expect(chave, `${chave} deveria estar em maiúsculas`).toBe(chave.toUpperCase());
    }
  });
});
