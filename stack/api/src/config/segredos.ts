/**
 * Segredos que não podem entrar em produção com o valor de desenvolvimento.
 *
 * Os padrões estão no repositório: quem os conhece assina um token válido e
 * entra como qualquer pessoa. Em desenvolvimento eles são conveniência; em
 * produção são uma porta aberta. O boot passa a recusar explicitamente, em vez
 * de subir e parecer que está tudo bem.
 *
 * Auditoria de 08/09/2026, P1. Ela registrou que **não foi comprovado** que
 * produção esteja usando o padrão — o que se fecha aqui é a possibilidade.
 */

/** Os valores padrão, num lugar só, para o `env.ts` e a checagem não divergirem. */
export const SEGREDOS_DE_DESENVOLVIMENTO = {
  JWT_SECRET: 'dev-jwt-secret-troque-em-producao',
  COOKIE_SECRET: 'dev-cookie-secret-troque-em-producao',
} as const;

/**
 * 32 caracteres é o piso para um segredo gerado ao acaso ter entropia que
 * valha a pena. Não é uma medida de força — é um filtro contra `123`, `troca`
 * e o nome da empresa.
 */
const TAMANHO_MINIMO = 32;

export type NomeDeSegredo = keyof typeof SEGREDOS_DE_DESENVOLVIMENTO;

/**
 * Quais segredos estão inseguros. Devolve **nomes**, nunca valores: o retorno
 * vai para o log do boot.
 */
export function segredosInsegurosEmProducao(
  cfg: Record<NomeDeSegredo, string | undefined>,
): NomeDeSegredo[] {
  return (Object.keys(SEGREDOS_DE_DESENVOLVIMENTO) as NomeDeSegredo[]).filter((nome) => {
    const valor = (cfg[nome] ?? '').trim();
    if (valor === '') return true;
    if (valor === SEGREDOS_DE_DESENVOLVIMENTO[nome]) return true;
    return valor.length < TAMANHO_MINIMO;
  });
}
