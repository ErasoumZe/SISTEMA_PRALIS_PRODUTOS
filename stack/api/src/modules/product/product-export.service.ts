import { inject, injectable } from 'tsyringe';
import { ProductEnums, type ProductSchemas } from '@pralis/shared';
import { ProductRepository } from './product.repository';

type ProductEntity = ProductSchemas.ProductEntity;

/** BASE, TNP, LI e HORA — a exportação varre todos os catálogos. */
const CATALOGOS = ProductEnums.catalogo.options;

/**
 * Colunas na ordem em que saem. Nome em snake_case porque o destino é
 * reconciliação com SIA/Compilart/planilha, não a tela.
 */
const COLUNAS = [
  'id', 'loja', 'codigo', 'codigo_barras', 'codigo_interno', 'base_product_id',
  'nome', 'grupo', 'tipo', 'status',
  'custo', 'v_venda_pontual', 'margem_pontual', 'quantidade', 'medida_base', 'qt_cad',
  'ncm', 'cest', 'categoria', 'cst_pis_cofins', 'icms', 'reducao_icms',
  'aliquota_pis', 'aliquota_cofins',
] as const;

const texto = (v: string | null | undefined) => `"${String(v ?? '').replace(/"/g, '""')}"`;

/**
 * Código entre aspas com `=` na frente para o Excel NÃO comer o zero à
 * esquerda: sem isso `00145` vira `145` e deixa de casar com o cadastro do SIA.
 * Mesma convenção do CSV de produtos vendidos (`vendas-unicos.service.ts`).
 */
const codigo = (v: string | null | undefined) => {
  const s = String(v ?? '');
  return s === '' ? '""' : `="${s.replace(/"/g, '""')}"`;
};

/**
 * Vírgula decimal (Excel pt-BR), sem casas fixas.
 *
 * De propósito não arredonda: o arquivo existe para conferir contra outro
 * sistema, e forçar 2 casas num campo que guarda 4 inventaria diferença que
 * não existe. Vazio quando o valor não está preenchido — zero não é o mesmo
 * que "sem custo".
 */
const numero = (v: number | null | undefined) =>
  v == null ? '' : String(v).replace('.', ',');

/**
 * O CSV sai FIEL ao que está gravado, inclusive no `grupo`.
 *
 * Vale saber ao comparar com outro sistema: 11 dos 13 grupos do cadastro têm
 * `U+2060` (word joiner) no meio do nome, herdado da planilha. É invisível na
 * tela e no Excel, então "MER BEBIDAS - CERVEJAS" digitado à mão NÃO casa com o
 * que está aqui. Quem for reconciliar precisa tirar os caracteres de formato
 * dos dois lados — é o que `normalizeGroup` (em `apoio/tax-rule.service.ts`) já
 * faz internamente. Limpar aqui seria mentir sobre o dado gravado.
 */
export function montarCsvProdutos(produtos: ProductEntity[]): string {
  const linhas = [
    COLUNAS.join(';'),
    ...produtos.map((p) => [
      texto(p.id),
      texto(p.loja),
      codigo(p.codigo),
      codigo(p.codigoBarras),
      codigo(p.codigoInterno),
      texto(p.baseProductId),
      texto(p.nome),
      texto(p.grupo),
      texto(p.tipo),
      texto(p.status),
      numero(p.custo),
      numero(p.vVendaPontual),
      numero(p.margemPontual),
      numero(p.quantidade),
      texto(p.medidaBase),
      numero(p.qtCad),
      texto(p.fiscal?.ncm),
      texto(p.fiscal?.cest),
      texto(p.fiscal?.categoria),
      texto(p.fiscal?.cstPisCofins),
      numero(p.fiscal?.icms),
      numero(p.fiscal?.reducaoIcms),
      numero(p.fiscal?.aliquotaPis),
      numero(p.fiscal?.aliquotaCofins),
    ].join(';')),
  ];
  // BOM no começo, senão o Excel abre os acentos quebrados
  return `﻿${linhas.join('\r\n')}\r\n`;
}

@injectable()
export class ProductExportService {
  constructor(@inject(ProductRepository) private products: ProductRepository) {}

  /**
   * Base viva de produtos, todas as lojas, ativos E inativos.
   *
   * Reusa o `list` do repositório uma vez por catálogo em vez de escrever
   * consulta nova: é o mesmo caminho já testado da listagem, e herda de graça
   * a regra de que cadastro aposentado por unificação (`status = 'unificado'`)
   * não é mais um produto e fica de fora.
   */
  async gerarCsv(): Promise<string> {
    const porLoja = await Promise.all(CATALOGOS.map((loja) => this.products.list(loja, {})));
    const produtos = porLoja.flat().sort(
      (a, b) => a.loja.localeCompare(b.loja) || a.nome.localeCompare(b.nome, 'pt-BR'),
    );
    return montarCsvProdutos(produtos);
  }
}
