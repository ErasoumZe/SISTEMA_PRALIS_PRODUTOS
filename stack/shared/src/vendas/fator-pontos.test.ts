import { describe, expect, it } from 'vitest';
import {
  FATOR_PADRAO, emPontos, erroDoFator, exemploDoFator, fatorFaturamentoEm, vigenteEm,
  type FatorPontos,
} from './fator-pontos';

const versao = (vigenciaInicio: string, faturamento: number, extras: Partial<FatorPontos> = {}): FatorPontos => ({
  loja: 'TNP', vigenciaInicio, faturamento, ticketMedio: faturamento,
  ticketEmPontos: false, observacao: null, ...extras,
});

describe('régua de pontos — decisões do José em 06/10/2026', () => {
  describe('qual versão vale', () => {
    const versoes = [versao('2026-01-01', 0.25), versao('2026-11-01', 0.3), versao('2026-06-01', 0.28)];

    it('vale a de maior data que já começou', () => {
      expect(vigenteEm(versoes, '2026-10-06')?.vigenciaInicio).toBe('2026-06-01');
      expect(vigenteEm(versoes, '2026-11-01')?.vigenciaInicio).toBe('2026-11-01');
      expect(vigenteEm(versoes, '2026-12-31')?.vigenciaInicio).toBe('2026-11-01');
    });

    it('o primeiro dia da vigência já conta', () => {
      expect(vigenteEm(versoes, '2026-06-01')?.faturamento).toBe(0.28);
      expect(vigenteEm(versoes, '2026-05-31')?.faturamento).toBe(0.25);
    });

    it('antes de tudo não tem versão', () => {
      expect(vigenteEm(versoes, '2025-12-31')).toBeNull();
      expect(vigenteEm([], '2026-10-06')).toBeNull();
    });

    it('a ordem da lista não importa — é a data que manda', () => {
      const embaralhada = [...versoes].reverse();
      expect(vigenteEm(embaralhada, '2026-10-06')?.vigenciaInicio).toBe('2026-06-01');
    });
  });

  describe('o padrão é o que o sistema já fazia', () => {
    it('sem nada cadastrado, vale 0,25 — o número que estava no código', () => {
      expect(FATOR_PADRAO).toBe(0.25);
      expect(fatorFaturamentoEm([], '2026-10-06')).toBe(0.25);
    });

    it('com data anterior a toda vigência, também cai no padrão', () => {
      expect(fatorFaturamentoEm([versao('2026-11-01', 0.3)], '2026-10-06')).toBe(0.25);
    });
  });

  describe('conversão', () => {
    it('reais viram pontos em centavos de ponto', () => {
      expect(emPontos(1000, 0.25)).toBe(250);
      expect(emPontos(9139.11, 0.25)).toBe(2284.78);
      expect(emPontos(0, 0.25)).toBe(0);
    });

    it('número impossível não propaga NaN para o gráfico', () => {
      expect(emPontos(Number.NaN, 0.25)).toBe(0);
      expect(emPontos(Number.POSITIVE_INFINITY, 0.25)).toBe(0);
    });

    it('o exemplo da tela traduz o fator em dinheiro', () => {
      expect(exemploDoFator(0.25)).toEqual({ reais: 1000, pontos: 250 });
      expect(exemploDoFator(0.3, 500)).toEqual({ reais: 500, pontos: 150 });
    });
  });

  describe('o que a tela recusa', () => {
    it('zero e negativo, porque zerariam o placar', () => {
      expect(erroDoFator(0)).toMatch(/maior que zero/);
      expect(erroDoFator(-1)).toMatch(/maior que zero/);
    });

    it('texto que não é número', () => {
      expect(erroDoFator('abc')).toMatch(/Informe um número/);
      expect(erroDoFator(null)).toMatch(/Informe um número/);
      expect(erroDoFator(undefined)).toMatch(/Informe um número/);
    });

    it('fora da faixa de sanidade', () => {
      expect(erroDoFator(10000)).toMatch(/maior fator/);
      expect(erroDoFator(0.0000001)).toMatch(/menor fator/);
    });

    it('precisão exagerada', () => {
      expect(erroDoFator(0.1234567)).toMatch(/casas decimais/);
      expect(erroDoFator(0.123456)).toBeNull();
    });

    it('os valores que a padaria usa passam', () => {
      expect(erroDoFator(0.25)).toBeNull();
      expect(erroDoFator(0.3)).toBeNull();
      expect(erroDoFator(1)).toBeNull();
    });
  });

  describe('ticket médio', () => {
    it('nasce desligado: hoje ele aparece em reais', () => {
      expect(versao('2026-01-01', 0.25).ticketEmPontos).toBe(false);
    });

    it('tem régua própria, que pode diferir da do faturamento', () => {
      const v = versao('2026-01-01', 0.25, { ticketMedio: 1, ticketEmPontos: true });
      expect(vigenteEm([v], '2026-10-06')).toMatchObject({ faturamento: 0.25, ticketMedio: 1, ticketEmPontos: true });
    });
  });
});
