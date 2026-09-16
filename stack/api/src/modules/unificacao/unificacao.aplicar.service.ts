import { inject, injectable } from 'tsyringe';
import { customAlphabet } from 'nanoid';
import { eq, sql } from 'drizzle-orm';
import type { ProductRequests } from '@pralis/shared';
import { db } from '@/db/databases';
import { AppError } from '@/config/api.replies';
import type { CurrentUser } from '@/types/fastify-jwt';
import { ProductRepository } from '@/modules/product/product.repository';
import { ProductSheetService } from '@/modules/google-sheets/product-sheet.service';
import { esperarEspelho } from '@/modules/google-sheets/espelho-na-tela';
import { unifGrupo, unifGrupoItem } from './unificacao.grupo.table';
import { unifFonteProduto } from './unificacao.table';
import { unifDecisao } from './unificacao.decisao.table';
import { UnificacaoGruposService, type FiltrosGrupos } from './unificacao.grupos.service';
import type { CandidatoUnificado } from './unificacao.motor';

const rand4 = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 4);
const genCodigo = () => `PR-${rand4()}-${rand4()}`;

export type AcaoUnificacao = 'unificado' | 'nao_e_o_mesmo' | 'criado' | 'ignorado';

export interface ResultadoUnificar {
  /** `criado` = não existia no Pralis; `atualizado` = já existia e foi completado. */
  modo: 'criado' | 'atualizado';
  productId: string;
  codigo: string;
  codigoInterno: string;
  sheetSync: string;
}

