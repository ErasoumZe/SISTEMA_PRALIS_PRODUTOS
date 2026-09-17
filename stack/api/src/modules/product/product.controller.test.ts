import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ProductController } from './product.controller';
import type { ProductService } from './product.service';

/**
 * F04 da auditoria de 08/09/2026: a falha do espelho de loja ficava invisível.
 *
 * O `update` calculava `espelhoLoja`, mas o controller não o colocava em
 * `details` — o campo caía dentro do produto e o schema de resposta o
 * descartava. A tela dizia "atualizado com sucesso" com a aba da loja parada,
 * e ninguém ficava sabendo.
 *
 * O que está sob teste é o que o controller ENTREGA, não o que o serviço
 * calcula: o defeito estava exatamente entre os dois.
 */

const respostaDe = () => {
  let capturado: { corpo?: unknown } = {};
  const reply = {
    status() { return this; },
    send(corpo: unknown) { capturado.corpo = corpo; return corpo; },
  } as unknown as FastifyReply;
  return { reply, lido: () => capturado.corpo as { message: string; details: Record<string, unknown> } };
};

const pedido = (): FastifyRequest<never> => ({
  currentUser: { id: 'u-1', name: 'Jose', email: 'j@c.com', loja: 'TNP', role: 'admin' },
  params: { id: '0197d7c4-2c9a-7000-8000-000000000001' },
  body: { nome: 'ARROZ' },
}) as unknown as FastifyRequest<never>;

const controller = (resultado: Record<string, unknown>) => new ProductController({
  async update() { return resultado; },
} as unknown as ProductService);

describe('PUT /products/:id — o resultado do espelho de loja não pode sumir', () => {
  it('leva espelhoLoja para details', async () => {
    const { reply, lido } = respostaDe();
    const c = controller({
      id: 'p-1', nome: 'ARROZ', loja: 'TNP',
      sheetSync: 'skipped', lojasAtualizadas: 0, espelhoLoja: 'espelhado', creareDrive: {},
    });

    await c.update(pedido() as never, reply);

    expect(lido().details).toMatchObject({ espelhoLoja: 'espelhado' });
  });

  /* O caso que motivou tudo: gravou no banco, a aba da loja NÃO recebeu. */
  it('falha do espelho aparece na mensagem, sem virar erro de cadastro', async () => {
    const { reply, lido } = respostaDe();
    const c = controller({
      id: 'p-1', nome: 'ARROZ', loja: 'TNP',
      sheetSync: 'skipped', lojasAtualizadas: 0, espelhoLoja: 'falhou', creareDrive: {},
    });

    await c.update(pedido() as never, reply);

    expect(lido().details).toMatchObject({ espelhoLoja: 'falhou' });
    expect(lido().message).toMatch(/aba da loja/i);
    // a edição valeu: não pode parecer que o produto não foi salvo
    expect(lido().message).toMatch(/atualizado/i);
  });

  it('espelho desligado não vira aviso de falha', async () => {
    const { reply, lido } = respostaDe();
    const c = controller({
      id: 'p-1', nome: 'ARROZ', loja: 'TNP',
      sheetSync: 'skipped', lojasAtualizadas: 0, espelhoLoja: 'desligado', creareDrive: {},
    });

    await c.update(pedido() as never, reply);

    expect(lido().message).not.toMatch(/pendente|aba da loja/i);
  });

  it('produto da BASE não fala em aba de loja', async () => {
    const { reply, lido } = respostaDe();
    const c = controller({
      id: 'p-1', nome: 'ARROZ', loja: 'BASE',
      sheetSync: 'synced', lojasAtualizadas: 2, espelhoLoja: 'sem-aba', creareDrive: {},
    });

    await c.update(pedido() as never, reply);

    expect(lido().message).not.toMatch(/aba da loja/i);
    expect(lido().message).toMatch(/planilha/i);
  });
});
