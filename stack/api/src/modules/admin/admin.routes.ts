import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { container } from 'tsyringe';
import { z } from 'zod/v4';
import { AdminController } from './admin.controller';
import { AdminRequests, AdminSchemas } from '@pralis/shared';
import { apiResponseSchema } from '@/config/api.replies';
import { authMiddleware } from '@/middlewares/auth-handler';

export async function adminRoutes(app: FastifyInstance) {
  const controller = container.resolve(AdminController);
  const a = app.withTypeProvider<ZodTypeProvider>();

  // todas as rotas exigem autenticação (e o controller exige role admin)
  app.addHook('onRequest', authMiddleware);

  const dashboardReply = apiResponseSchema(AdminSchemas.dashboardSchema);
  const usersReply = apiResponseSchema(z.array(AdminSchemas.adminUserSchema));
  const okReply = apiResponseSchema(z.any());

  a.get(
    '/admin/dashboard',
    { schema: { response: { 200: dashboardReply }, summary: 'Métricas do painel', tags: ['ADMIN'] } },
    controller.dashboard.bind(controller),
  );

  a.get(
    '/admin/users',
    { schema: { response: { 200: usersReply }, summary: 'Listar usuários', tags: ['ADMIN'] } },
    controller.users.bind(controller),
  );

  a.patch<{ Params: AdminRequests.AdminUserIdParam; Body: AdminRequests.UpdateRoleRequest }>(
    '/admin/users/:id/role',
    {
      schema: {
        params: AdminRequests.adminUserIdParamSchema,
        body: AdminRequests.updateRoleSchema,
        response: { 200: okReply },
        summary: 'Promover/rebaixar usuário',
        tags: ['ADMIN'],
      },
    },
    controller.updateRole.bind(controller),
  );

  a.delete<{ Params: AdminRequests.AdminUserIdParam }>(
    '/admin/users/:id',
    {
      schema: {
        params: AdminRequests.adminUserIdParamSchema,
        response: { 200: okReply },
        summary: 'Excluir usuário',
        tags: ['ADMIN'],
      },
    },
    controller.deleteUser.bind(controller),
  );
}
