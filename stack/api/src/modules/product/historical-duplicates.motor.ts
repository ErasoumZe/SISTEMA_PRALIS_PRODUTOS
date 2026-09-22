export type TipoConfrontoHistorico = 'barras-exatas' | 'nome-exato' | 'revisar' | 'sem-par';

export interface ProdutoParaConfrontar {
  id: string;
  codigoInterno: string;
  nome: string;
  codigoBarras: string | null;
}

export interface ConfrontoHistorico {
  legado: ProdutoParaConfrontar;
  tipo: TipoConfrontoHistorico;
  candidato: ProdutoParaConfrontar | null;
  semelhanca: number | null;
}

const normalizar = (texto: string) => texto
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().replace(/\s+/g, ' ')
  .replace(/(\d)\s+([A-Z])/g, '$1$2');

const barras = (valor: string | null) => {
  const digitos = String(valor ?? '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  return digitos.length >= 6 && !/^0+$/.test(digitos) ? digitos : '';
};

/** Similaridade conservadora por palavras: sugestão para revisão, nunca ação automática. */
export function semelhancaNome(a: string, b: string): number {
  const aa = new Set(normalizar(a).split(' ').filter(Boolean));
  const bb = new Set(normalizar(b).split(' ').filter(Boolean));
  const uniao = new Set([...aa, ...bb]).size;
  if (!uniao) return 0;
  let comuns = 0;
  for (const token of aa) if (bb.has(token)) comuns += 1;
  return comuns / uniao;
}

/**
 * Só duas evidências liberam unificação: código de barras único ou nome
 * normalizado idêntico e único. Similaridade fica explicitamente em revisão.
 */
export function confrontarHistoricos(
  legados: ProdutoParaConfrontar[],
  sia: ProdutoParaConfrontar[],
): ConfrontoHistorico[] {
  const porBarras = new Map<string, ProdutoParaConfrontar[]>();
  const porNome = new Map<string, ProdutoParaConfrontar[]>();
  for (const produto of sia) {
    const b = barras(produto.codigoBarras);
    if (b) porBarras.set(b, [...(porBarras.get(b) ?? []), produto]);
    const n = normalizar(produto.nome);
    if (n) porNome.set(n, [...(porNome.get(n) ?? []), produto]);
  }

  return legados.map((legado) => {
    const porCodigo = porBarras.get(barras(legado.codigoBarras)) ?? [];
    if (porCodigo.length === 1) return { legado, tipo: 'barras-exatas', candidato: porCodigo[0]!, semelhanca: 1 };

    const porMesmoNome = porNome.get(normalizar(legado.nome)) ?? [];
    if (porMesmoNome.length === 1) return { legado, tipo: 'nome-exato', candidato: porMesmoNome[0]!, semelhanca: 1 };

    let melhor: ProdutoParaConfrontar | null = null;
    let maior = 0;
    for (const candidato of sia) {
      const nota = semelhancaNome(legado.nome, candidato.nome);
      if (nota > maior) { maior = nota; melhor = candidato; }
    }
    if (melhor && maior >= 0.5) return { legado, tipo: 'revisar', candidato: melhor, semelhanca: maior };
    return { legado, tipo: 'sem-par', candidato: null, semelhanca: null };
  });
}
