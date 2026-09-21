import { inject, injectable } from 'tsyringe';
import { AppError } from '@/config/api.replies';
import type { CurrentUser } from '@/types/fastify-jwt';
import { CodigoCadastroPlanilhaService } from './codigo-cadastro.planilha';
import { CodigoCadastroRepository, type CodigoCadastroRepo } from './codigo-cadastro.repository';
import {
  formatarCodigoCadastro,
  reconciliarCodigoCadastro,
  type BaldeCodigo,
  type PropostaCodigo,
} from './codigo-cadastro.motor';

/**
 * Frase que libera a gravação. Trocar código mexe em etiqueta impressa, na
 * coluna AC da planilha oficial e no que o PDV recebe — um clique sem atrito
 * seria um clique sem decisão.
 */
export const CONFIRMACAO_CODIGO_CADASTRO = 'RECONCILIAR CODIGO DE CADASTRO';

/**
 * Teto de trocas por chamada.
 *
 * Adotar ~750 códigos numa requisição só levaria dezenas de segundos; se o
 * navegador desistir no meio, o servidor continua gravando e ninguém sabe onde
 * parou. A tela repete em lotes e mostra o que falta.
 */
export const LOTE_MAXIMO = 200;

export interface ItemPrevia {
  productId: string;
  loja: string;
  nome: string;
  codigoBarras: string | null;
  codigoAtual: string | null;
  balde: BaldeCodigo;
  codigoProposto: string | null;
  motivo: string;
  candidatos: Array<{ loja: string; coditem: string; descricao: string; semelhanca?: number }>;
}

export interface Previa {
  resumo: Record<BaldeCodigo, number>;
  /** De onde sai o próximo código cunhado. */
  teto: number;
  tetoDe: string;
  paresSia: number;
  /** Estado da leitura da planilha MIX — só entra no teto, não decide nada. */
  planilha: { estado: string; teto: number; linhas: number };
  itens: ItemPrevia[];
  confirmacao: string;
  loteMaximo: number;
}

export interface DecisaoPedida {
  productId: string;
  codigo?: string;
  cunhar?: boolean;
  /** O código que a TELA mostrava — a guarda contra decisão sobrescrita. */
  codigoAtualEsperado: string | null;
  confirmacao: string;
}

const BALDES: BaldeCodigo[] = [
  'ja-correto', 'exato', 'barras-tem-codigo', 'conflito-sia', 'disputado', 'fora-do-sia', 'novo',
];

/**
 * Os baldes que podem ser adotados EM LOTE — os dois em que o código proposto
 * é um número lido, não uma semelhança.
 *
 * Ficam separados de propósito: `exato` casou por etiqueta e o de-para confirma;
 * `barras-tem-codigo` leu o número no campo de barras do próprio cadastro e o
 * de-para NÃO confirma (a exportação está atrasada). São graus de certeza
 * diferentes, e juntá-los num botão só tiraria de quem opera a chance de
 * conferir o segundo grupo antes.
 */
export const BALDES_EM_LOTE = ['exato', 'barras-tem-codigo'] as const;
export type BaldeEmLote = (typeof BALDES_EM_LOTE)[number];

const zerado = (): Record<BaldeCodigo, number> => Object.fromEntries(
  BALDES.map((b) => [b, 0]),
) as Record<BaldeCodigo, number>;

@injectable()
export class CodigoCadastroService {
  constructor(
    @inject(CodigoCadastroRepository) private repo: CodigoCadastroRepo,
    @inject(CodigoCadastroPlanilhaService) private planilha: CodigoCadastroPlanilhaService,
  ) {}

  private async propostas(): Promise<PropostaCodigo[]> {
    const [produtos, pares] = await Promise.all([this.repo.listarProdutos(), this.repo.listarPares()]);
    return reconciliarCodigoCadastro(produtos, pares);
  }

