import { inject, injectable } from 'tsyringe';
import { sql } from 'drizzle-orm';
import type { ProductDuplicados } from '@pralis/shared';
import { db } from '@/db/databases';
import { AppError } from '@/config/api.replies';
import { ProductSheetService } from '@/modules/google-sheets/product-sheet.service';
import type { CurrentUser } from '@/types/fastify-jwt';

/** Campos fiscais que, divergindo, exigem decisão explícita do admin. */
const CAMPOS_FISCAIS = ['ncm', 'cst_pis_cofins', 'aliquota_simples'] as const;

interface LinhaMerge {
  id: string;
  loja: string;
  nome: string;
  status: string;
  ncm: string | null;
  cstPisCofins: string | null;
  aliquotaSimples: string | null;
}

@injectable()
export class ProductMergeService {
  constructor(@inject(ProductSheetService) private sheets: ProductSheetService) {}

  private async carregar(id: string): Promise<LinhaMerge | null> {
    const r = await db.execute(sql`
      SELECT p.id, p.loja, p.nome, p.status, f.ncm, f.cst_pis_cofins, f.aliquota_simples
        FROM products p LEFT JOIN product_fiscal f ON f.product_id = p.id
       WHERE p.id = ${id} LIMIT 1`);
    const row = r.rows[0];
    if (!row) return null;
    return {
      id: String(row.id), loja: String(row.loja), nome: String(row.nome ?? ''),
      status: String(row.status ?? 'ativo'),
      ncm: row.ncm == null ? null : String(row.ncm),
      cstPisCofins: row.cst_pis_cofins == null ? null : String(row.cst_pis_cofins),
      aliquotaSimples: row.aliquota_simples == null ? null : String(row.aliquota_simples),
    };
  }

  /**
   * Funde dois cadastros da MESMA loja: um sobrevive, o outro é aposentado.
   *
   * Não apaga nada. O perdedor fica com `status = 'unificado'`, aponta para o
   * vencedor e some das listagens — e um snapshot da linha inteira vai para
   * `product_merge`. Apagar de verdade levaria junto, por `onDelete: 'cascade'`,
   * os vínculos de `produto_creare` que uma pessoa confirmou um a um.
   *
   * A mudança é RETROATIVA por decisão do José (31/08/2026): a margem já é
   * recalculada na hora a partir do custo atual do cadastro, então unificar é a
   * mesma classe de mudança que editar um custo — não um risco novo.
   */
  async unificar(
    user: CurrentUser,
    body: ProductDuplicados.UnificarBody,
  ): Promise<ProductDuplicados.UnificarResult> {
    if (user.role !== 'admin') {
      throw new AppError('Apenas o administrador unifica cadastros.', 403, 'ONLY_ADMIN_MERGE');
    }
    const { vencedorProductId: vencedorId, perdedorProductId: perdedorId } = body;
    if (vencedorId === perdedorId) {
      throw new AppError('Escolha dois cadastros diferentes.', 422, 'SAME_PRODUCT');
    }

    const [vencedor, perdedor] = await Promise.all([this.carregar(vencedorId), this.carregar(perdedorId)]);
    if (!vencedor || !perdedor) throw new AppError('Produto não encontrado.', 404, 'PRODUCT_NOT_FOUND');
    if (vencedor.loja !== perdedor.loja) {
      // A Coca da TNP e a da LI têm custo e preço próprios: não são duplicata.
      throw new AppError('Só é possível unificar cadastros da mesma loja.', 422, 'PRODUCT_OTHER_STORE');
    }
    if (vencedor.loja === 'BASE') {
      // Fundir dois BASE (caso D3) reaponta os filhos das três lojas e está
      // fora do escopo por decisão do José.
      throw new AppError(
        'Unificar produtos do catálogo Base ainda não é permitido.', 422, 'BASE_MERGE_NOT_ALLOWED',
      );
    }
    if (perdedor.status === 'unificado' || vencedor.status === 'unificado') {
      throw new AppError('Um dos cadastros já foi unificado.', 422, 'ALREADY_MERGED');
    }

    const fiscalDiverge = CAMPOS_FISCAIS.some((c) => {
      const chave = c === 'cst_pis_cofins' ? 'cstPisCofins' : c === 'aliquota_simples' ? 'aliquotaSimples' : 'ncm';
      return vencedor[chave as keyof LinhaMerge] !== perdedor[chave as keyof LinhaMerge];
    });
    if (fiscalDiverge && !body.fiscalConfirmado) {
      throw new AppError(
        'NCM, CST ou alíquota divergem entre os cadastros. Confirme qual vale antes de unificar.',
        422,
        'FISCAL_DIVERGE',
      );
    }

    const contagem = await db.transaction(async (tx) => {
      // 1) SNAPSHOT antes de tocar em qualquer coisa — é o desfazer.
      const snapshot = await tx.execute(sql`
        SELECT to_jsonb(p) AS produto,
               (SELECT to_jsonb(f) FROM product_fiscal f WHERE f.product_id = p.id)          AS fiscal,
               (SELECT to_jsonb(t) FROM product_transformacao t WHERE t.product_id = p.id)   AS transformacao,
               (SELECT jsonb_agg(to_jsonb(pr)) FROM promocoes pr WHERE pr.product_id = p.id) AS promocoes,
               (SELECT jsonb_agg(to_jsonb(pc)) FROM produto_creare pc WHERE pc.product_id = p.id) AS vinculos
          FROM products p WHERE p.id = ${perdedorId}`);

      // 2) Reaponta os vínculos de venda ANTES de tudo — apagar o perdedor
      // levaria junto, por `onDelete: 'cascade'`, o trabalho manual da tela de
      // de-para.
      //
      // Não há colisão possível aqui: `uq_produto_creare_natural` é
      // (loja, produto_codigo, produto) e NÃO inclui `product_id`. Ou seja,
      // uma venda só pode estar vinculada a UM produto, e trocar o dono não
      // muda a trinca. Se um dia o índice passar a incluir o produto, este
      // UPDATE precisa voltar a tratar conflito.
      const movidos = await tx.execute(sql`
        UPDATE produto_creare SET product_id = ${vencedorId}
         WHERE product_id = ${perdedorId} RETURNING id`);

      // 3) `base_product_id` NÃO tem chave estrangeira: nada avisaria se ficasse
      // apontando para um id aposentado. Reaponta explicitamente.
      const filhos = await tx.execute(sql`
        UPDATE products SET base_product_id = ${vencedorId}
         WHERE base_product_id = ${perdedorId} RETURNING id`);

      // 4) Aposenta o perdedor — sem DELETE.
      await tx.execute(sql`
        UPDATE products SET status = 'unificado', unificado_em_product_id = ${vencedorId}
         WHERE id = ${perdedorId}`);

      // 5) Auditoria.
      await tx.execute(sql`
        INSERT INTO product_merge (id, loja, vencedor_product_id, perdedor_product_id, snapshot, confirmado_por)
        VALUES (gen_random_uuid()::text, ${perdedor.loja}, ${vencedorId}, ${perdedorId},
                ${JSON.stringify(snapshot.rows[0] ?? {})}::jsonb, ${user.name})`);

      return {
        vinculosReapontados: movidos.rows.length,
        filhosReapontados: filhos.rows.length,
      };
    });

    // Fora da transação: o perdedor deixou de ser um produto, então sai da
    // planilha. Falha do Google não desfaz a unificação já gravada — o
    // reprocessamento manual existe para isso.
    const espelho = await this.sheets.removeProduct(perdedorId).catch(() => ({ outcome: 'failed' as const }));

    return {
      loja: perdedor.loja as ProductDuplicados.UnificarResult['loja'],
      vencedorProductId: vencedorId,
      perdedorProductId: perdedorId,
      ...contagem,
      sheetSync: espelho.outcome,
    };
  }

