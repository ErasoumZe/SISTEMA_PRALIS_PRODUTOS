import { inject, injectable } from 'tsyringe';
import argon2 from 'argon2';
import { AuthRepository } from './auth.repository';
import { AppError } from '@/config/api.replies';

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
}

@injectable()
export class AuthService {
  constructor(@inject(AuthRepository) private repo: AuthRepository) {}

  async register(data: { name: string; email: string; password: string }): Promise<PublicUser> {
    const exists = await this.repo.findByEmail(data.email);
    if (exists) throw new AppError('E-mail já cadastrado', 409, 'EMAIL_IN_USE');
    const passwordHash = await argon2.hash(data.password);
    const user = await this.repo.createUser({ name: data.name, email: data.email, passwordHash });
    return this.publicUser(user);
  }

  async login(email: string, password: string): Promise<{ user: PublicUser; sessionId: string }> {
    const user = await this.repo.findByEmail(email);
    if (!user || !user.isActive) throw new AppError('Credenciais inválidas', 401, 'INVALID_CREDENTIALS');
    const ok = await argon2.verify(user.passwordHash, password);
    if (!ok) throw new AppError('Credenciais inválidas', 401, 'INVALID_CREDENTIALS');
    const session = await this.repo.createSession(user.id);
    return { user: this.publicUser(user), sessionId: session.id };
  }

  async logout(sessionId: string): Promise<void> {
    await this.repo.deleteSession(sessionId);
  }

  async me(userId: string): Promise<PublicUser> {
    const user = await this.repo.findById(userId);
    if (!user) throw new AppError('Usuário não encontrado', 404, 'USER_NOT_FOUND');
    return this.publicUser(user);
  }

  private publicUser(u: { id: string; name: string; email: string; isActive: boolean }): PublicUser {
    return { id: u.id, name: u.name, email: u.email, isActive: u.isActive };
  }
}
