import { injectable } from 'tsyringe';
import { sql } from 'drizzle-orm';
import { db } from '@/db/databases';
import { metaDiaSemana, metaVersao } from './metas.table';

type Loja = 'TNP' | 'LI';

export interface DiaPorTurno { data: string; manha: number; tarde: number }

export interface VersaoGravada {
  id: string;
  vigenciaInicio: string;
  crescimento: number;
  referenciaInicio: string;
  referenciaFim: string;
  observacao: string | null;
  criadoEm: string;
}

export interface LinhaMatriz {
  diaSemana: number;
  ocorrencias: number;
  referenciaMedia: number;
  pctManha: number;
  meta: number;
  metaManha: number;
  metaTarde: number;
}

const n = (valor: unknown) => Number(valor ?? 0);

@injectable()
export class MetasRepository {
  /**
   * Venda por dia, partida em manhã e tarde.
   *
   * Só `natureza = 'posto'`: é o caixa de verdade, o único que tem turno no nome
   * do operador (`VND CAIXA PDV - 1M`). Delivery e outros canais entram como
   * `canal`/`nominal` e ficariam sem turno — por decisão do José em 05/10/2026
   * eles não contam na meta por turno.
   *
   * O turno sai de `deriveOperador()` na ingestão, que é a mesma leitura que a
   * planilha faz com `MID(H12;18;1)`.
   */
  async vendaPorTurno(loja: Loja, inicio: string, fim: string): Promise<DiaPorTurno[]> {
    const result = await db.execute(sql`
      SELECT data::text AS data,
             COALESCE(SUM(total_pagamento) FILTER (WHERE turno = 'M'), 0) AS manha,
             COALESCE(SUM(total_pagamento) FILTER (WHERE turno = 'T'), 0) AS tarde
      FROM fechamento_caixa_dia
      WHERE loja = ${loja} AND natureza = 'posto'
        AND data BETWEEN ${inicio}::date AND ${fim}::date
      GROUP BY data
      ORDER BY data
    `);
    return result.rows.map((row) => ({
      data: String(row.data), manha: n(row.manha), tarde: n(row.tarde),
    }));
  }

  /** A matriz que valia no dia informado: a de maior vigência que já começou. */
  async versaoVigente(loja: Loja, data: string): Promise<{ versao: VersaoGravada; matriz: LinhaMatriz[] } | null> {
    const achada = await db.execute(sql`
      SELECT id, vigencia_inicio::text AS vigencia_inicio, crescimento,
             referencia_inicio::text AS referencia_inicio, referencia_fim::text AS referencia_fim,
             observacao, criado_em
      FROM meta_versao
      WHERE loja = ${loja} AND vigencia_inicio <= ${data}::date
      ORDER BY vigencia_inicio DESC
      LIMIT 1
    `);
    const linha = achada.rows[0];
    if (!linha) return null;

    const linhas = await db.execute(sql`
      SELECT dia_semana, ocorrencias, referencia_media, pct_manha, meta, meta_manha, meta_tarde
      FROM meta_dia_semana WHERE versao_id = ${String(linha.id)}
      ORDER BY dia_semana
    `);
    return {
      versao: {
        id: String(linha.id),
        vigenciaInicio: String(linha.vigencia_inicio),
        crescimento: n(linha.crescimento),
        referenciaInicio: String(linha.referencia_inicio),
        referenciaFim: String(linha.referencia_fim),
        observacao: linha.observacao === null ? null : String(linha.observacao),
        criadoEm: new Date(String(linha.criado_em)).toISOString(),
      },
      matriz: linhas.rows.map((row) => ({
        diaSemana: Number(row.dia_semana),
        ocorrencias: Number(row.ocorrencias),
        referenciaMedia: n(row.referencia_media),
        pctManha: n(row.pct_manha),
        meta: n(row.meta),
        metaManha: n(row.meta_manha),
        metaTarde: n(row.meta_tarde),
      })),
    };
  }

  /**
   * Grava a versão e suas linhas numa transação.
   *
   * `onConflictDoUpdate` na vigência: gerar duas vezes para o mesmo dia é
   * corrigir a matriz antes de ela valer, não criar uma segunda meta. O que não
   * se faz é apagar versão antiga — ela é o registro do que foi cobrado.
   */
  async gravar(
    loja: Loja,
    versao: { vigenciaInicio: string; crescimento: number; referenciaInicio: string; referenciaFim: string; observacao?: string; criadoPor?: string },
    matriz: LinhaMatriz[],
  ): Promise<string> {
    return db.transaction(async (tx) => {
      const [gravada] = await tx.insert(metaVersao).values({
        loja,
        vigenciaInicio: versao.vigenciaInicio,
        crescimento: versao.crescimento.toFixed(4),
        referenciaInicio: versao.referenciaInicio,
        referenciaFim: versao.referenciaFim,
        observacao: versao.observacao ?? null,
        criadoPor: versao.criadoPor ?? null,
      }).onConflictDoUpdate({
        target: [metaVersao.loja, metaVersao.vigenciaInicio],
        set: {
          crescimento: versao.crescimento.toFixed(4),
          referenciaInicio: versao.referenciaInicio,
          referenciaFim: versao.referenciaFim,
          observacao: versao.observacao ?? null,
          criadoPor: versao.criadoPor ?? null,
        },
      }).returning({ id: metaVersao.id });

      const id = gravada!.id;
      await tx.execute(sql`DELETE FROM meta_dia_semana WHERE versao_id = ${id}`);
      if (matriz.length) {
        await tx.insert(metaDiaSemana).values(matriz.map((linha) => ({
          versaoId: id,
          diaSemana: linha.diaSemana,
          ocorrencias: linha.ocorrencias,
          referenciaMedia: linha.referenciaMedia.toFixed(2),
          pctManha: linha.pctManha.toFixed(4),
          meta: linha.meta.toFixed(2),
          metaManha: linha.metaManha.toFixed(2),
          metaTarde: linha.metaTarde.toFixed(2),
        })));
      }
      return id;
    });
  }
}
