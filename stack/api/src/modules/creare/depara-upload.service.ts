import { injectable } from 'tsyringe';
import { sql } from 'drizzle-orm';
import { AppError } from '@/config/api.replies';
import { db } from '@/db/databases';
import { siaProdutoDePara } from './creare.table';
import { lerConteudo, lerDePara } from './sia-depara.parser';
import type { CreareStore } from './creare.config';

/**
 * Importa o de-para do SIA pela tela, em vez de pela linha de comando.
 *
 * Existia só `npm run creare:depara`, que precisa de shell e da credencial do
 * banco de produção. Isso deixava a régua da numeração — o de-para é ela —
 * dependendo de um desenvolvedor com acesso ao servidor, e o catálogo do SIA
 * muda toda semana.
 *
 * As regras de recusa são as MESMAS do script, porque são do parser
 * (`sia-depara.parser.ts`), que é compartilhado e testado: código de barras
 * apontando para dois produtos, ou `coditem` repetido, recusa antes de gravar.
 * De-para ambíguo é pior que de-para nenhum — ele manda o produto errado ao PDV.
 */
export const CONFIRMACAO_DEPARA = 'SUBSTITUIR O DE-PARA DESTA LOJA';

export const LOJAS_DEPARA = ['TNP', 'LI', 'HORA'] as const;

export interface ResumoDePara {
  loja: string;
  arquivo: string;
  linhas: number;
  semBarras: number;
  semDadosBalanca: number;
  /** Quantas linhas a loja tem hoje — o que seria substituído. */
  atuais: number;
  barrasAmbiguas: Array<{ chave: string; coditens: string[] }>;
  coditensRepetidos: string[];
  /**
   * Menor e maior `coditem` do **catálogo**, já sem as linhas de delivery.
   *
   * Antes esta faixa somava os dois blocos e saía "10000–719000", que parece um
   * erro grosseiro de leitura quando na verdade é o cadastro de entrega no fim
   * do arquivo. Separar os dois é a diferença entre um número que assusta e um
   * número que informa.
   */
  faixa: { min: number; max: number } | null;
  /**
   * Linhas de entrega, que ficam **de fora** do de-para.
   *
   * São o mesmo produto cadastrado de novo para o delivery, com código
   * `700000 + o do catálogo`. O Pralis não administra esses cadastros — eles são
   * do PDV da loja — e mantê-los aqui só cria produto disputando o mesmo código.
   */
  entrega: number;
  confirmacao: string;
}

/**
 * Onde termina o catálogo e começa a entrega.
 *
 * **Pelo código, não pelo nome.** A primeira versão disto olhava o nome
 * terminado em `DELIVERY`, e a exportação de 20/09 mostrou por que não dá: o
 * SIA trunca a descrição em ~50 caracteres, e em **216 das 1.208** linhas de
 * entrega a palavra sai cortada (`... 170G DELIVE`) ou some inteira. Já o
 * código separa os dois blocos sem exceção — medido no mesmo arquivo:
 *
 *   catálogo  10000–13126   2.984 linhas
 *   entrega  710000–719000  1.208 linhas
 *
 * Nenhuma linha de catálogo passa de 700000 e nenhuma de entrega fica abaixo.
 */
const PRIMEIRO_CODIGO_DE_ENTREGA = 700_000;

const ehEntrega = (coditem: string): boolean => {
  const n = Number(String(coditem).replace(/\D/g, ''));
  return Number.isFinite(n) && n >= PRIMEIRO_CODIGO_DE_ENTREGA;
};

@injectable()
export class DeParaUploadService {
  private async atuais(loja: string): Promise<number> {
    const r = await db.execute(sql`SELECT count(*)::int AS n FROM sia_produto_depara WHERE loja = ${loja}`);
    return Number((r.rows?.[0] as { n?: number } | undefined)?.n ?? 0);
  }

  private ler(conteudo: Buffer, nome: string) {
    let tabela: unknown[][];
    try {
      tabela = lerConteudo(conteudo, nome);
    } catch (e: unknown) {
      throw new AppError(
        `Não consegui ler o arquivo (${e instanceof Error ? e.message : 'formato desconhecido'}). Envie o .xls ou .csv exportado do SIA Supervisor.`,
        422,
      );
    }
    let bruto: ReturnType<typeof lerDePara>;
    try {
      bruto = lerDePara(tabela);
    } catch (e: unknown) {
      throw new AppError(
        `O arquivo não tem as colunas do SIA (${e instanceof Error ? e.message : 'cabeçalho não reconhecido'}).`,
        422,
      );
    }
    return this.separarCatalogo(bruto);
  }

