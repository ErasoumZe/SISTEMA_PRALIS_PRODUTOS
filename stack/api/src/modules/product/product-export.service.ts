import { inject, injectable } from 'tsyringe';
import * as XLSX from 'xlsx';
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

  /**
   * Backup recuperável do catálogo antes de operação destrutiva.
   * Mantém identificadores como texto para o Excel não remover zeros à esquerda.
   */
  async gerarXlsx(): Promise<Buffer> {
    const produtos = (await this.products.listAllForBackup()).sort(
      (a, b) => a.loja.localeCompare(b.loja) || a.nome.localeCompare(b.nome, 'pt-BR'),
    );
    const v = (valor: unknown) => valor ?? '';
    const dados = produtos.map((p) => ({
      id: p.id, loja: p.loja, codigo: p.codigo, codigo_interno: p.codigoInterno,
      codigo_barras: p.codigoBarras, base_product_id: p.baseProductId,
      cadastrado_por: p.createdByName, cadastrado_em: p.createdAt,
      nome: p.nome, marca: p.marca, grupo: p.grupo, tipo: p.tipo, status: p.status,
      quantidade: p.quantidade, medida_base: p.medidaBase, embalagem: p.embalagem,
      c_de: p.cDe, qt_cad: p.qtCad, medida_compra: p.medidaCompra,
      compra_aproximada: p.compraAproximada, foto_url: p.fotoUrl, habilitar_ajuda: p.habilitarAjuda,
      estoque_min: p.estoqueMin, estoque_max: p.estoqueMax, setor_estoque: p.setorEstoque,
      custo: p.custo, margem_pontual: p.margemPontual, venda_pontual: p.vVendaPontual,
      calculo_automatico: p.auto, setor_venda_1: p.setorVenda1, setor_venda_2: p.setorVenda2,
      local_venda_1: p.localVenda1, local_venda_2: p.localVenda2,
      transformacao_precisao: p.transformacao?.precisao, transformacao_qtd: p.transformacao?.qtd,
      transformacao_unidade: p.transformacao?.unidade, produto_receituario: p.transformacao?.produtoReceituario,
      ref_receituario: p.transformacao?.refReceituario,
      ncm: p.fiscal?.ncm, cest: p.fiscal?.cest, categoria: p.fiscal?.categoria,
      cst_pis_cofins: p.fiscal?.cstPisCofins, aliquota_cheia: p.fiscal?.aliquotaCheia,
      aliquota_fcp: p.fiscal?.aliquotaFcp, aliquota_pis: p.fiscal?.aliquotaPis,
      aliquota_cofins: p.fiscal?.aliquotaCofins, reducao_icms: p.fiscal?.reducaoIcms,
      icms: p.fiscal?.icms, tributacao_simples: p.fiscal?.tributacaoSimples,
      aliquota_simples: p.fiscal?.aliquotaSimples, icms_re: p.fiscal?.icmsRe,
      base_fiscal: p.fiscal?.baseFiscal, codigo_fiscal: p.fiscal?.codigoFiscal,
      produto_fiscal: p.fiscal?.produtoFiscal, cst_reforma: p.fiscal?.cstReforma,
      cclass_trib: p.fiscal?.cClassTrib, aliquota_ibs: p.fiscal?.aliquotaIbs,
      aliquota_cbs: p.fiscal?.aliquotaCbs, origem_fiscal: p.fiscal?.origemFiscal,
      aliquota_ecf: p.fiscal?.aliquotaEcf, aliquota_ecf_id: p.fiscal?.aliquotaEcfId,
      estado_fiscal: p.fiscal?.estado, motivo_fiscal: p.fiscal?.motivo,
      pct_ncm: p.fiscal?.pctNcm,
    }));
    const promocoes = produtos.flatMap((p) => p.promocoes.map((promo, indice) => ({
      produto_id: p.id, loja: p.loja, codigo_interno: p.codigoInterno, produto: p.nome,
      indice: indice + 1, tipo: promo.tipo, valor: promo.valor, desconto_pct: promo.descontoPct,
      hora_inicio: promo.horaInicio, hora_fim: promo.horaFim, dias: promo.dias.map((dia) => dia ? 'S' : 'N').join(''), desconto_ate: promo.descontoAte,
    })));
    const resumo = [
      { campo: 'gerado_em_utc', valor: new Date().toISOString() },
      { campo: 'total_produtos', valor: produtos.length },
      { campo: 'total_promocoes', valor: promocoes.length },
      { campo: 'observacao', valor: 'Inclui todos os status, inclusive unificado.' },
    ];
    const livro = XLSX.utils.book_new();
    const adicionar = (nome: string, linhas: Record<string, unknown>[]) => {
      const aba = XLSX.utils.json_to_sheet(linhas.map((linha) => Object.fromEntries(
        Object.entries(linha).map(([chave, valor]) => [chave, v(valor)]),
      )));
      aba['!freeze'] = { xSplit: 0, ySplit: 1 };
      aba['!cols'] = Object.keys(linhas[0] ?? {}).map((chave) => ({ wch: Math.min(Math.max(chave.length + 2, 14), 28) }));
      XLSX.utils.book_append_sheet(livro, aba, nome);
    };
    adicionar('Resumo', resumo);
    adicionar('Produtos', dados);
    adicionar('Promocoes', promocoes);
    return XLSX.write(livro, { type: 'buffer', bookType: 'xlsx', compression: true });
  }
}