  /**
   * De onde vem o teto da numeração.
   *
   * Três fontes, e vale a maior: o de-para do SIA (a régua da rede), o maior
   * código já gravado no banco, e a planilha MIX quando estiver configurada.
   * A planilha é opcional de propósito — a reconciliação não pode depender do
   * Google para funcionar, mas se a leitura estiver disponível ela protege
   * contra cunhar sobre um código que existe lá e ainda não chegou ao SIA.
   */
  private async teto(): Promise<{ teto: number; tetoDe: string; planilha: Previa['planilha'] }> {
    const [sia, banco, leitura] = await Promise.all([
      this.repo.tetoSia(),
      this.repo.maiorCodigo(),
      this.planilha.ler().catch(() => null),
    ]);
    const daPlanilha = leitura?.estado === 'ok' ? leitura.teto : 0;
    const teto = Math.max(sia, banco, daPlanilha);
    const tetoDe = teto === daPlanilha && daPlanilha > 0 ? 'planilha MIX'
      : teto === sia && sia > 0 ? 'de-para do SIA'
        : 'maior código já gravado';
    return {
      teto,
      tetoDe,
      planilha: {
        estado: leitura?.estado ?? 'falhou',
        teto: daPlanilha,
        linhas: leitura?.linhas.length ?? 0,
      },
    };
  }

  async previa(): Promise<Previa> {
    const [propostas, teto] = await Promise.all([this.propostas(), this.teto()]);
    const resumo = zerado();
    for (const p of propostas) resumo[p.balde] += 1;
    return {
      resumo,
      teto: teto.teto,
      tetoDe: teto.tetoDe,
      planilha: teto.planilha,
      paresSia: (await this.repo.listarPares()).length,
      confirmacao: CONFIRMACAO_CODIGO_CADASTRO,
      loteMaximo: LOTE_MAXIMO,
      itens: propostas.map((p) => ({
        productId: p.produto.id,
        loja: p.produto.loja,
        nome: p.produto.nome,
        codigoBarras: p.produto.codigoBarras,
        codigoAtual: p.produto.codigoInterno,
        balde: p.balde,
        codigoProposto: p.codigoProposto,
        motivo: p.motivo,
        candidatos: p.candidatos.map((c) => ({
          loja: c.loja, coditem: formatarCodigoCadastro(c.coditem), descricao: c.descricao, semelhanca: c.semelhanca,
        })),
      })),
    };
  }

  private conferirFrase(confirmacao: string): void {
    if (confirmacao.trim().toUpperCase() !== CONFIRMACAO_CODIGO_CADASTRO) {
      throw new AppError(`Frase de confirmação inválida. Digite "${CONFIRMACAO_CODIGO_CADASTRO}" para gravar.`, 400);
    }
  }

  /**
   * Adota em lote o balde `exato` — e só ele.
   *
   * O motor já rebaixou para `disputado` qualquer código que dois produtos
   * queiram, então aqui não há como dois cadastros receberem o mesmo número.
   */
  async adotarExatos(user: CurrentUser, confirmacao: string, balde: BaldeEmLote = 'exato') {
    this.conferirFrase(confirmacao);
    const propostas = await this.propostas();
    const alvos = propostas.filter((p) => p.balde === balde);
    const lote = alvos.slice(0, LOTE_MAXIMO);

    let aplicadas = 0;
    let conflitos = 0;
    for (const p of lote) {
      const r = await this.repo.trocar({
        productId: p.produto.id,
        loja: p.produto.loja,
        codigoAnteriorEsperado: p.produto.codigoInterno,
        codigoNovo: p.codigoProposto!,
        fonte: p.fonte,
        alteradoPorUserId: user.id,
        alteradoPorNome: user.name,
      });
      if (r === 'trocado') aplicadas += 1;
      else conflitos += 1;
    }
    return { aplicadas, conflitos, restantes: Math.max(0, alvos.length - lote.length) };
  }

