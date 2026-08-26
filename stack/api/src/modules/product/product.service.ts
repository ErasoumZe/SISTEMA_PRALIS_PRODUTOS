import { inject, injectable } from 'tsyringe';
import { customAlphabet } from 'nanoid';
import { ProductRequests, ProductSchemas } from '@pralis/shared';
import { ProductRepository } from './product.repository';
import { ProductSheetService, type SheetSyncOutcome } from '@/modules/google-sheets/product-sheet.service';
import { AppError } from '@/config/api.replies';
import type { CurrentUser } from '@/types/fastify-jwt';
import { TaxRuleService, type FiscalClassification } from '@/modules/apoio/tax-rule.service';

const rand4 = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ0123456789', 4);
const genCodigo = () => `PR-${rand4()}-${rand4()}`;

/** Produto criado + como ficou o espelhamento na planilha (nunca bloqueia o cadastro). */
export type CreatedProduct = ProductSchemas.ProductEntity & { sheetSync: SheetSyncOutcome };

/** Produto editado + espelho na planilha + quantas lojas herdaram a mudança. */
export type UpdatedProduct = ProductSchemas.ProductEntity & {
  sheetSync: SheetSyncOutcome;
  lojasAtualizadas: number;
};

/**
 * Campos que a loja HERDA da BASE. Promoções ficam de fora de propósito: são da
 * loja por definição (e mesclar listas não teria significado). `status` entra
 * na herança, mas a loja que já tiver escolhido o seu mantém a escolha — é a
 * mesma regra de todo campo.
 */
const CAMPOS_HERDADOS = [
  'nome', 'quantidade', 'medidaBase', 'codigoBarras', 'marca', 'embalagem', 'cDe',
  'qtCad', 'medidaCompra', 'codigoInterno', 'fotoUrl', 'grupo', 'tipo', 'status',
  'habilitarAjuda', 'estoqueMin', 'estoqueMax', 'setorEstoque', 'custo',
  'margemPontual', 'vVendaPontual', 'auto', 'localVenda1', 'localVenda2',
] as const satisfies readonly (keyof ProductSchemas.ProductEntity)[];

/** Blocos inteiros que a loja herda como um todo (não campo a campo). */
const BLOCOS_HERDADOS = ['fiscal', 'transformacao'] as const;

/** Comparação estrutural — serve para escalares e para os blocos fiscal/transformação. */
const mesmoValor = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

@injectable()
export class ProductService {
  constructor(
    @inject(ProductRepository) private repo: ProductRepository,
    @inject(ProductSheetService) private sheets: ProductSheetService,
    @inject(TaxRuleService) private taxRules: TaxRuleService,
  ) {}

  private withAutomaticTax<T extends ProductRequests.CreateProductRequest | ProductRequests.UpdateProductRequest>(
    payload: T,
    rule: FiscalClassification,
  ): T {
    const fiscal = payload.fiscal ?? {
      ncm: null, cest: null, categoria: null, cstPisCofins: null,
      aliquotaCheia: null, aliquotaFcp: null, aliquotaPis: null,
      aliquotaCofins: null, reducaoIcms: null, icms: null,
    };
    return {
      ...payload,
      grupo: rule.grupo,
      fiscal: {
        ...fiscal,
        ncm: rule.ncm ?? fiscal.ncm,
        cstPisCofins: rule.cstPisCofins,
        tributacaoSimples: rule.tributacaoSimples,
        aliquotaSimples: rule.aliquotaSimples,
        icmsRe: rule.icmsRe,
        baseFiscal: rule.baseFiscal,
        codigoFiscal: rule.codigoFiscal,
        produtoFiscal: rule.produtoFiscal,
        cstReforma: rule.cstReforma,
        cClassTrib: rule.cClassTrib,
        aliquotaIbs: rule.aliquotaIbs,
        aliquotaCbs: rule.aliquotaCbs,
        origemFiscal: rule.origem,
      },
    } as T;
  }

  private async novoCodigo(): Promise<string> {
    let codigo = genCodigo();
    for (let i = 0; i < 5 && (await this.repo.findByCodigo(codigo)); i++) codigo = genCodigo();
    return codigo;
  }