/** O que um lote de "criar todos os que faltam" devolve para a tela. */
export interface ResultadoLoteFaltantes {
  /** Quantos grupos este lote pegou — já com o teto por chamada aplicado. */
  selecionados: number;
  /** Produto que NÃO existia e passou a existir. */
  criados: number;
  /**
   * Grupo que, na hora de gravar, casou com um produto que já estava no Pralis
   * e foi COMPLETADO em vez de criado. Não é criação nem erro: é o `flagJaNoPralis`
   * chegando atrasado (o casamento por nome/barras é mais frouxo que a flag).
   */
  pulados: number;
  falhas: number;
  /** Quantos ainda faltam DEPOIS deste lote — é assim que a tela sabe se repete. */
  restantes: number;
  resultados: Array<{
    id: string; modo?: 'criado' | 'atualizado'; productId?: string; erro?: string;
  }>;
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
 * A Central grava somente a BASE. A cópia e o fiscal de cada loja entram no
 * fluxo explícito "Importar da Base", para TNP e LI permanecerem independentes.
 */
@injectable()
export class UnificacaoAplicarService {
  constructor(
    @inject(ProductRepository) private repo: ProductRepository,
    @inject(ProductSheetService) private sheets: ProductSheetService,
    @inject(UnificacaoGruposService) private grupos: UnificacaoGruposService,
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
        /** Para a fonte `pralis`, o `raw` guarda o id do produto que já existe. */
        raw: unifFonteProduto.raw,
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

  private payload(
    c: CandidatoUnificado,
    barras: string | null,
    ativo: boolean,
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
      compraAproximada: false,
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
      // O fiscal pertence à loja e será aplicado quando a BASE for importada.
      fiscal: null,
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
   * O produto BASE que este grupo já tem no Pralis, se tiver.
   *
   * Prefere o vínculo EXATO: a linha da fonte `pralis` carrega o id do produto.
   * Só cai no `findDuplicate` quando não há essa linha — ele casa por nome OU
   * barras, o que é mais frouxo, então fica como segunda opção e o caminho
   * usado vai registrado na auditoria.
   */
  private async acharBaseExistente(
    itens: Array<{ fonte: string; loja: string; raw: unknown }>,
    nome: string,
    barras: string | null,
  ): Promise<{ id: string; por: 'fonte_pralis' | 'duplicado' } | null> {
    const doPralis = itens.find((i) => i.fonte === 'pralis' && i.loja === 'BASE');
    const id = (doPralis?.raw as { id?: string } | null)?.id;
    if (id && (await this.repo.findById(id))) return { id, por: 'fonte_pralis' };

    const dup = await this.repo.findDuplicate('BASE', nome, barras);
    return dup ? { id: dup.id, por: 'duplicado' } : null;
  }

  /**
   * O que a atualização pode mexer no cadastro.
   *
   * Nome: só o nome ESCOLHIDO na tela sobrescreve o que já está no Pralis. A
   * distinção é `nomeDe === 'escolha_manual'`, carimbado por `unificar` depois
   * de conferir que o nome veio das fontes daquele produto. O nome que o motor
   * deduziu sozinho continua servindo só para preencher cadastro SEM nome: o
   * lote automático e o "criar todos os que faltam" unificam sem nome
   * escolhido, e sem essa distinção apagariam em massa o nome que o José curou
   * no Pralis, sem ninguém ter clicado nisso.
   *
   * Grupo só é preenchido quando ainda está vazio.
   *
   * Custo e venda: o Compilart SOBRESCREVE, porque é o catálogo vivo da loja e
   * o Pralis pode estar com valor velho. Sem Compilart no grupo, não mexe.
   */
  private patchCadastro(
    atual: { nome: string; grupo: string | null },
    c: CandidatoUnificado,
    temCompilart: boolean,
  ): ProductRequests.UpdateProductRequest {
    const escolhidoNaTela = c.nomeDe === 'escolha_manual';
    const trocaNome = c.nome.trim() !== '' && c.nome !== atual.nome
      && (escolhidoNaTela || !atual.nome?.trim());
    return {
      ...(trocaNome ? { nome: c.nome } : {}),
      ...(atual.grupo?.trim() ? {} : { grupo: c.grupo ?? 'A CLASSIFICAR' }),
      ...(temCompilart && c.custo != null ? { custo: c.custo } : {}),
      ...(temCompilart && c.venda != null ? { vVendaPontual: c.venda } : {}),
    };
  }

  /**
   * Unifica o grupo: ATUALIZA quando o produto já existe no Pralis, CRIA quando
   * não existe.
   *
   * Unificar um grupo que já está no Pralis nunca foi "criar de novo" — é
   * completar aquele cadastro com o fiscal e o que as outras fontes trazem.
   * `forcar` continua existindo como escape para criar um separado mesmo assim.
   */
  async unificar(
    user: CurrentUser,
    grupoId: string,
    forcar = false,
    nomeEscolhido?: string,
  ): Promise<ResultadoUnificar> {
    if (user.role !== 'admin') {
      throw new AppError('Apenas o administrador unifica cadastros.', 403, 'ONLY_ADMIN_UNIF');
    }
    const { grupo, itens } = await this.carregarGrupo(grupoId);
    if (grupo.decisao) {
      throw new AppError(`Este grupo já foi marcado como "${grupo.decisao}".`, 409, 'UNIF_JA_DECIDIDO');
    }

    const candidatoOriginal = grupo.candidato as CandidatoUnificado;
    const nomeLimpo = nomeEscolhido?.replace(/\p{Cf}/gu, '').replace(/\s+/g, ' ').trim();
    if (nomeLimpo) {
      const nomesPermitidos = new Set(
        itens.map((item) => item.nome?.replace(/\p{Cf}/gu, '').replace(/\s+/g, ' ').trim())
          .filter((nome): nome is string => !!nome),
      );
      if (!nomesPermitidos.has(nomeLimpo)) {
        throw new AppError(
          'Escolha um dos nomes que já existem nas fontes deste produto.',
          422,
          'UNIF_NOME_FORA_DAS_FONTES',
        );
      }
    }
    const candidato: CandidatoUnificado = nomeLimpo
      ? { ...candidatoOriginal, nome: nomeLimpo, nomeDe: 'escolha_manual' }
      : candidatoOriginal;
    if (!candidato.nome?.trim()) {
      throw new AppError('Grupo sem nome em nenhuma fonte — não dá para cadastrar.', 422, 'UNIF_SEM_NOME');
    }
    const barras = this.barrasReal(itens);

    const existente = forcar ? null : await this.acharBaseExistente(itens, candidato.nome, barras);
    if (existente) {
      return this.atualizar(user, grupo, itens, candidato, existente);
    }
    return this.criar(user, grupo, candidato, barras);
  }

  /**
   * Cria de uma vez TODOS os grupos que ainda não estão no Pralis, dentro dos
   * filtros que estiverem ligados na tela.
   *
   * A seleção não é montada aqui: vem de `idsACriar`, a mesma condição que
   * alimenta a contagem mostrada na confirmação. É isso que faz a tela poder
   * prometer "vai criar N" e cumprir.
   *
   * O lote é PEQUENO e retomável de propósito — cada criação escreve na
   * planilha, e milhares numa requisição só estouram o tempo da requisição e a
   * cota do Google. Cada item é gravado ao terminar, então parar no meio (ou
   * fechar a aba) não desfaz o que já passou: é só clicar de novo.
   *
   * IDEMPOTENTE por construção: a seleção só enxerga grupo sem decisão, e
   * unificar grava a decisão. Rodar duas vezes seguidas não duplica produto —
   * a segunda passada simplesmente não seleciona nada.
   *
   * Um item que FALHA continua sem decisão e voltaria a ser escolhido no lote
   * seguinte. Por isso o resultado separa `falhas` e `restantes`: é com eles
   * que a tela para quando um lote inteiro não anda, em vez de repetir os
   * mesmos itens para sempre.
   */
  async criarFaltantes(
    user: CurrentUser,
    filtros: FiltrosGrupos = {},
    limite = 25,
  ): Promise<ResultadoLoteFaltantes> {
    if (user.role !== 'admin') {
      throw new AppError('Apenas o administrador unifica cadastros.', 403, 'ONLY_ADMIN_UNIF');
    }
    const ids = await this.grupos.idsACriar(filtros, limite);

    const resultados: ResultadoLoteFaltantes['resultados'] = [];
    for (const id of ids) {
      try {
        // um a um, e não numa transação só: o que já gravou tem de ficar gravado
        const r = await this.unificar(user, id, false);
        resultados.push({ id, modo: r.modo, productId: r.productId });
      } catch (error) {
        resultados.push({ id, erro: error instanceof Error ? error.message : 'Falha inesperada' });
      }
    }

    return {
      selecionados: ids.length,
      criados: resultados.filter((r) => r.modo === 'criado').length,
      pulados: resultados.filter((r) => r.modo === 'atualizado').length,
      falhas: resultados.filter((r) => r.erro).length,
      restantes: await this.grupos.contarACriar(filtros),
      resultados,
    };
  }

  /** Completa um cadastro que já existe. Não recria nada. */
  private async atualizar(
    user: CurrentUser,
    grupo: typeof unifGrupo.$inferSelect,
    itens: Array<{ fonte: string; loja: string; ativo: boolean | null; codBarras: string | null }>,
    candidato: CandidatoUnificado,
    existente: { id: string; por: 'fonte_pralis' | 'duplicado' },
  ): Promise<ResultadoUnificar> {
    const base = await this.repo.findById(existente.id);
    if (!base) throw new AppError('Produto do Pralis não encontrado.', 404, 'PRODUCT_NOT_FOUND');
    const temCompilart = grupo.fontes.includes('compilart_tnp');
    const barras = this.barrasReal(itens) ?? base.codigoBarras;

    await this.repo.update(base.id, this.patchCadastro(base, candidato, temCompilart));
    // reenfileira: sem isto a atualização não chega ao Sheets nem ao Criare
    await this.sheets.registerPending(base.id);

    await this.registrar(grupo.chave, 'unificado', user, {
      modo: 'atualizado',
      encontradoPor: existente.por,
      nome: base.nome,
      custoVendaDoCompilart: temCompilart,
      fontes: grupo.fontes,
    }, base.id);

    const sync = await esperarEspelho(
      this.sheets.syncProduct(base.id).catch(() => ({ outcome: 'failed' as const, rowNumber: null })),
    );
    return {
      modo: 'atualizado',
      productId: base.id,
      codigo: base.codigo,
      codigoInterno: base.codigoInterno ?? '',
      sheetSync: sync.outcome,
    };
  }

  /** Cria somente o produto BASE. Cada loja importa depois, de forma independente. */
  private async criar(
    user: CurrentUser,
    grupo: typeof unifGrupo.$inferSelect,
    candidato: CandidatoUnificado,
    barras: string | null,
  ): Promise<ResultadoUnificar> {
    const codigo = await this.novoCodigo();
    const codigoInterno = await this.repo.proximoCodigoInterno();

    // BASE sem fiscal: fiscal é da loja. Espelho da planilha enfileirado junto.
    const base = await this.repo.create(
      this.payload(candidato, barras, candidato.ativo),
      { loja: 'BASE', codigo, codigoInterno, createdByUserId: user.id, createdByName: user.name },
      (productId, tx) => this.sheets.registerPending(productId, tx),
    );

    await this.registrar(grupo.chave, 'unificado', user, {
      modo: 'criado',
      nome: candidato.nome, grupo: candidato.grupo, barras, fontes: grupo.fontes,
    }, base.id);

    // Depois do commit: o produto JÁ está salvo. Se o Google falhar, fica
    // `failed` e aparece como pendente, nunca como erro que peça recadastro.
    const sync = await esperarEspelho(
      this.sheets.syncProduct(base.id).catch(() => ({ outcome: 'failed' as const, rowNumber: null })),
    );

    return {
      modo: 'criado',
      productId: base.id,
      codigo,
      codigoInterno,
      sheetSync: sync.outcome,
    };
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
