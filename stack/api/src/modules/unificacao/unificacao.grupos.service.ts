import { injectable } from 'tsyringe';
import { and, asc, count, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import { db } from '@/db/databases';
import { AppError } from '@/config/api.replies';
import type { CurrentUser } from '@/types/fastify-jwt';
import { unifFonteProduto } from './unificacao.table';
import { unifGrupo, unifGrupoItem } from './unificacao.grupo.table';
import { agrupar, type GrupoReconciliado, type ItemFonte, type LojaFonte } from './unificacao.motor';
import { normalizarNome } from './unificacao.fontes';

/** Cada fonte pertence a uma loja; o Pralis diz a dele na própria linha. */
const LOJA_DA_FONTE: Record<string, LojaFonte> = {
  sia_li: 'LI',
  compilart_tnp: 'TNP',
  planilha_tnp: 'TNP',
  fiscal_tnp: 'TNP',
};

export interface FiltrosGrupos {
  filtro?: 'mesmo_cod_barras' | 'mesmo_cod_interno' | 'nome_parecido' | 'unico';
  loja?: LojaFonte;
  status?: 'ativo' | 'inativo';
  /** Só os que pedem olho humano (nome divergente, sem fiscal TNP, sem grupo). */
  revisar?: boolean;
  /** Só os que ainda não têm fiscal da contabilidade da TNP. */
  semFiscalTnp?: boolean;
  /** Só os que ficariam "A CLASSIFICAR". */
  semGrupo?: boolean;
  q?: string;
  decisao?: 'pendente' | 'feita';
  pagina?: number;
  tamanho?: number;
}

export interface TotaisUnificacao {
  grupos: number;
  porMotivo: Record<string, number>;
  jaNoPralis: number;
  aCriar: number;
  semFiscalTnp: number;
  semGrupo: number;
  nomesDivergentes: number;
  barrasConflitante: number;
  pendentes: number;
  decididos: number;
}

const numero = (v: string | null): number | null => (v == null ? null : Number(v));

@injectable()
export class UnificacaoGruposService {
  /** Lê o staging e devolve na forma que o motor entende. */
  private async itens(): Promise<ItemFonte[]> {
    const linhas = await db.select().from(unifFonteProduto);
    return linhas.map((l) => ({
      id: l.id,
      fonte: l.fonte,
      loja: LOJA_DA_FONTE[l.fonte]
        ?? (((l.raw as Record<string, string>)?.loja as LojaFonte) || 'BASE'),
      codInterno: l.codInterno,
      codBarras: l.codBarras,
      chaveBarras: l.chaveBarras,
      nome: l.nome,
      nomeNormalizado: l.nomeNormalizado,
      ativo: l.ativo,
      grupo: l.grupo,
      custo: numero(l.custo),
      venda: numero(l.venda),
      ncm: l.ncm,
      cst: l.cst,
      csosn: l.csosn,
      aliqEcf: l.aliqEcf,
      reducao: numero(l.reducao),
      icmsEfetivo: numero(l.icmsEfetivo),
    }));
  }

  /**
   * Códigos de barras que cobrem produtos diferentes DENTRO de uma mesma fonte.
   * Não bloqueiam nada: viram flag para a tela cobrar decisão.
   */
  private conflitos(itens: ItemFonte[]): Set<string> {
    const porFonteChave = new Map<string, Set<string>>();
    for (const i of itens) {
      if (!i.chaveBarras) continue;
      const k = `${i.fonte}|${i.chaveBarras}`;
      if (!porFonteChave.has(k)) porFonteChave.set(k, new Set());
      porFonteChave.get(k)!.add(normalizarNome(i.nome));
    }
    const conflitantes = new Set<string>();
    for (const [k, nomes] of porFonteChave) {
      if (nomes.size > 1) conflitantes.add(k.split('|')[1]!);
    }
    return conflitantes;
  }

  /**
   * Reconstrói os grupos a partir do staging.
   *
   * Preserva as decisões já tomadas casando pela `chave` — recomputar não pode
   * apagar trabalho humano.
   */
  async recalcular(): Promise<TotaisUnificacao> {
    const itens = await this.itens();
    const grupos = agrupar({ itens, barrasConflitantes: this.conflitos(itens) });

    const decisoes = await db
      .select({
        chave: unifGrupo.chave,
        decisao: unifGrupo.decisao,
        decididoPor: unifGrupo.decididoPor,
        decididoEm: unifGrupo.decididoEm,
        grupoManual: unifGrupo.grupoManual,
        grupoDefinidoPor: unifGrupo.grupoDefinidoPor,
        grupoDefinidoEm: unifGrupo.grupoDefinidoEm,
      })
      .from(unifGrupo)
      .where(sql`${unifGrupo.decisao} IS NOT NULL OR ${unifGrupo.grupoManual} IS NOT NULL`);
    const anteriores = new Map(decisoes.map((d) => [d.chave, d]));

    await db.transaction(async (tx) => {
      await tx.execute(sql`DELETE FROM unif_grupo_item`);
      await tx.execute(sql`DELETE FROM unif_grupo`);

      const LOTE = 300;
      for (let i = 0; i < grupos.length; i += LOTE) {
        const fatia = grupos.slice(i, i + LOTE);
        const gravados = await tx
          .insert(unifGrupo)
          .values(fatia.map((g) => this.paraLinha(g, anteriores.get(g.chave))))
          .returning({ id: unifGrupo.id, chave: unifGrupo.chave });

        const porChave = new Map(gravados.map((x) => [x.chave, x.id]));
        const itensDoLote = fatia.flatMap((g) =>
          g.itens.map((it) => ({
            grupoId: porChave.get(g.chave)!,
            fonteProdutoId: it.id,
            fonte: it.fonte,
            loja: it.loja,
          })));
        if (itensDoLote.length) await tx.insert(unifGrupoItem).values(itensDoLote);
      }
    });

    return this.totais();
  }

  private paraLinha(
    g: GrupoReconciliado,
    anterior?: {
      decisao: string | null; decididoPor: string | null; decididoEm: Date | null;
      grupoManual: string | null; grupoDefinidoPor: string | null; grupoDefinidoEm: Date | null;
    },
  ) {
    const grupoManual = anterior?.grupoManual?.trim() || null;
    const candidato = grupoManual
      ? { ...g.candidato, grupo: grupoManual, grupoDe: 'central_manual' }
      : g.candidato;
    return {
      chave: g.chave,
      motivo: g.motivo,
      fontes: g.fontes,
      lojas: g.lojas,
      candidato,
      nome: candidato.nome,
      nomeNormalizado: normalizarNome(candidato.nome),
      grupo: candidato.grupo,
      grupoManual,
      grupoDefinidoPor: anterior?.grupoDefinidoPor ?? null,
      grupoDefinidoEm: anterior?.grupoDefinidoEm ?? null,
      ativo: g.candidato.ativo,
      flagNomesDivergentes: g.flags.nomesDivergentes,
      flagSemFiscalTnp: g.flags.semFiscalTnp,
      flagSemBarras: g.flags.semBarras,
      flagBarrasConflitante: g.flags.barrasConflitante,
      flagSemGrupo: grupoManual ? false : g.flags.semGrupo,
      flagJaNoPralis: g.flags.jaNoPralis,
      decisao: anterior?.decisao ?? null,
      decididoPor: anterior?.decididoPor ?? null,
      decididoEm: anterior?.decididoEm ?? null,
    };
  }

  /**
   * Define o grupo oficial de um item que chegou sem essa informação.
   * A escolha fica fora do staging e sobrevive a qualquer recálculo das fontes.
   */
  async definirGrupo(user: CurrentUser, grupoId: string, nomeGrupo: string): Promise<void> {
    if (user.role !== 'admin') {
      throw new AppError('Apenas o administrador define grupos.', 403, 'ONLY_ADMIN_UNIF');
    }
    const nome = nomeGrupo.replace(/\p{Cf}/gu, '').replace(/\s+/g, ' ').trim();
    if (!nome) throw new AppError('Informe um grupo.', 422, 'UNIF_GRUPO_VAZIO');

    const [atual] = await db.select().from(unifGrupo).where(eq(unifGrupo.id, grupoId));
    if (!atual) throw new AppError('Grupo de reconciliação não encontrado.', 404, 'UNIF_GRUPO_NOT_FOUND');
    if (atual.decisao) {
      throw new AppError(`Este item já foi marcado como "${atual.decisao}".`, 409, 'UNIF_JA_DECIDIDO');
    }

    const candidato = atual.candidato as Record<string, unknown>;
    await db.update(unifGrupo).set({
      grupo: nome,
      grupoManual: nome,
      grupoDefinidoPor: user.name,
      grupoDefinidoEm: new Date(),
      flagSemGrupo: false,
      candidato: { ...candidato, grupo: nome, grupoDe: 'central_manual' },
    }).where(eq(unifGrupo.id, grupoId));
  }

  /**
   * O que pode ser unificado sem interpretação humana.
   *
   * Uma definição só, usada pela contagem e pela seleção: se as duas
   * divergissem, a tela prometeria um número e o botão faria outro.
   *
   * `mesmo_cod_barras` é a chave forte. As três flags de fora são as que
   * exigem olho humano — nome divergente, código de barras conflitante entre
   * fontes, e item sem grupo (sem grupo não há regra fiscal, e o cadastro
   * quebraria depois na edição normal com TAX_RULE_NOT_FOUND).
   */
  private condicoesAutomaticas(): SQL {
    return and(
      eq(unifGrupo.motivo, 'mesmo_cod_barras'),
      eq(unifGrupo.flagNomesDivergentes, false),
      eq(unifGrupo.flagBarrasConflitante, false),
      eq(unifGrupo.flagSemGrupo, false),
      sql`${unifGrupo.decisao} IS NULL`,
      sql`length(trim(${unifGrupo.nome})) > 0`,
    )!;
  }

  /** Quantos grupos o lote automático ainda tem para processar. */
  async contarAutomaticos(): Promise<number> {
    const [linha] = await db.select({ total: count() }).from(unifGrupo)
      .where(this.condicoesAutomaticas());
    return linha?.total ?? 0;
  }

  /** IDs do lote que pode ser unificado sem interpretação humana. */
  async idsAutomaticos(limite: number): Promise<string[]> {
    const linhas = await db.select({ id: unifGrupo.id }).from(unifGrupo)
      .where(this.condicoesAutomaticas())
      .orderBy(asc(unifGrupo.nome), asc(unifGrupo.chave))
      .limit(Math.min(200, Math.max(1, limite)));
    return linhas.map((l) => l.id);
  }

  /** Os filtros viram SQL — a tela nunca recebe a base inteira para peneirar. */
  private condicoes(f: FiltrosGrupos): SQL[] {
    const onde: SQL[] = [];
    if (f.filtro) onde.push(eq(unifGrupo.motivo, f.filtro));
    if (f.loja) onde.push(sql`${unifGrupo.lojas} @> ARRAY[${f.loja}]::text[]`);
    if (f.status) onde.push(eq(unifGrupo.ativo, f.status === 'ativo'));
    if (f.semFiscalTnp) onde.push(eq(unifGrupo.flagSemFiscalTnp, true));
    if (f.semGrupo) onde.push(eq(unifGrupo.flagSemGrupo, true));
    if (f.revisar) {
      onde.push(or(
        eq(unifGrupo.flagNomesDivergentes, true),
        eq(unifGrupo.flagSemFiscalTnp, true),
        eq(unifGrupo.flagSemGrupo, true),
        eq(unifGrupo.flagBarrasConflitante, true),
      )!);
    }
    if (f.decisao === 'pendente') onde.push(sql`${unifGrupo.decisao} IS NULL`);
    if (f.decisao === 'feita') onde.push(sql`${unifGrupo.decisao} IS NOT NULL`);
    if (f.q?.trim()) {
      const termo = `%${f.q.trim()}%`;
      onde.push(or(
        ilike(unifGrupo.nome, termo),
        ilike(unifGrupo.chave, termo),
        ilike(unifGrupo.nomeNormalizado, `%${normalizarNome(f.q)}%`),
      )!);
    }
    return onde;
  }

  async listar(f: FiltrosGrupos) {
    const pagina = Math.max(1, f.pagina ?? 1);
    const tamanho = Math.min(200, Math.max(1, f.tamanho ?? 50));
    const onde = this.condicoes(f);
    const filtro = onde.length ? and(...onde) : undefined;

    const [{ total }] = await db.select({ total: count() }).from(unifGrupo).where(filtro);

    const grupos = await db
      .select()
      .from(unifGrupo)
      .where(filtro)
      .orderBy(asc(unifGrupo.nome), asc(unifGrupo.chave))
      .limit(tamanho)
      .offset((pagina - 1) * tamanho);

    // as linhas de origem só das páginas pedidas — não da base inteira
    const ids = grupos.map((g) => g.id);
    const itens = ids.length
      ? await db
        .select({
          grupoId: unifGrupoItem.grupoId,
          fonte: unifGrupoItem.fonte,
          loja: unifGrupoItem.loja,
          codInterno: unifFonteProduto.codInterno,
          codBarras: unifFonteProduto.codBarras,
          nome: unifFonteProduto.nome,
          ativo: unifFonteProduto.ativo,
          grupo: unifFonteProduto.grupo,
          custo: unifFonteProduto.custo,
          venda: unifFonteProduto.venda,
          ncm: unifFonteProduto.ncm,
          cst: unifFonteProduto.cst,
        })
        .from(unifGrupoItem)
        .leftJoin(unifFonteProduto, eq(unifGrupoItem.fonteProdutoId, unifFonteProduto.id))
        .where(inArray(unifGrupoItem.grupoId, ids))
      : [];

    const porGrupo = new Map<string, typeof itens>();
    for (const it of itens) porGrupo.set(it.grupoId, [...(porGrupo.get(it.grupoId) ?? []), it]);

    return {
      total: total ?? 0,
      pagina,
      tamanho,
      paginas: Math.ceil((total ?? 0) / tamanho),
      grupos: grupos.map((g) => ({ ...g, itens: porGrupo.get(g.id) ?? [] })),
    };
  }

  async totais(): Promise<TotaisUnificacao> {
    const [r] = await db
      .select({
        grupos: count(),
        jaNoPralis: sql<number>`count(*) FILTER (WHERE ${unifGrupo.flagJaNoPralis})::int`,
        aCriar: sql<number>`count(*) FILTER (WHERE NOT ${unifGrupo.flagJaNoPralis})::int`,
        semFiscalTnp: sql<number>`count(*) FILTER (WHERE ${unifGrupo.flagSemFiscalTnp})::int`,
        semGrupo: sql<number>`count(*) FILTER (WHERE ${unifGrupo.flagSemGrupo})::int`,
        nomesDivergentes: sql<number>`count(*) FILTER (WHERE ${unifGrupo.flagNomesDivergentes})::int`,
        barrasConflitante: sql<number>`count(*) FILTER (WHERE ${unifGrupo.flagBarrasConflitante})::int`,
        pendentes: sql<number>`count(*) FILTER (WHERE ${unifGrupo.decisao} IS NULL)::int`,
        decididos: sql<number>`count(*) FILTER (WHERE ${unifGrupo.decisao} IS NOT NULL)::int`,
      })
      .from(unifGrupo);

    const motivos = await db
      .select({ motivo: unifGrupo.motivo, quantos: count() })
      .from(unifGrupo)
      .groupBy(unifGrupo.motivo);

    return {
      grupos: r?.grupos ?? 0,
      porMotivo: Object.fromEntries(motivos.map((m) => [m.motivo, m.quantos])),
      jaNoPralis: r?.jaNoPralis ?? 0,
      aCriar: r?.aCriar ?? 0,
      semFiscalTnp: r?.semFiscalTnp ?? 0,
      semGrupo: r?.semGrupo ?? 0,
      nomesDivergentes: r?.nomesDivergentes ?? 0,
      barrasConflitante: r?.barrasConflitante ?? 0,
      pendentes: r?.pendentes ?? 0,
      decididos: r?.decididos ?? 0,
    };
  }
}
