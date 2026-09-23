import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { uuidv7 } from 'uuidv7';
import { Telas } from '@pralis/shared';
import { users } from '@/modules/user/user.table';
import type { CurrentUser } from '@/types/fastify-jwt';
import type { PermissaoService } from './permissao.service';

/**
 * A permissão contra banco de verdade.
 *
 * O unitário prova as REGRAS (`permissao.motor.test.ts`); aqui prova o que só
 * o Postgres responde: que a segunda decisão sobre a mesma tela substitui a
 * primeira em vez de empilhar linha (o índice único), e que o que foi gravado
 * volta na leitura seguinte.
 */

let container: StartedPostgreSqlContainer;
let service: PermissaoService;
let db: { insert: (t: unknown) => { values: (v: unknown) => Promise<unknown> }; $client: { end: () => Promise<void> } };

const rodrigoId = uuidv7();
const joseId = uuidv7();
const giuliaId = uuidv7();

const RAIZ_EMAIL = 'rodrigo@cicluz.com.br';

const rodrigo: CurrentUser = { id: rodrigoId, name: 'Rodrigo', email: RAIZ_EMAIL, loja: null, role: 'admin' };
const jose: CurrentUser = { id: joseId, name: 'José', email: 'sistema@cicluz.com.br', loja: null, role: 'admin' };
const giulia: CurrentUser = { id: giuliaId, name: 'Giulia', email: 'giulia@cicluz.com.br', loja: 'TNP', role: 'user' };

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:18.1-alpine').start();
  process.env.DATABASE_URL = container.getConnectionUri();
  process.env.ADMIN_EMAIL = RAIZ_EMAIL;
  process.env.VITEST = 'true';

  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  const dbMod = await import('@/db/databases');
  db = dbMod.db as unknown as typeof db;
  await migrate(dbMod.db, { migrationsFolder: './drizzle' });

  const { PermissaoRepository } = await import('./permissao.repository');
  const { PermissaoService } = await import('./permissao.service');
  service = new PermissaoService(new PermissaoRepository());

  await db.insert(users).values([
    { id: rodrigoId, name: 'Rodrigo', email: RAIZ_EMAIL, passwordHash: 'x', role: 'admin', loja: null },
    { id: joseId, name: 'José', email: 'sistema@cicluz.com.br', passwordHash: 'x', role: 'admin', loja: null },
    { id: giuliaId, name: 'Giulia', email: 'giulia@cicluz.com.br', passwordHash: 'x', role: 'user', loja: 'TNP' },
  ]);
}, 180_000);

afterAll(async () => {
  await db.$client.end();
  await container?.stop();
});

describe('permissão contra banco', () => {
  it('sem nada gravado, todo mundo enxerga todas as telas', async () => {
    expect(await service.telasDoUsuario(giuliaId)).toEqual([...Telas.TODAS_AS_TELAS]);
  });

  it('o Rodrigo bloqueia uma tela e ela some para a pessoa', async () => {
    await service.alternar(rodrigo, { userId: giuliaId, telaId: 'manutencao', permitido: false });
    const telas = await service.telasDoUsuario(giuliaId);
    expect(telas).not.toContain('manutencao');
    expect(telas).toContain('produtos');
  });

  /*
   * Sem o índice único, alternar duas vezes deixaria duas linhas para o mesmo
   * par e a leitura teria de desempatar por data — que é o tipo de regra que
   * some numa refatoração e volta como permissão fantasma.
   */
  it('alternar de novo SUBSTITUI a decisão, não empilha', async () => {
    await service.alternar(rodrigo, { userId: giuliaId, telaId: 'manutencao', permitido: true });
    expect(await service.telasDoUsuario(giuliaId)).toContain('manutencao');

    await service.alternar(rodrigo, { userId: giuliaId, telaId: 'manutencao', permitido: false });
    expect(await service.telasDoUsuario(giuliaId)).not.toContain('manutencao');
  });

  it('admin bloqueia usuário comum, mas não outro admin', async () => {
    await service.alternar(jose, { userId: giuliaId, telaId: 'dashboard', permitido: false });
    expect(await service.telasDoUsuario(giuliaId)).not.toContain('dashboard');

    await expect(service.alternar(jose, { userId: rodrigoId, telaId: 'dashboard', permitido: false }))
      .rejects.toThrow(/administrador principal/i);
  });

  it('o admin-raiz continua enxergando tudo mesmo com linha gravada contra ele', async () => {
    // grava direto pelo repositório: a via do service recusa, e é isso que se quer provar por baixo
    const { PermissaoRepository } = await import('./permissao.repository');
    await new PermissaoRepository().gravar({
      userId: rodrigoId, telaId: 'usuarios', permitido: false,
      alteradoPorUserId: joseId, alteradoPorNome: 'José',
    });
    expect(await service.telasDoUsuario(rodrigoId)).toEqual([...Telas.TODAS_AS_TELAS]);
  });

  it('tela sempre liberada não pode ser desligada', async () => {
    await expect(service.alternar(rodrigo, { userId: giuliaId, telaId: 'produtos', permitido: false }))
      .rejects.toThrow(/não pode ser desligada/i);
  });

  it('usuário comum não abre o painel de permissões quando perde a tela', async () => {
    await service.alternar(rodrigo, { userId: giuliaId, telaId: 'permissoes', permitido: false });
    await expect(service.painel(giulia)).rejects.toThrow(/não tem acesso/i);
  });

  it('o painel diz quem cada um pode gerenciar', async () => {
    const painel = await service.painel(rodrigo);
    const porEmail = new Map(painel.pessoas.map((p) => [p.email, p]));
    expect(porEmail.get(RAIZ_EMAIL)?.adminRaiz).toBe(true);
    expect(porEmail.get(RAIZ_EMAIL)?.gerenciavel).toBe(false);
    expect(porEmail.get('giulia@cicluz.com.br')?.gerenciavel).toBe(true);

    const peloJose = await service.painel(jose);
    const vistoPeloJose = new Map(peloJose.pessoas.map((p) => [p.email, p]));
    expect(vistoPeloJose.get('giulia@cicluz.com.br')?.gerenciavel).toBe(true);
    expect(vistoPeloJose.get('sistema@cicluz.com.br')?.gerenciavel).toBe(false);
  });
});
