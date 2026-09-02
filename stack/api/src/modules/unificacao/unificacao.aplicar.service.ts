import { inject, injectable } from 'tsyringe';
import { customAlphabet } from 'nanoid';
import { eq, sql } from 'drizzle-orm';
import type { ProductRequests, ProductSchemas } from '@pralis/shared';
import { db } from '@/db/databases';
import { AppError } from '@/config/api.replies';
import type { CurrentUser } from '@/types/fastify-jwt';
import { ProductRepository } from '@/modules/product/product.repository';
import { ProductSheetService } from '@/modules/google-sheets/product-sheet.service';
import { unifGrupo, unifGrupoItem } from './unificacao.grupo.table';
import { unifFonteProduto } from './unificacao.table';
import { unifDecisao } from './unificacao.decisao.table';
import type { CandidatoUnificado } from './unificacao.motor';

const rand4 = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 4);
const genCodigo = () => `PR-${rand4()}-${rand4()}`;

/** Lojas que recebem cópia. BASE é o mestre, HORA ainda não entra. */
const LOJAS_DESTINO = ['LI', 'TNP'] as const;
type LojaDestino = (typeof LOJAS_DESTINO)[number];

export type AcaoUnificacao = 'unificado' | 'nao_e_o_mesmo' | 'criado' | 'ignorado';

export interface ResultadoUnificar {
  productId: string;
  codigo: string;
  codigoInterno: string;
  lojasCriadas: LojaDestino[];
  sheetSync: string;
}

/**
 * Grava no catálogo mestre o que a Central de Produtos decidir.
 *
 * NÃO passa pelo `ProductService.create()` de propósito: aquele caminho chama
 * `classify()`, que exige regra fiscal do grupo e sobrescreve parte do fiscal
 * com a regra do GRUPO. Nenhum dos 17 grupos do SIA tem regra, e derivar
 * fiscal de grupo é justamente o que não pode acontecer aqui.
 *
 * O que se reusa do caminho normal, no nível do repositório:
 *  - `findDuplicate` — o risco de colisão de código de barras não some;
 *  - `proximoCodigoInterno` e a geração de `codigo`;
 *  - `registerPending` + `syncProduct` — sem isso o unificado não chega ao
 *    Sheets nem, por consequência, ao Criare.
 *
 * O fiscal é gravado POR LOJA e copiado da fonte: LI do SIA, TNP da
 * contabilidade. O produto BASE fica SEM fiscal — fiscal é da loja, e inventar
 * um "fiscal do BASE" seria escolher um dos dois sem base para isso.
 */
@injectable()
export class UnificacaoAplicarService {
  constructor(
    @inject(ProductRepository) private repo: ProductRepository,
    @inject(ProductSheetService) private sheets: ProductSheetService,
  ) {}

  private async novoCodigo(): Promise<string> {
    let codigo = genCodigo();
    for (let i = 0; i < 5 && (await this.repo.findByCodigo(codigo)); i += 1) codigo = genCodigo();
    return codigo;
  }

  private async carregarGrupo(grupoId: string) {
    const [grupo] = await db.select().from(unifGrupo).where(eq(unifGrupo.id, grupoId));
    if (!grupo) throw new AppError('Grupo não encontrado.', 404, 'UNIF_GRUPO_NOT_FOUND');

    const itens = await db
      .select({
        fonte: unifGrupoItem.fonte,
        loja: unifGrupoItem.loja,
        codBarras: unifFonteProduto.codBarras,
        nome: unifFonteProduto.nome,
        ativo: unifFonteProduto.ativo,
      })
      .from(unifGrupoItem)
      .leftJoin(unifFonteProduto, eq(unifGrupoItem.fonteProdutoId, unifFonteProduto.id))
      .where(eq(unifGrupoItem.grupoId, grupoId));

    return { grupo, itens };
  }

  /** O código de barras REAL de alguma fonte — não a chave normalizada. */
  private barrasReal(itens: Array<{ codBarras: string | null }>): string | null {
    return itens.map((i) => i.codBarras).find((b) => !!b && b.trim() !== '') ?? null;
  }