  /** Uma decisão, um produto — o caminho dos baldes que exigem gente. */
  async decidir(user: CurrentUser, pedido: DecisaoPedida) {
    this.conferirFrase(pedido.confirmacao);
    if (!!pedido.cunhar === !!pedido.codigo) {
      throw new AppError('Escolha um código da lista OU cunhe um novo — não os dois, nem nenhum.', 422);
    }
    const propostas = await this.propostas();
    const alvo = propostas.find((p) => p.produto.id === pedido.productId);
    if (!alvo) throw new AppError('Produto não está na lista da reconciliação.', 404);

    const comum = {
      productId: alvo.produto.id,
      loja: alvo.produto.loja,
      codigoAnteriorEsperado: pedido.codigoAtualEsperado,
      alteradoPorUserId: user.id,
      alteradoPorNome: user.name,
    };

    if (pedido.cunhar) {
      /*
       * Cunhar só no balde `novo` — o único em que o produto não casa com nada
       * no SIA e o código atual não é da faixa da rede.
       *
       * Antes isto olhava `candidatos.length`, e passou a bloquear demais
       * quando o balde ganhou SUGESTÃO POR NOME: sugestão não é par, e a pessoa
       * precisa poder dizer "nenhuma dessas serve, cria um número novo".
       * Olhar o balde diz a mesma coisa sem confundir as duas naturezas.
       */
      if (alvo.balde !== 'novo') {
        throw new AppError(
          `Este produto está em "${alvo.balde}", não em "sem código da rede". Resolva ali antes de cunhar.`,
          422,
        );
      }
      const { teto } = await this.teto();
      if (teto <= 0) {
        throw new AppError(
          'Não dá para cunhar sem saber onde a numeração está: o de-para do SIA está vazio e a planilha não pôde ser lida.',
          409,
        );
      }
      const r = await this.repo.cunhar({ ...comum, fonte: `Cunhado sequencial após ${teto}` }, teto);
      if (r.resultado !== 'trocado') throw this.conflito();
      return { codigo: r.codigo, fonte: 'cunhado' };
    }

    const escolhido = formatarCodigoCadastro(pedido.codigo);
    const par = alvo.candidatos.find((c) => formatarCodigoCadastro(c.coditem) === escolhido);
    /*
     * `barras-tem-codigo` não tem candidato: o código não veio de um par do
     * de-para, veio do campo de barras do próprio cadastro. Aceitar a proposta
     * do motor é o que permite resolver esses um a um, em vez de só em lote.
     */
    const proposto = alvo.codigoProposto
      && formatarCodigoCadastro(alvo.codigoProposto) === escolhido;
    if (!par && !proposto) {
      throw new AppError(
        'Esse código não está entre os pares deste produto no SIA. Escolha um dos oferecidos, ou cunhe um novo.',
        422,
      );
    }

    /*
     * Nenhum código para dois cadastros.
     *
     * A prévia só traz BASE e órfãos (as cópias de loja herdam da BASE e ficam
     * de fora), então dois produtos DAQUI com o mesmo número são duplicata de
     * verdade — e é exatamente o estrago que o José está limpando à mão.
     * O banco não tem unicidade em `codigo_interno` para barrar isso, e o
     * balde `disputado` só freia a adoção EM LOTE; a decisão uma a uma passava.
     */
    const dono = propostas.find((p) => p.produto.id !== alvo.produto.id
      && p.produto.codigoInterno
      && formatarCodigoCadastro(p.produto.codigoInterno) === escolhido);
    if (dono) {
      throw new AppError(
        `O código ${escolhido} já é do cadastro "${dono.produto.nome}" (${dono.produto.loja}). `
        + 'Dois cadastros com o mesmo número brigam no PDV — unifique os dois antes de numerar.',
        409,
      );
    }
    const origem = par ? `SIA ${par.loja}` : alvo.fonte;
    const r = await this.repo.trocar({
      ...comum,
      codigoNovo: escolhido,
      fonte: `${origem} (escolhido por ${alvo.balde})`,
    });
    if (r !== 'trocado') throw this.conflito();
    return { codigo: escolhido, fonte: origem };
  }

  private conflito() {
    return new AppError(
      'O código deste produto mudou desde que a tela carregou. Recarregue a prévia antes de decidir de novo.',
      409,
    );
  }
}
