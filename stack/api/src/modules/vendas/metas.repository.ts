import { injectable } from 'tsyringe';
import { sql } from 'drizzle-orm';
import { db } from '@/db/databases';
import { metaDiaSemana, metaPlanilhaTnpDia, metaVersao } from './metas.table';
import type { MetaTnpDia, ParametrosMetaPlanilha } from '../../../../shared/src/vendas/metas-planilha';
import type { MetaTnpLinhaLida, MetasTnpLidas } from './metas-planilha.source';

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
const nOuNulo = (valor: unknown) => (valor === null || valor === undefined ? null : Number(valor));

function comoLinhaPlanilha(row: Record<string, unknown>): MetaTnpLinhaLida {
  const data = String(row.data);
  const parametros: ParametrosMetaPlanilha = {
    ajusteDia: n(row.ajuste_dia),
    crescimentoMes: n(row.crescimento_mes),
    pctManha: n(row.pct_manha),
    modo: String(row.modo) as ParametrosMetaPlanilha['modo'],
    casasArredondamento: Number(row.casas_arredondamento),
  };
  const dataBase = String(row.data_base);
  const estado = String(row.estado);
  let meta: MetaTnpDia;
  if (estado === 'calculada') {
    const base = nOuNulo(row.base);
    if (base === null) throw new Error(`Meta TNP ${data} gravada sem base.`);
    const ajustada = base * (1 + parametros.ajusteDia);
    const crescida = ajustada * (1 + parametros.crescimentoMes);
    const tarde = n(row.meta_tarde);
    const tardePlanilha = n(row.meta_tarde_planilha);
    meta = {
      estado: 'calculada', data, dataBase,
      valores: {
        base, ajustada, crescida,
        total: n(row.meta_total), manha: n(row.meta_manha), tarde, tardePlanilha,
        diferencaTardePlanilha: Math.round((tarde - tardePlanilha) * 100) / 100,
      },
    };
  } else if (estado === 'domingo_fechado') {
    meta = { estado, data, total: 0, manha: 0, tarde: 0 };
  } else if (estado === 'sem_referencia') {
    meta = { estado, data, dataBase };
  } else {
    throw new Error(`Estado de meta TNP desconhecido em ${data}.`);
  }
  return { data, linhaPlanilha: Number(row.linha_planilha), parametros, meta };
}

@injectable()
export class MetasRepository {
  /** Existe pelo menos uma importação congelada da regra da planilha para TNP. */
  async temMetasPlanilhaTnp(): Promise<boolean> {
    const result = await db.execute(sql`SELECT 1 FROM meta_planilha_tnp_dia LIMIT 1`);
    return result.rows.length > 0;
  }

  /** A tela lê apenas a cópia congelada, nunca o Google Sheets ao vivo. */
  async metasPlanilhaTnp(inicio: string, fim: string): Promise<MetasTnpLidas> {
    const result = await db.execute(sql`
      SELECT data::text, data_base::text, estado, base, ajuste_dia, crescimento_mes,
             pct_manha, modo, casas_arredondamento, meta_total, meta_manha, meta_tarde,
             meta_tarde_planilha, linha_planilha, lida_na_planilha_em
      FROM meta_planilha_tnp_dia
      WHERE data BETWEEN ${inicio}::date AND ${fim}::date
      ORDER BY data
    `);
    const porData = new Map<string, MetaTnpLinhaLida>();
    let lidoEm = '';
    for (const row of result.rows) {
      const linha = comoLinhaPlanilha(row);
      if (porData.has(linha.data)) throw new Error(`Meta TNP duplicada para ${linha.data}.`);
      porData.set(linha.data, linha);
      const lida = new Date(String(row.lida_na_planilha_em)).toISOString();
      if (lida > lidoEm) lidoEm = lida;
    }
    return { porData, lidoEm: lidoEm || new Date(0).toISOString() };
  }

  /**
   * Substitui somente a faixa ainda autorizada. O passado fica congelado por
   * data, mesmo que a planilha seja corrigida mais tarde.
   */
  async importarMetasPlanilhaTnp(
    fonte: MetasTnpLidas, planilhaId: string, vigenciaInicio: string, importadoPor?: string | null,
  ): Promise<{ gravadas: number; calculadas: number; semReferencia: number; domingos: number }> {
    const linhas = [...fonte.porData.values()].filter((linha) => linha.data >= vigenciaInicio);
    if (!linhas.length) throw new Error('Nenhuma data da planilha está dentro da vigência escolhida.');
    const resumo = { gravadas: linhas.length, calculadas: 0, semReferencia: 0, domingos: 0 };
    await db.transaction(async (tx) => {
      await tx.execute(sql`DELETE FROM meta_planilha_tnp_dia WHERE data >= ${vigenciaInicio}::date`);
      await tx.insert(metaPlanilhaTnpDia).values(linhas.map((linha) => {
        const { data, linhaPlanilha, parametros, meta } = linha;
        const base = meta.estado === 'calculada' ? meta.valores.base : null;
        const valores = meta.estado === 'calculada' ? meta.valores : null;
        if (meta.estado === 'calculada') resumo.calculadas += 1;
        if (meta.estado === 'sem_referencia') resumo.semReferencia += 1;
        if (meta.estado === 'domingo_fechado') resumo.domingos += 1;
        return {
          data,
          dataBase: meta.estado === 'domingo_fechado'
            ? new Date(Date.parse(`${data}T00:00:00Z`) - 364 * 86_400_000).toISOString().slice(0, 10)
            : meta.dataBase,
          estado: meta.estado,
          base: base === null ? null : base.toFixed(2),
          ajusteDia: parametros.ajusteDia.toFixed(4),
          crescimentoMes: parametros.crescimentoMes.toFixed(4),
          pctManha: parametros.pctManha.toFixed(4),
          modo: parametros.modo,
          casasArredondamento: parametros.casasArredondamento,
          metaTotal: valores?.total.toFixed(2) ?? '0',
          metaManha: valores?.manha.toFixed(2) ?? '0',
          metaTarde: valores?.tarde.toFixed(2) ?? '0',
          metaTardePlanilha: valores?.tardePlanilha.toFixed(2) ?? '0',
          planilhaId,
          linhaPlanilha,
          lidaNaPlanilhaEm: new Date(fonte.lidoEm),
          importadoPor: importadoPor ?? null,
        };
      }));
    });
    return resumo;
  }

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