  /**
   * Fiscal da loja, copiado da fonte. Campo que a fonte não traz sai NULO —
   * nada de herdar do grupo nem da outra loja.
   */
  private fiscalDaLoja(loja: LojaDestino, c: CandidatoUnificado): ProductSchemas.ProductEntity['fiscal'] {
    const vazio = {
      cest: null, categoria: null, cstPisCofins: null, aliquotaCheia: null,
      aliquotaFcp: null, aliquotaPis: null, aliquotaCofins: null,
      tributacaoSimples: null, aliquotaSimples: null, icmsRe: null, baseFiscal: null,
      codigoFiscal: null, produtoFiscal: null, cstReforma: null, cClassTrib: null,
      aliquotaIbs: null, aliquotaCbs: null, origemFiscal: null,
    };
    if (loja === 'LI') {
      if (!c.fiscalLi) return null;
      // o SIA entrega NCM e redução. `icms` fica nulo porque a alíquota interna
      // do SIA não é a mesma coisa que o ICMS efetivo da contabilidade — cada
      // loja grava o que a SUA fonte diz, e nenhuma preenche a lacuna da outra.
      return { ...vazio, ncm: c.fiscalLi.ncm, reducaoIcms: c.fiscalLi.reducao, icms: null };
    }
    if (!c.fiscalTnp) return null;
    return { ...vazio, ncm: c.fiscalTnp.ncm, reducaoIcms: null, icms: c.fiscalTnp.icmsEfetivo };
  }

  private payload(
    c: CandidatoUnificado,
    barras: string | null,
    ativo: boolean,
    fiscal: ProductSchemas.ProductEntity['fiscal'],
  ): ProductRequests.CreateProductRequest {
    return {
      nome: c.nome,
      quantidade: 0,
      medidaBase: 'UN',
      codigoBarras: barras,
      marca: null,
      embalagem: null,
      cDe: null,
      qtCad: 1,
      medidaCompra: null,
      codigoInterno: null,
      fotoUrl: null,
      // texto puro, sem regra fiscal atrás: quem não tem grupo entra A CLASSIFICAR
      grupo: c.grupo ?? 'A CLASSIFICAR',
      tipo: 'revenda',
      status: ativo ? 'ativo' : 'inativo',
      habilitarAjuda: false,
      estoqueMin: null,
      estoqueMax: null,
      setorEstoque: null,
      setorVenda1: null,
      setorVenda2: null,
      custo: c.custo,
      margemPontual: null,
      vVendaPontual: c.venda,
      auto: false,
      localVenda1: null,
      localVenda2: null,
      promocoes: [],
      transformacao: null,
      fiscal,
    };
  }

  private async registrar(
    chave: string,
    acao: AcaoUnificacao,
    user: CurrentUser,
    detalhe: unknown,
    productId?: string,
  ) {
    await db.insert(unifDecisao).values({
      grupoChave: chave,
      acao,
      productId: productId ?? null,
      detalhe: detalhe as object,
      usuarioId: user.id,
      usuarioNome: user.name,
    });
    await db
      .update(unifGrupo)
      .set({ decisao: acao, decididoPor: user.name, decididoEm: new Date() })
      .where(eq(unifGrupo.chave, chave));
  }

