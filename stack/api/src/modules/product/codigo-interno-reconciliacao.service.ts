import { inject, injectable } from 'tsyringe';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { CurrentUser } from '@/types/fastify-jwt';
import { db } from '@/db/databases';
import { ProductSheetService } from '@/modules/google-sheets/product-sheet.service';
import { ProductSheetLojaService } from '@/modules/google-sheets/product-sheet-loja.service';
import { products, productCodigoInternoHistory } from './product.table';
import { ProductRepository } from './product.repository';
import catalogo from './compilart-li.catalogo.json';

type Linha = { id: string; loja: string; nome: string; ean: string | null; codigo: string | null; baseProductId: string | null };
type Mudanca = Linha & { novo: string; fonte: string };

const soDigitos = (v: unknown) => String(v ?? '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');
const codigo = (v: unknown) => soDigitos(v).padStart(5, '0');
const CONFIRMACAO = 'RECONCILIAR CODIGOS LI';

@injectable()
export class CodigoInternoReconciliacaoService {
  static readonly CONFIRMACAO = CONFIRMACAO;

  constructor(
    @inject(ProductRepository) private repo: ProductRepository,
    @inject(ProductSheetService) private sheets: ProductSheetService,
    @inject(ProductSheetLojaService) private sheetsLoja: ProductSheetLojaService,
  ) {}

  private async plano() {
    const rows = await db.select({
      id: products.id, loja: products.loja, nome: products.nome, ean: products.codigoBarras,
      codigo: products.codigoInterno, baseProductId: products.baseProductId,
    }).from(products).where(inArray(products.loja, ['LI', 'TNP']));

    const porEan = new Map<string, Set<string>>();
    for (const item of catalogo) {
      const ean = soDigitos(item.ean);
      if (!ean) continue;
      const set = porEan.get(ean) ?? new Set<string>();
      set.add(codigo(item.codigo));
      porEan.set(ean, set);
    }

    const candidatos: Mudanca[] = [];
    let ambiguosCatalogo = 0;
    let semCorrespondencia = 0;
    for (const row of rows as Linha[]) {
      const ean = soDigitos(row.ean);
      if (row.loja === 'TNP') {
        if (ean === '7891095911486') candidatos.push({ ...row, novo: '01326', fonte: 'TNP: reserva confirmada após legado 01325' });
        continue;
      }
      const destinos = porEan.get(ean);
      if (!destinos) { semCorrespondencia += 1; continue; }
      if (destinos.size !== 1) { ambiguosCatalogo += 1; continue; }
      candidatos.push({ ...row, novo: [...destinos][0]!, fonte: 'Compilart LI 2026-09-18 (EAN exato)' });
    }

    const porDestino = new Map<string, Mudanca[]>();
    for (const c of candidatos) {
      const chave = `${c.loja}:${c.novo}`;
      porDestino.set(chave, [...(porDestino.get(chave) ?? []), c]);
    }
    const duplicadosSistema = new Set(
      [...porDestino.entries()].filter(([, itens]) => itens.length > 1).map(([chave]) => chave),
    );
    const atualPorLojaCodigo = new Map(rows.map((r) => [`${r.loja}:${codigo(r.codigo)}`, r]));
    const preliminares = candidatos.filter((c) => !duplicadosSistema.has(`${c.loja}:${c.novo}`));
    const idsPreliminares = new Set(preliminares.map((c) => c.id));
    let colisoes = 0;
    const aptos = preliminares.filter((c) => {
      const dono = atualPorLojaCodigo.get(`${c.loja}:${c.novo}`);
      const ok = !dono || dono.id === c.id || idsPreliminares.has(dono.id);
      if (!ok) colisoes += 1;
      return ok;
    });
    const mudancas = aptos.filter((c) => codigo(c.codigo) !== c.novo);
    return {
      totalLi: rows.filter((r) => r.loja === 'LI').length,
      totalTnp: rows.filter((r) => r.loja === 'TNP').length,
      exatos: candidatos.length,
      aptos: aptos.length,
      alteracoes: mudancas.length,
      jaCorretos: aptos.length - mudancas.length,
      bloqueadosDuplicidade: candidatos.length - preliminares.length,
      ambiguosCatalogo,
      semCorrespondencia,
      colisoes,
      amostra: mudancas.slice(0, 20).map((m) => ({ id: m.id, loja: m.loja, nome: m.nome, de: codigo(m.codigo), para: m.novo })),
      mudancas,
    };
  }

  async previa() {
    const { mudancas: _mudancas, ...resumo } = await this.plano();
    return { ...resumo, confirmacao: CONFIRMACAO };
  }

  async aplicar(user: CurrentUser, confirmacao: string) {
    if (confirmacao.trim().toUpperCase() !== CONFIRMACAO) throw new Error('Frase de confirmação inválida.');
    const plano = await this.plano();
    if (plano.mudancas.length === 0) return { ...await this.previa(), aplicadas: 0, planilha: 'sem-alteracao' };
    await db.transaction(async (tx) => {
      for (const m of plano.mudancas) {
        await tx.insert(productCodigoInternoHistory).values({
          productId: m.id, loja: m.loja, codigoAnterior: m.codigo, codigoNovo: m.novo,
          fonte: m.fonte, alteradoPorUserId: user.id, alteradoPorNome: user.name,
        });
        await tx.update(products).set({ codigoInterno: m.novo }).where(and(
          eq(products.id, m.id),
          m.codigo == null ? isNull(products.codigoInterno) : eq(products.codigoInterno, m.codigo),
        ));
      }
    });

    let falhasPlanilha = 0;
    for (let i = 0; i < plano.mudancas.length; i += 25) {
      const lote = await Promise.all(plano.mudancas.slice(i, i + 25).map((m) => this.repo.findById(m.id)));
      const produtos = lote.filter((p): p is NonNullable<typeof p> => !!p);
      const resultados = await this.sheets.syncStoreProducts(produtos);
      falhasPlanilha += resultados.filter((r) => r.outcome === 'failed' || r.outcome === 'misconfigured').length;
      const itens = produtos.flatMap((produto, j) => {
        const linha = resultados[j]?.rowNumber;
        return linha == null ? [] : [{ produto, linha }];
      });
      if (itens.length && await this.sheetsLoja.espelharNasAbasDeLoja(itens) === 'falhou') falhasPlanilha += itens.length;
    }
    const { mudancas: _mudancas, ...resumo } = plano;
    return { ...resumo, aplicadas: plano.mudancas.length, planilha: falhasPlanilha ? 'parcial' : 'sincronizada', falhasPlanilha };
  }
}
