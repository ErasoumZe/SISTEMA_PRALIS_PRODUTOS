import { inject, injectable } from 'tsyringe';
import { Creare } from '@pralis/shared';
import type { ProductSchemas } from '@pralis/shared';
import { env } from '@/config/env';
import { AppError } from '@/config/api.replies';
import { ProductRepository } from '@/modules/product/product.repository';
import { barcodeCandidates } from '@/modules/apoio/tax-rule.service';
import { parseCreareConfigs, type CreareStore } from './creare.config';
import { CreareDeParaRepository, type SiaDePara } from './creare.depara.repository';
import { CreareExportRepository, type ExportBatch } from './creare-export.repository';

type ProductEntity = ProductSchemas.ProductEntity;

/** Produto que ficou de fora, com o motivo — para ninguém achar que sumiu. */
export interface CreareForaDoArquivo {
  codigo: string;
  nome: string;
  codigoBarras: string | null;
  motivo: string;
}

/**
 * Uma linha para responder a única pergunta que ainda não tem resposta: o campo
 * de custo tem 2 ou 3 casas decimais?
 *
 * O TXT do fornecedor não resolve — a SKOL 473ML, que vende a R$ 6,90, sai com
 * `0000000100`, que é R$ 0,10 a 3 casas e R$ 1,00 a 2. Em vez de adivinhar,
 * mostramos o que VAI no arquivo e as duas leituras possíveis. Depois de aplicar
 * os 10 primeiros no SIA, basta abrir um produto lá e ver qual coluna bate.
 */
export interface CreareAmostraCusto {
  codigo: string;
  nome: string;
  custoNoPralis: number;
  /** Exatamente o que vai nas posições 143-152 com a configuração de hoje. */
  campoGravado: string;
  casasConfiguradas: number;
  seSiaLerCom2Casas: number;
  seSiaLerCom3Casas: number;
}

export interface CreareLojaDiagnostico {
  loja: CreareStore;
  configurada: boolean;
  /** Produtos ativos e inativos da loja no Pralis. */
  totalProdutos: number;
  /** Linhas do SIA carregadas para esta loja. Zero = de-para não importado. */
  deParaCarregado: number;
  casados: number;
  naoCasados: number;
  invalidos: number;
  exemplosNaoCasados: CreareForaDoArquivo[];
  exemplosInvalidos: CreareForaDoArquivo[];
  /**
   * Dois produtos do Pralis casando no MESMO coditem. Um sobrescreveria o
   * outro no PDV, então a exportação é recusada enquanto existir colisão.
   */
  colisoesCoditem: Array<{ coditem: string; produtos: string[] }>;
  /** Quantos registros sairiam com cada código de ECF. Confira antes de importar. */
  distribuicaoEcf: Record<string, number>;
  /** Amostra para decidir as casas decimais do custo — ver `CreareAmostraCusto`. */
  amostraCusto: CreareAmostraCusto[];
}

export interface CreareHealth {
  enabled: boolean;
  configOk: boolean;
  configErrors: string[];
  configuredStores: CreareStore[];
  approvedForProduction: false;
  /** Se o robô consegue baixar sozinho (token presente e forte). */
  downloadPorTokenHabilitado: boolean;
  lojas: CreareLojaDiagnostico[];
}

interface Lote {
  casados: Array<{ produto: ProductEntity; sia: SiaDePara }>;
  naoCasados: CreareForaDoArquivo[];
  invalidos: CreareForaDoArquivo[];
  colisoesCoditem: Array<{ coditem: string; produtos: string[] }>;
  totalProdutos: number;
  deParaCarregado: number;
}

const resumo = (p: ProductEntity, motivo: string): CreareForaDoArquivo => ({
  codigo: p.codigo,
  nome: p.nome,
  codigoBarras: p.codigoBarras,
  motivo,
});

@injectable()
export class CreareService {
  constructor(
    @inject(ProductRepository) private products: ProductRepository,
    @inject(CreareDeParaRepository) private dePara: CreareDeParaRepository,
    @inject(CreareExportRepository) private exports: CreareExportRepository,
  ) {}