  /**
   * Fica só com o catálogo e recalcula as recusas SOBRE ELE.
   *
   * Recalcular importa: uma linha de entrega colidindo com outra linha de
   * entrega travaria a gravação de um bloco que nem vai ser gravado. A conta
   * tem que ser sobre o que realmente entra no de-para.
   */
  private separarCatalogo(bruto: ReturnType<typeof lerDePara>) {
    const catalogo = bruto.linhas.filter((l) => !ehEntrega(l.coditem));

    const porChave = new Map<string, string[]>();
    const porCoditem = new Map<string, number>();
    for (const l of catalogo) {
      porChave.set(l.chaveBarras, [...(porChave.get(l.chaveBarras) ?? []), l.coditem]);
      porCoditem.set(l.coditem, (porCoditem.get(l.coditem) ?? 0) + 1);
    }

    return {
      linhas: catalogo,
      entrega: bruto.linhas.length - catalogo.length,
      semBarras: bruto.semBarras,
      semDadosBalanca: catalogo.filter((l) => !l.pesavel || (l.pesavel === 'S' && (l.teclaBalanca === null || l.validadeBalanca === null))).length,
      barrasAmbiguas: [...porChave.entries()]
        .filter(([, coditens]) => coditens.length > 1)
        .map(([chave, coditens]) => ({ chave, coditens })),
      coditensRepetidos: [...porCoditem.entries()].filter(([, n]) => n > 1).map(([c]) => c),
    };
  }

  /** Confere sem gravar. É o equivalente ao script sem `--apply`. */
  async previa(loja: CreareStore, conteudo: Buffer, nome: string): Promise<ResumoDePara> {
    const r = this.ler(conteudo, nome);
    const numeros = r.linhas.map((l) => Number(l.coditem)).filter(Number.isFinite);
    return {
      loja,
      arquivo: nome,
      linhas: r.linhas.length,
      semBarras: r.semBarras,
      semDadosBalanca: r.semDadosBalanca,
      atuais: await this.atuais(loja),
      barrasAmbiguas: r.barrasAmbiguas.slice(0, 20),
      coditensRepetidos: r.coditensRepetidos.slice(0, 20),
      faixa: numeros.length ? { min: Math.min(...numeros), max: Math.max(...numeros) } : null,
      entrega: r.entrega,
      confirmacao: CONFIRMACAO_DEPARA,
    };
  }

  /**
   * Substitui o de-para da loja inteiro.
   *
   * Substituição, não mesclagem, e numa transação só: a exportação é a verdade
   * daquele momento. Mesclar deixaria para trás produto que o SIA apagou, e um
   * de-para com fantasma manda o TXT atualizar um item que não existe mais.
   */
  async aplicar(loja: CreareStore, conteudo: Buffer, nome: string, confirmacao: string) {
    if (confirmacao.trim().toUpperCase() !== CONFIRMACAO_DEPARA) {
      throw new AppError(`Frase de confirmação inválida. Digite "${CONFIRMACAO_DEPARA}" para gravar.`, 400);
    }
    const r = this.ler(conteudo, nome);

    if (r.barrasAmbiguas.length) {
      const ex = r.barrasAmbiguas[0]!;
      throw new AppError(
        `Recusado: ${r.barrasAmbiguas.length} código(s) de barras apontam para mais de um produto no SIA `
        + `(ex.: ${ex.chave} → ${ex.coditens.join(', ')}). Um sobrescreveria o outro no PDV.`,
        422,
      );
    }
    if (r.coditensRepetidos.length) {
      throw new AppError(
        `Recusado: coditem repetido na exportação (${r.coditensRepetidos.slice(0, 10).join(', ')}).`,
        422,
      );
    }
    if (r.linhas.length === 0) {
      throw new AppError(
        r.entrega > 0
          ? `O arquivo só tem linhas de entrega (código a partir de ${PRIMEIRO_CODIGO_DE_ENTREGA}). Envie a exportação do catálogo.`
          : 'O arquivo não tem nenhuma linha com código de barras.',
        422,
      );
    }
    if (r.semDadosBalanca > 0) {
      throw new AppError(
        `Recusado: ${r.semDadosBalanca} produto(s) sem Pesavel S/N ou, quando S, sem Tecla/Validade. `
        + 'Exporte o cadastro atual do SIA com as colunas operacionais de balanca.',
        422,
        'CREARE_BALANCA_INCOMPLETA',
      );
    }

    const antes = await this.atuais(loja);
    await db.transaction(async (tx) => {
      await tx.execute(sql`DELETE FROM sia_produto_depara WHERE loja = ${loja}`);
      const lote = 500;
      for (let i = 0; i < r.linhas.length; i += lote) {
        await tx.insert(siaProdutoDePara).values(r.linhas.slice(i, i + lote).map((l) => ({ ...l, loja })));
      }
    });

    return { loja, gravadas: r.linhas.length, substituidas: antes, semBarras: r.semBarras, entrega: r.entrega };
  }
}
