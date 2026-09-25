import { z } from 'zod/v4';

/**
 * A LISTA DE VENDAS — uma linha por cupom, como saiu do caixa.
 *
 * Só existe sobre `venda_item_pdv`, a tabela em que cada item traz o ID da
 * venda, o dispositivo e a hora, comprovados pelo ERP. As tabelas diárias não
 * sabem o que é "uma venda"; por isso esta visão fica vazia (e diz isso) até o
 * robô da loja enviar o detalhe.
 *
 * "Tempo real" aqui significa: a tela relê a cada poucos segundos e mostra o
 * que já chegou. Quem decide a latência é o robô, não esta rota.
 */

/** Data/hora local da loja, `aaaa-mm-ddThh:mm`, interpretada em America/Sao_Paulo. */
const dataHoraLocal = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);

export const listaVendasQuerySchema = z.object({
  loja: z.enum(['TNP', 'LI']).optional(),
  inicio: dataHoraLocal,
  fim: dataHoraLocal,
  /** ID original do dispositivo no ERP — nunca o nome do PDV. */
  dispositivoIdErp: z.string().trim().max(60).optional(),
  // filtros de cadastro: a venda entra se AO MENOS UM item confirmado passar
  setor: z.string().trim().max(120).optional(),
  grupo: z.string().trim().max(120).optional(),
  produto: z.string().trim().max(120).optional(),
  limite: z.coerce.number().int().min(1).max(200).default(50),
  pagina: z.coerce.number().int().min(1).default(1),
});

export const vendaResumoSchema = z.object({
  vendaIdErp: z.string(),
  /** `aaaa-mm-ddThh:mm:ss`, hora local da loja. */
  vendidoEm: z.string(),
  dispositivoIdErp: z.string(),
  pdv: z.string(),
  /** Itens NÃO cancelados. */
  itens: z.number(),
  quantidade: z.number(),
  /** Soma dos itens não cancelados; `null` para quem não pode ver dinheiro. */
  total: z.number().nullable(),
  status: z.string(),
  confirmada: z.boolean(),
  cancelada: z.boolean(),
});

export const listaVendasSchema = z.object({
  loja: z.enum(['TNP', 'LI']),
  periodo: z.object({
    inicio: z.string(),
    fim: z.string(),
    fuso: z.literal('America/Sao_Paulo'),
    granularidade: z.literal('minuto'),
  }),
  filtros: z.object({
    dispositivoIdErp: z.string().nullable(),
    setor: z.string().nullable(),
    grupo: z.string().nullable(),
    produto: z.string().nullable(),
    ativo: z.boolean(),
  }),
  /** Há algum item desta loja no período? Se não, o robô ainda não mandou. */
  disponivel: z.boolean(),
  total: z.number(),
  pagina: z.number(),
  limite: z.number(),
  /** Hora local em que a fonte foi atualizada pela última vez — é o "atualizado há". */
  atualizadoEm: z.string().nullable(),
  /**
   * PDVs que venderam no período — as opções do filtro de PDV. Ignoram o
   * próprio filtro de PDV (senão escolher um apagaria os outros do menu).
   */
  pdvs: z.array(z.object({ dispositivoIdErp: z.string(), pdv: z.string() })),
  vendas: z.array(vendaResumoSchema),
});

export const vendaDetalheQuerySchema = z.object({
  loja: z.enum(['TNP', 'LI']).optional(),
  vendaIdErp: z.string().trim().min(1).max(60),
});

export const vendaDetalheSchema = z.object({
  loja: z.enum(['TNP', 'LI']),
  vendaIdErp: z.string(),
  vendidoEm: z.string(),
  dispositivoIdErp: z.string(),
  pdv: z.string(),
  status: z.string(),
  confirmada: z.boolean(),
  total: z.number().nullable(),
  itens: z.array(z.object({
    itemIdErp: z.string(),
    produtoIdErp: z.string(),
    produtoCodigo: z.string(),
    produto: z.string(),
    /** Nome no cadastro do Pralis quando o item casou; `null` quando não. */
    produtoCadastro: z.string().nullable(),
    quantidade: z.number(),
    valorUnitario: z.number().nullable(),
    total: z.number().nullable(),
    cancelado: z.boolean(),
  })),
});

export type ListaVendasQuery = z.output<typeof listaVendasQuerySchema>;
export type ListaVendas = z.output<typeof listaVendasSchema>;
export type VendaResumo = z.output<typeof vendaResumoSchema>;
export type VendaDetalheQuery = z.output<typeof vendaDetalheQuerySchema>;
export type VendaDetalhe = z.output<typeof vendaDetalheSchema>;
