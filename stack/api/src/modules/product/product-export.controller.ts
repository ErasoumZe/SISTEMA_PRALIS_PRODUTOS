import { inject, injectable } from 'tsyringe';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '@/config/api.replies';
import { ProductExportService } from './product-export.service';

@injectable()
export class ProductExportController {
  constructor(@inject(ProductExportService) private service: ProductExportService) {}

  /**
   * Exportação da base inteira, todas as lojas. Só administrador: o arquivo
   * traz custo e margem de todos os catálogos de uma vez — mesmo critério do
   * `GET /admin/creare/health`.
   */
  async exportar(request: FastifyRequest, reply: FastifyReply) {
    const user = request.currentUser;
    if (!user) throw new AppError('Não autenticado', 401, 'UNAUTHENTICATED');
    if (user.role !== 'admin') throw new AppError('Acesso restrito a administradores.', 403, 'FORBIDDEN');

    const csv = await this.service.gerarCsv();
    const data = new Date().toISOString().slice(0, 10).replaceAll('-', '');

    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="produtos-${data}.csv"`)
      .header('cache-control', 'no-store')
      .status(200)
      .send(csv);
  }
}
