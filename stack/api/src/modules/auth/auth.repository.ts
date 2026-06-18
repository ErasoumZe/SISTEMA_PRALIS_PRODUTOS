import { injectable } from 'tsyringe';
import { and, eq, gt } from 'drizzle-orm';
import { db, Tx } from '@/db/databases';
import { users } from '@/modules/user/user.table';
import { sessions } from '@/modules/auth/auth.table';

@injectable()
export class AuthRepository {
  async createUser(data: { name: string; email: string; passwordHash: string }, tx: Tx = db) {
    const [created] = await tx.insert(users).values(data).returning();
    if (!created) throw new Error('Falha ao criar usuário');
    return created;
  }

  async findByEmail(email: string, tx: Tx = db) {
    const [user] = await tx.select().from(users).where(eq(users.email, email)).limit(1);
    return user ?? null;
  }

  async findById(id: string, tx: Tx = db) {
    const [user] = await tx.select().from(users).where(eq(users.id, id)).limit(1);
    return user ?? null;
  }

  async createSession(userId: string, tx: Tx = db) {
    const [session] = await tx.insert(sessions).values({ userId }).returning();
    if (!session) throw new Error('Falha ao criar sessão');
    return session;
  }

  async findValidSession(id: string, tx: Tx = db) {
    const [session] = await tx
      .select()
      .from(sessions)
      .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())))
      .limit(1);
    return session ?? null;
  }

  async deleteSession(id: string, tx: Tx = db) {
    await tx.delete(sessions).where(eq(sessions.id, id));
  }
}
