import { Telas } from '@pralis/shared';

/**
 * As regras de quem enxerga o quê — puras, sem banco e sem HTTP.
 *
 * A hierarquia que o José definiu em 23/09/2026:
 *
 *   admin-raiz (ADMIN_EMAIL)  vê TUDO, sempre, e ninguém mexe nisso
 *   admin                     vê tudo por padrão; o admin-raiz decide o que tirar
 *   usuário                   vê tudo por padrão; admin-raiz e admins decidem
 *
 * "Por padrão vê tudo" é decisão dele, não descuido: o sistema entrou em
 * produção com todo mundo enxergando tudo, e trancar de uma vez deixaria gente
 * sem conseguir trabalhar no meio do expediente. A permissão nasce permissiva e
 * fecha por decisão, não o contrário.
 */

export type Papel = 'admin' | 'user';

export interface PessoaPermissao {
  id: string;
  email: string;
  role: Papel;
}

/** Uma negativa gravada: a ausência de linha significa liberado. */
export interface RegraGravada {
  telaId: string;
  permitido: boolean;
}

const normalizar = (email: string) => email.trim().toLowerCase();

export const ehAdminRaiz = (email: string, adminRaizEmail: string): boolean =>
  !!email && normalizar(email) === normalizar(adminRaizEmail);

/**
 * As telas que uma pessoa enxerga.
 *
 * O admin-raiz ignora as regras gravadas de propósito: se uma linha pudesse
 * desligar uma tela dele, um erro de clique trancaria a única conta capaz de
 * destrancar o sistema.
 */
export const telasDe = (
  pessoa: PessoaPermissao,
  regras: RegraGravada[],
  adminRaizEmail: string,
): string[] => {
  if (ehAdminRaiz(pessoa.email, adminRaizEmail)) return [...Telas.TODAS_AS_TELAS];

  const negadas = new Set(
    regras.filter((r) => !r.permitido).map((r) => r.telaId),
  );
  return Telas.TODAS_AS_TELAS.filter(
    (id) => Telas.TELAS_SEMPRE_LIBERADAS.includes(id) || !negadas.has(id),
  );
};

export const podeVer = (
  pessoa: PessoaPermissao,
  telaId: string,
  regras: RegraGravada[],
  adminRaizEmail: string,
): boolean => telasDe(pessoa, regras, adminRaizEmail).includes(telaId);

export type RecusaDeGestao =
  | 'sem-permissao'
  | 'admin-raiz-intocavel'
  | 'nao-mexe-em-admin'
  | 'nao-mexe-em-si';

/**
 * Quem pode mexer na permissão de quem.
 *
 * Três recusas, e cada uma fecha um caminho de escalada:
 *
 * - **admin-raiz intocável**: ninguém desliga tela dele, nem ele mesmo;
 * - **admin não mexe em admin**: senão dois admins se destrancam em par, e o
 *   "o Rodrigo decide os admins" vira letra morta;
 * - **ninguém mexe em si mesmo** (fora o raiz, que não precisa): quem pudesse
 *   se auto-liberar tornaria a tela de permissões decorativa.
 */
export const podeGerenciar = (
  ator: PessoaPermissao,
  alvo: PessoaPermissao,
  adminRaizEmail: string,
): { pode: true } | { pode: false; motivo: RecusaDeGestao } => {
  if (ehAdminRaiz(alvo.email, adminRaizEmail)) {
    return { pode: false, motivo: 'admin-raiz-intocavel' };
  }
  if (ehAdminRaiz(ator.email, adminRaizEmail)) return { pode: true };

  if (ator.id === alvo.id) return { pode: false, motivo: 'nao-mexe-em-si' };
  if (ator.role !== 'admin') return { pode: false, motivo: 'sem-permissao' };
  if (alvo.role === 'admin') return { pode: false, motivo: 'nao-mexe-em-admin' };
  return { pode: true };
};

export const MOTIVO_EM_PORTUGUES: Record<RecusaDeGestao, string> = {
  'sem-permissao': 'Você não pode alterar permissões.',
  'admin-raiz-intocavel': 'O administrador principal enxerga todas as telas e isso não pode ser alterado.',
  'nao-mexe-em-admin': 'Só o administrador principal altera as permissões de um administrador.',
  'nao-mexe-em-si': 'Você não pode alterar as suas próprias permissões.',
};