  /**
   * Cria o produto BASE e as cópias das lojas presentes no grupo.
   *
   * Só por clique humano. Recusa se o grupo já foi decidido, para dois cliques
   * não gerarem dois cadastros.
   */
  async unificar(user: CurrentUser, grupoId: string, forcar = false): Promise<ResultadoUnificar> {
    if (user.role !== 'admin') {
      throw new AppError('Apenas o administrador unifica cadastros.', 403, 'ONLY_ADMIN_UNIF');
    }
    const { grupo, itens } = await this.carregarGrupo(grupoId);
    if (grupo.decisao) {
      throw new AppError(`Este grupo já foi marcado como "${grupo.decisao}".`, 409, 'UNIF_JA_DECIDIDO');
    }

    const candidato = grupo.candidato as CandidatoUnificado;
    if (!candidato.nome?.trim()) {
      throw new AppError('Grupo sem nome em nenhuma fonte — não dá para cadastrar.', 422, 'UNIF_SEM_NOME');
    }
    const barras = this.barrasReal(itens);

    if (!forcar) {
      const dup = await this.repo.findDuplicate('BASE', candidato.nome, barras);
      if (dup) {
        throw new AppError(
          `Já existe "${dup.nome}" na base. Confira antes de criar de novo.`,
          409,
          'UNIF_DUPLICADO',
        );
      }
    }

    const codigo = await this.novoCodigo();
    const codigoInterno = await this.repo.proximoCodigoInterno();

    // BASE sem fiscal: fiscal é da loja. Espelho da planilha enfileirado junto.
    const base = await this.repo.create(
      this.payload(candidato, barras, candidato.ativo, null),
      { loja: 'BASE', codigo, codigoInterno, createdByUserId: user.id, createdByName: user.name },
      (productId, tx) => this.sheets.registerPending(productId, tx),
    );

    const lojasCriadas: LojaDestino[] = [];
    for (const loja of LOJAS_DESTINO) {
      if (!grupo.lojas.includes(loja)) continue;
      if (await this.repo.findDuplicate(loja, candidato.nome, barras)) continue;

      const ativoNaLoja = itens.some((i) => i.loja === loja && i.ativo === true);
      await this.repo.create(
        this.payload(candidato, barras, ativoNaLoja, this.fiscalDaLoja(loja, candidato)),
        {
          loja,
          codigo: await this.novoCodigo(),
          codigoInterno, // mesmo código interno entre as lojas, como na importação
          createdByUserId: user.id,
          createdByName: user.name,
          baseProductId: base.id,
        },
      );
      lojasCriadas.push(loja);
    }

    await this.registrar(grupo.chave, 'unificado', user, {
      nome: candidato.nome, grupo: candidato.grupo, barras, lojasCriadas, fontes: grupo.fontes,
    }, base.id);

    // Depois do commit: o produto JÁ está salvo. Se o Google falhar, fica
    // `failed` e aparece como pendente, nunca como erro que peça recadastro.
    const sync = await this.sheets.syncProduct(base.id).catch(() => ({ outcome: 'failed' as const }));

    return { productId: base.id, codigo, codigoInterno, lojasCriadas, sheetSync: sync.outcome };
  }

  /** Tira o grupo da fila sem criar nada. */
  async marcar(user: CurrentUser, grupoId: string, acao: 'nao_e_o_mesmo' | 'ignorado'): Promise<void> {
    if (user.role !== 'admin') {
      throw new AppError('Apenas o administrador decide.', 403, 'ONLY_ADMIN_UNIF');
    }
    const [grupo] = await db.select().from(unifGrupo).where(eq(unifGrupo.id, grupoId));
    if (!grupo) throw new AppError('Grupo não encontrado.', 404, 'UNIF_GRUPO_NOT_FOUND');
    if (grupo.decisao) {
      throw new AppError(`Este grupo já foi marcado como "${grupo.decisao}".`, 409, 'UNIF_JA_DECIDIDO');
    }
    await this.registrar(grupo.chave, acao, user, { nome: grupo.nome, fontes: grupo.fontes });
  }

  /** Desfaz a marcação (não apaga produto criado — isso é decisão à parte). */
  async reabrir(user: CurrentUser, grupoId: string): Promise<void> {
    if (user.role !== 'admin') {
      throw new AppError('Apenas o administrador decide.', 403, 'ONLY_ADMIN_UNIF');
    }
    const [grupo] = await db.select().from(unifGrupo).where(eq(unifGrupo.id, grupoId));
    if (!grupo) throw new AppError('Grupo não encontrado.', 404, 'UNIF_GRUPO_NOT_FOUND');
    if (grupo.decisao === 'unificado') {
      throw new AppError(
        'Este grupo já virou produto. Reabrir aqui não apaga o cadastro — trate o produto no catálogo.',
        409,
        'UNIF_JA_CRIADO',
      );
    }
    await db.execute(sql`
      UPDATE unif_grupo SET decisao = NULL, decidido_por = NULL, decidido_em = NULL
      WHERE id = ${grupoId}`);
  }
}
