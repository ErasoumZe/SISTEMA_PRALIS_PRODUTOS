import { z } from 'zod/v4';
import { catalogo, userRole } from '../product/product.enums';

/** Métricas do painel administrativo (todas calculadas a partir dos dados reais). */
export const dashboardSchema = z.object({
  totais: z.object({
    produtos: z.number().int(),
    ativos: z.number().int(),
    inativos: z.number().int(),
    usuarios: z.number().int(),
    lojas: z.number().int(),
    base: z.number().int(), // produtos no catálogo Geral (BASE)
    cadastradosHoje: z.number().int(),
  }),
  porTipo: z.object({
    revenda: z.number().int(),
    transformacao: z.number().int(),
  }),
  porLoja: z.array(z.object({ loja: catalogo, total: z.number().int() })),
  produtividade: z.array(z.object({ nome: z.string(), total: z.number().int() })),
  porDia: z.array(z.object({ dia: z.string(), total: z.number().int() })),
  recentes: z.array(
    z.object({
      id: z.string(),
      nome: z.string(),
      loja: catalogo,
      createdByName: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
});
export type Dashboard = z.infer<typeof dashboardSchema>;

/** Usuário na visão de administração (com contagem de produtos cadastrados). */
export const adminUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  loja: z.string().nullable(), // null para admin
  role: userRole,
  emailVerified: z.boolean(),
  isActive: z.boolean(),
  createdAt: z.string(),
  produtos: z.number().int(),
});
export type AdminUser = z.infer<typeof adminUserSchema>;
