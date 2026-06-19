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
      subject: 'Seu código de acesso — Pralis',
      html: EmailService.codeEmail({
        name,
        code,
        intro: 'Use o código abaixo para confirmar seu e-mail e ativar sua conta:',
        nota: 'É só voltar à tela de confirmação e digitá-lo.',
      }),
    });
  }

  /** Envia o código de recuperação de senha. Sem Resend (dev), apenas loga. */
  async sendPasswordReset(to: string, name: string, code: string): Promise<void> {
    if (!this.resend) {
      // eslint-disable-next-line no-console
      console.log(`\n[DEV] Código de recuperação de senha para ${to}: ${code}\n`);
      return;
    }
    await this.resend.emails.send({
      from: env.EMAIL_FROM,
      to,
      subject: 'Recuperação de senha — Pralis',
      html: EmailService.codeEmail({
        name,
        code,
        intro: 'Recebemos um pedido para redefinir a sua senha. Use o código abaixo:',
        nota: 'É só voltar à tela de recuperação e digitá-lo para criar uma nova senha.',
      }),
    });
  }

  /** Template HTML (identidade Pralis) de e-mail com código em destaque. */
  static codeEmail({ name, code, intro, nota }: { name: string; code: string; intro: string; nota: string }): string {
    const appUrl =
      env.CORS_ORIGIN && env.CORS_ORIGIN !== '*'
        ? env.CORS_ORIGIN.replace(/\/$/, '')
        : 'https://produtos.cicluzieai.com.br';
    const logo = `${appUrl}/brand/simbolo.png`;
    const safeName = String(name).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c] ?? c);
    const font = "'Montserrat','Helvetica Neue',Arial,sans-serif";
    return `<!DOCTYPE html>
<html lang="pt-BR"><body style="margin:0;padding:0;background:#f5f5f7;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f7;padding:32px 12px;font-family:${font};">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(29,29,31,0.06);">
        <tr><td align="center" style="padding:36px 32px 4px;">
          <img src="${logo}" width="72" height="72" alt="Pralis" style="display:block;border-radius:18px;" />
          <div style="margin-top:12px;font-size:11px;letter-spacing:1.5px;color:#9a9a9f;font-weight:600;">CADASTRO DE PRODUTOS</div>
        </td></tr>
        <tr><td style="padding:8px 36px 0;">
          <h1 style="margin:16px 0 6px;font-size:22px;color:#1d1d1f;font-weight:700;">Olá, ${safeName}!</h1>
          <p style="margin:0;font-size:15px;line-height:1.6;color:#5c5c61;">${intro}</p>
        </td></tr>
        <tr><td style="padding:22px 36px;">
          <div style="background:#f4ecdd;border-radius:14px;padding:22px;text-align:center;">
            <span style="font-size:40px;font-weight:800;letter-spacing:12px;color:#5c3a34;">${code}</span>
          </div>
        </td></tr>
        <tr><td style="padding:0 36px;">
          <p style="margin:0;font-size:13px;line-height:1.6;color:#8a8a8f;">O código expira em <strong style="color:#ee7a1e;">15 minutos</strong>. ${nota}</p>
        </td></tr>
        <tr><td style="padding:24px 36px 32px;">
          <hr style="border:none;border-top:1px solid #ececee;margin:0 0 16px;" />
          <p style="margin:0;font-size:12px;line-height:1.6;color:#a0a0a5;">Se você não solicitou, pode ignorar este e-mail com segurança.</p>
          <p style="margin:10px 0 0;font-size:12px;color:#a0a0a5;">— Equipe <strong style="color:#5c3a34;">Pralis</strong> · Cicluz</p>
        </td></tr>
      </table>
      <div style="margin-top:16px;font-size:11px;color:#b0b0b5;font-family:${font};">Padaria Pralis — Cicluz</div>
    </td></tr>
  </table>
</body></html>`;
  }
}
