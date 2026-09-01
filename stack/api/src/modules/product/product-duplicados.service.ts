import { inject, injectable } from 'tsyringe';
import { sql } from 'drizzle-orm';
import { ProductRules, type ProductDuplicados } from '@pralis/shared';
import { db } from '@/db/databases';
import { barcodeCandidates } from '@/modules/apoio/tax-rule.service';
// `semelhanca` e o casamento venda↔produto já existem, testados e em uso na
// margem. O plano manda reaproveitar em vez de escrever outro motor.
import { indexarPorCodigo, resolverProduto, semelhanca, type ProdutoCadastro } from '@/modules/vendas/vendas-margem';

type Catalogo = 'BASE' | 'TNP' | 'LI' | 'HORA';

/**
 * Comparar nome contra nome é O(n²). Com ~150 produtos por loja são 11 mil
 * comparações, instantâneo. Acima disso o custo cresce rápido, então o piso
 * existe e o teto também: melhor recusar do que travar a tela.
 */
const MAX_PRODUTOS_PARA_NOME = 3000;

interface LinhaProduto extends ProdutoCadastro {
  codigoInterno: string | null;
  vVendaPontual: number | null;
  ncm: string | null;
  cstPisCofins: string | null;
  aliquotaSimples: number | null;
  status: string;
  baseProductId: string | null;
}

const num = (v: unknown): number | null => (v == null ? null : Number(v));

@injectable()
export class ProductDuplicadosService {
  /** Cadastro da loja com o fiscal junto — uma consulta, sem N+1. */
  private async produtos(loja: Catalogo): Promise<LinhaProduto[]> {
    const r = await db.execute(sql`
      SELECT p.id, p.nome, p.codigo_barras, p.codigo_interno, p.custo, p.qt_cad,
             p.quantidade, p.medida_base, p.v_venda_pontual, p.status, p.base_product_id,
             f.ncm, f.cst_pis_cofins, f.aliquota_simples
        FROM products p
        LEFT JOIN product_fiscal f ON f.product_id = p.id
       WHERE p.loja = ${loja} AND p.status <> 'unificado'
    `);
    return r.rows.map((row) => ({
      id: String(row.id),
      nome: String(row.nome ?? ''),
      codigoBarras: row.codigo_barras == null ? null : String(row.codigo_barras),
      custo: num(row.custo),
      qtCad: Number(row.qt_cad ?? 1),
      quantidade: num(row.quantidade),
      medidaBase: row.medida_base == null ? null : String(row.medida_base),
      codigoInterno: row.codigo_interno == null ? null : String(row.codigo_interno),
      vVendaPontual: num(row.v_venda_pontual),
      ncm: row.ncm == null ? null : String(row.ncm),
      cstPisCofins: row.cst_pis_cofins == null ? null : String(row.cst_pis_cofins),
      aliquotaSimples: num(row.aliquota_simples),
      status: String(row.status ?? 'ativo'),
      baseProductId: row.base_product_id == null ? null : String(row.base_product_id),
    }));
  }

  /**
   * Faturamento por produto nos últimos 90 dias, resolvido pelo MESMO caminho
   * da margem: de-para confirmado tem precedência, senão casamento por código.
   * Sem isso a fila seria ordenada por semelhança, e o que importa é a
   * duplicata que move dinheiro.
   */
  private async faturamento90d(
    loja: Catalogo, produtos: LinhaProduto[],
  ): Promise<{ porProduto: Map<string, number>; porChave: Map<string, number> }> {
    const vazio = { porProduto: new Map<string, number>(), porChave: new Map<string, number>() };
    if (loja !== 'TNP' && loja !== 'LI') return vazio;

    const vendas = await db.execute(sql`
      SELECT produto_codigo, produto, SUM(total) AS total
        FROM venda_produto_dia
       WHERE loja = ${loja} AND data >= (CURRENT_DATE - INTERVAL '90 days')
       GROUP BY produto_codigo, produto
    `);
    const dePara = await db.execute(sql`
      SELECT pc.produto_codigo, pc.produto, pc.product_id
        FROM produto_creare pc WHERE pc.loja = ${loja}
    `);

    const porId = new Map(produtos.map((p) => [p.id, p]));
    const mapaDePara = new Map<string, ProdutoCadastro>();
    for (const d of dePara.rows) {
      const alvo = porId.get(String(d.product_id));
      if (alvo) mapaDePara.set(`${String(d.produto_codigo ?? '')}|${String(d.produto ?? '')}`, alvo);
    }

    const indice = indexarPorCodigo(produtos);
    const porProduto = new Map<string, number>();
    const porChave = new Map<string, number>();

    for (const v of vendas.rows) {
      const codigo = String(v.produto_codigo ?? '');
      const total = Number(v.total ?? 0);

      // O faturamento também é somado por CHAVE de código. Duplicata por
      // código de barras é ambígua por definição, e `indexarPorCodigo` remove
      // chave ambígua do índice de propósito — sem isto, justamente o grupo
      // que mais precisa ser priorizado apareceria com R$ 0.
      for (const chave of barcodeCandidates(codigo)) {
        if (chave) porChave.set(chave, (porChave.get(chave) ?? 0) + total);
      }

      const achado = resolverProduto(codigo, String(v.produto ?? ''), indice, mapaDePara);
      if (!achado) continue;
      porProduto.set(achado.id, (porProduto.get(achado.id) ?? 0) + total);
    }
    return { porProduto, porChave };
  }

