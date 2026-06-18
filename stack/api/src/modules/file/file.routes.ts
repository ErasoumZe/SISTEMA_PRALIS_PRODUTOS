import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { FileController } from './file.controller';
import { authMiddleware } from '@/middlewares/auth-handler';

export async function fileRoutes(app: FastifyInstance) {
  const controller = container.resolve(FileController);
  app.addHook('onRequest', authMiddleware);

  app.post(
    '/files',
    {
      schema: {
        summary: 'Upload de imagem (multipart) — devolve { url }',
        consumes: ['multipart/form-data'],
        tags: ['FILES'],
      },
    },
    controller.upload.bind(controller),
  );
}
