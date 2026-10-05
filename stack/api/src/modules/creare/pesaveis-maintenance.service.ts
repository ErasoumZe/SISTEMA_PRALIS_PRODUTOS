import { createHash } from 'node:crypto';
import { injectable } from 'tsyringe';
import { sql } from 'drizzle-orm';
import { AppError } from '@/config/api.replies';
import { db, type Tx } from '@/db/databases';
import { lerConteudo } from './sia-depara.parser';
import { lerPesaveisExportacao } from './pesaveis-exportacao';
import { planejarPesaveis, type EspelhoPesavelAtual, type ProdutoPesavelAtual } from './pesaveis-plano';

export const CONFIRMACAO_PESAVEIS = 'ATUALIZAR PESAVEIS TNP';
const digest = (valor: string | Buffer) => createHash('sha256').update(valor).digest('hex');

@injectable()
export class PesaveisMaintenanceService {
  private ler(conteudo: Buffer, nome: string) {
    if (!/\.xlsx?$/i.test(nome)) throw new AppError('Envie a exportação .xls ou .xlsx do SIA.', 422);
    let fonte: ReturnType<typeof lerPesaveisExportacao>;
    try { fonte = lerPesaveisExportacao(lerConteudo(conteudo, nome)); }
    catch (erro) {
      throw new AppError(`Exportação inválida: ${erro instanceof Error ? erro.message : 'formato desconhecido'}`, 422);
    }
    if (fonte.problemas.length) {
      throw new AppError(`Exportação recusada: ${fonte.problemas.slice(0, 5).join('; ')}. Total: ${fonte.problemas.length}.`, 422);
    }
    return fonte;
  }

  private async estado(tx: Tx, codigos: string[], bloquear: boolean) {
    const lista = sql.join(codigos.map((codigo) => sql`${codigo}`), sql`, `);
    const trava = bloquear ? sql`FOR UPDATE` : sql``;
    const [p, e] = await Promise.all([
      tx.execute(sql`SELECT id, codigo_interno AS "codigoInterno", nome, pesavel,
          tecla_balanca AS "teclaBalanca", validade_balanca AS "validadeBalanca"
        FROM products WHERE loja = 'TNP' AND status <> 'unificado'
          AND ltrim(codigo_interno, '0') IN (${lista}) ORDER BY id ${trava}`),
      tx.execute(sql`SELECT id, coditem, pesavel, tecla_balanca AS "teclaBalanca",
          validade_balanca AS "validadeBalanca"
        FROM sia_produto_depara WHERE loja = 'TNP'
          AND ltrim(coditem, '0') IN (${lista}) ORDER BY id ${trava}`),
    ]);
    return {
      produtos: p.rows as unknown as ProdutoPesavelAtual[],
      espelhos: e.rows as unknown as EspelhoPesavelAtual[],
    };
  }

  private async calcular(tx: Tx, conteudo: Buffer, nome: string, bloquear: boolean) {
    const fonte = this.ler(conteudo, nome);
    const estado = await this.estado(tx, fonte.pesaveis.map((p) => p.codigoInterno), bloquear);
    const plano = planejarPesaveis(fonte.pesaveis, estado.produtos, estado.espelhos);
    const hashArquivo = digest(conteudo);
    const hashPlano = digest(JSON.stringify({ hashArquivo, estado }));
    return { fonte, plano, hashArquivo, hashPlano };
  }

  async previa(conteudo: Buffer, nome: string) {
    const { fonte, plano, hashArquivo, hashPlano } = await this.calcular(db, conteudo, nome, false);
    return {
      loja: 'TNP', arquivo: nome, totalFonte: fonte.produtos, pesaveisFonte: fonte.pesaveis.length,
      validadeZero: fonte.pesaveis.filter((p) => p.validadeDias === 0).length,
      atualizarProdutos: plano.atualizarProdutos.length, atualizarEspelhos: plano.atualizarEspelhos.length,
      jaCorretos: plano.jaCorretos, semProduto: plano.semProduto,
      codigoAmbiguo: plano.codigoAmbiguo, espelhoAmbiguo: plano.espelhoAmbiguo,
      semEspelho: plano.semEspelho, hashArquivo, hashPlano, confirmacao: CONFIRMACAO_PESAVEIS,
      /*
       * Uma amostra do que vai ser gravado, para a conferência não ser só
       * contagem. Os três primeiros com validade em dias, porque validade 0 é a
       * maioria e não mostra nada: o que o operador precisa ver antes de
       * confirmar é um prazo de verdade saindo do arquivo.
       */
      amostra: plano.atualizarProdutos
        .filter(({ fonte: item }) => item.validadeDias > 0)
        .slice(0, 3)
        .map(({ fonte: item }) => ({
          codigoInterno: item.codigoInterno, nome: item.nome, validadeDias: item.validadeDias,
        })),
    };
  }

  async aplicar(conteudo: Buffer, nome: string, confirmacao: string, hashArquivo: string, hashPlano: string) {
    if (confirmacao.trim().toUpperCase() !== CONFIRMACAO_PESAVEIS) {
      throw new AppError(`Digite exatamente ${CONFIRMACAO_PESAVEIS}.`, 400);
    }
    return db.transaction(async (tx) => {
      const atual = await this.calcular(tx, conteudo, nome, true);
      if (hashArquivo !== atual.hashArquivo || hashPlano !== atual.hashPlano) {
        throw new AppError('Arquivo ou cadastros mudaram desde a prévia. Confira novamente; nada foi gravado.', 409);
      }
      const { plano } = atual;
      if (plano.codigoAmbiguo.length || plano.espelhoAmbiguo.length) {
        throw new AppError('Há códigos ambíguos. Corrija os vínculos antes de aplicar; nada foi gravado.', 422);
      }
      for (const { atual: produto, fonte } of plano.atualizarProdutos) {
        await tx.execute(sql`UPDATE products SET pesavel = 'S', tecla_balanca = 0,
          validade_balanca = ${fonte.validadeDias} WHERE id = ${produto.id}`);
      }
      for (const { atual: espelho, fonte } of plano.atualizarEspelhos) {
        await tx.execute(sql`UPDATE sia_produto_depara SET pesavel = 'S', tecla_balanca = '000',
          validade_balanca = ${String(fonte.validadeDias)} WHERE id = ${espelho.id}`);
      }
      return {
        loja: 'TNP', produtosAtualizados: plano.atualizarProdutos.length,
        espelhosAtualizados: plano.atualizarEspelhos.length,
        jaCorretos: plano.jaCorretos, semProduto: plano.semProduto,
        semEspelho: plano.semEspelho,
      };
    });
  }
}
