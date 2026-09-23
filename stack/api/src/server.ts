import { readFileSync } from 'node:fs';
import 'reflect-metadata';
import Fastify from 'fastify';
import { container } from 'tsyringe';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import fastifyCookie from '@fastify/cookie';
import fastifyJwt from '@fastify/jwt';
import fastifyMultipart from '@fastify/multipart';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import {
  serializerCompiler,
  validatorCompiler,
  jsonSchemaTransform,
} from 'fastify-type-provider-zod';
import { env } from '@/config/env';
import { segredosInsegurosEmProducao } from '@/config/segredos';
import { AppError } from '@/config/api.replies';
import { productRoutes } from '@/modules/product/product.routes';
import { authRoutes } from '@/modules/auth/auth.routes';
import { fileRoutes } from '@/modules/file/file.routes';
import { adminRoutes } from '@/modules/admin/admin.routes';
import { permissaoRoutes } from '@/modules/permissao/permissao.routes';
import { productSheetRoutes } from '@/modules/google-sheets/product-sheet.routes';
import { apoioRoutes } from '@/modules/apoio/apoio.routes';
import { creareRoutes } from '@/modules/creare/creare.routes';
import { unificacaoRoutes } from '@/modules/unificacao/unificacao.routes';
import { vendasRoutes } from '@/modules/vendas/vendas.routes';
import { reenvioRoutes } from '@/modules/google-sheets/reenvio.routes';
import { ReenvioSheetsService } from '@/modules/google-sheets/reenvio.service';

const app = Fastify({
  logger: env.NODE_ENV === 'dev',
});

// validação/serialização via Zod
app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);

// segurança
app.register(helmet);
app.register(cors, {
  origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(','),
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  credentials: true, // necessário para enviar/receber o cookie de autenticação
});

// autenticação (cookie + JWT) — cookie deve vir antes do jwt
app.register(fastifyCookie, { secret: env.COOKIE_SECRET });
app.register(fastifyJwt, {
  secret: env.JWT_SECRET,
  cookie: { cookieName: 'access_token', signed: false },
});

// upload de arquivos (multipart)
app.register(fastifyMultipart, { limits: { fileSize: 8 * 1024 * 1024 } });

// documentação (Swagger) — deve vir antes das rotas
app.register(fastifySwagger, {
  openapi: {
    info: {
      title: 'Pralis — API de Cadastro de Produtos',
      description: 'Mesmo stack seguro da Cicluz (Fastify + Drizzle + Zod).',
      version: '0.1.0',
    },
  },
  transform: jsonSchemaTransform,
});
app.register(fastifySwaggerUi, { routePrefix: '/docs' });

// rotas
app.register(authRoutes);
app.register(fileRoutes);
app.register(productRoutes);
app.register(adminRoutes);
app.register(permissaoRoutes);
app.register(productSheetRoutes);
app.register(apoioRoutes);
app.register(creareRoutes);
app.register(unificacaoRoutes);
app.register(vendasRoutes);
app.register(reenvioRoutes);

/**
 * Reenvio automático do que a planilha recusou.
 *
 * A fila (`product_sheet_sync`) já existia com status e tentativas, mas ninguém
 * a lia de volta: quando o Google falhava, a tela avisava "pendente" e a linha
 * ficava esperando alguém reabrir o produto. Agora o processo relê sozinho.
 *
 * Roda só em produção e só com a integração ligada — em desenvolvimento e nos
 * testes um temporizador de fundo batendo no Google seria ruído e cota gasta.
 *
 * `unref()` para o intervalo não segurar o processo vivo no encerramento.
 *
 * PRESSUPÕE UMA INSTÂNCIA. Com duas, as duas leriam a mesma fila; o serviço
 * tolera (a espera é calculada no banco), mas gastaria chamada à toa. Se um dia
 * houver réplica, isto vira job com trava.
 */
const MINUTOS_ENTRE_REENVIOS = 5;
if (env.NODE_ENV === 'production' && env.GOOGLE_SHEETS_ENABLED) {
  const relogio = setInterval(() => {
    container.resolve(ReenvioSheetsService)
      .reprocessar()
      .then((r) => {
        if (r.tentados > 0) {
          app.log.info(
            { reenvio: r },
            `Reenvio à planilha: ${r.sincronizados}/${r.tentados} ok, ${r.desistidos} desistido(s)`,
          );
        }
      })
      .catch((e) => app.log.error(e, 'Reenvio à planilha falhou'));
  }, MINUTOS_ENTRE_REENVIOS * 60 * 1000);
  relogio.unref();
}