  /** Pares que uma pessoa já disse não serem o mesmo produto. */
  private async recusas(): Promise<Set<string>> {
    const r = await db.execute(sql`SELECT produto_a_id, produto_b_id FROM product_merge_recusa`);
    return new Set(r.rows.map((x) => `${String(x.produto_a_id)}|${String(x.produto_b_id)}`));
  }

  /**
   * Candidatos da BASE para um produto de loja órfão (caso D2). Código de
   * barras vale 100 e vem primeiro; nome é sugestão e depende do piso.
   */
  private sugerirBase(
    p: LinhaProduto, base: LinhaProduto[], indiceBase: Map<string, ProdutoCadastro>, piso: number,
  ): ProductDuplicados.SugestaoBase[] {
    const porBarras = resolverProduto(p.codigoBarras ?? '', p.nome, indiceBase, new Map());
    const saida: ProductDuplicados.SugestaoBase[] = [];
    if (porBarras) {
      const achado = base.find((b) => b.id === porBarras.id);
      if (achado) {
        saida.push({
          productId: achado.id, nome: achado.nome,
          descricao: ProductRules.montarDescricao(achado.nome, achado.quantidade ?? 0, achado.medidaBase ?? ''),
          codigoBarras: achado.codigoBarras, semelhanca: 100, porCodigoBarras: true,
        });
      }
    }
    for (const b of base) {
      if (saida.some((s) => s.productId === b.id)) continue;
      const sem = Math.max(semelhanca(p.nome, b.nome), semelhanca(
        ProductRules.montarDescricao(p.nome, p.quantidade ?? 0, p.medidaBase ?? ''),
        ProductRules.montarDescricao(b.nome, b.quantidade ?? 0, b.medidaBase ?? ''),
      ));
      if (sem < piso) continue;
      saida.push({
        productId: b.id, nome: b.nome,
        descricao: ProductRules.montarDescricao(b.nome, b.quantidade ?? 0, b.medidaBase ?? ''),
        codigoBarras: b.codigoBarras, semelhanca: sem, porCodigoBarras: false,
      });
    }
    return saida.sort((a, b) => b.semelhanca - a.semelhanca).slice(0, 5);
  }

