import { inject, injectable } from 'tsyringe';
import { eq, sql } from 'drizzle-orm';
import { customAlphabet } from 'nanoid';
import { db } from '@/db/databases';
import { AppError } from '@/config/api.replies';
import type { CurrentUser } from '@/types/fastify-jwt';
import { products, productFiscal } from './product.table';
import { CargaBasePlanilhaService, type EstadoCarga, type ColunaTrocada } from './carga-base.planilha';
import {
  FISCAL_ZERADO, planejarCarga, type DecisaoCarga, type MotivoRecusa, type ProdutoDaCarga, type ResumoCarga,
} from './carga-base.motor';

/**
 * CARGA DA BASE — põe no sistema todos os produtos da planilha.
 *
 * Três decisões moldam este serviço, e as três são do José em 25/09/2026:
 *
 * 1. **Todos os produtos, iguais à planilha.** Nada de amostra, nada de lote
 *    que deixa resto. Ativo entra ativo, inativo entra inativo.
 * 2. **A Base é zerada antes.** É uma carga, não uma fusão: o que está lá sai,
 *    e entra o que a planilha diz. Só a loja `BASE` é apagada; o cadastro
 *    próprio de TNP e LI não é tocado.
 * 3. **O fiscal entra zerado**, com a largura que o TXT do Creare exige.
 *
 * ### O espelho fica DESLIGADO aqui, e isso não é detalhe
 *
 * Todo cadastro normal chama `ProductSheetService.registerPending`, que
 * enfileira a linha para ser escrita de volta na planilha. Só que
 * `GOOGLE_SHEETS_BASE_TAB` é **a mesma aba que esta carga lê**. Espelhar aqui
 * devolveria 7.369 linhas para dentro da fonte, duplicando a planilha inteira
 * na primeira execução. Então a carga grava só no banco. Quem veio da planilha
 * não precisa voltar para ela.
 *
 * ### Uma transação só
 *
 * Os 7.369 produtos entram num `INSERT` em blocos dentro de UMA transação. Ou
 * a Base inteira fica de pé, ou nada muda — que é o que "não pode haver erros"
 * exige. Produto a produto, uma falha na linha 6.000 deixaria meia Base no ar,
 * sem ninguém saber onde parou.
 */

/** Mesmo alfabeto e formato da Central: sem caracteres que se confundem lendo. */
const rand4 = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 4);

export const CONFIRMACAO_CARGA = 'ZERAR A BASE E IMPORTAR A PLANILHA';

/** Quantas linhas por `INSERT`. Postgres tem teto de parâmetros por comando. */
const BLOCO = 500;

export interface PreviaCarga {
  estado: EstadoCarga;
  erro?: string;
  /** Colunas cujo título saiu do lugar. Havendo uma, a carga não roda. */
  trocadas: ColunaTrocada[];
  truncada: boolean;
  linhasLidas: number;
  linhasSemNome: number;
  importar: number;
  ativos: number;
  inativos: number;
  comBarras: number;
  recusas: Record<MotivoRecusa, number>;
  /** As recusadas, todas: com zero recusa a lista vem vazia e a tela diz isso. */
  recusadas: DecisaoCarga[];
  barrasRepetidas: ResumoCarga['barrasRepetidas'];
  porGrupo: ResumoCarga['porGrupo'];
  /** Quantos produtos da Base seriam apagados antes de entrar os novos. */
  apagar: number;
  /** Amostra do que entraria, para conferir campo a campo antes de mandar. */
  amostra: ProdutoDaCarga[];
  confirmacao: string;
}

export interface ResultadoCarga {
  apagados: number;
  criados: number;
  ativos: number;
  inativos: number;
}

@injectable()
export class CargaBaseService {
  constructor(@inject(CargaBasePlanilhaService) private planilha: CargaBasePlanilhaService) {}

  private async planejar() {
    const leitura = await this.planilha.ler();
    if (leitura.estado !== 'ok') return { leitura, plano: null };
    return { leitura, plano: planejarCarga(leitura.linhas) };
  }

  private async quantosNaBase(): Promise<number> {
    const r = await db.select({ n: sql<number>`count(*)::int` }).from(products).where(eq(products.loja, 'BASE'));
    return Number(r[0]?.n ?? 0);
  }

  async previa(): Promise<PreviaCarga> {
    const { leitura, plano } = await this.planejar();
    const semRecusa: Record<MotivoRecusa, number> = {
      'codigo-invalido': 0, 'codigo-repetido-na-planilha': 0, 'sem-nome': 0,
      'situacao-desconhecida': 0, 'unidade-desconhecida': 0, 'sem-id-de-grupo': 0,
    };
    return {
      estado: leitura.estado,
      erro: leitura.erro,
      trocadas: leitura.trocadas,
      truncada: leitura.truncada,
      linhasLidas: leitura.linhas.length,
      linhasSemNome: leitura.descartadas,
      importar: plano?.importar ?? 0,
      ativos: plano?.ativos ?? 0,
      inativos: plano?.inativos ?? 0,
      comBarras: plano?.comBarras ?? 0,
      recusas: plano?.recusas ?? semRecusa,
      recusadas: (plano?.decisoes ?? []).filter((d) => d.acao === 'recusar'),
      barrasRepetidas: plano?.barrasRepetidas ?? [],
      porGrupo: plano?.porGrupo ?? [],
      apagar: await this.quantosNaBase(),
      amostra: (plano?.decisoes ?? []).filter((d) => d.acao === 'importar').slice(0, 20).map((d) => d.produto!),
      confirmacao: CONFIRMACAO_CARGA,
    };
  }

