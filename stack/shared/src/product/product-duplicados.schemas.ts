import { z } from 'zod/v4';
import { catalogo } from './product.enums';

/**
 * Diagnóstico de cadastros duplicados. SÓ LEITURA — nesta fatia não existe
 * botão de fundir. Ninguém sabe hoje se são 12 duplicatas ou 1.200, e esse
 * número é que decide se a unificação precisa de ação em lote.
 *
 * Fundir vale apenas DENTRO da mesma loja: a Coca da TNP e a Coca da LI têm
 * custo e preço próprios e continuam cadastros distintos.
 */

export const motivoDuplicidade = z.enum([
  /** Mesmo código de barras (ou mesmo PLU de balança) na mesma loja. */
  'codigo_barras',
  /** Mesmo código interno na mesma loja. */
  'codigo_interno',
  /** Nomes parecidos acima do piso — sugestão, não fato. */
  'nome',
  /** Produto de loja sem vínculo com a BASE (caso D2: ligar, não fundir). */
  'sem_base',
]);

export const produtoDuplicadoSchema = z.object({
  id: z.string(),
  nome: z.string(),
  descricao: z.string(),
  codigoBarras: z.string().nullable(),
  codigoInterno: z.string().nullable(),
  custo: z.number().nullable(),
  vVendaPontual: z.number().nullable(),
  ncm: z.string().nullable(),
  cstPisCofins: z.string().nullable(),
  aliquotaSimples: z.number().nullable(),
  status: z.string(),
  temBase: z.boolean(),
  /** Faturamento dos últimos 90 dias — é o que ordena a fila. */
  faturamento90d: z.number(),
});

export const grupoDuplicadoSchema = z.object({
  motivo: motivoDuplicidade,
  /** O que os une: o código, ou o par de nomes. */
  chave: z.string(),
  /** 0..100. Só faz sentido quando o motivo é `nome`. */
  semelhanca: z.number().nullable(),
  /** Campos em que os cadastros DIFEREM — "iguais" precisa ser conferido. */
  camposDiferentes: z.array(z.string()),
  /** true quando NCM, CST ou alíquota divergem: fundir exige decisão fiscal. */
  fiscalDiverge: z.boolean(),
  faturamento90d: z.number(),
  produtos: z.array(produtoDuplicadoSchema),
});

export const duplicadosSchema = z.object({
  loja: catalogo,
  /** Quantos produtos da loja foram analisados. */
  produtosAnalisados: z.number(),
  totais: z.object({
    codigoBarras: z.number(),
    codigoInterno: z.number(),
    nome: z.number(),
    semBase: z.number(),
  }),
  /** Faturamento de 90 dias preso em cadastros duplicados. */
  faturamentoEnvolvido: z.number(),
  grupos: z.array(grupoDuplicadoSchema),
});

export const duplicadosQuerySchema = z.object({
  loja: catalogo.optional(),
  /** Piso de semelhança de nome. Começar alto e baixar com o uso. */
  semelhancaMinima: z.coerce.number().int().min(50).max(100).default(75),
});

export type ProdutoDuplicado = z.output<typeof produtoDuplicadoSchema>;
export type GrupoDuplicado = z.output<typeof grupoDuplicadoSchema>;
export type Duplicados = z.output<typeof duplicadosSchema>;
export type DuplicadosQuery = z.output<typeof duplicadosQuerySchema>;
export type MotivoDuplicidade = z.output<typeof motivoDuplicidade>;

/**
 * Pedido de unificação. O admin escolhe qual LINHA sobrevive — não campo a
 * campo, que é onde esse tipo de tela vira um formulário que ninguém termina.
 */
export const unificarBodySchema = z.object({
  vencedorProductId: z.string().min(1),
  perdedorProductId: z.string().min(1),
  /**
   * O admin viu a divergência fiscal e assumiu que o NCM/CST/alíquota do
   * vencedor é o correto. Sem isso, unificar com fiscal divergente é RECUSADO:
   * o mesmo princípio de nunca inventar alíquota.
   */
  fiscalConfirmado: z.boolean().default(false),
});

export const unificarResultSchema = z.object({
  loja: catalogo,
  vencedorProductId: z.string(),
  perdedorProductId: z.string(),
  /** Vínculos de venda que passaram a apontar para o vencedor. */
  vinculosReapontados: z.number(),
  /** Produtos de loja que penduravam no perdedor e foram reapontados. */
  filhosReapontados: z.number(),
  /** Como ficou o espelho da planilha ao aposentar o perdedor. */
  sheetSync: z.string(),
});

export type UnificarBody = z.output<typeof unificarBodySchema>;
export type UnificarResult = z.output<typeof unificarResultSchema>;
