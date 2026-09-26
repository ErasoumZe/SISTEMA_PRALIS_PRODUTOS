/**
 * De onde sai o código interno de um produto NOVO.
 *
 * A regra é simples de dizer e fácil de errar: o próximo código é o maior que
 * já existe **dentro da faixa de produto**, mais um.
 *
 * ### A faixa, e por que ela precisa de teto
 *
 * A carga de 25/09/2026 trouxe a numeração inteira do SIA, e ela não é
 * contínua: além dos produtos (até 13129), há uma faixa alta com entrega,
 * equipamento e embalagem — 712931, 713118, 719000. Sem teto, "o maior mais
 * um" sairia em **719001**, que não é numeração de produto nenhum e ainda
 * queimaria a faixa reservada.
 *
 * O teto é o mesmo `PRIMEIRO_CODIGO_DE_ENTREGA` que o resto do sistema usa
 * para distinguir produto de entrega. Código acima dele existe, é válido e
 * continua funcionando — só não conta para decidir qual é o próximo.
 */

/** Primeiro código da faixa alta. Daqui para cima não é produto de prateleira. */
export const PRIMEIRO_CODIGO_FORA_DA_FAIXA = 700_000;

/**
 * Último código de produto já cadastrado quando a faixa foi definida.
 *
 * Dado pelo José em 26/09/2026: *"o código interno do novo deve pegar a partir
 * do 13130, 13129 é o último novo cadastrado"*. Serve de piso: mesmo com a
 * Base vazia, a numeração nunca volta para trás e nunca reaproveita código que
 * o PDV já conhece — reaproveitar faria o TXT sobrescrever outro produto.
 */
export const ULTIMO_CODIGO_DE_PRODUTO = 13_129;

/**
 * O maior código que conta para a sequência.
 *
 * Ignora a faixa alta e qualquer coisa que não seja número. Devolve o piso
 * quando nada resta, que é o caso de uma Base recém-zerada.
 */
export const maiorCodigoDaFaixa = (codigos: readonly (string | number | null | undefined)[]): number => {
  let maior = ULTIMO_CODIGO_DE_PRODUTO;
  for (const bruto of codigos) {
    const n = Number(String(bruto ?? '').replace(/\D/g, ''));
    if (!Number.isInteger(n) || n <= 0) continue;
    if (n >= PRIMEIRO_CODIGO_FORA_DA_FAIXA) continue;
    if (n > maior) maior = n;
  }
  return maior;
};

/** Próximo código, a partir do maior já salvo DENTRO da faixa de produto. */
export const calcularProximoCodigoInterno = (maiorCodigoAtual: number): string =>
  String(Math.max(maiorCodigoAtual, ULTIMO_CODIGO_DE_PRODUTO) + 1).padStart(5, '0');
