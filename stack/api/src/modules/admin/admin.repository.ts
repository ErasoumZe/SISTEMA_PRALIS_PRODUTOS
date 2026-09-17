import { injectable } from 'tsyringe';
import { sql, eq, ne, and, desc, count, isNotNull } from 'drizzle-orm';
import { db } from '@/db/databases';
import { products } from '@/modules/product/product.table';
import { users } from '@/modules/user/user.table';
import { AdminSchemas } from '@pralis/shared';

type Catalogo = AdminSchemas.Dashboard['porLoja'][number]['loja'];

@injectable()
export class AdminRepository {
  /** Agrega todas as métricas do painel a partir dos dados reais. */
  async getDashboard(): Promise<AdminSchemas.Dashboard> {
    const [tot] = await db
      .select({
        produtos: count(),
        ativos: sql<number>`count(*) filter (where ${products.status} = 'ativo')::int`,
        inativos: sql<number>`count(*) filter (where ${products.status} = 'inativo')::int`,
        base: sql<number>`count(*) filter (where ${products.loja} = 'BASE')::int`,
        cadastradosHoje: sql<number>`count(*) filter (
          where ${products.createdAt} >= (
            date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'
          )
        )::int`,
        revenda: sql<number>`count(*) filter (where ${products.tipo} = 'revenda')::int`,
        transformacao: sql<number>`count(*) filter (where ${products.tipo} = 'transformacao')::int`,
      })
      .from(products);

    const [u] = await db.select({ usuarios: count() }).from(users);
    const [lj] = await db.select({ lojas: sql<number>`count(distinct ${users.loja})::int` }).from(users);

    const porLojaRows = await db
      .select({ loja: products.loja, total: count() })
      .from(products)
      .groupBy(products.loja);

    // Parte de usuários, não de produtos: assim todo usuário aparece no painel,
    // inclusive quem ainda não cadastrou nada. O vínculo por ID evita que nomes
    // iguais misturem produtividades e inclui o catálogo Base na contagem.
    const produtividade = await db
      .select({
        id: users.id,
        nome: users.name,
        total: sql<number>`count(${products.id})::int`,
      })
      .from(users)
      .leftJoin(products, eq(products.createdByUserId, users.id))
      .groupBy(users.id, users.name)
      .orderBy(desc(sql`count(${products.id})`), users.name);

    const dia = sql<string>`to_char(date_trunc('day', ${products.createdAt}), 'YYYY-MM-DD')`;
    const porDiaRows = await db
      .select({ dia, total: count() })
      .from(products)
      .where(and(ne(products.loja, 'BASE'), sql`${products.createdAt} >= now() - interval '30 days'`))
      .groupBy(sql`date_trunc('day', ${products.createdAt})`)
      .orderBy(sql`date_trunc('day', ${products.createdAt})`);

    const recentes = await db
      .select({
        id: products.id, // o dashboard usa como atalho para o produto
        nome: products.nome,
        loja: products.loja,
        createdByUserId: products.createdByUserId,
        createdByName: products.createdByName,
        createdAt: products.createdAt,
      })
      .from(products)
      .where(ne(products.loja, 'BASE'))
      .orderBy(desc(products.createdAt))
      .limit(6);

    return {
      totais: {
        produtos: Number(tot?.produtos ?? 0),
        ativos: Number(tot?.ativos ?? 0),
        inativos: Number(tot?.inativos ?? 0),
        usuarios: Number(u?.usuarios ?? 0),
        lojas: Number(lj?.lojas ?? 0),
        base: Number(tot?.base ?? 0),
        cadastradosHoje: Number(tot?.cadastradosHoje ?? 0),
      },
      porTipo: {
        revenda: Number(tot?.revenda ?? 0),
        transformacao: Number(tot?.transformacao ?? 0),
      },
      porLoja: porLojaRows.map((r) => ({ loja: r.loja as Catalogo, total: Number(r.total) })),
      produtividade: produtividade.map((r) => ({ id: r.id, nome: r.nome, total: Number(r.total) })),
      porDia: porDiaRows.map((r) => ({ dia: r.dia, total: Number(r.total) })),
      recentes: recentes.map((r) => ({
        id: r.id,
        nome: r.nome,
        loja: r.loja as Catalogo,
        createdByUserId: r.createdByUserId,
        createdByName: r.createdByName,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  async listUsers(): Promise<AdminSchemas.AdminUser[]> {
    const rows = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        loja: users.loja,
        role: users.role,
        emailVerified: users.emailVerified,
        isActive: users.isActive,
        createdAt: users.createdAt,
      })
      .from(users)
      .orderBy(desc(users.createdAt));

    // contagem de produtos por usuário (uma query agregada, mapeada por id)
    const counts = await db
      .select({ uid: products.createdByUserId, total: count() })
      .from(products)
      .where(isNotNull(products.createdByUserId))
      .groupBy(products.createdByUserId);
    const porUsuario = new Map(counts.map((c) => [c.uid, Number(c.total)]));

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      loja: r.loja,
      role: r.role as AdminSchemas.AdminUser['role'],
      emailVerified: r.emailVerified,
      isActive: r.isActive,
      createdAt: r.createdAt.toISOString(),
      produtos: porUsuario.get(r.id) ?? 0,
    }));
  }

  async findUser(id: string): Promise<{ id: string; email: string; role: string } | null> {
    const [row] = await db
      .select({ id: users.id, email: users.email, role: users.role })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    return row ?? null;
  }

  async updateRole(id: string, role: 'admin' | 'user'): Promise<boolean> {
    const updated = await db.update(users).set({ role }).where(eq(users.id, id)).returning({ id: users.id });
    return updated.length > 0;
  }

  async deleteUser(id: string): Promise<boolean> {
    // produtos criados por ele ficam (FK createdByUserId é ON DELETE SET NULL; createdByName permanece)
    const deleted = await db.delete(users).where(eq(users.id, id)).returning({ id: users.id });
    return deleted.length > 0;
  }
}
