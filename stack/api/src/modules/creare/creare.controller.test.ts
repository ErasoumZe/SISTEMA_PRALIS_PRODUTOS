import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CreareController } from './creare.controller';
import type { CreareService } from './creare.service';

function response() {
  const headers: Record<string, string> = {};
  let status = 0;
  let body: unknown;
  const reply = {
    header(key: string, value: string) { headers[key] = value; return this; },
    status(value: number) { status = value; return this; },
    send(value?: unknown) { body = value; return this; },
  };
  return { reply: reply as unknown as FastifyReply, headers, get status() { return status; }, get body() { return body; } };
}

const request = (modo: 'completo' | 'pendentes') => ({
  query: { loja: 'TNP', modo },
  currentUser: { role: 'admin' },
}) as unknown as FastifyRequest<{ Querystring: { loja: 'TNP'; modo: 'completo' | 'pendentes' } }>;

describe('download incremental Criare', () => {
  it('responde 204 quando nao existe produto novo ou alterado', async () => {
    const pending = vi.fn().mockResolvedValue(null);
    const generate = vi.fn();
    const controller = new CreareController({ pending, generate } as unknown as CreareService);
    const result = response();
    await controller.export(request('pendentes'), result.reply);
    expect(result.status).toBe(204);
    expect(result.headers['Cache-Control']).toBe('no-store');
    expect(generate).not.toHaveBeenCalled();
  });

  it('identifica o lote e preserva o endpoint completo', async () => {
    const pending = vi.fn().mockResolvedValue({
      id: '019c1f58-472e-7000-8000-000000000001', sha256: 'a'.repeat(64),
      itens: [{ productId: 'p1', hash: 'b'.repeat(64) }], conteudo: `${'0'.repeat(363)}\n`,
    });
    const generate = vi.fn().mockResolvedValue(Buffer.from('completo'));
    const controller = new CreareController({ pending, generate } as unknown as CreareService);
    const incremental = response();
    await controller.export(request('pendentes'), incremental.reply);
    expect(incremental.status).toBe(200);
    expect(incremental.headers['X-Creare-Lote-Id']).toBe('019c1f58-472e-7000-8000-000000000001');
    expect(incremental.headers['X-Creare-Registros']).toBe('1');
    expect(generate).not.toHaveBeenCalled();

    const complete = response();
    await controller.export(request('completo'), complete.reply);
    expect(generate).toHaveBeenCalledWith('TNP', undefined);
    expect(complete.headers['X-Creare-Lote-Id']).toBeUndefined();
  });
});
