import { injectable } from 'tsyringe';
import { Resend } from 'resend';
import { env } from '@/config/env';

@injectable()
export class EmailService {
  private readonly resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

  /** Envia o código de verificação. Sem Resend configurado (dev), apenas loga o código. */
  async sendVerificationCode(to: string, name: string, code: string): Promise<void> {
    if (!this.resend) {
      // eslint-disable-next-line no-console
      console.log(`\n[DEV] Código de verificação para ${to}: ${code}\n`);
      return;
    }
    await this.resend.emails.send({
      from: env.EMAIL_FROM,
      to,
      subject: 'Seu código de acesso — Cadastro de Produtos Pralis',
      html: `
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;color:#222">
          <h2>Olá, ${name}!</h2>
          <p>Use o código abaixo para confirmar seu e-mail e ativar sua conta:</p>
          <p style="font-size:32px;font-weight:bold;letter-spacing:8px;text-align:center;background:#f3f0fb;padding:16px;border-radius:8px">${code}</p>
          <p style="color:#777;font-size:13px">O código expira em 15 minutos. Se você não solicitou, ignore este e-mail.</p>
        </div>`,
    });
  }
}