  /**
   * "Não são o mesmo produto." Guarda a recusa para o par não voltar à fila.
   * Sem isso o mesmo par volta toda semana e a tela perde a confiança.
   */
  async recusar(user: CurrentUser, produtoAId: string, produtoBId: string): Promise<void> {
    if (user.role !== 'admin') {
      throw new AppError('Apenas o administrador julga duplicatas.', 403, 'ONLY_ADMIN_MERGE');
    }
    if (produtoAId === produtoBId) throw new AppError('Escolha dois cadastros diferentes.', 422, 'SAME_PRODUCT');

    const [a, b] = await Promise.all([this.carregar(produtoAId), this.carregar(produtoBId)]);
    if (!a || !b) throw new AppError('Produto não encontrado.', 404, 'PRODUCT_NOT_FOUND');
    if (a.loja !== b.loja) throw new AppError('Cadastros de lojas diferentes.', 422, 'PRODUCT_OTHER_STORE');

    // par ORDENADO: A-B e B-A são a mesma recusa
    const [x, y] = [produtoAId, produtoBId].sort();
    await db.execute(sql`
      INSERT INTO product_merge_recusa (id, loja, produto_a_id, produto_b_id, recusado_por)
      VALUES (gen_random_uuid()::text, ${a.loja}, ${x}, ${y}, ${user.name})
      ON CONFLICT (produto_a_id, produto_b_id) DO NOTHING`);
  }

  /**
   * Liga um produto de loja ao catálogo BASE (caso D2). Só preenche o vínculo:
   * NÃO copia custo nem preço, que são de cada loja. A herança campo a campo
   * já implementada cuida do resto a partir da próxima edição da BASE.
   */
  async ligarBase(user: CurrentUser, productId: string, baseProductId: string): Promise<void> {
    if (user.role !== 'admin') {
      throw new AppError('Apenas o administrador liga produtos à Base.', 403, 'ONLY_ADMIN_MERGE');
    }
    const [produto, base] = await Promise.all([this.carregar(productId), this.carregar(baseProductId)]);
    if (!produto || !base) throw new AppError('Produto não encontrado.', 404, 'PRODUCT_NOT_FOUND');
    if (produto.loja === 'BASE') {
      throw new AppError('Só produtos de loja se ligam à Base.', 422, 'NOT_A_STORE_PRODUCT');
    }
    if (base.loja !== 'BASE') {
      throw new AppError('O destino precisa ser um produto do catálogo Base.', 422, 'NOT_A_BASE_PRODUCT');
    }
    await db.execute(sql`
      UPDATE products SET base_product_id = ${baseProductId} WHERE id = ${productId}`);
  }
}