  /**
   * Zera a Base e cria todos os produtos da planilha.
   *
   * A planilha é lida DE NOVO aqui, e não reaproveitada da prévia: entre ver a
   * prévia e confirmar podem passar minutos, e a planilha é editada ao vivo.
   * Importar o que a prévia mostrou seria importar o passado.
   */
  async importar(user: CurrentUser, confirmacao: string): Promise<ResultadoCarga> {
    if (confirmacao.trim().toUpperCase() !== CONFIRMACAO_CARGA) {
      throw new AppError(`Frase de confirmação inválida. Digite "${CONFIRMACAO_CARGA}" para carregar a Base.`, 400);
    }
    const { leitura, plano } = await this.planejar();
    if (leitura.estado === 'coluna-mudou') {
      const quais = leitura.trocadas.map((t) => `${t.coluna} (esperava "${t.esperado}", achou "${t.encontrado}")`).join('; ');
      throw new AppError(`A planilha mudou de forma e nada foi importado. Confira: ${quais}`, 409);
    }
    if (leitura.estado !== 'ok' || !plano) {
      throw new AppError('A planilha não pôde ser lida agora; nada foi alterado.', 503);
    }
    if (plano.importar === 0) {
      throw new AppError('A planilha não trouxe nenhum produto que possa entrar; nada foi alterado.', 409);
    }

    const novos = plano.decisoes.filter((d) => d.acao === 'importar').map((d) => d.produto!);

    return db.transaction(async (tx) => {
      const apagados = await tx.delete(products).where(eq(products.loja, 'BASE')).returning({ id: products.id });

      const linhas = novos.map((p) => ({
        loja: 'BASE',
        codigo: `PR-${rand4()}-${rand4()}`,
        codigoInterno: p.codigoInterno,
        nome: p.nome,
        codigoBarras: p.codigoBarras,
        medidaBase: p.medidaBase,
        tipo: p.tipo,
        status: p.status,
        grupo: p.grupo,
        grupoId: p.grupoId,
        estoqueMin: p.estoqueMin === null ? null : String(p.estoqueMin),
        estoqueMax: p.estoqueMax === null ? null : String(p.estoqueMax),
        custo: p.custo === null ? null : String(p.custo),
        vVendaPontual: p.precoVenda === null ? null : String(p.precoVenda),
        createdByUserId: user.id,
        createdByName: user.name,
      }));

      const criados: string[] = [];
      for (let i = 0; i < linhas.length; i += BLOCO) {
        const parte = await tx.insert(products).values(linhas.slice(i, i + BLOCO)).returning({ id: products.id });
        for (const p of parte) criados.push(p.id);
      }

      /*
       * O fiscal zerado entra para TODOS, no mesmo passo. Produto sem linha
       * fiscal nenhuma é derrubado pelo gerador do Creare com "Dados fiscais
       * ausentes" — e aí a carga teria sido inútil para o que ela existe.
       */
      const fiscais = criados.map((productId) => ({
        productId,
        ncm: FISCAL_ZERADO.ncm,
        cest: FISCAL_ZERADO.cest,
        cstPisCofins: FISCAL_ZERADO.cstPisCofins,
        aliquotaEcfId: FISCAL_ZERADO.aliquotaEcfId,
        aliquotaCheia: String(FISCAL_ZERADO.aliquotaCheia),
        aliquotaFcp: String(FISCAL_ZERADO.aliquotaFcp),
        aliquotaPis: String(FISCAL_ZERADO.aliquotaPis),
        aliquotaCofins: String(FISCAL_ZERADO.aliquotaCofins),
        reducaoIcms: String(FISCAL_ZERADO.reducaoIcms),
        icms: String(FISCAL_ZERADO.icms),
        categoria: FISCAL_ZERADO.categoria,
        aliquotaEcf: FISCAL_ZERADO.aliquotaEcf,
        estado: FISCAL_ZERADO.estado,
        motivo: FISCAL_ZERADO.motivo,
      }));
      for (let i = 0; i < fiscais.length; i += BLOCO) {
        await tx.insert(productFiscal).values(fiscais.slice(i, i + BLOCO));
      }

      return {
        apagados: apagados.length,
        criados: criados.length,
        ativos: plano.ativos,
        inativos: plano.inativos,
      };
    });
  }
}
