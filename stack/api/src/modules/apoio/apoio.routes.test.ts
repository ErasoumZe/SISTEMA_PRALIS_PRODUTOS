import 'reflect-metadata';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { container } from 'tsyringe';
import { TaxRuleService, type GroupTaxRule } from './tax-rule.service';
import { apoioRoutes } from './apoio.routes';

/*
 * A rota instala o `authMiddleware` real, que exige cookie e JWT. O que está
 * sob teste aqui é o CONTRATO DO CORPO, não a autenticação — que tem os
 * próprios testes. Dublar só a sessão mantém o teste focado no defeito.
 */
vi.mock('@/middlewares/auth-handler', () => ({
  authMiddleware: async (request: { currentUser?: unknown }) => {
    request.currentUser = {
      id: 'u-1', name: 'Jose', email: 'jose@cicluz.com.br', loja: null, role: 'admin',
    };
  },
}));

/**
 * Teste de CONTRATO: o que o serviço devolve tem de chegar no corpo HTTP.
 *
 * F01 da auditoria de 08/09/2026. O `TaxRuleService` entregava `margemPadrao`
 * e o `ProductForm` esperava esse atributo, mas o schema de resposta não o
 * declarava — e o serializador do Zod remove silenciosamente tudo que não está
 * no schema. A margem sumia entre o serviço e a tela, sem erro em lugar nenhum.
 *
 * Testar o serviço isolado nunca pegaria isso: o defeito mora exatamente na
 * costura. Por isso este arquivo sobe a rota de verdade e olha o JSON.
 */

const regra = (over: Partial<GroupTaxRule> = {}): GroupTaxRule => ({
  grupo: 'MER PADARIA',
  cstPisCofins: '01',
  tributacaoSimples: 'TRIBUTADO',
  aliquotaSimples: 7.4,
  icmsRe: 0,
  baseFiscal: 'Regra do grupo',
  margemPadrao: 0.3,
  ...over,
});

/** Sobe só a rota, com o serviço dublado e sem exigir sessão. */
async function servidor(regras: GroupTaxRule[]) {
  container.registerInstance(TaxRuleService, {
    async list() { return regras; },
  } as unknown as TaxRuleService);

  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorateRequest('currentUser', null);
  await app.register(async (instancia) => {
    await apoioRoutes(instancia.withTypeProvider<ZodTypeProvider>() as never);
  });
  await app.ready();
  return app;
}

let app: Awaited<ReturnType<typeof servidor>> | null = null;
afterEach(async () => { await app?.close(); app = null; container.clearInstances(); });
beforeEach(() => { container.clearInstances(); });

describe('GET /apoio/grupos-fiscais — a margem tem de chegar na resposta', () => {
  it('devolve margemPadrao no corpo, não só no serviço', async () => {
    app = await servidor([regra({ margemPadrao: 0.3 })]);

    const r = await app.inject({ method: 'GET', url: '/apoio/grupos-fiscais' });
    const [primeira] = (r.json() as { data: Array<Record<string, unknown>> }).data;

    expect(r.statusCode).toBe(200);
    expect(primeira).toHaveProperty('margemPadrao', 0.3);
  });

  /* Zero é decisão ("este grupo não tem margem"), não ausência de dado. */
  it('preserva margem ZERO, sem virar null nem sumir', async () => {
    app = await servidor([regra({ margemPadrao: 0 })]);

    const [primeira] = (app && (await app.inject({ method: 'GET', url: '/apoio/grupos-fiscais' }))
      .json() as { data: Array<Record<string, unknown>> }).data;

    expect(primeira).toHaveProperty('margemPadrao', 0);
    expect(primeira!.margemPadrao).not.toBeNull();
  });

  it('grupo sem margem chega como null, e não como ausente', async () => {
    app = await servidor([regra({ margemPadrao: null })]);

    const [primeira] = ((await app.inject({ method: 'GET', url: '/apoio/grupos-fiscais' }))
      .json() as { data: Array<Record<string, unknown>> }).data;

    expect(primeira).toHaveProperty('margemPadrao');
    expect(primeira!.margemPadrao).toBeNull();
  });

  /* Fração vira porcentagem na tela; 0.075 não pode chegar arredondado. */
  it('não arredonda a fração recebida', async () => {
    app = await servidor([regra({ margemPadrao: 0.075 })]);

    const [primeira] = ((await app.inject({ method: 'GET', url: '/apoio/grupos-fiscais' }))
      .json() as { data: Array<Record<string, unknown>> }).data;

    expect(primeira!.margemPadrao).toBe(0.075);
  });
});
