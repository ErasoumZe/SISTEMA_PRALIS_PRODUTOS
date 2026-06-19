import { inject, injectable } from 'tsyringe';
import { AdminRepository } from './admin.repository';
import { AppError } from '@/config/api.replies';
import { env } from '@/config/env';
import { AdminSchemas } from '@pralis/shared';

@injectable()
export class AdminService {
  constructor(@inject(AdminRepository) private repo: AdminRepository) {}

  getDashboard(): Promise<AdminSchemas.Dashboard> {
    return this.repo.getDashboard();
  }

  listUsers(): Promise<AdminSchemas.AdminUser[]> {
    return this.repo.listUsers();
  }

  /** Promove/rebaixa um usuário. O admin-raiz (ADMIN_EMAIL) não pode ser rebaixado. */
  async updateRole(id: string, role: 'admin' | 'user'): Promise<void> {
    const user = await this.repo.findUser(id);
    if (!user) throw new AppError('Usuário não encontrado', 404, 'USER_NOT_FOUND');
    if (user.email.trim().toLowerCase() === env.ADMIN_EMAIL && role !== 'admin') {
      throw new AppError('Este administrador não pode ser rebaixado.', 400, 'CANNOT_DEMOTE_ROOT');
    }
    await this.repo.updateRole(id, role);
  }

  /** Exclui um usuário. Não permite excluir a si mesmo nem o admin-raiz (ADMIN_EMAIL). */
  async deleteUser(actorId: string, id: string): Promise<void> {
    const user = await this.repo.findUser(id);
    if (!user) throw new AppError('Usuário não encontrado', 404, 'USER_NOT_FOUND');
    if (id === actorId) throw new AppError('Você não pode excluir a própria conta.', 400, 'CANNOT_DELETE_SELF');
    if (user.email.trim().toLowerCase() === env.ADMIN_EMAIL) {
      throw new AppError('O administrador principal não pode ser excluído.', 400, 'CANNOT_DELETE_ROOT');
    }
    await this.repo.deleteUser(id);
  }
}
