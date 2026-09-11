import { inject, injectable } from 'tsyringe';
import { customAlphabet } from 'nanoid';
import { ProductRequests, ProductSchemas } from '@pralis/shared';
import { ProductRepository } from './product.repository';
import { ProductSheetService, type SheetSyncOutcome } from '@/modules/google-sheets/product-sheet.service';
import {
  LOJAS_ESPELHADAS,
  ProductSheetLojaService,
  type EspelhoLojaResultado,
  type LojaEspelhada,
} from '@/modules/google-sheets/product-sheet-loja.service';
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
  espelhoLoja: EspelhoLojaResultado;
};

/**
 * Campos que a loja HERDA da BASE. Promoções ficam de fora de propósito: são da
 * loja por definição (e mesclar listas não teria significado). `status` entra
 * na herança, mas a loja que já tiver escolhido o seu mantém a escolha — é a
 * mesma regra de todo campo.
 */
const CAMPOS_HERDADOS = [
  'nome', 'quantidade', 'medidaBase', 'codigoBarras', 'marca', 'embalagem', 'cDe',
  'qtCad', 'medidaCompra', 'compraAproximada', 'codigoInterno', 'fotoUrl', 'grupo', 'tipo', 'status',
  'habilitarAjuda', 'estoqueMin', 'estoqueMax', 'setorEstoque', 'custo',
  'margemPontual', 'vVendaPontual', 'auto', 'localVenda1', 'localVenda2',
] as const satisfies readonly (keyof ProductSchemas.ProductEntity)[];

/** Blocos inteiros que a loja herda como um todo (não campo a campo). */
const BLOCOS_HERDADOS = ['fiscal', 'transformacao'] as const;

/** Comparação estrutural — serve para escalares e para os blocos fiscal/transformação. */
const mesmoValor = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Campos fiscais que uma PESSOA digita. Todo o resto do bloco é DERIVADO da
 * regra do grupo, do de-para por produto ou do cadastro de ECF.
 *
 * Só estes entram na comparação que decide "o colaborador mexeu no fiscal?".
 * Comparar o bloco inteiro dava falso positivo e travava o salvamento de quem
 * não tinha tocado em nada: os derivados chegam do servidor a cada
 * classificação, e a tela não tem como devolvê-los idênticos.
 */
const FISCAIS_MANUAIS = [
  'ncm', 'cest', 'categoria',
  'aliquotaCheia', 'aliquotaFcp', 'aliquotaPis', 'aliquotaCofins',
  'reducaoIcms', 'icms',
] as const;

/**
 * Ausência de valor tem três grafias na travessia tela -> API: `null`, `''` e
 * `0`. O formulário monta os números com `Number(x) || null`, então um zero
 * GUARDADO volta como `null` — e comparar cru acusava mudança onde não houve.
 *
 * Zero e vazio são indistinguíveis para quem preenche a tela hoje; tratá-los
 * como iguais aqui é honesto. Onde a distinção importa de verdade — a margem —
 * ela é feita em `margemPctParaFracao`, que é outro caminho.
 */
const fiscalVazio = (v: unknown): boolean =>
  v == null || v === '' || v === 0;

/**
 * O produto está sem CARGA fiscal — só com a classificação básica, ou com nada.
 *
 * `cstPisCofins` e `ncm` NÃO contam: os dois vêm do grupo e do de-para por
 * código de barras, e chegam desde sempre. O que falta nos produtos antigos é a
 * carga em si — alíquotas, redução, ECF, categoria, CEST —, que só existe no
 * cadastro de ECF e só passou a ser lida depois.
 *
 * Basta UM desses estar preenchido para o produto contar como já classificado:
 * completar deve ser um ato único, não algo que reescreve a cada salvamento.
 */
const semCargaFiscal = (f: Record<string, unknown> | null | undefined): boolean =>
  ['aliquotaEcf', 'aliquotaCheia', 'reducaoIcms', 'categoria', 'cest', 'aliquotaPis']
    .every((campo) => fiscalVazio(f?.[campo]));

/** Compara SÓ o que a pessoa digita, normalizando as grafias de vazio. */
const mesmoFiscalManual = (
  a: Record<string, unknown> | null | undefined,
  b: Record<string, unknown> | null | undefined,
): boolean => FISCAIS_MANUAIS.every((campo) => {
  const x = a?.[campo];
  const y = b?.[campo];
  if (fiscalVazio(x) && fiscalVazio(y)) return true;
  return String(x) === String(y);
});

