import { injectable } from 'tsyringe';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '@/db/databases';
import { users } from '@/modules/user/user.table';
import { userTelaPermissao } from './permissao.table';
import type { Papel, PessoaPermissao, RegraGravada } from './permissao.motor';

export interface PessoaComRegras extends PessoaPermissao {
  nome: string;
  loja: string | null;
  ativo: boolean;
  regras: RegraGravada[];
}

export interface PermissaoRepo {
  pessoa(userId: string): Promise<PessoaComRegras | null>;
  regrasDe(userId: string): Promise<RegraGravada[]>;
  pessoas(): Promise<PessoaComRegras[]>;
  gravar(pedido: {
    userId: string;
    telaId: string;
    permitido: boolean;
    alteradoPorUserId: string;
    alteradoPorNome: string;
  }): Promise<void>;
}

@injectable()
export class PermissaoRepository implements PermissaoRepo {
  async regrasDe(userId: string): Promise<RegraGravada[]> {
    return db
      .select({ telaId: userTelaPermissao.telaId, permitido: userTelaPermissao.permitido })
      .from(userTelaPermissao)
      .where(eq(userTelaPermissao.userId, userId));
  }

  async pessoa(userId: string): Promise<PessoaComRegras | null> {
    const [u] = await db
      .select({
        id: users.id, nome: users.name, email: users.email,
        role: users.role, loja: users.loja, ativo: users.isActive,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!u) return null;
    return { ...u, role: u.role as Papel, regras: await this.regrasDe(userId) };
  }

  /** Todo mundo + as regras de todo mundo, em duas consultas em vez de N+1. */
  async pessoas(): Promise<PessoaComRegras[]> {
    const lista = await db
      .select({
        id: users.id, nome: users.name, email: users.email,
        role: users.role, loja: users.loja, ativo: users.isActive,
      })
      .from(users)
      .orderBy(asc(users.name));
    if (lista.length === 0) return [];

    const regras = await db
      .select({
        userId: userTelaPermissao.userId,
        telaId: userTelaPermissao.telaId,
        permitido: userTelaPermissao.permitido,
      })
      .from(userTelaPermissao)
      .where(inArray(userTelaPermissao.userId, lista.map((u) => u.id)));

    const porUsuario = new Map<string, RegraGravada[]>();
    for (const r of regras) {
      porUsuario.set(r.userId, [...(porUsuario.get(r.userId) ?? []), { telaId: r.telaId, permitido: r.permitido }]);
    }
    return lista.map((u) => ({
      ...u,
      role: u.role as Papel,
      regras: porUsuario.get(u.id) ?? [],
    }));
  }

  /**
   * Grava a decisão. Uma linha por (usuário, tela) — o índice único garante —,
   * então a segunda decisão sobre a mesma tela SUBSTITUI a primeira em vez de
   * empilhar uma linha nova que o leitor teria de desempatar por data.
   */
  async gravar(pedido: {
    userId: string;
    telaId: string;
    permitido: boolean;
    alteradoPorUserId: string;
    alteradoPorNome: string;
  }): Promise<void> {
    const existente = await db
      .select({ id: userTelaPermissao.id })
      .from(userTelaPermissao)
      .where(and(
        eq(userTelaPermissao.userId, pedido.userId),
        eq(userTelaPermissao.telaId, pedido.telaId),
      ))
      .limit(1);

    if (existente[0]) {
      await db.update(userTelaPermissao)
        .set({
          permitido: pedido.permitido,
          alteradoEm: new Date(),
          alteradoPorUserId: pedido.alteradoPorUserId,
          alteradoPorNome: pedido.alteradoPorNome,
        })
        .where(eq(userTelaPermissao.id, existente[0].id));
      return;
    }
    await db.insert(userTelaPermissao).values({
      userId: pedido.userId,
      telaId: pedido.telaId,
      permitido: pedido.permitido,
      alteradoPorUserId: pedido.alteradoPorUserId,
      alteradoPorNome: pedido.alteradoPorNome,
    });
  }
}
