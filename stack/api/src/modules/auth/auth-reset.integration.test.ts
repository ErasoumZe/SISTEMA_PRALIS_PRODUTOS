import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { uuidv7 } from 'uuidv7';

/**
 * Recuperação de senha tem de derrubar as sessões abertas.
 *
 * Auditoria de 08/09/2026, P1: o reset trocava a senha e deixava as sessões
 * vivas. Se a conta foi tomada, quem invadiu continuava dentro — e expulsar o
 * invasor é justamente o motivo de alguém recuperar a senha.
 */

let container: StartedPostgreSqlContainer;
let repo: import('./auth.repository').AuthRepository;
let db: {
  insert: (t: unknown) => { values: (v: unknown) => Promise<unknown> };
  $client: { end: () => Promise<void> };
};
let sessions: typeof import('./auth.table')['sessions'];

const userId = uuidv7();

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:18.1-alpine').start();
  process.env.DATABASE_URL = container.getConnectionUri();
  process.env.VITEST = 'true';
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  const dbMod = await import('@/db/databases');
  db = dbMod.db as unknown as typeof db;
  await migrate(dbMod.db, { migrationsFolder: './drizzle' });

  const { AuthRepository } = await import('./auth.repository');
  const { users } = await import('@/modules/user/user.table');
  ({ sessions } = await import('./auth.table'));
  repo = new AuthRepository();

  await db.insert(users).values([{
    id: userId, name: 'Jose', email: 'jose@cicluz.com.br',
    passwordHash: 'hash-antigo', loja: 'TNP', role: 'user',
  }]);
}, 180_000);

afterAll(async () => {
  await db.$client.end();
  await container?.stop();
});

describe('AuthRepository.resetPassword', () => {
  it('troca a senha E derruba as sessoes abertas', async () => {
    const { eq } = await import('drizzle-orm');
    const dbMod = await import('@/db/databases');

    const a = await repo.createSession(userId);
    const b = await repo.createSession(userId);
    expect(await repo.findValidSession(a.id)).toBeTruthy();
    expect(await repo.findValidSession(b.id)).toBeTruthy();

    await repo.resetPassword(userId, 'hash-novo');

    // as duas sessoes morreram — nao basta invalidar a de quem pediu o reset
    expect(await repo.findValidSession(a.id)).toBeFalsy();
    expect(await repo.findValidSession(b.id)).toBeFalsy();

    const restantes = await dbMod.db.select().from(sessions).where(eq(sessions.userId, userId));
    expect(restantes).toEqual([]);
  });

  it('a sessao criada DEPOIS do reset continua valendo', async () => {
    const nova = await repo.createSession(userId);

    expect(await repo.findValidSession(nova.id)).toBeTruthy();
  });
});
