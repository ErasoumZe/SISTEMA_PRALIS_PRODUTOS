import { inject, injectable } from 'tsyringe';
import { eq, and, sql } from 'drizzle-orm';
import { ProductRules, type VendasDePara } from '@pralis/shared';
import { db } from '@/db/databases';
import { AppError } from '@/config/api.replies';
import { produtoCreare } from './vendas.table';
import { VendasReportRepository } from './vendas-report.repository';
import { indexarPorCodigo, resolverProduto, semelhanca, type ProdutoCadastro } from './vendas-margem';
import { barcodeCandidates } from '@/modules/apoio/tax-rule.service';

type Loja = 'TNP' | 'LI';

/** Quantos candidatos oferecer. Mais que isso vira lista, não sugestão. */
const MAX_SUGESTOES = 5;
/**
 * Abaixo disso o nome não se parece o bastante para valer o clique.
 *
 * Era 25 e isso se mostrou perigoso na prática: "PAO DE SAL PRALIS" recebia
 * "BOLO PRALIS LIMAO 250 G" com 50% — as duas frases dividem "PRALIS" e várias
 * sílabas. Numa tela de confirmação, sugestão ruim não é neutra: ela convida ao
 * clique errado, e vincular errado calcula a margem com o custo de outro
 * produto. Lista vazia é melhor que lista enganosa.
 */
const SEMELHANCA_MINIMA = 55;

/**
 * Código curto e numérico é PLU de balança, não EAN (que tem 8, 12, 13 ou 14).
 * Isso muda o conselho na tela: não adianta procurar parecido, o produto
 * precisa ser cadastrado com o EAN de balança para casar sozinho.
 */
const pluDeBalanca = (produtoCodigo: string): string | null => {
  const [normalizado] = barcodeCandidates(produtoCodigo);
  if (!normalizado) return null;
  return normalizado.length >= 3 && normalizado.length <= 6 ? normalizado : null;
};

const descricao = (p: ProdutoCadastro): string =>
  ProductRules.montarDescricao(p.nome, p.quantidade ?? 0, p.medidaBase ?? '');

@injectable()
export class VendasDeParaService {
  constructor(@inject(VendasReportRepository) private repository: VendasReportRepository) {}

  /**
   * Códigos vendidos no período que ainda não têm produto, ordenados pelo
   * faturamento — resolver primeiro o que mais pesa. Cada um vem com
   * candidatos por semelhança de nome, que são SUGESTÃO: nada é vinculado sem
   * uma pessoa confirmar.
   */
  async pendentes(loja: Loja, inicio: string, fim: string): Promise<VendasDePara.DeParaLista> {
    const [vendas, cadastro, dePara] = await Promise.all([
      this.repository.produtos(loja, inicio, fim),
      this.repository.produtosDaLoja(loja),
      this.repository.deParaDaLoja(loja),
    ]);
    const indice = indexarPorCodigo(cadastro);

    const pendentes: VendasDePara.Pendente[] = [];
    let faturamentoPendente = 0;

    for (const venda of vendas) {
      if (resolverProduto(venda.produtoCodigo, venda.produto, indice, dePara)) continue;
      faturamentoPendente += venda.faturamento;
      pendentes.push({
        produtoCodigo: venda.produtoCodigo,
        produto: venda.produto,
        quantidade: venda.quantidade,
        faturamento: venda.faturamento,
        codigoPlu: pluDeBalanca(venda.produtoCodigo),
        sugestoes: this.sugerir(venda.produto, cadastro),
      });
    }

    pendentes.sort((a, b) => b.faturamento - a.faturamento);
    return {
      loja,
      periodo: { inicio, fim },
      faturamentoPendente: Math.round(faturamentoPendente * 100) / 100,
      pendentes,
    };
  }

  private sugerir(nomeNoPdv: string, cadastro: ProdutoCadastro[]): VendasDePara.Sugestao[] {
    return cadastro
      .map((p) => ({
        productId: p.id,
        nome: p.nome,
        descricao: descricao(p),
        codigoBarras: p.codigoBarras,
        custo: p.custo,
        // compara com a descrição montada pela regra do Pralis, que é o texto
        // mais próximo do que o PDV imprime
        semelhanca: Math.max(semelhanca(nomeNoPdv, descricao(p)), semelhanca(nomeNoPdv, p.nome)),
      }))
      .filter((s) => s.semelhanca >= SEMELHANCA_MINIMA)
      .sort((a, b) => b.semelhanca - a.semelhanca)
      .slice(0, MAX_SUGESTOES);
  }

  /** Cria ou troca o vínculo. `productId` nulo desfaz. */
  async vincular(
    loja: Loja,
    produtoCodigo: string,
    produtoNoPdv: string,
    productId: string | null,
    confirmadoPor: string,
  ): Promise<void> {
    const codigo = produtoCodigo.trim();
    const descricaoPdv = produtoNoPdv.trim();
    // o código PODE vir vazio — é o caso dos pesáveis que o PDV manda sem
    // código. A descrição é o que resta para identificar a venda.
    if (!descricaoPdv) throw new AppError('Descrição do produto no PDV é obrigatória.', 422, 'DESCRIPTION_REQUIRED');

    if (productId === null) {
      await db.delete(produtoCreare).where(and(
        eq(produtoCreare.loja, loja),
        eq(produtoCreare.produtoCodigo, codigo),
        eq(produtoCreare.produto, descricaoPdv),
      ));
      return;
    }

    const [produto] = await db.execute(sql`SELECT id, loja FROM products WHERE id = ${productId}`)
      .then((r) => r.rows as Array<{ id: string; loja: string }>);
    if (!produto) throw new AppError('Produto não encontrado.', 404, 'PRODUCT_NOT_FOUND');
    // vincular a venda de uma loja ao produto de OUTRA daria margem com o custo
    // errado — e ainda deixaria uma loja enxergando o cadastro da outra
    if (produto.loja !== loja) {
      throw new AppError('O produto precisa ser da mesma loja da venda.', 422, 'PRODUCT_OTHER_STORE');
    }

    await db.insert(produtoCreare)
      .values({ loja, produtoCodigo: codigo, produto: descricaoPdv, productId, confirmadoPor })
      .onConflictDoUpdate({
        target: [produtoCreare.loja, produtoCreare.produtoCodigo, produtoCreare.produto],
        set: { productId, confirmadoPor, confirmadoEm: sql`now()` },
      });
  }
}
