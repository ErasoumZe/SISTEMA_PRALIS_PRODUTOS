import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CodigoCadastroController } from './codigo-cadastro.controller';
import type { CodigoCadastroService } from './codigo-cadastro.service';

/**
 * O portão de admin e o que a resposta CONTA.
 *
 * O código de cadastro vale para a rede inteira e chega ao PDV — gerente de
 * loja não decide isso. E a mensagem precisa distinguir "adotei tudo" de
 * "adotei parte e falta continuar": sem isso o operador para no meio achando
 * que terminou.
 */

const respostaDe = () => {
  const capturado: { corpo?: unknown } = {};
  const reply = {
    status() { return this; },
    send(corpo: unknown) { capturado.corpo = corpo; return corpo; },
  } as unknown as FastifyReply;
  return { reply, lido: () => capturado.corpo as { message: string; data: Record<string, unknown> } };
};

const pedido = (role: 'admin' | 'user' | null, body: unknown = {}): FastifyRequest<never> => ({
  currentUser: role ? { id: 'u-1', name: 'José', email: 'j@c.br', loja: null, role } : undefined,
  body,
}) as unknown as FastifyRequest<never>;

const servico = (over: Partial<CodigoCadastroService> = {}) => new CodigoCadastroController({
  async previa() {
    return {
      resumo: { 'ja-correto': 1, exato: 2, 'conflito-sia': 3, disputado: 1, novo: 4 },
      teto: 13439, tetoDe: 'de-para do SIA', paresSia: 10,
      planilha: { estado: 'sem-destino', teto: 0, linhas: 0 },
      itens: [], confirmacao: 'X', loteMaximo: 200,
    };
  },
  async adotarExatos() { return { aplicadas: 2, conflitos: 0, restantes: 0 }; },
  async decidir() { return { codigo: '13440', fonte: 'cunhado' }; },
  ...over,
} as unknown as CodigoCadastroService);

describe('CodigoCadastroController — portão de admin', () => {
  for (const rota of ['previa', 'adotarExatos', 'decidir'] as const) {
    it(`${rota} recusa quem não está autenticado`, async () => {
      const { reply } = respostaDe();
      await expect(servico()[rota](pedido(null) as never, reply)).rejects.toMatchObject({ statusCode: 401 });
    });

    it(`${rota} recusa usuário de loja`, async () => {
      const { reply } = respostaDe();
      await expect(servico()[rota](pedido('user') as never, reply)).rejects.toMatchObject({ statusCode: 403 });
    });
  }

  it('deixa o admin passar', async () => {
    const { reply, lido } = respostaDe();
    await servico().previa(pedido('admin'), reply);
    expect(lido().data.teto).toBe(13439);
  });
});

describe('CodigoCadastroController — o que a mensagem conta', () => {
  it('soma conflito e disputado como "para decidir"', async () => {
    const { reply, lido } = respostaDe();
    await servico().previa(pedido('admin'), reply);
    // 3 conflito-sia + 1 disputado
    expect(lido().message).toMatch(/2 pronto\(s\) para adotar, 4 para decidir, 4 sem par/);
  });

  it('avisa que faltou lote quando a adoção foi cortada', async () => {
    const { reply, lido } = respostaDe();
    const c = servico({ async adotarExatos() { return { aplicadas: 200, conflitos: 3, restantes: 47 }; } } as never);
    await c.adotarExatos(pedido('admin', { confirmacao: 'X' }) as never, reply);
    expect(lido().message).toMatch(/200 código\(s\) adotado\(s\)/);
    expect(lido().message).toMatch(/3 mudaram/);
    expect(lido().message).toMatch(/Faltam 47/);
  });

  it('não inventa aviso quando terminou limpo', async () => {
    const { reply, lido } = respostaDe();
    await servico().adotarExatos(pedido('admin', { confirmacao: 'X' }) as never, reply);
    expect(lido().message).not.toMatch(/Faltam|mudaram/);
  });
});
