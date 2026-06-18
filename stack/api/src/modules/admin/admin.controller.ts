import { FastifyReply, FastifyRequest } from 'fastify';
import { inject, injectable } from 'tsyringe';
import { AdminService } from './admin.service';
import { AdminRequests } from '@pralis/shared';
import { buildResponse, AppError } from '@/config/api.replies';
import type { CurrentUser } from '@/types/fastify-jwt';

/** Garante que o usuário autenticado é admin. */
function requireAdmin(request: FastifyRequest): CurrentUser {
  const user = request.currentUser;
  if (!user) throw new AppError('Não autenticado', 401, 'UNAUTHENTICATED');
  if (user.role !== 'admin') throw new AppError('Acesso restrito a administradores', 403, 'FORBIDDEN');
  return user;
}

@injectable()
export class AdminController {
  constructor(@inject(AdminService) private service: AdminService) {}

  async dashboard(request: FastifyRequest, reply: FastifyReply) {
    requireAdmin(request);
    const data = await this.service.getDashboard();
    return reply.status(200).send(buildResponse(data, 'Painel administrativo'));
  }

  async users(request: FastifyRequest, reply: FastifyReply) {
    requireAdmin(request);
    const data = await this.service.listUsers();
    return reply.status(200).send(buildResponse(data, 'Usuários'));
  }

  async updateRole(
    request: FastifyRequest<{ Params: AdminRequests.AdminUserIdParam; Body: AdminRequests.UpdateRoleRequest }>,
    reply: FastifyReply,
  ) {
    requireAdmin(request);
    await this.service.updateRole(request.params.id, request.body.role);
    return reply.status(200).send(buildResponse(null, 'Permissão atualizada'));
  }
}
