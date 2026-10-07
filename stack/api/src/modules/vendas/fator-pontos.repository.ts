import { injectable } from 'tsyringe';
import { sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { FatorPontosSchemas } from '@pralis/shared';
import { db } from '@/db/databases';

type Loja = 'TNP' | 'LI';
const n = (valor: unknown): number => Number(valor ?? 0);

const paraVersao = (linha: Record<string, unknown>): FatorPontosSchemas.FatorVersao => ({
  id: String(linha.id),
  loja: String(linha.loja) as Loja,
  vigenciaInicio: String(linha.vigencia_inicio),
  faturamento: n(linha.faturamento),
  ticketMedio: n(linha.ticket_medio),
  ticketEmPontos: Boolean(linha.ticket_em_pontos),
  observacao: linha.observacao === null ? null : String(linha.observacao),
  criadoPor: linha.criado_por === null ? null : String(linha.criado_por),
  criadoEm: new Date(String(linha.criado_em)).toISOString(),
});

const COLUNAS = sql`id, loja, vigencia_inicio::text AS vigencia_inicio, faturamento,
  ticket_medio, ticket_em_pontos, observacao, criado_por, criado_em`;

@injectable()
export class FatorPontosRepository {
  /** Todas as versões da loja, da mais recente para a mais antiga. */
  async listar(loja: Loja): Promise<FatorPontosSchemas.FatorVersao[]> {
    const r = await db.execute(sql`
      SELECT ${COLUNAS} FROM fator_pontos_versao
      WHERE loja = ${loja} ORDER BY vigencia_inicio DESC
    `);
    return r.rows.map(paraVersao);
  }

  /**
   * A régua que valia no dia informado.
   *
   * É a consulta que todo relatório faz, então ela é um `LIMIT 1` sobre o
   * índice `(loja, vigencia_inicio)` — não uma leitura da tabela inteira.
   */
  async vigenteEm(loja: Loja, data: string): Promise<FatorPontosSchemas.FatorVersao | null> {
    const r = await db.execute(sql`
      SELECT ${COLUNAS} FROM fator_pontos_versao
      WHERE loja = ${loja} AND vigencia_inicio <= ${data}::date
      ORDER BY vigencia_inicio DESC LIMIT 1
    `);
    const linha = r.rows[0];
    return linha ? paraVersao(linha) : null;
  }

  /**
   * Grava a régua da vigência.
   *
   * `onConflict` na vigência: salvar duas vezes para o mesmo dia é correção,
   * não uma segunda régua. Versão antiga nunca é apagada por aqui.
   */
  async salvar(
    entrada: FatorPontosSchemas.SalvarFatorBody & { criadoPor: string | null },
  ): Promise<FatorPontosSchemas.FatorVersao> {
    const r = await db.execute(sql`
      INSERT INTO fator_pontos_versao
        (id, loja, vigencia_inicio, faturamento, ticket_medio, ticket_em_pontos, observacao, criado_por)
      VALUES (${uuidv7()}, ${entrada.loja}, ${entrada.vigenciaInicio}::date, ${entrada.faturamento},
        ${entrada.ticketMedio}, ${entrada.ticketEmPontos}, ${entrada.observacao ?? null}, ${entrada.criadoPor})
      ON CONFLICT (loja, vigencia_inicio) DO UPDATE SET
        faturamento = EXCLUDED.faturamento,
        ticket_medio = EXCLUDED.ticket_medio,
        ticket_em_pontos = EXCLUDED.ticket_em_pontos,
        observacao = EXCLUDED.observacao,
        criado_por = EXCLUDED.criado_por
      RETURNING ${COLUNAS}
    `);
    const linha = r.rows[0];
    if (!linha) throw new Error('Falha ao gravar o fator de pontos');
    return paraVersao(linha);
  }

  /** Apaga uma vigência. Devolve `false` quando ela já não existia. */
  async apagar(id: string): Promise<boolean> {
    const r = await db.execute(sql`DELETE FROM fator_pontos_versao WHERE id = ${id} RETURNING id`);
    return r.rows.length > 0;
  }
}