  async create(user: CurrentUser, payload: ProductRequests.CreateProductRequest): Promise<CreatedProduct> {
    // Governança: produto NOVO só o admin cria, e sempre na base geral.
    // As lojas recebem produtos por importação (importFromBase), nunca por cadastro direto.
    if (user.role !== 'admin') {
      throw new AppError('Apenas o administrador cadastra produtos novos (na base geral).', 403, 'ONLY_ADMIN_CREATE');
    }
    const alvo = 'BASE' as const;
    if (!payload.grupo?.trim()) {
      throw new AppError('Selecione o grupo de mercadorias para aplicar a regra fiscal.', 422, 'GROUP_REQUIRED');
    }
    const payloadComImposto = this.withAutomaticTax(
      payload,
      await this.taxRules.classify(payload.grupo, payload.codigoBarras ?? undefined),
    );

    if (!payloadComImposto.forcar) {
      const dup = await this.repo.findDuplicate(alvo, payloadComImposto.nome, payloadComImposto.codigoBarras ?? null);
      if (dup) {
        throw new AppError(
          `Produto "${dup.nome}" já cadastrado${dup.createdByName ? ` por ${dup.createdByName}` : ''}.`,
          409,
          'DUPLICATE_PRODUCT',
        );
      }
    }
    const codigo = await this.novoCodigo();
    const codigoInterno = await this.repo.proximoCodigoInterno();

    // produto + registro `pending` de espelhamento na MESMA transação
    const created = await this.repo.create(
      payloadComImposto,
      { loja: alvo, codigo, codigoInterno, createdByUserId: user.id, createdByName: user.name },
      (productId, tx) => this.sheets.registerPending(productId, tx),
    );

    // Depois do commit: tenta espelhar. O produto JÁ está salvo — se o Google
    // falhar, o registro fica `failed` e o usuário vê "sincronização pendente",
    // nunca um erro que o faça cadastrar de novo.
    const sync = await this.sheets.syncProduct(created.id).catch(() => ({ outcome: 'failed' as const }));
    return { ...created, sheetSync: sync.outcome };
  }

  async list(user: CurrentUser, filter: ProductRequests.ListProductQuery) {
    // admin pode visualizar qualquer catálogo (BASE/TNP/LI/HORA); usuário comum só a própria loja
    const alvo = filter.loja && user.role === 'admin' ? filter.loja : user.loja ?? 'BASE';
    return this.repo.list(alvo, filter);
  }

  /** Catálogo base; marca `importado` conforme já está na loja do usuário (tela de importar). */
  async listBase(user: CurrentUser, filter: ProductRequests.ListProductQuery) {
    return this.repo.list('BASE', filter, user.loja);
  }

  async getById(user: CurrentUser, id: string): Promise<ProductSchemas.ProductEntity> {
    const p = await this.repo.findById(id);
    if (!p) throw new AppError('Produto não encontrado', 404, 'NOT_FOUND');
    if (p.loja !== user.loja && p.loja !== 'BASE' && user.role !== 'admin') {
      throw new AppError('Produto não pertence à sua loja', 403, 'FORBIDDEN');
    }
    return p;
  }

