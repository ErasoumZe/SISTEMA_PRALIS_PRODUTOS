import { inject, injectable } from 'tsyringe';
import { AppError } from '@/config/api.replies';
import type { CurrentUser } from '@/types/fastify-jwt';
import { ProductSheetService } from '@/modules/google-sheets/product-sheet.service';
import { CodigoCadastroPlanilhaService, type EstadoMix } from './codigo-cadastro.planilha';
import { CodigoCadastroRepository, type CodigoCadastroRepo } from './codigo-cadastro.repository';
import { ProductRepository } from './product.repository';
import { customAlphabet } from 'nanoid';
import { planejarImportacao, type DecisaoImportacao, type MotivoPulo, type ProdutoNovo } from './importar-mix.motor';

/** Mesmo alfabeto e formato da Central: sem caracteres que se confundem lendo. */
const rand4 = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 4);
const genCodigo = () => `PR-${rand4()}-${rand4()}`;

/**
 * Importa para a Base os produtos que existem na planilha MIX e não no sistema.
 *
 * Duas coisas moldam este serviço:
 *
 * 1. **Nunca inventar valor.** Campo que a planilha não traz entra vazio; linha
 *    sem o mínimo para ser produto não entra. Quem decide o que é "mínimo" é o
 *    motor, e cada recusa aparece no relatório com o motivo.
 * 2. **O fiscal não vem daqui.** Quem preenche fiscal é o `BackfillFiscalService`,
 *    pela fonte que já foi aprovada (ECF/SIA). Trazer alíquota da MIX criaria
 *    uma segunda fonte de verdade no campo de maior consequência do cadastro.
 */
export const CONFIRMACAO_IMPORTAR_MIX = 'IMPORTAR PRODUTOS DA PLANILHA';

/**
 * Teto por chamada. São ~2.700 produtos a criar; uma requisição só levaria
 * minutos e, se o navegador desistisse no meio, ninguém saberia onde parou.
 */
export const LOTE_IMPORTACAO = 100;

export interface PreviaImportacao {
  estado: EstadoMix;
  /** A planilha encheu a janela lida — pode haver produto além dela. */
  truncada: boolean;
  faltando: string[];
  erro?: string;
  linhasLidas: number;
  linhasDescartadas: number;
  importar: number;
  pular: Record<MotivoPulo, number>;
  /** Uma amostra do que entraria, para conferir antes de mandar. */
  amostra: DecisaoImportacao[];
  confirmacao: string;
  loteMaximo: number;
}

@injectable()
export class ImportarMixService {
  constructor(
    @inject(CodigoCadastroPlanilhaService) private planilha: CodigoCadastroPlanilhaService,
    @inject(CodigoCadastroRepository) private codigos: CodigoCadastroRepo,
    @inject(ProductRepository) private produtos: ProductRepository,
    @inject(ProductSheetService) private sheets: ProductSheetService,
  ) {}

  private async planejar() {
    const leitura = await this.planilha.ler();
    if (leitura.estado !== 'ok') return { leitura, plano: null };
    /*
     * Compara contra TODO o cadastro vivo, não só contra a Base: um produto que
     * hoje só existe como órfão de loja já ocupa aquele código e aquele código
     * de barras. Importar de novo criaria o duplicado que a Central existe para
     * desfazer.
     */
    const existentes = await this.codigos.listarProdutos();
    return { leitura, plano: planejarImportacao(leitura.linhas, existentes) };
  }

  async previa(): Promise<PreviaImportacao> {
    const { leitura, plano } = await this.planejar();
    const vazio = {
      'codigo-invalido': 0, 'codigo-repetido-na-planilha': 0, 'sem-nome': 0,
      'unidade-desconhecida': 0, 'tipo-desconhecido': 0, 'ja-existe-por-codigo': 0, 'ja-existe-por-barras': 0,
      'barras-repetida-na-planilha': 0,
    };
    return {
      estado: leitura.estado,
      truncada: leitura.truncada,
      faltando: leitura.faltando,
      erro: leitura.erro,
      linhasLidas: leitura.linhas.length,
      linhasDescartadas: leitura.descartadas,
      importar: plano?.importar ?? 0,
      pular: plano?.pular ?? vazio,
      amostra: (plano?.decisoes ?? []).filter((d) => d.acao === 'importar').slice(0, 25),
      confirmacao: CONFIRMACAO_IMPORTAR_MIX,
      loteMaximo: LOTE_IMPORTACAO,
    };
  }

  /**
   * Cria os produtos, em lote limitado.
   *
   * Um produto por transação, pelo mesmo caminho da Central
   * (`ProductRepository.create` + `registerPending`): assim o espelho da
   * planilha oficial é enfileirado dentro da transação de criação, como em todo
   * cadastro normal. Falha num produto não derruba os outros — ela é contada e
   * devolvida, porque parar tudo por causa de uma linha ruim faria o operador
   * recomeçar do zero.
   */
  async importar(user: CurrentUser, confirmacao: string) {
    if (confirmacao.trim().toUpperCase() !== CONFIRMACAO_IMPORTAR_MIX) {
      throw new AppError(`Frase de confirmação inválida. Digite "${CONFIRMACAO_IMPORTAR_MIX}" para importar.`, 400);
    }
    const { leitura, plano } = await this.planejar();
    if (leitura.estado !== 'ok' || !plano) {
      throw new AppError('A planilha MIX não pôde ser lida agora; nada foi criado.', 503);
    }

    const aCriar = plano.decisoes.filter((d) => d.acao === 'importar').slice(0, LOTE_IMPORTACAO);
    const criados: string[] = [];
    const falhas: Array<{ linha: number; codigo: string; erro: string }> = [];

    for (const decisao of aCriar) {
      try {
        const produto = await this.criar(user, decisao.produto!);
        criados.push(produto);
      } catch (e: unknown) {
        falhas.push({
          linha: decisao.linha,
          codigo: decisao.codigo,
          erro: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return {
      criados: criados.length,
      falhas,
      restantes: Math.max(0, plano.importar - aCriar.length),
    };
  }

  private async criar(user: CurrentUser, novo: ProdutoNovo): Promise<string> {
    const codigo = await this.novoCodigo();
    const criado = await this.produtos.create(
      {
        nome: novo.nome,
        codigoBarras: novo.codigoBarras,
        medidaBase: novo.medidaBase,
        tipo: novo.tipo,
        status: novo.status,
        grupo: novo.grupo,
        marca: novo.marca,
        embalagem: novo.embalagem,
        setorEstoque: novo.setorEstoque,
        estoqueMin: novo.estoqueMin,
        estoqueMax: novo.estoqueMax,
        custo: novo.custo,
        ...(novo.qtCad === null ? {} : { qtCad: novo.qtCad }),
      } as never,
      {
        loja: 'BASE',
        codigo,
        // o código de cadastro vem da planilha, não da sequência interna
        codigoInterno: novo.codigoInterno,
        createdByUserId: user.id,
        createdByName: user.name,
      },
      (productId, tx) => this.sheets.registerPending(productId, tx),
    );
    return criado.id;
  }

  /** Mesmo formato e mesma tentativa da Central (`PR-XXXX-XXXX`). */
  private async novoCodigo(): Promise<string> {
    let codigo = genCodigo();
    for (let i = 0; i < 5 && (await this.produtos.findByCodigo(codigo)); i += 1) codigo = genCodigo();
    return codigo;
  }
}
