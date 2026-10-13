import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { env } from '@/config/env';
import { MetasController, TELA_METAS_GERENTES } from './metas.controller';
import type { MetasService } from './metas.service';

function resposta() {
  let status = 0;
  let body: unknown;
  const reply = {
    status(value: number) { status = value; return this; },
    send(value: unknown) { body = value; return this; },
  };
  return { reply: reply as unknown as FastifyReply, get status() { return status; }, get body() { return body; } };
}

const usuario = (role: 'admin' | 'user', telas: string[]) => ({
  id: 'u-1', name: 'Usuário', email: env.ADMIN_EMAIL, loja: role === 'admin' ? null : 'TNP', role, telas,
});

describe('MetasController — segurança e sigilo do placar', () => {
  it('consulta as metas sem solicitar valores em reais, inclusive para admin', async () => {
    const consultar = vi.fn().mockResolvedValue({ turnos: {} });
    const controller = new MetasController({ consultar } as unknown as MetasService);
    const saida = resposta();
    const request = {
      query: { loja: 'TNP' }, currentUser: usuario('admin', [TELA_METAS_GERENTES]),
    } as unknown as FastifyRequest<{ Querystring: { loja: 'TNP' } }>;

    await controller.consultar(request, saida.reply);

    expect(consultar).toHaveBeenCalledWith('TNP', { loja: 'TNP' }, false);
    expect(saida.status).toBe(200);
  });

  it('recusa congelamento para admin sem permissão de visualizar o relatório', async () => {
    const importarPlanilhaTnp = vi.fn();
    const controller = new MetasController({ importarPlanilhaTnp } as unknown as MetasService);
    const request = {
      body: { vigenciaInicio: '2026-08-01', aplicar: true }, currentUser: usuario('admin', []),
    } as unknown as FastifyRequest;

    await expect(controller.importarPlanilhaTnp(request as never, resposta().reply))
      .rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
    expect(importarPlanilhaTnp).not.toHaveBeenCalled();
  });

  it('recusa congelamento para usuário comum mesmo com acesso ao relatório', async () => {
    const importarPlanilhaTnp = vi.fn();
    const controller = new MetasController({ importarPlanilhaTnp } as unknown as MetasService);
    const request = {
      body: { vigenciaInicio: '2026-08-01', aplicar: true },
      currentUser: usuario('user', [TELA_METAS_GERENTES]),
    } as unknown as FastifyRequest;

    await expect(controller.importarPlanilhaTnp(request as never, resposta().reply))
      .rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
    expect(importarPlanilhaTnp).not.toHaveBeenCalled();
  });
});
