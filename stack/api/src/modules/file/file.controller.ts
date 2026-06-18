import { FastifyReply, FastifyRequest } from 'fastify';
import { inject, injectable } from 'tsyringe';
import { FileService } from './file.service';
import { buildResponse, AppError } from '@/config/api.replies';

@injectable()
export class FileController {
  constructor(@inject(FileService) private service: FileService) {}

  async upload(request: FastifyRequest, reply: FastifyReply) {
    const file = await request.file();
    if (!file) throw new AppError('Nenhum arquivo enviado.', 400, 'NO_FILE');
    if (!file.mimetype.startsWith('image/')) throw new AppError('Envie uma imagem.', 400, 'NOT_IMAGE');

    const buffer = await file.toBuffer();
    const url = await this.service.uploadImage(buffer);
    return reply.status(201).send(buildResponse({ url }, 'Upload concluído'));
  }
}
