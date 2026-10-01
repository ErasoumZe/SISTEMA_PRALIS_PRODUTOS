import { AppError } from '@/config/api.replies';
import type { CurrentUser } from '@/types/fastify-jwt';

type LojaGerentes = 'TNP' | 'LI';
const AMBAS: LojaGerentes[] = ['TNP', 'LI'];
const emailIgual = (a: string, b: string) => !!b.trim() && a.trim().toLowerCase() === b.trim().toLowerCase();

/** Duas contas nomeadas podem consultar ambas. Os demais usam a loja da sessão. */
export function lojasGerentes(user: CurrentUser | undefined, donoEmail: string, programadorEmail: string): LojaGerentes[] {
  if (!user) return [];
  if (user.role === 'admin' && (emailIgual(user.email, donoEmail) || emailIgual(user.email, programadorEmail))) return AMBAS;
  return user.loja === 'TNP' || user.loja === 'LI' ? [user.loja] : [];
}

export function lojaGerentes(
  user: CurrentUser | undefined, solicitada: LojaGerentes | undefined, donoEmail: string, programadorEmail: string,
): LojaGerentes {
  if (!user) throw new AppError('Não autenticado.', 401, 'UNAUTHENTICATED');
  const permitidas = lojasGerentes(user, donoEmail, programadorEmail);
  if (!permitidas.length) throw new AppError('Conta sem loja autorizada para este relatório.', 403, 'STORE_FORBIDDEN');
  if (solicitada && !permitidas.includes(solicitada)) throw new AppError('Você só pode consultar sua loja.', 403, 'FORBIDDEN');
  if (permitidas.length > 1 && !solicitada) throw new AppError('Selecione a loja.', 400, 'STORE_REQUIRED');
  return solicitada ?? permitidas[0]!;
}