@injectable()
export class ProductService {
  constructor(
    @inject(ProductRepository) private repo: ProductRepository,
    @inject(ProductSheetService) private sheets: ProductSheetService,
    @inject(ProductSheetLojaService) private sheetsLoja: ProductSheetLojaService,
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
    /*
     * O cadastro de ECF entra por ÚLTIMO e só onde o produto casou pelo nome.
     * É cópia do cadastro que o Creare já usava — nunca derivação por
     * semelhança fiscal. Onde não casou, `ecf` é `null` e cada campo mantém o
     * que já estava: o comportamento de antes, sem os campos de ECF.
     */
    const ecf = rule.ecf;
    return {
      ...payload,
      grupo: rule.grupo,
      fiscal: {
        ...fiscal,
        ncm: rule.ncm ?? fiscal.ncm,
        cstPisCofins: rule.cstPisCofins,
        reducaoIcms: ecf?.reducaoIcms ?? fiscal.reducaoIcms,
        aliquotaCheia: ecf?.aliquotaCheia ?? fiscal.aliquotaCheia,
        aliquotaFcp: ecf?.aliquotaFcp ?? fiscal.aliquotaFcp,
        aliquotaPis: ecf?.aliquotaPis ?? fiscal.aliquotaPis,
        aliquotaCofins: ecf?.aliquotaCofins ?? fiscal.aliquotaCofins,
        aliquotaEcf: ecf?.aliquotaEcf ?? null,
        aliquotaEcfId: ecf?.aliquotaEcfId ?? null,
        categoria: ecf?.categoria ?? fiscal.categoria,
        icms: ecf?.icms ?? fiscal.icms,
        cest: ecf?.cest ?? fiscal.cest,
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
    // o código interno é gerado DENTRO da transação de `create` (F09):
    // gerar aqui fora deixava dois cadastros simultâneos com o mesmo número

    // produto + registro `pending` de espelhamento na MESMA transação
    const created = await this.repo.create(
      payloadComImposto,
      // sem `codigoInterno`: `create` gera dentro da propria transacao (F09)
      { loja: alvo, codigo, createdByUserId: user.id, createdByName: user.name },
      (productId, tx) => this.sheets.registerPending(productId, tx),
    );

    // Depois do commit: tenta espelhar. O produto JÁ está salvo — se o Google
    // falhar, o registro fica `failed` e o usuário vê "sincronização pendente",
    // nunca um erro que o faça cadastrar de novo.
    const sync = await this.sheets
      .syncProduct(created.id)
      .catch(() => ({ outcome: 'failed' as const, rowNumber: null }));
    /*
     * As abas de loja são cópias linha a linha da combinada e carregam as
     * colunas gerais de TODOS os produtos, inclusive os da BASE. Pular a BASE
     * aqui deixaria a linha nova em branco nelas e desalinharia a seguinte.
     */
    if (sync.outcome === 'synced' && sync.rowNumber !== null) {
      await this.espelharNasAbasDeLoja([{ produto: created, linha: sync.rowNumber }]);
    }
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
      !mesmoFiscalManual(
        payload.fiscal as Record<string, unknown> | null,
        p.fiscal as Record<string, unknown> | null,
      )
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
    } else if (grupoEfetivo?.trim() && semCargaFiscal(p.fiscal)) {
      /*
       * COMPLETAR o que nunca foi preenchido — não é reclassificar.
       *
       * Produto criado pela Central não passa por `classify()` de propósito, e
       * produto cadastrado antes de a fonte de ECF existir ficou com CST e NCM
       * e mais nada. Como a carga fiscal só era buscada quando o GRUPO mudava,
       * esses produtos nunca a recebiam: abrir e salvar não adiantava, e trocar
       * o grupo só para forçar seria pedir para a pessoa mentir no cadastro.
       *
       * Só entra quando o bloco está vazio, então nunca sobrescreve o que já
       * existe. E falha do Google não derruba a edição: sem a regra, salva sem
       * o fiscal, como salvava antes.
       */
      const regra = await this.taxRules
        .classify(grupoEfetivo, payload.codigoBarras ?? p.codigoBarras ?? undefined, payload.nome ?? p.nome)
        .catch(() => null);
      if (regra) {
        payloadFinal = this.withAutomaticTax({ ...payload, fiscal: p.fiscal }, regra);
      }
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

    if (updated.loja === 'BASE') {
      await this.sheets.registerPending(updated.id).catch(() => undefined);
    }
    // Na planilha nova, BASE e lojas compartilham a mesma linha. O serviço
    // principal decide se escreve os campos gerais ou somente a faixa LI/TNP.
    const sync = await this.sheets
      .syncProduct(updated.id)
      .catch(() => ({ outcome: 'failed' as const, rowNumber: null }));
    const sheetSync: SheetSyncOutcome = sync.outcome;

    /*
     * Na planilha nova, as abas `(TNP)`/`(LI) CADASTRO PRODUTOS` são cópias
     * linha a linha da combinada e precisam da MESMA linha — inclusive para
     * produto da BASE, porque elas carregam as colunas gerais de todos.
     *
     * O espelho dedicado antigo só entra quando o destino principal não
     * escreveu: `skipped`/`disabled` permitem o fallback, mas falha não pode
     * ser mascarada por uma escrita em outro lugar.
     */
    let espelhoLoja: EspelhoLojaResultado;
    if (sheetSync === 'synced' && sync.rowNumber !== null) {
      espelhoLoja = await this.espelharNasAbasDeLoja([{ produto: updated, linha: sync.rowNumber }]);
    } else if (updated.loja === 'BASE') {
      espelhoLoja = 'sem-aba';
    } else if (sheetSync === 'failed' || sheetSync === 'misconfigured') {
      espelhoLoja = 'falhou';
    } else {
      espelhoLoja = await this.espelharNaAbaDaLoja([updated]);
    }
    return { ...updated, sheetSync, lojasAtualizadas, espelhoLoja };
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

    /*
     * As abas `(TNP)`/`(LI) CADASTRO PRODUTOS` são cópias linha a linha da
     * combinada: enquanto a linha delas não esvazia, o produto excluído segue
     * lá. Limpa a MESMA linha que a combinada acabou de liberar.
     *
     * DEPOIS do banco, ao contrário de `removeProduct`:
     *  - antes do banco não adiantaria. Como esta limpeza não pode abortar a
     *    exclusão, ela só adiantaria o risco: se o `repo.delete` falhasse, o
     *    rollback acima repõe a linha da combinada e NÃO repõe as abas de
     *    loja — o produto voltaria vivo no banco e na combinada, e sumido nas
     *    cópias, que é a divergência que este caminho existe para evitar;
     *  - depois do banco a exclusão é definitiva e irreversível: abortar não
     *    desfaria nada. O que resta é não esconder a falha, e é isso que o
     *    `espelhoLoja` faz, do mesmo jeito que na edição.
     *
     * Sem linha na combinada (`absent`, `disabled`, `skipped`) não há o que
     * limpar nas cópias: elas se localizam pela linha, não pelo ID.
     */
    let espelhoLoja: EspelhoLojaResultado = 'sem-aba';
    if (remocao.rowNumber !== null) {
      // try/catch, não `.catch()`: erro síncrono escaparia do `.catch` e viraria
      // um 500 numa exclusão que já valeu no banco.
      try {
        espelhoLoja = await this.sheetsLoja.limparNasAbasDeLoja(
          [{ produto: p, linha: remocao.rowNumber }],
        );
      } catch {
        espelhoLoja = 'falhou';
      }
    }
    return { espelhoLoja };
  }

  /** Importa produtos da BASE para a loja do usuário (pula os já importados/duplicados). */
  async importFromBase(
    user: CurrentUser,
    baseIds: string[],
  ): Promise<{ imported: number; skipped: number; espelhoLoja: EspelhoLojaResultado }> {
    // importação é da BASE para a loja do usuário; admin (sem loja) não usa este fluxo
    const loja = user.loja;
    if (!loja) throw new AppError('Apenas usuários de loja podem importar da base', 400, 'NO_LOJA');
    let imported = 0;
    let skipped = 0;
    const criados: ProductSchemas.ProductEntity[] = [];
    for (const baseId of baseIds) {
      const base = await this.repo.findById(baseId);
      if (!base || base.loja !== 'BASE') { skipped++; continue; }
      if (await this.repo.existsByBase(loja, baseId)) { skipped++; continue; }
      if (await this.repo.findDuplicate(loja, base.nome, base.codigoBarras ?? null)) { skipped++; continue; }
      const codigo = await this.novoCodigo();
      const criado = await this.repo.create(this.toCreatePayload(base), {
        loja,
        codigo,
        codigoInterno: base.codigoInterno, // herda o mesmo código interno da base (igual entre lojas)
        createdByUserId: user.id,
        createdByName: user.name,
        baseProductId: baseId,
      });
      criados.push(criado);
      imported++;
    }
    // A planilha nova recebe a faixa da loja na MESMA linha da BASE, em lote.
    // Se o destino ainda usar o leiaute antigo, o resultado `skipped` aciona o
    // espelho dedicado anterior sem duplicar escritas.
    const resultados = await this.sheets
      .syncStoreProducts(criados)
      .catch(() => criados.map(() => ({ outcome: 'failed' as const, rowNumber: null })));
    const outcomes = resultados.map((r) => r.outcome);
    const espelhoLoja: EspelhoLojaResultado = outcomes.some((o) => o === 'failed' || o === 'misconfigured')
      ? 'falhou'
      : outcomes.some((o) => o === 'synced')
        ? await this.espelharNasAbasDeLoja(
          criados.flatMap((produto, i) => {
            const linha = resultados[i]?.rowNumber;
            return linha == null ? [] : [{ produto, linha }];
          }),
        )
        : await this.espelharNaAbaDaLoja(criados);
    return { imported, skipped, espelhoLoja };
  }

  /**
   * Espelha produtos de loja na aba da loja, se o espelho automatico estiver
   * ligado. So TNP e LI: HORA nao entrou em nenhuma integracao.
   *
   * Silencioso por contrato — os produtos JA estao salvos quando isto roda, e
   * uma falha do Google nao pode desfazer nem esconder o cadastro.
   */
  private async espelharNaAbaDaLoja(
    produtos: ProductSchemas.ProductEntity[],
  ): Promise<EspelhoLojaResultado> {
    const loja = produtos[0]?.loja;
    if (!loja || !(LOJAS_ESPELHADAS as readonly string[]).includes(loja)) return 'sem-aba';
    // try/catch, nao `.catch()`: erro sincrono (dependencia faltando, por
    // exemplo) escapa do `.catch` e derrubaria o cadastro que ja foi salvo.
    try {
      return await this.sheetsLoja.espelharVarios(produtos, loja as LojaEspelhada);
    } catch {
      return 'falhou';
    }
  }

  /**
   * Mantém as abas `(TNP)` e `(LI) CADASTRO PRODUTOS` na MESMA linha da aba
   * combinada. Vale para produto da BASE também: elas guardam as colunas
   * gerais de TODOS os produtos, e escrever só a combinada quebra o
   * alinhamento — foi exatamente o que aconteceu com a linha 1198.
   */
  private async espelharNasAbasDeLoja(
    itens: Array<{ produto: ProductSchemas.ProductEntity; linha: number }>,
  ): Promise<EspelhoLojaResultado> {
    if (itens.length === 0) return 'sem-aba';
    try {
      return await this.sheetsLoja.espelharNasAbasDeLoja(itens);
    } catch {
      return 'falhou';
    }
  }

  private toCreatePayload(p: ProductSchemas.ProductEntity): ProductRequests.CreateProductRequest {
    return {
      nome: p.nome, quantidade: p.quantidade, medidaBase: p.medidaBase, codigoBarras: p.codigoBarras,
      marca: p.marca, embalagem: p.embalagem, cDe: p.cDe, qtCad: p.qtCad, medidaCompra: p.medidaCompra,
      compraAproximada: p.compraAproximada,
      codigoInterno: p.codigoInterno, fotoUrl: p.fotoUrl, grupo: p.grupo, tipo: p.tipo, status: p.status,
      habilitarAjuda: p.habilitarAjuda, estoqueMin: p.estoqueMin, estoqueMax: p.estoqueMax,
      setorEstoque: p.setorEstoque, setorVenda1: p.setorVenda1, setorVenda2: p.setorVenda2,
      custo: p.custo, margemPontual: p.margemPontual,
      vVendaPontual: p.vVendaPontual, auto: p.auto, localVenda1: p.localVenda1, localVenda2: p.localVenda2,
      promocoes: p.promocoes, transformacao: p.transformacao, fiscal: p.fiscal,
    };
  }
}