/**
 * Quando a imagem foi construída, gravado pelo Dockerfile em `/app/BUILD_TIME`.
 *
 * É a resposta de recurso para "meu merge subiu?": o SHA depende de a
 * plataforma injetar `SOURCE_COMMIT`, e quando ela não injeta o `commit` volta
 * `null` — indistinguível de "a API nem sabe dizer". O carimbo do build não
 * depende de ninguém, então sempre separa deploy novo de deploy velho.
 *
 * Lido UMA vez: é constante durante a vida do processo, e ler arquivo a cada
 * health-check seria I/O à toa no caminho que o balanceador mais chama.
 */
const carimboDoBuild = (() => {
  let lido: string | null | undefined;
  return (): string | null => {
    if (lido === undefined) {
      try {
        lido = readFileSync('/app/BUILD_TIME', 'utf8').trim() || null;
      } catch {
        lido = null; // fora do contêiner (dev, teste) o arquivo não existe
      }
    }
    return lido;
  };
})();

/**
 * Liveness + qual versao esta no ar.
 *
 * Sem isto nao havia como saber QUAL commit responde em producao: a auditoria
 * teve de inferir pelo painel do Coolify. Nao consulta o banco de proposito —
 * um health que depende do Postgres nao distingue "processo morto" de "banco
 * fora", e e a diferenca que decide o que fazer.
 *
 * Nao expoe segredo nenhum: so o SHA, que e publico no repositorio.
 */
app.get('/health', async () => ({
  ok: true,
  commit: env.BUILD_COMMIT || null,
  buildTime: carimboDoBuild(),
  ambiente: env.NODE_ENV,
}));

/**
 * Readiness: da para ATENDER? Exige o banco de pe. E o que um balanceador
 * deve olhar antes de mandar trafego.
 */
app.get('/health/pronto', async (_request, reply) => {
  try {
    const { db } = await import('@/db/databases');
    const { sql } = await import('drizzle-orm');
    await db.execute(sql`SELECT 1`);
    return { ok: true, banco: 'ok' };
  } catch {
    // motivo fica no log; a resposta nao descreve a infraestrutura
    return reply.status(503).send({ ok: false, banco: 'indisponivel' });
  }
});

// tratamento de erros global
app.setErrorHandler((error: Error & { statusCode?: number; validation?: unknown }, _request, reply) => {
  if (error instanceof AppError) {
    return reply
      .status(error.statusCode)
      .send({ message: error.message, data: null, details: { code: error.code, data: error.details } });
  }
  // erros de validação do Zod chegam com statusCode 400
  const statusCode = error.statusCode ?? 500;
  if (statusCode >= 500) {
    app.log.error(error);
    /*
     * 5xx não devolve a mensagem interna. Ela costuma trazer nome de tabela,
     * trecho de SQL ou caminho de arquivo — informação de graça para quem
     * estiver sondando, e inútil para quem está usando o sistema.
     * O erro completo fica no log do servidor.
     */
    return reply.status(statusCode).send({
      message: 'Erro interno. A equipe foi notificada pelo log.',
      data: null,
      details: null,
    });
  }
  return reply.status(statusCode).send({
    message: error.message ?? 'Erro na requisição',
    data: null,
    details: error.validation ?? null,
  });
});

/*
 * Em produção, segredo padrão ou fraco IMPEDE o boot.
 *
 * Subir e funcionar com o segredo de desenvolvimento é o pior dos mundos:
 * parece que está tudo bem. Falhar aqui é ruidoso, e é para ser.
 */
if (env.NODE_ENV === 'production') {
  const inseguros = segredosInsegurosEmProducao(env);
  if (inseguros.length > 0) {
    app.log.fatal(
      `Boot recusado: ${inseguros.join(' e ')} com valor padrão, vazio ou curto demais. `
      + 'Defina segredos próprios de 32+ caracteres antes de subir.',
    );
    process.exit(1);
  }
}

app
  .listen({ port: env.PORT, host: '0.0.0.0' })
  .then(() => {
    app.log.info(`Pralis API em http://localhost:${env.PORT}  |  docs: http://localhost:${env.PORT}/docs`);
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
