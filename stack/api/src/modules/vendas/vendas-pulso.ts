import { VendasPulso } from '@pralis/shared';

/**
 * O pulso da importação, calculado longe de banco e de HTTP.
 *
 * A conta é de datas, e data é onde mais se erra por fuso e por off-by-one —
 * por isso mora aqui, onde dá para conferir sem subir Postgres.
 */

/** O que o banco sabe de cada fonte. */
export interface LeituraDaFonte {
  loja: string;
  tipo: string;
  ultimoDia: string | null;
  ultimaChegada: string | null;
}

/** Diferença em dias entre duas datas ISO (`AAAA-MM-DD`), pelo calendário. */
const diasEntre = (de: string, ate: string): number =>
  Math.round(
    (new Date(`${ate}T00:00:00Z`).getTime() - new Date(`${de}T00:00:00Z`).getTime()) / 86_400_000,
  );

export function montarPulso(
  leituras: readonly LeituraDaFonte[],
  hoje: string,
): VendasPulso.Pulso {
  const fontes = leituras.map((l) => {
    /*
     * O atraso é medido pelo dia da VENDA, nunca pelo da chegada.
     *
     * Um robô que roda todo dia mas reenvia sempre o mesmo arquivo velho tem
     * chegada de hoje e não trouxe venda nova nenhuma. Medir pela chegada
     * esconderia justamente esse defeito, que é o mais difícil de notar a olho.
     */
    const diasSemDados = l.ultimoDia ? diasEntre(l.ultimoDia, hoje) : null;
    return {
      loja: l.loja,
      tipo: l.tipo,
      ultimoDia: l.ultimoDia,
      ultimaChegada: l.ultimaChegada,
      diasSemDados,
      /*
       * Fonte que NUNCA recebeu nada conta como atrasada. Tratá-la como "sem
       * problema" esconderia a loja que nunca foi ligada — que é uma falha
       * silenciosa pior que a do robô que parou.
       */
      atrasado: diasSemDados == null || diasSemDados > VendasPulso.DIAS_PARA_ALERTA,
    };
  });

  return { algumAtrasado: fontes.some((f) => f.atrasado), fontes };
}
