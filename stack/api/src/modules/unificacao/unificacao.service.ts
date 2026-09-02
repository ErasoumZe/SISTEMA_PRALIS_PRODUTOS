import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inject, injectable } from 'tsyringe';
import { sql } from 'drizzle-orm';
import { ProductEnums } from '@pralis/shared';
import { db } from '@/db/databases';
import { env } from '@/config/env';
import { AppError } from '@/config/api.replies';
import { ProductRepository } from '@/modules/product/product.repository';
import { unifFonteProduto } from './unificacao.table';
import {
  ARQUIVOS,
  barrasAmbiguas,
  chaveDeBarras,
  lerFonte,
  normalizarNome,
  type Fonte,
  type LinhaFonte,
} from './unificacao.fontes';

export interface ResumoFonte {
  fonte: Fonte;
  linhas: number;
  comBarras: number;
  semBarras: number;
  ativos: number;
  inativos: number;
  semStatus: number;
  /** Códigos de barras que cobrem produtos diferentes DENTRO da mesma fonte. */
  barrasConflitantes: Array<{ chave: string; nomes: string[] }>;
}

export interface UnificacaoHealth {
  carregado: boolean;
  carregadoEm: string | null;
  total: number;
  fontes: ResumoFonte[];
}

const LOTE = 500;

@injectable()
export class UnificacaoService {
  constructor(@inject(ProductRepository) private products: ProductRepository) {}

  /** Pasta das fontes. Configurável para o container achar os CSVs no deploy. */
  private pastaFontes(): string {
    return env.UNIFICACAO_FONTES_DIR || resolve(process.cwd(), '../../docs');
  }

  /**
   * A base viva do Pralis entra no staging como mais uma fonte, para a tela
   * conseguir dizer "isto já existe" sem consultar dois lugares.
   *
   * Reusa o `list` do repositório uma vez por catálogo — mesmo caminho já
   * testado da listagem, e herda a regra de que cadastro aposentado por
   * unificação não é mais um produto.
   */
  private async lerPralis(): Promise<LinhaFonte[]> {
    const porLoja = await Promise.all(
      ProductEnums.catalogo.options.map((loja) => this.products.list(loja, {})),
    );
    return porLoja.flat().map((p) => ({
      fonte: 'pralis' as const,
      codInterno: p.codigoInterno ?? '',
      codBarras: p.codigoBarras ?? '',
      chaveBarras: chaveDeBarras(p.codigoBarras),
      nome: p.nome,
      nomeNormalizado: normalizarNome(p.nome),
      ativo: p.status === 'ativo',
      custo: p.custo,
      venda: p.vVendaPontual,
      ncm: p.fiscal?.ncm ?? null,
      cst: p.fiscal?.cstPisCofins ?? null,
      csosn: null,
      aliqEcf: null,
      reducao: p.fiscal?.reducaoIcms ?? null,
      aliqInterna: p.fiscal?.icms ?? null,
      icmsEfetivo: null,
      raw: { id: p.id, loja: p.loja, codigo: p.codigo, grupo: p.grupo ?? '' },
    }));
  }

  private lerArquivo(fonte: Exclude<Fonte, 'pralis'>): LinhaFonte[] {
    const caminho = resolve(this.pastaFontes(), ARQUIVOS[fonte]);
    try {
      return lerFonte(fonte, readFileSync(caminho, 'utf8'));
    } catch {
      throw new AppError(
        `Arquivo da fonte "${fonte}" não encontrado em ${caminho}.`,
        503,
        'UNIFICACAO_FONTE_AUSENTE',
      );
    }
  }

  /**
   * Apaga e recarrega TUDO. Rodar de novo dá o mesmo estado — é retrato, não
   * histórico. Nada aqui encosta na tabela `products`.
   */
  async carregar(): Promise<UnificacaoHealth> {
    const doArquivo = (Object.keys(ARQUIVOS) as Array<Exclude<Fonte, 'pralis'>>)
      .flatMap((fonte) => this.lerArquivo(fonte));
    const todas = [...doArquivo, ...(await this.lerPralis())];

    await db.transaction(async (tx) => {
      await tx.execute(sql`DELETE FROM unif_fonte_produto`);
      for (let i = 0; i < todas.length; i += LOTE) {
        await tx.insert(unifFonteProduto).values(
          todas.slice(i, i + LOTE).map((l) => ({
            fonte: l.fonte,
            codInterno: l.codInterno,
            codBarras: l.codBarras,
            chaveBarras: l.chaveBarras,
            nome: l.nome,
            nomeNormalizado: l.nomeNormalizado,
            ativo: l.ativo,
            custo: l.custo == null ? null : String(l.custo),
            venda: l.venda == null ? null : String(l.venda),
            ncm: l.ncm,
            cst: l.cst,
            csosn: l.csosn,
            aliqEcf: l.aliqEcf,
            reducao: l.reducao == null ? null : String(l.reducao),
            aliqInterna: l.aliqInterna == null ? null : String(l.aliqInterna),
            icmsEfetivo: l.icmsEfetivo == null ? null : String(l.icmsEfetivo),
            raw: l.raw,
          })),
        );
      }
    });

    return this.health();
  }

  async health(): Promise<UnificacaoHealth> {
    const linhas = await db
      .select({
        fonte: unifFonteProduto.fonte,
        chaveBarras: unifFonteProduto.chaveBarras,
        nome: unifFonteProduto.nome,
        ativo: unifFonteProduto.ativo,
        carregadoEm: unifFonteProduto.carregadoEm,
      })
      .from(unifFonteProduto);

    const porFonte = new Map<Fonte, typeof linhas>();
    for (const l of linhas) {
      const f = l.fonte as Fonte;
      porFonte.set(f, [...(porFonte.get(f) ?? []), l]);
    }

    const fontes: ResumoFonte[] = [...porFonte.entries()].map(([fonte, ls]) => ({
      fonte,
      linhas: ls.length,
      comBarras: ls.filter((l) => l.chaveBarras !== '').length,
      semBarras: ls.filter((l) => l.chaveBarras === '').length,
      ativos: ls.filter((l) => l.ativo === true).length,
      inativos: ls.filter((l) => l.ativo === false).length,
      semStatus: ls.filter((l) => l.ativo == null).length,
      barrasConflitantes: barrasAmbiguas(
        ls.map((l) => ({ chaveBarras: l.chaveBarras, nome: l.nome }) as LinhaFonte),
      ),
    })).sort((a, b) => a.fonte.localeCompare(b.fonte));

    return {
      carregado: linhas.length > 0,
      carregadoEm: linhas[0]?.carregadoEm?.toISOString() ?? null,
      total: linhas.length,
      fontes,
    };
  }
}