  /**
   * Encontra o produto no SIA pelo código de barras. Usa `barcodeCandidates`,
   * o MESMO casamento da classificação fiscal e do relatório de vendas — assim
   * um pesável de balança casa pelo PLU sem regra separada.
   */
  private casar(produto: ProductEntity, sia: Map<string, SiaDePara>): SiaDePara | undefined {
    for (const chave of barcodeCandidates(produto.codigoBarras)) {
      const linha = sia.get(chave);
      if (linha) return linha;
    }
    return undefined;
  }

  /**
   * Sem par no de-para, o CÓDIGO INTERNO do produto vale como coditem.
   *
   * O de-para por código de barras nasceu quando o Pralis não sabia o coditem
   * de nada, e casar pelas barras era o único jeito de não INSERIR duplicado
   * no Criare. Desde a carga de 25/09/2026 isso mudou: o código interno de
   * cada produto É o coditem do SIA (coluna X da planilha, "isso é fato, já
   * conferi no sistema real" — José), e a numeração nova continua a sequência
   * dele. Exigir o de-para agora deixava de fora produto legítimo — em
   * 26/09/2026 a TNP tinha 2 produtos e o TXT saía com 1.
   *
   * O que o SIA fornecia além do coditem (grupo, ECF, NCM) o produto já traz
   * consigo, e o gerador prefere o produto. Aqui só se preenche o suficiente
   * para o casamento existir; o resto é do cadastro.
   */
  private casarPeloCodigoInterno(produto: ProductEntity): SiaDePara | undefined {
    const coditem = String(produto.codigoInterno ?? '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    if (!coditem) return undefined;
    return {
      chaveBarras: '',
      codigoBarras: produto.codigoBarras ?? '',
      coditem,
      descricao: produto.nome,
      codGrupo: produto.grupoId ?? '',
      aliqSaidaEcf: produto.fiscal?.aliquotaEcfId ?? '',
      reducao: null,
      aliquotaInterna: null,
      cstSaida: '',
      csosn: '',
      ncm: produto.fiscal?.ncm ?? '',
      ativo: produto.status === 'ativo' ? 'S' : 'N',
    };
  }

  private async montarLote(store: CreareStore, config: Creare.CreareStoreConfig): Promise<Lote> {
    const [produtos, sia] = await Promise.all([
      this.products.list(store, {}),
      this.dePara.porBarras(store),
    ]);

    const casados: Lote['casados'] = [];
    const naoCasados: CreareForaDoArquivo[] = [];
    const invalidos: CreareForaDoArquivo[] = [];
    const porCoditem = new Map<string, string[]>();

    /*
     * Produto sem id de grupo herda o id do NOME do grupo, aprendido dos
     * produtos da carga. Cobre quem foi cadastrado pelo formulário antes de o
     * id passar a ser preenchido na criação (28/09/2026) — o LIMPADOR PERFUMADO
     * caía em "Codigo do grupo: nao existe de-para".
     */
    const idsPorNome = new Map<string, string | null>();
    for (const produto of produtos) {
      if (!produto.grupoId?.trim() && produto.grupo?.trim()) {
        if (!idsPorNome.has(produto.grupo)) idsPorNome.set(produto.grupo, await this.products.grupoIdPorNome(produto.grupo));
        produto.grupoId = idsPorNome.get(produto.grupo) ?? produto.grupoId ?? null;
      }
      const linha = this.casar(produto, sia) ?? this.casarPeloCodigoInterno(produto);
      if (!linha) {
        naoCasados.push(resumo(produto, 'sem par no SIA pelo codigo de barras e sem codigo interno para valer como coditem'));
        continue;
      }
      /*
       * Serializa já aqui para descobrir agora o que não fecha. Um produto que
       * quebra o layout não pode derrubar a exportação inteira: o robô roda às
       * 22:30 sem ninguém olhando. Ele fica de fora e aparece no health.
       */
      try {
        Creare.generateCreareRecord(produto, config, linha);
      } catch (error) {
        const mensagem = error instanceof Creare.CreareValidationError ? error.message : 'erro inesperado';
        invalidos.push(resumo(produto, mensagem));
        continue;
      }
      porCoditem.set(linha.coditem, [...(porCoditem.get(linha.coditem) ?? []), produto.codigo]);
      casados.push({ produto, sia: linha });
    }

    return {
      casados,
      naoCasados,
      invalidos,
      colisoesCoditem: [...porCoditem.entries()]
        .filter(([, produtos_]) => produtos_.length > 1)
        .map(([coditem, produtos_]) => ({ coditem, produtos: produtos_ })),
      totalProdutos: produtos.length,
      deParaCarregado: sia.size,
    };
  }

  /**
   * Pega produtos com custo de verdade (custo zero não distingue 2 de 3 casas)
   * e mostra o campo gravado ao lado das duas leituras possíveis.
   */
  private amostraCusto(lote: Lote, config: Creare.CreareStoreConfig): CreareAmostraCusto[] {
    const casas = config.decimalPlaces.cost;
    return lote.casados
      .filter(({ produto }) => (produto.custo ?? 0) > 0)
      .slice(0, 5)
      .map(({ produto }) => {
        const campoGravado = Creare.formatCreareNumber(produto.custo, 10, casas);
        const bruto = Number(campoGravado);
        return {
          codigo: produto.codigo,
          nome: produto.nome,
          custoNoPralis: produto.custo ?? 0,
          campoGravado,
          casasConfiguradas: casas,
          seSiaLerCom2Casas: bruto / 100,
          seSiaLerCom3Casas: bruto / 1000,
        };
      });
  }

  private configuracao(store: CreareStore): Creare.CreareStoreConfig {
    const parsed = parseCreareConfigs(env.CREARE_STORE_CONFIG_JSON);
    if (parsed.errors.length) {
      throw new AppError(
        `Configuração Criare incompleta (${parsed.errors.join(', ')}).`,
        503,
        'CREARE_MISCONFIGURED',
      );
    }
    const config = parsed.configs[store];
    if (!config) {
      throw new AppError(`Loja ${store} não possui configuração Criare.`, 503, 'CREARE_STORE_NOT_CONFIGURED');
    }
    // O layout oficial usa o campo de 13 para EAN-13 e o estendido para GTIN-14.
    // Configuracoes antigas da loja podem ainda dizer "extended"; nao deixar
    // que isso recoloque um EAN-13 no campo errado apos o deploy.
    return { ...config, barcodeField: 'automatic' };
  }

  async health(): Promise<CreareHealth> {
    const parsed = parseCreareConfigs(env.CREARE_STORE_CONFIG_JSON);
    const configuradas = (['TNP', 'LI', 'HORA'] as const).filter((store) => !!parsed.configs[store]);

    const lojas: CreareLojaDiagnostico[] = [];
    for (const store of configuradas) {
      const config = parsed.configs[store]!;
      const lote = await this.montarLote(store, config);
      const distribuicaoEcf: Record<string, number> = {};
      for (const { sia } of lote.casados) {
        // o que vai no arquivo: zero é placeholder e cai no padrão da loja
        const codigo = sia.aliqSaidaEcf.replace(/^0+$/, '') || config.ecfTaxCodePadrao || '(vazio)';
        distribuicaoEcf[codigo] = (distribuicaoEcf[codigo] ?? 0) + 1;
      }
      lojas.push({
        loja: store,
        configurada: true,
        totalProdutos: lote.totalProdutos,
        deParaCarregado: lote.deParaCarregado,
        casados: lote.casados.length,
        naoCasados: lote.naoCasados.length,
        invalidos: lote.invalidos.length,
        exemplosNaoCasados: lote.naoCasados.slice(0, 10),
        exemplosInvalidos: lote.invalidos.slice(0, 10),
        colisoesCoditem: lote.colisoesCoditem,
        distribuicaoEcf,
        amostraCusto: this.amostraCusto(lote, config),
      });
    }

    return {
      enabled: env.CREARE_EXPORT_ENABLED,
      configOk: parsed.errors.length === 0,
      configErrors: parsed.errors,
      configuredStores: configuradas,
      // Só muda depois da homologação formal; a feature flag não equivale a aprovação.
      approvedForProduction: false,
      downloadPorTokenHabilitado: env.CREARE_EXPORT_TOKEN.length >= 32,
      lojas,
    };
  }

  /**
   * `limite` existe para a primeira execução real: gerar 5 a 10 produtos,
   * importar, conferir no log do Criare, e só então liberar o catálogo todo.
   */
  async generate(store: CreareStore, limite?: number): Promise<Buffer> {
    if (!env.CREARE_EXPORT_ENABLED) {
      throw new AppError('Exportação Criare está desabilitada.', 503, 'CREARE_DISABLED');
    }
    const config = this.configuracao(store);
    const lote = await this.montarLote(store, config);

    if (!lote.deParaCarregado) {
      throw new AppError(
        `De-para do SIA não importado para ${store}. Rode "npm run creare:depara" antes de exportar.`,
        503,
        'CREARE_DEPARA_MISSING',
      );
    }
    if (lote.colisoesCoditem.length) {
      const exemplo = lote.colisoesCoditem[0]!;
      throw new AppError(
        `Exportação recusada: ${lote.colisoesCoditem.length} coditem(ns) do SIA casam com mais de um produto do Pralis `
        + `(ex.: coditem ${exemplo.coditem} -> ${exemplo.produtos.join(', ')}). Um sobrescreveria o outro no PDV.`,
        422,
        'CREARE_CODITEM_COLLISION',
      );
    }
    if (!lote.casados.length) {
      throw new AppError(
        `Nenhum produto de ${store} casou com o cadastro do SIA.`,
        422,
        'CREARE_EMPTY',
      );
    }

    const selecionados = limite && limite > 0 ? lote.casados.slice(0, limite) : lote.casados;
    const porId = new Map(selecionados.map(({ produto, sia }) => [produto.id, sia]));
    const file = Creare.generateCreareFile(
      selecionados.map(({ produto }) => produto),
      config,
      (produto) => porId.get(produto.id),
    );
    // O serializer limita a saída a ASCII; assim os bytes são idênticos
    // em ASCII, UTF-8 e CP1252 e nenhuma acentuação desloca o registro.
    return Buffer.from(file, 'ascii');
  }

  /** Snapshot repetivel: baixar nao confirma que o SIA importou. */
  async pending(store: CreareStore, limite?: number): Promise<ExportBatch | null> {
    if (!env.CREARE_EXPORT_ENABLED) {
      throw new AppError('Exportacao Criare desabilitada.', 503, 'CREARE_DISABLED');
    }
    const existing = await this.exports.open(store);
    if (existing) return existing;
    const config = this.configuracao(store);
    const lote = await this.montarLote(store, config);
    if (!lote.deParaCarregado) {
      throw new AppError('De-para do SIA nao importado.', 503, 'CREARE_DEPARA_MISSING');
    }
    if (lote.colisoesCoditem.length) {
      throw new AppError('Coditem do SIA corresponde a mais de um produto.', 422, 'CREARE_CODITEM_COLLISION');
    }
    if (!lote.casados.length) {
      throw new AppError('Nenhum produto casou com o cadastro do SIA.', 422, 'CREARE_EMPTY');
    }
    const rows = lote.casados.map(({ produto, sia }) => ({
      productId: produto.id,
      record: Creare.generateCreareRecord(produto, config, sia),
    }));
    return this.exports.prepare(store, rows, config.lineEnding === 'CRLF' ? '\r\n' : '\n', limite);
  }

  async confirm(store: CreareStore, id: string, sha256: string) {
    return this.exports.confirm(store, id, sha256);
  }

  async openBatch(store: CreareStore): Promise<ExportBatch | null> {
    if (!env.CREARE_EXPORT_ENABLED) {
      throw new AppError('Exportacao Criare desabilitada.', 503, 'CREARE_DISABLED');
    }
    this.configuracao(store);
    return this.exports.open(store);
  }
}
