import { FastifyReply, FastifyRequest } from 'fastify';
import { inject, injectable } from 'tsyringe';
import { AdminService } from './admin.service';
import { AdminRequests } from '@pralis/shared';
import { buildResponse } from '@/config/api.replies';
import { exigirTela } from '@/modules/permissao/exigir-tela';
import type { CurrentUser } from '@/types/fastify-jwt';

/**
 * Este controller serve DUAS telas — o painel e a gestão de usuários —, e elas
 * são liberadas separadamente. Por isso a guarda recebe qual é, em vez de
 * perguntar "é admin?" uma vez só para as duas.
 */
const exigirAcesso = (request: FastifyRequest, tela: string): CurrentUser =>
  exigirTela(request.currentUser, tela);

@injectable()
export class AdminController {
  constructor(@inject(AdminService) private service: AdminService) {}

  async dashboard(request: FastifyRequest, reply: FastifyReply) {
    exigirAcesso(request, 'dashboard');
    const data = await this.service.getDashboard();
    return reply.status(200).send(buildResponse(data, 'Painel administrativo'));
  }

  async users(request: FastifyRequest, reply: FastifyReply) {
    exigirAcesso(request, 'usuarios');
    const data = await this.service.listUsers();
    return reply.status(200).send(buildResponse(data, 'Usuários'));
  }

  async updateRole(
    request: FastifyRequest<{ Params: AdminRequests.AdminUserIdParam; Body: AdminRequests.UpdateRoleRequest }>,
    reply: FastifyReply,
  ) {
    exigirAcesso(request, 'usuarios');
    await this.service.updateRole(request.params.id, request.body.role);
    return reply.status(200).send(buildResponse(null, 'Permissão atualizada'));
  }

  async deleteUser(request: FastifyRequest<{ Params: AdminRequests.AdminUserIdParam }>, reply: FastifyReply) {
    const admin = exigirAcesso(request, 'usuarios');
    await this.service.deleteUser(admin.id, request.params.id);
    return reply.status(200).send(buildResponse(null, 'Usuário excluído'));
  }
}
