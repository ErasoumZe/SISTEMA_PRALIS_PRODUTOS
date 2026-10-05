import { codigoSia, type PesavelDaExportacao } from './pesaveis-exportacao';

export interface ProdutoPesavelAtual {
  id: string;
  codigoInterno: string | null;
  nome: string;
  pesavel: string | null;
  teclaBalanca: number | null;
  validadeBalanca: number | null;
}

export interface EspelhoPesavelAtual {
  id: string;
  coditem: string;
  pesavel: string | null;
  teclaBalanca: string | null;
  validadeBalanca: string | null;
}

/** Não usa nome, unidade nem barcode como chave de atualização. */
export function planejarPesaveis(
  fonte: PesavelDaExportacao[], produtos: ProdutoPesavelAtual[], espelhos: EspelhoPesavelAtual[],
) {
  const porCodigo = <T>(linhas: T[], obter: (linha: T) => string | null) => {
    const mapa = new Map<string, T[]>();
    for (const linha of linhas) {
      const codigo = codigoSia(obter(linha));
      if (codigo) mapa.set(codigo, [...(mapa.get(codigo) ?? []), linha]);
    }
    return mapa;
  };
  const produtosPorCodigo = porCodigo(produtos, (p) => p.codigoInterno);
  const espelhosPorCodigo = porCodigo(espelhos, (e) => e.coditem);
  const atualizarProdutos: Array<{ atual: ProdutoPesavelAtual; fonte: PesavelDaExportacao }> = [];
  const atualizarEspelhos: Array<{ atual: EspelhoPesavelAtual; fonte: PesavelDaExportacao }> = [];
  const semProduto: string[] = [];
  const codigoAmbiguo: string[] = [];
  const espelhoAmbiguo: string[] = [];
  const semEspelho: string[] = [];
  let jaCorretos = 0;

  for (const item of fonte) {
    const candidatos = produtosPorCodigo.get(item.codigoInterno) ?? [];
    if (!candidatos.length) { semProduto.push(item.codigoInterno); continue; }
    if (candidatos.length !== 1) { codigoAmbiguo.push(item.codigoInterno); continue; }
    const dePara = espelhosPorCodigo.get(item.codigoInterno) ?? [];
    if (dePara.length > 1) { espelhoAmbiguo.push(item.codigoInterno); continue; }
    const produto = candidatos[0]!;
    const produtoCerto = produto.pesavel === 'S' && produto.teclaBalanca === 0
      && produto.validadeBalanca === item.validadeDias;
    if (!produtoCerto) atualizarProdutos.push({ atual: produto, fonte: item });
    if (!dePara.length) semEspelho.push(item.codigoInterno);
    else {
      const espelho = dePara[0]!;
      if (espelho.pesavel !== 'S' || Number(espelho.teclaBalanca) !== 0
        || Number(espelho.validadeBalanca) !== item.validadeDias
        || espelho.teclaBalanca === null || espelho.validadeBalanca === null) {
        atualizarEspelhos.push({ atual: espelho, fonte: item });
      }
    }
    if (produtoCerto && (!dePara.length || !atualizarEspelhos.some((e) => e.fonte === item))) jaCorretos++;
  }
  return { atualizarProdutos, atualizarEspelhos, semProduto, codigoAmbiguo,
    espelhoAmbiguo, semEspelho, jaCorretos };
}
