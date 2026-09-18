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
   * Linhas de delivery: o mesmo produto cadastrado de novo para a entrega.
   *
   * Reconhecidas pelo nome terminado em DELIVERY — que é o que dá para observar
   * no arquivo. Na exportação da Lisboa o código também é `700000 + o normal`,
   * mas isso é padrão de uma loja, não regra do SIA, então o nome é que manda.
   */
  delivery: number;
  confirmacao: string;
}

const EH_DELIVERY = /\bDELIVERY\s*$/i;

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
    try {
      return lerDePara(tabela);
    } catch (e: unknown) {
      throw new AppError(
        `O arquivo não tem as colunas do SIA (${e instanceof Error ? e.message : 'cabeçalho não reconhecido'}).`,
        422,
      );
    }
  }

  /** Confere sem gravar. É o equivalente ao script sem `--apply`. */
  async previa(loja: CreareStore, conteudo: Buffer, nome: string): Promise<ResumoDePara> {
    const r = this.ler(conteudo, nome);
    const catalogo = r.linhas.filter((l) => !EH_DELIVERY.test(l.descricao));
    const numeros = catalogo.map((l) => Number(l.coditem)).filter(Number.isFinite);
    return {
      loja,
      arquivo: nome,
      linhas: r.linhas.length,
      semBarras: r.semBarras,
      atuais: await this.atuais(loja),
      barrasAmbiguas: r.barrasAmbiguas.slice(0, 20),
      coditensRepetidos: r.coditensRepetidos.slice(0, 20),
      faixa: numeros.length ? { min: Math.min(...numeros), max: Math.max(...numeros) } : null,
      delivery: r.linhas.length - catalogo.length,
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
      throw new AppError('O arquivo não tem nenhuma linha com código de barras.', 422);
    }

    const antes = await this.atuais(loja);
    await db.transaction(async (tx) => {
      await tx.execute(sql`DELETE FROM sia_produto_depara WHERE loja = ${loja}`);
      const lote = 500;
      for (let i = 0; i < r.linhas.length; i += lote) {
        await tx.insert(siaProdutoDePara).values(r.linhas.slice(i, i + lote).map((l) => ({ ...l, loja })));
      }
    });

    return { loja, gravadas: r.linhas.length, substituidas: antes, semBarras: r.semBarras };
  }
}
