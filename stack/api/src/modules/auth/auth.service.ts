import { randomInt } from 'node:crypto';
import { inject, injectable } from 'tsyringe';
import argon2 from 'argon2';
import { AuthRepository } from './auth.repository';
import { EmailService } from '@/modules/email/email.service';
import { AppError } from '@/config/api.replies';
import { env } from '@/config/env';

/**
 * Código de 6 dígitos para verificação e recuperação de senha.
 *
 * `Math.random` não serve: é previsível a partir de saídas observadas, e este
 * código vale como prova de identidade para trocar uma senha.
 * `randomInt` usa o gerador do sistema operacional e é uniforme na faixa.
 */
const genCode = () => String(randomInt(100000, 1000000));
const CODE_TTL_MIN = 15;

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  loja: 'TNP' | 'LI' | 'HORA' | null; // null para admin
  role: 'admin' | 'user';
  isActive: boolean;
}

@injectable()
export class AuthService {
  constructor(
    @inject(AuthRepository) private repo: AuthRepository,
    @inject(EmailService) private email: EmailService,
  ) {}

  /** Cria a conta como NÃO verificada e envia o código por e-mail. Não loga ainda. */
  async register(data: { name: string; email: string; password: string; loja?: 'TNP' | 'LI' | 'HORA' }): Promise<{ email: string }> {
    const exists = await this.repo.findByEmail(data.email);
    if (exists) throw new AppError('E-mail já cadastrado', 409, 'EMAIL_IN_USE');

    const role = data.email.trim().toLowerCase() === env.ADMIN_EMAIL ? 'admin' : 'user';
    // admin não tem loja (casa = BASE); conta comum precisa escolher a loja
    const loja = role === 'admin' ? null : data.loja ?? null;
    if (role !== 'admin' && !loja) throw new AppError('Selecione a sua loja', 400, 'LOJA_REQUIRED');

    const passwordHash = await argon2.hash(data.password);
    const code = genCode();
    const expires = new Date(Date.now() + CODE_TTL_MIN * 60_000);

    const user = await this.repo.createUser({
      name: data.name, email: data.email, passwordHash, loja, role,
      verificationCode: code, verificationExpiresAt: expires,
    });
    await this.email.sendVerificationCode(user.email, user.name, code);
    return { email: user.email };
  }

  /** Confirma o código → ativa a conta e já cria a sessão (login). */
  async verifyEmail(email: string, code: string): Promise<{ user: PublicUser; sessionId: string }> {
    const user = await this.repo.findByEmail(email);
    if (!user) throw new AppError('Conta não encontrada', 404, 'USER_NOT_FOUND');
    if (user.emailVerified) throw new AppError('E-mail já confirmado. Faça login.', 400, 'ALREADY_VERIFIED');
    if (!user.verificationCode || user.verificationCode !== code) throw new AppError('Código inválido.', 400, 'INVALID_CODE');
    if (!user.verificationExpiresAt || user.verificationExpiresAt.getTime() < Date.now()) {
      throw new AppError('Código expirado. Reenvie um novo.', 400, 'CODE_EXPIRED');
    }
    await this.repo.setVerified(user.id);
    const session = await this.repo.createSession(user.id);
    return { user: this.publicUser(user), sessionId: session.id };
  }

  /** Reenvia um novo código (não revela se a conta existe). */
  async resendCode(email: string): Promise<void> {
    const user = await this.repo.findByEmail(email);
    if (!user || user.emailVerified) return;
    const code = genCode();
    const expires = new Date(Date.now() + CODE_TTL_MIN * 60_000);
    await this.repo.updateVerificationCode(user.id, code, expires);
    await this.email.sendVerificationCode(user.email, user.name, code);
  }

  /** Inicia a recuperação: gera código e envia por e-mail (não revela se a conta existe). */
  async forgotPassword(email: string): Promise<void> {
    const user = await this.repo.findByEmail(email);
    if (!user || !user.isActive) return;
    const code = genCode();
    const expires = new Date(Date.now() + CODE_TTL_MIN * 60_000);
    await this.repo.setResetCode(user.id, code, expires);
    await this.email.sendPasswordReset(user.email, user.name, code);
  }

  /** Conclui a recuperação: valida o código e define a nova senha. */
  async resetPassword(email: string, code: string, password: string): Promise<void> {
    const user = await this.repo.findByEmail(email);
    if (!user) throw new AppError('Conta não encontrada', 404, 'USER_NOT_FOUND');
    if (!user.resetCode || user.resetCode !== code) throw new AppError('Código inválido.', 400, 'INVALID_CODE');
    if (!user.resetExpiresAt || user.resetExpiresAt.getTime() < Date.now()) {
      throw new AppError('Código expirado. Solicite um novo.', 400, 'CODE_EXPIRED');
    }
    const passwordHash = await argon2.hash(password);
    await this.repo.resetPassword(user.id, passwordHash);
  }

  async login(email: string, password: string): Promise<{ user: PublicUser; sessionId: string }> {
    const user = await this.repo.findByEmail(email);
    if (!user || !user.isActive) throw new AppError('Credenciais inválidas', 401, 'INVALID_CREDENTIALS');
    const ok = await argon2.verify(user.passwordHash, password);
    if (!ok) throw new AppError('Credenciais inválidas', 401, 'INVALID_CREDENTIALS');
    if (!user.emailVerified) throw new AppError('Confirme seu e-mail para entrar.', 403, 'EMAIL_NOT_VERIFIED');
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

  private publicUser(u: { id: string; name: string; email: string; loja: string | null; role: string; isActive: boolean }): PublicUser {
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      loja: u.loja as PublicUser['loja'],
      role: u.role as PublicUser['role'],
      isActive: u.isActive,
    };
  }
}
