import { inject, injectable } from 'tsyringe';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { AppError } from '@/config/api.replies';
import { db } from '@/db/databases';
import type { CurrentUser } from '@/types/fastify-jwt';
import { siaProdutoDePara } from '@/modules/creare/creare.table';
import { products } from './product.table';
import { CodigoCadastroRepository, type CodigoCadastroRepo } from './codigo-cadastro.repository';
import { reconciliarGiuliaComSia, type ProdutoGiuliaSia, type PropostaGiuliaSia } from './giulia-sia.motor';

export const CONFIRMACAO_GIULIA_SIA = 'CONCILIAR GIULIA COM SIA';
const LOTE_MAXIMO = 200;

@injectable()
export class GiuliaSiaService {
  constructor(@inject(CodigoCadastroRepository) private codigos: CodigoCadastroRepo) {}

  private async lerProdutos(): Promise<ProdutoGiuliaSia[]> {
    return db.select({ id: products.id, loja: products.loja, nome: products.nome, codigoBarras: products.codigoBarras, codigoInterno: products.codigoInterno })
      .from(products)
      .where(and(eq(products.loja, 'BASE'), isNull(products.baseProductId), eq(products.createdByName, 'Giulia garcia'), ne(products.status, 'unificado')))
      .orderBy(products.nome);
  }

  private async propostas() {
    const [produtos, pares, maiorBanco, ultimoAtivo] = await Promise.all([
      this.lerProdutos(),
      db.select({ loja: siaProdutoDePara.loja, coditem: siaProdutoDePara.coditem, chaveBarras: siaProdutoDePara.chaveBarras, descricao: siaProdutoDePara.descricao, ativo: siaProdutoDePara.ativo }).from(siaProdutoDePara),
      this.codigos.maiorCodigo(),
      db.execute(sql`SELECT COALESCE(MAX(CAST(coditem AS BIGINT)), 0) AS max FROM sia_produto_depara WHERE ativo = 'S' AND coditem ~ '^[0-9]+$'`),
    ]);
    const ultimoSiaAtivo = Number((ultimoAtivo.rows?.[0] as { max?: string | number } | undefined)?.max ?? 0);
    const teto = Math.max(ultimoSiaAtivo, maiorBanco);
    return { propostas: reconciliarGiuliaComSia(produtos, pares, teto), ultimoSiaAtivo, maiorBanco, teto };
  }

  async previa() {
    const lida = await this.propostas();
    const resumo = { 'conciliar-sia': 0, 'novo-codigo': 0, pendente: 0, 'conflito-sia': 0 };
    for (const item of lida.propostas) resumo[item.situacao] += 1;
    return { ...lida, resumo, confirmacao: CONFIRMACAO_GIULIA_SIA, loteMaximo: LOTE_MAXIMO };
  }

  async aplicar(user: CurrentUser, confirmacao: string) {
    if (confirmacao.trim().toUpperCase() !== CONFIRMACAO_GIULIA_SIA) throw new AppError(`Digite "${CONFIRMACAO_GIULIA_SIA}" para gravar.`, 400);
    const lida = await this.propostas();
    const alvos = lida.propostas.filter((p) => p.situacao === 'conciliar-sia' || p.situacao === 'novo-codigo').slice(0, LOTE_MAXIMO);
    let aplicadas = 0; let conflitos = 0;
    for (const p of alvos) {
      const comum = { productId: p.produto.id, loja: p.produto.loja, codigoAnteriorEsperado: p.produto.codigoInterno, alteradoPorUserId: user.id, alteradoPorNome: user.name };
      if (p.situacao === 'conciliar-sia') {
        const r = await this.codigos.trocar({ ...comum, codigoNovo: p.codigoProposto!, fonte: 'Conciliação Giulia/SIA por código de barras exato' });
        if (r === 'trocado') aplicadas += 1; else conflitos += 1;
      } else {
        const r = await this.codigos.cunhar({ ...comum, fonte: `Novo código Giulia/SIA após ${lida.teto}` }, lida.teto);
        if (r.resultado === 'trocado') aplicadas += 1; else conflitos += 1;
      }
    }
    return { aplicadas, conflitos, restantes: Math.max(0, lida.propostas.filter((p) => p.situacao === 'conciliar-sia' || p.situacao === 'novo-codigo').length - alvos.length) };
  }
}
