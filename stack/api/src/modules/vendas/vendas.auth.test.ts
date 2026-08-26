import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { env } from '@/config/env';
import { vendasImportAuth } from './vendas.auth';

function context(token?: string) {
  const send = vi.fn();
  const status = vi.fn(() => ({ send }));
  const request = { headers: token ? { authorization: `Bearer ${token}` } : {}, cookies: {} } as FastifyRequest;
  const reply = { status, sent: false } as unknown as FastifyReply;
  return { request, reply, status, send };
}

describe('vendasImportAuth', () => {
  beforeEach(() => {
    env.VENDAS_IMPORT_TOKEN = 's'.repeat(32);
  });

  it('aceita o segredo da automação sem exigir cookie de usuário', async () => {
    const ctx = context('s'.repeat(32));
    await expect(vendasImportAuth(ctx.request, ctx.reply)).resolves.toBeUndefined();
    expect(ctx.status).not.toHaveBeenCalled();
  });

  it('recusa token incorreto sem revelar o segredo', async () => {
    const ctx = context('x'.repeat(32));
    await vendasImportAuth(ctx.request, ctx.reply);
    expect(ctx.status).toHaveBeenCalledWith(401);
    expect(ctx.send).toHaveBeenCalledWith(expect.objectContaining({ message: 'Token de importação inválido.' }));
    expect(JSON.stringify(ctx.send.mock.calls)).not.toContain('s'.repeat(32));
  });

  it('mantém a automação desabilitada quando o segredo não foi configurado', async () => {
    env.VENDAS_IMPORT_TOKEN = '';
    const ctx = context('x'.repeat(32));
    await vendasImportAuth(ctx.request, ctx.reply);
    expect(ctx.status).toHaveBeenCalledWith(503);
  });
});