  async diagnosticar(loja: Catalogo, semelhancaMinima: number): Promise<ProductDuplicados.Duplicados> {
    const produtos = await this.produtos(loja);
    const recusados = await this.recusas();
    // catálogo BASE só é carregado quando há órfão para ligar
    const base = loja === 'BASE' ? [] : await this.produtos('BASE');
    const indiceBase = indexarPorCodigo(base);
    const { porProduto: faturamento, porChave } = await this.faturamento90d(loja, produtos);
    const grupos: ProductDuplicados.GrupoDuplicado[] = [];

    const paraSaida = (p: LinhaProduto): ProductDuplicados.ProdutoDuplicado => ({
      id: p.id,
      nome: p.nome,
      descricao: ProductRules.montarDescricao(p.nome, p.quantidade ?? 0, p.medidaBase ?? ''),
      codigoBarras: p.codigoBarras,
      codigoInterno: p.codigoInterno,
      custo: p.custo,
      vVendaPontual: p.vVendaPontual,
      ncm: p.ncm,
      cstPisCofins: p.cstPisCofins,
      aliquotaSimples: p.aliquotaSimples,
      status: p.status,
      temBase: p.baseProductId != null,
      faturamento90d: Math.round((faturamento.get(p.id) ?? 0) * 100) / 100,
    });

    const montar = (
      motivo: ProductDuplicados.MotivoDuplicidade,
      chave: string,
      itens: LinhaProduto[],
      sem: number | null,
    ): ProductDuplicados.GrupoDuplicado => {
      const saida = itens.map(paraSaida);
      const difere = (campo: keyof ProductDuplicados.ProdutoDuplicado) =>
        new Set(saida.map((s) => JSON.stringify(s[campo]))).size > 1;
      const camposDiferentes = (['custo', 'vVendaPontual', 'ncm', 'cstPisCofins', 'aliquotaSimples', 'nome'] as const)
        .filter(difere);
      return {
        motivo,
        chave,
        semelhanca: sem,
        camposDiferentes,
        // NCM, CST ou alíquota divergindo significa que eles NÃO eram iguais:
        // fundir sem decidir qual vale poria imposto errado no cupom.
        fiscalDiverge: ['ncm', 'cstPisCofins', 'aliquotaSimples'].some((c) => camposDiferentes.includes(c as never)),
        // Num grupo por código de barras, a venda não pode ser atribuída a um
        // dos cadastros — é por isso que eles são duplicata. O dinheiro é do
        // GRUPO, e cada produto aparece com 0 até alguém unificar.
        faturamento90d: Math.round(
          (motivo === 'codigo_barras'
            ? (porChave.get(chave) ?? 0)
            : saida.reduce((s, p) => s + p.faturamento90d, 0)) * 100,
        ) / 100,
        produtos: saida,
        sugestoesBase: motivo === 'sem_base' && itens[0]
          ? this.sugerirBase(itens[0], base, indiceBase, semelhancaMinima)
          : [],
      };
    };

    // 1) mesmo código de barras (ou mesmo PLU) — o caso indiscutível
    const porChaveBarras = new Map<string, LinhaProduto[]>();
    for (const p of produtos) {
      for (const chave of barcodeCandidates(p.codigoBarras)) {
        if (!chave) continue;
        porChaveBarras.set(chave, [...(porChaveBarras.get(chave) ?? []), p]);
      }
    }
    const jaAgrupado = new Set<string>();
    for (const [chave, itens] of porChaveBarras) {
      const unicos = [...new Map(itens.map((i) => [i.id, i])).values()];
      if (unicos.length < 2) continue;
      if (unicos.every((u) => jaAgrupado.has(u.id))) continue;
      unicos.forEach((u) => jaAgrupado.add(u.id));
      grupos.push(montar('codigo_barras', chave, unicos, null));
    }

    // 2) mesmo código interno na mesma loja
    const porInterno = new Map<string, LinhaProduto[]>();
    for (const p of produtos) {
      const c = (p.codigoInterno ?? '').trim();
      if (!c) continue;
      porInterno.set(c, [...(porInterno.get(c) ?? []), p]);
    }
    for (const [chave, itens] of porInterno) {
      if (itens.length < 2) continue;
      grupos.push(montar('codigo_interno', chave, itens, null));
    }

    // 3) nomes parecidos — SUGESTÃO, e por isso vem depois dos fatos
    if (produtos.length <= MAX_PRODUTOS_PARA_NOME) {
      const vistos = new Set<string>();
      for (let i = 0; i < produtos.length; i++) {
        for (let j = i + 1; j < produtos.length; j++) {
          const a = produtos[i]!;
          const b = produtos[j]!;
          if (jaAgrupado.has(a.id) && jaAgrupado.has(b.id)) continue;
          const par = `${a.id}|${b.id}`;
          if (vistos.has(par)) continue;
          const sem = Math.max(semelhanca(a.nome, b.nome), semelhanca(
            ProductRules.montarDescricao(a.nome, a.quantidade ?? 0, a.medidaBase ?? ''),
            ProductRules.montarDescricao(b.nome, b.quantidade ?? 0, b.medidaBase ?? ''),
          ));
          if (sem < semelhancaMinima) continue;
          // par que alguém já disse não ser o mesmo não volta a ser sugerido
          const [x, y] = [a.id, b.id].sort();
          if (recusados.has(`${x}|${y}`)) continue;
          vistos.add(par);
          grupos.push(montar('nome', `${a.nome} ≈ ${b.nome}`, [a, b], sem));
        }
      }
    }

    // 4) produto de loja sem BASE — caso D2: ligar, não fundir
    if (loja !== 'BASE') {
      for (const p of produtos) {
        if (p.baseProductId != null) continue;
        grupos.push(montar('sem_base', p.nome, [p], null));
      }
    }

    // ordena por dinheiro, não por semelhança: é o que faz a tela ser usada
    grupos.sort((a, b) => b.faturamento90d - a.faturamento90d);

    const conta = (m: ProductDuplicados.MotivoDuplicidade) => grupos.filter((g) => g.motivo === m).length;
    return {
      loja,
      produtosAnalisados: produtos.length,
      totais: {
        codigoBarras: conta('codigo_barras'),
        codigoInterno: conta('codigo_interno'),
        nome: conta('nome'),
        semBase: conta('sem_base'),
      },
      faturamentoEnvolvido: Math.round(
        grupos.filter((g) => g.motivo !== 'sem_base').reduce((s, g) => s + g.faturamento90d, 0) * 100,
      ) / 100,
      grupos,
    };
  }
}