  async update(user: CurrentUser, id: string, payload: ProductRequests.UpdateProductRequest) {
    // editar: admin (qualquer produto) ou colaborador (produtos da própria loja)
    const p = await this.repo.findById(id);
    if (!p) throw new AppError('Produto não encontrado', 404, 'NOT_FOUND');
    if (user.role !== 'admin' && p.loja !== user.loja) {
      throw new AppError('Você só pode editar produtos da sua loja.', 403, 'FORBIDDEN');
    }

    // O bloco fiscal é DERIVADO do grupo e tem consequência tributária: só o
    // admin altera à mão. Compara em vez de recusar a simples presença do
    // campo, porque a tela manda o payload inteiro em qualquer edição — recusar
    // a presença quebraria toda edição comum do colaborador. Mudar o GRUPO
    // continua permitido: aí quem recalcula o fiscal é a regra, não a pessoa.
    const grupoOuBarcodeMudou =
      (payload.grupo !== undefined && !mesmoValor(payload.grupo, p.grupo)) ||
      (payload.codigoBarras !== undefined && !mesmoValor(payload.codigoBarras, p.codigoBarras));
    if (
      user.role !== 'admin' &&
      payload.fiscal !== undefined &&
      !grupoOuBarcodeMudou &&
      !mesmoValor(payload.fiscal, p.fiscal)
    ) {
      throw new AppError(
        'Apenas o administrador altera os dados fiscais do produto.',
        403,
        'ONLY_ADMIN_FISCAL',
      );
    }

    let payloadFinal = payload;
    const grupoEfetivo = payload.grupo ?? p.grupo;
    // Reclassificar imposto só faz sentido quando a CHAVE da classificação
    // mudou. A tela envia o produto inteiro em uma edição; usar a mera presença
    // de `fiscal`/`grupo` aqui fazia uma alteração de preço depender do Google
    // Sheets e impedia editar produtos legados sem grupo.
    if (grupoOuBarcodeMudou) {
      if (!grupoEfetivo?.trim()) {
        throw new AppError('Selecione o grupo de mercadorias para aplicar a regra fiscal.', 422, 'GROUP_REQUIRED');
      }
      // Alterar somente o grupo não pode apagar NCM/CEST e demais dados
      // específicos já existentes no produto.
      // Colaborador nunca escolhe os campos fiscais manuais. Ao trocar grupo/EAN,
      // a classificação parte do snapshot fiscal salvo e só a regra pode
      // modificá-lo. Isso permite o recálculo sem abrir uma brecha para misturar
      // grupo novo com NCM/CEST/alíquotas arbitrários no payload.
      const comFiscalAnterior = user.role !== 'admin' || payload.fiscal === undefined
        ? { ...payload, fiscal: p.fiscal }
        : payload;
      const codigoBarrasEfetivo = payload.codigoBarras ?? p.codigoBarras ?? undefined;
      payloadFinal = this.withAutomaticTax(
        comFiscalAnterior,
        await this.taxRules.classify(grupoEfetivo, codigoBarrasEfetivo),
      );
    } else if (payload.fiscal !== undefined && mesmoValor(payload.fiscal, p.fiscal)) {
      // Não regrava a relação fiscal quando ela apenas voltou idêntica no
      // payload completo da tela.
      const { fiscal: _fiscalInalterado, ...semFiscalInalterado } = payload;
      payloadFinal = semFiscalInalterado;
    }
    const updated = await this.repo.update(id, payloadFinal);
    if (!updated) throw new AppError('Produto não encontrado', 404, 'NOT_FOUND');

    // A edição JÁ valeu no Postgres e uma falha do Google não pode desfazê-la.
    // Mas o resultado também não pode SUMIR: antes, o erro era engolido e a
    // tela dizia "atualizado com sucesso" com a planilha parada no valor
    // antigo — ninguém ficava sabendo.
    // Herança: a mudança feita na BASE desce para as lojas que ainda seguiam
    // aquele campo. Roda antes do espelho porque não depende do Google.
    const lojasAtualizadas = updated.loja === 'BASE' ? await this.propagarParaLojas(p, updated) : 0;

    let sheetSync: SheetSyncOutcome = 'skipped';
    if (updated.loja === 'BASE') {
      await this.sheets.registerPending(updated.id).catch(() => undefined);
      const sync = await this.sheets
        .syncProduct(updated.id)
        .catch(() => ({ outcome: 'failed' as const }));
      sheetSync = sync.outcome;
    }
    return { ...updated, sheetSync, lojasAtualizadas };
  }

  /**
   * Propaga uma edição da BASE para as cópias das lojas, CAMPO A CAMPO.
   *
   * A loja recebe o valor novo apenas se o valor dela ainda era igual ao
   * ANTIGO da BASE — ou seja, se ela ainda estava seguindo aquele campo. Onde a
   * loja tinha valor próprio, ele é preservado.
   *
   * É isso que faz "herdar tudo da BASE" e "poder editar em cada loja"
   * coexistirem: sem a comparação com o valor antigo, a edição do admin
   * apagaria em silêncio o que a loja escolheu.
   *
   * Não precisa de coluna nova no banco: "a loja sobrescreveu este campo" é
   * exatamente "o valor dela é diferente do que a BASE tinha".
   */
  private async propagarParaLojas(
    antes: ProductSchemas.ProductEntity,
    depois: ProductSchemas.ProductEntity,
  ): Promise<number> {
    const copias = await this.repo.listByBaseProductId(depois.id);
    let atualizadas = 0;

    for (const copia of copias) {
      const patch: Record<string, unknown> = {};

      for (const campo of CAMPOS_HERDADOS) {
        if (mesmoValor(antes[campo], depois[campo])) continue; // a BASE não mexeu neste campo
        if (!mesmoValor(copia[campo], antes[campo])) continue; // a loja tem valor próprio aqui
        patch[campo] = depois[campo];
      }
      for (const bloco of BLOCOS_HERDADOS) {
        if (mesmoValor(antes[bloco], depois[bloco])) continue;
        if (!mesmoValor(copia[bloco], antes[bloco])) continue;
        patch[bloco] = depois[bloco];
      }

      if (Object.keys(patch).length === 0) continue;
      await this.repo.update(copia.id, patch as ProductRequests.UpdateProductRequest);
      atualizadas++;
    }
    return atualizadas;
  }

