import { formatarCodigoCadastro } from './codigo-cadastro.motor';

/** Reconciliação exclusiva por código de barras. Nome e código antigo nunca decidem. */
export type SituacaoGiuliaSia = 'conciliar-sia' | 'novo-codigo' | 'pendente' | 'conflito-sia';
export interface ProdutoGiuliaSia { id: string; loja: string; nome: string; codigoBarras: string | null; codigoInterno: string | null }
export interface ParGiuliaSia { loja: string; coditem: string; chaveBarras: string; descricao: string; ativo: string }
export interface PropostaGiuliaSia {
  produto: ProdutoGiuliaSia; situacao: SituacaoGiuliaSia; codigoProposto: string | null;
  candidatos: Array<{ loja: string; coditem: string; descricao: string; ativo: string }>; motivo: string;
}

const digitos = (valor: unknown) => String(valor ?? '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');
export const barrasGiuliaValidas = (valor: unknown) => digitos(valor).length >= 8;

export const reconciliarGiuliaComSia = (
  produtos: ProdutoGiuliaSia[], pares: ParGiuliaSia[], teto: number,
): PropostaGiuliaSia[] => {
  const porBarras = new Map<string, ParGiuliaSia[]>();
  for (const par of pares) {
    const chave = digitos(par.chaveBarras);
    if (chave) porBarras.set(chave, [...(porBarras.get(chave) ?? []), par]);
  }
  let proximo = teto + 1;
  return produtos.map((produto) => {
    if (!barrasGiuliaValidas(produto.codigoBarras)) return {
      produto, situacao: 'pendente', codigoProposto: null, candidatos: [],
      motivo: 'Sem código de barras válido (EAN-8 ou maior). Nenhum código foi proposto.',
    };
    const candidatos = porBarras.get(digitos(produto.codigoBarras)) ?? [];
    const codigos = [...new Set(candidatos.map((c) => formatarCodigoCadastro(c.coditem)))];
    if (codigos.length > 1) return {
      produto, situacao: 'conflito-sia', codigoProposto: null, candidatos,
      motivo: `O mesmo código de barras aponta para mais de um código SIA: ${codigos.join(', ')}.`,
    };
    if (codigos.length === 1) return {
      produto, situacao: 'conciliar-sia', codigoProposto: codigos[0]!, candidatos,
      motivo: 'Código de barras exato encontrado no SIA.',
    };
    return {
      produto, situacao: 'novo-codigo', codigoProposto: formatarCodigoCadastro(proximo++), candidatos: [],
      motivo: 'Código de barras válido sem ocorrência no SIA; número sequencial reservado na prévia.',
    };
  });
};
