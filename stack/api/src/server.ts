import 'reflect-metadata';
import Fastify from 'fastify';
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
import { AppError } from '@/config/api.replies';
import { productRoutes } from '@/modules/product/product.routes';
import { authRoutes } from '@/modules/auth/auth.routes';
import { fileRoutes } from '@/modules/file/file.routes';
import { adminRoutes } from '@/modules/admin/admin.routes';
import { productSheetRoutes } from '@/modules/google-sheets/product-sheet.routes';
import { apoioRoutes } from '@/modules/apoio/apoio.routes';
import { creareRoutes } from '@/modules/creare/creare.routes';
import { vendasRoutes } from '@/modules/vendas/vendas.routes';

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
app.register(productSheetRoutes);
app.register(apoioRoutes);
app.register(creareRoutes);
app.register(vendasRoutes);

app.get('/health', async () => ({ ok: true }));

// tratamento de erros global
app.setErrorHandler((error: Error & { statusCode?: number; validation?: unknown }, _request, reply) => {
  if (error instanceof AppError) {
    return reply
      .status(error.statusCode)
      .send({ message: error.message, data: null, details: { code: error.code, data: error.details } });
  }
  // erros de validação do Zod chegam com statusCode 400
  const statusCode = error.statusCode ?? 500;
  if (statusCode >= 500) app.log.error(error);
  return reply.status(statusCode).send({
    message: error.message ?? 'Erro interno',
    data: null,
    details: error.validation ?? null,
  });
});

app
  .listen({ port: env.PORT, host: '0.0.0.0' })
  .then(() => {
    app.log.info(`Pralis API em http://localhost:${env.PORT}  |  docs: http://localhost:${env.PORT}/docs`);
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