  async delete(user: CurrentUser, id: string) {
    // excluir é exclusivo do admin
    if (user.role !== 'admin') {
      throw new AppError('Apenas o administrador exclui produtos.', 403, 'ONLY_ADMIN_DELETE');
    }
    const p = await this.repo.findById(id);
    if (!p) throw new AppError('Produto não encontrado', 404, 'NOT_FOUND');

    // A planilha vem PRIMEIRO, ao contrário da criação. Na criação o produto já
    // é do usuário e uma falha do Google não pode desfazer o cadastro. Aqui é o
    // oposto: se o Google falhar e o banco seguisse em frente, o produto ficaria
    // eternamente na planilha sem dono. Como exclusão é sempre repetível,
    // bloquear é o que garante que os dois lados nunca divergem.
    const remocao = await this.sheets.removeProduct(id);
    if (remocao.outcome === 'failed' || remocao.outcome === 'misconfigured') {
      throw new AppError(
        `${remocao.message} Nada foi excluído — tente novamente.`,
        502,
        'SHEET_DELETE_FAILED',
      );
    }

    let ok: boolean;
    try {
      ok = await this.repo.delete(id);
    } catch (e) {
      // planilha já limpa e produto ainda no banco: devolve a linha para os
      // dois lados não divergirem, e propaga o erro real.
      await this.sheets.registerPending(id).catch(() => {});
      await this.sheets.syncProduct(id).catch(() => {});
      throw e;
    }
    if (!ok) throw new AppError('Produto não encontrado', 404, 'NOT_FOUND');
  }

  /** Importa produtos da BASE para a loja do usuário (pula os já importados/duplicados). */
  async importFromBase(user: CurrentUser, baseIds: string[]): Promise<{ imported: number; skipped: number }> {
    // importação é da BASE para a loja do usuário; admin (sem loja) não usa este fluxo
    const loja = user.loja;
    if (!loja) throw new AppError('Apenas usuários de loja podem importar da base', 400, 'NO_LOJA');
    let imported = 0;
    let skipped = 0;
    for (const baseId of baseIds) {
      const base = await this.repo.findById(baseId);
      if (!base || base.loja !== 'BASE') { skipped++; continue; }
      if (await this.repo.existsByBase(loja, baseId)) { skipped++; continue; }
      if (await this.repo.findDuplicate(loja, base.nome, base.codigoBarras ?? null)) { skipped++; continue; }
      const codigo = await this.novoCodigo();
      await this.repo.create(this.toCreatePayload(base), {
        loja,
        codigo,
        codigoInterno: base.codigoInterno, // herda o mesmo código interno da base (igual entre lojas)
        createdByUserId: user.id,
        createdByName: user.name,
        baseProductId: baseId,
      });
      imported++;
    }
    return { imported, skipped };
  }

  private toCreatePayload(p: ProductSchemas.ProductEntity): ProductRequests.CreateProductRequest {
    return {
      nome: p.nome, quantidade: p.quantidade, medidaBase: p.medidaBase, codigoBarras: p.codigoBarras,
      marca: p.marca, embalagem: p.embalagem, cDe: p.cDe, qtCad: p.qtCad, medidaCompra: p.medidaCompra,
      codigoInterno: p.codigoInterno, fotoUrl: p.fotoUrl, grupo: p.grupo, tipo: p.tipo, status: p.status,
      habilitarAjuda: p.habilitarAjuda, estoqueMin: p.estoqueMin, estoqueMax: p.estoqueMax,
      setorEstoque: p.setorEstoque, custo: p.custo, margemPontual: p.margemPontual,
      vVendaPontual: p.vVendaPontual, auto: p.auto, localVenda1: p.localVenda1, localVenda2: p.localVenda2,
      promocoes: p.promocoes, transformacao: p.transformacao, fiscal: p.fiscal,
    };
  }
}
