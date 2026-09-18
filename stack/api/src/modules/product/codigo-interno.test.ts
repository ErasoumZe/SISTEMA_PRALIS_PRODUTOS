import { describe, expect, it } from 'vitest';
import { calcularProximoCodigoInterno } from './codigo-interno';

describe('calcularProximoCodigoInterno', () => {
  it('começa em 01326 quando o catálogo está vazio', () => {
    expect(calcularProximoCodigoInterno(0)).toBe('01326');
  });

  it('ignora códigos antigos abaixo da faixa já ocupada no Criare', () => {
    expect(calcularProximoCodigoInterno(442)).toBe('01326');
  });

  it('continua do maior código quando a nova faixa já começou', () => {
    expect(calcularProximoCodigoInterno(1326)).toBe('01327');
    expect(calcularProximoCodigoInterno(1767)).toBe('01768');
  });

  it('mantém uma faixa independente para cada loja', () => {
    expect(calcularProximoCodigoInterno(426, 'TNP')).toBe('01326');
    expect(calcularProximoCodigoInterno(276, 'LI')).toBe('04397');
    expect(calcularProximoCodigoInterno(4397, 'LI')).toBe('04398');
  });
});
