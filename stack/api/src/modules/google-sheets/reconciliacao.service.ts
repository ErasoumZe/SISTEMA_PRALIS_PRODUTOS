import { inject, injectable } from 'tsyringe';
import { credenciaisSheetsFaltando, destinoSheetsFaltando, env } from '@/config/env';
import { SHEETS_GATEWAY } from './google-sheets.di';
import { a1, indexToCol, type SheetsGateway } from './google-sheets.client';
import { colunaDoCampo, lerLeiaute, type LeiauteNovo } from './leiaute-planilha-nova';
import { normalizarCabecalho } from './sheet-traducao';
import { sanitizeError } from './product-sheet.service';
import { ReconciliacaoRepository } from './reconciliacao.repository';

/**
 * Conferência SOMENTE LEITURA entre o catálogo do banco e a planilha.
 *
 * Existe porque a sincronização falha em silêncio: `syncProduct` devolve
 * `failed`, marca o registro e segue a vida — e ninguém volta para olhar. Sem
 * uma conta que feche, banco e planilha divergem por meses sem que nada acuse.
 * Foi assim que se descobriu que 1.187 das 1.188 linhas com produto da aba nova
 * não têm `ID` nenhum.
 *
 * NADA aqui escreve. Nem na planilha, nem no banco, nem no registro de
 * sincronização: um relatório que "conserta" ao ser aberto deixa de ser
 * relatório e vira mais uma coisa mexendo no dado sem ninguém pedir.
 */

/** Linha 3 = rótulos das faixas (só a planilha nova tem), 5 = cabeçalhos. */
const LINHA_FAIXAS = 3;
const LINHA_CABECALHO = 5;
/** Primeira linha de produto. As anteriores são cabeçalho e legenda. */
const PRIMEIRA_LINHA_DADOS = 11;

/**
 * Quanto de cada lista sai na resposta. O relatório inteiro pode ter milhares
 * de itens (é exatamente o caso hoje) e a tela não tem o que fazer com isso.
 * As CONTAGENS do resumo são sempre completas — só as listas são cortadas.
 */
export const LIMITE_PADRAO = 200;
export const LIMITE_MAXIMO = 2000;

export type EstadoReconciliacao =
  | 'ok'
  | 'desligado'
  | 'sem-destino'
  | 'sem-credencial'
  | 'sem-aba'
  | 'sem-coluna'
  | 'falhou';

/** Produto do banco que não tem linha nenhuma na planilha. */
export interface ProdutoSemLinha {
  produtoId: string;
  codigo: string;
  codigoInterno: string | null;
  nome: string;
}

/** Linha com `ID` preenchido que não corresponde a produto nenhum do banco. */
export interface LinhaOrfa {
  linha: number;
  id: string;
  nome: string;
}

/** Linha com produto e sem `ID`: não há como ligá-la ao banco. */
export interface LinhaSemId {
  linha: number;
  nome: string;
}

/** Mesmo produto nos dois lados, com nome diferente. */
export interface NomeDivergente {
  produtoId: string;
  linha: number;
  nomeNoBanco: string;
  nomeNaPlanilha: string;
}

export interface ResumoReconciliacao {
  produtosNoBanco: number;
  /** Linhas da aba com nome de produto preenchido (com ou sem `ID`). */
  linhasComProduto: number;
  linhasComId: number;
  semLinhaNaPlanilha: number;
  linhasOrfas: number;
  linhasSemId: number;
  nomeDivergente: number;
  limite: number;
  /** Alguma lista foi cortada pelo limite? As contagens continuam inteiras. */
  truncado: boolean;
}

export interface RelatorioReconciliacao {
  estado: EstadoReconciliacao;
  mensagem: string;
  spreadsheetId: string;
  aba: string;
  /** Onde `ID` e nome FORAM ENCONTRADOS agora — não são posições fixas. */
  colunaId: string | null;
  colunaNome: string | null;
  resumo: ResumoReconciliacao;
  semLinhaNaPlanilha: ProdutoSemLinha[];
  linhasOrfas: LinhaOrfa[];
  linhasSemId: LinhaSemId[];
  nomeDivergente: NomeDivergente[];
}

interface LinhaDaPlanilha {
  linha: number;
  id: string;
  nome: string;
}

const texto = (v: string | undefined): string => (v ?? '').trim();

/**
 * Comparação de nome. Reaproveita a normalização dos cabeçalhos porque ela
 * resolve justamente o que atrapalha aqui: caractere de formato invisível
 * (`U+2060`, herdado da planilha e presente em quase todo grupo), espaço
 * duplicado e caixa. Sem isso "ARROZ  TIPO 1" e "Arroz Tipo 1" virariam
 * divergência, e o relatório encheria de ruído que ninguém consegue conferir.
 */
const mesmoNome = (a: string, b: string): boolean =>
  normalizarCabecalho(a) === normalizarCabecalho(b);

@injectable()
export class ReconciliacaoService {
  constructor(
    @inject(SHEETS_GATEWAY) private sheets: SheetsGateway,
    @inject(ReconciliacaoRepository) private catalogo: ReconciliacaoRepository,
  ) {}

  private get spreadsheetId(): string {
    return env.GOOGLE_SHEETS_SPREADSHEET_ID;
  }

  /**
   * A aba conferida é a MESMA em que a sincronização escreve
   * (`GOOGLE_SHEETS_BASE_TAB`). Fixar aqui o nome da aba nova seria conferir um
   * lugar diferente do que a integração usa: o relatório fecharia certinho
   * enquanto o espelho gravava em outro canto.
   */
  private get nomeDaAba(): string {
    return env.GOOGLE_SHEETS_BASE_TAB;
  }

  async reconciliar(opcoes: { limite?: number } = {}): Promise<RelatorioReconciliacao> {
    const limite = Math.min(
      Math.max(1, Math.trunc(opcoes.limite ?? LIMITE_PADRAO)),
      LIMITE_MAXIMO,
    );

    /*
     * Estado sem dado nenhum. Nunca lança: quem abre a tela precisa LER o
     * motivo, não receber um 500 que some no log do servidor.
     */
    const semDados = (
      estado: EstadoReconciliacao,
      mensagem: string,
      colunas: { colunaId?: string | null; colunaNome?: string | null } = {},
    ): RelatorioReconciliacao => ({
      estado,
      mensagem,
      spreadsheetId: this.spreadsheetId,
      aba: this.nomeDaAba,
      colunaId: colunas.colunaId ?? null,
      colunaNome: colunas.colunaNome ?? null,
      resumo: {
        produtosNoBanco: 0,
        linhasComProduto: 0,
        linhasComId: 0,
        semLinhaNaPlanilha: 0,
        linhasOrfas: 0,
        linhasSemId: 0,
        nomeDivergente: 0,
        limite,
        truncado: false,
      },
      semLinhaNaPlanilha: [],
      linhasOrfas: [],
      linhasSemId: [],
      nomeDivergente: [],
    });

    if (!env.GOOGLE_SHEETS_ENABLED) {
      return semDados(
        'desligado',
        'Integração com a planilha desligada (GOOGLE_SHEETS_ENABLED=false).',
      );
    }
    const destino = destinoSheetsFaltando();
    if (destino.length > 0) {
      return semDados(
        'sem-destino',
        `Integração ligada, mas sem destino configurado: ${destino.join(', ')}.`,
      );
    }
    // nomes de variáveis, nunca valores — mesma regra do health
    const credenciais = credenciaisSheetsFaltando();
    if (credenciais.length > 0) {
      return semDados('sem-credencial', `Sem credencial do Google: ${credenciais.join(', ')}.`);
    }

    try {
      return await this.comparar(limite, semDados);
    } catch (e) {
      return semDados('falhou', sanitizeError(e));
    }
  }

  private async comparar(
    limite: number,
    semDados: (
      estado: EstadoReconciliacao,
      mensagem: string,
      colunas?: { colunaId?: string | null; colunaNome?: string | null },
    ) => RelatorioReconciliacao,
  ): Promise<RelatorioReconciliacao> {
    const abas = await this.sheets.getSheets(this.spreadsheetId);
    const aba = abas.find((s) => s.title === this.nomeDaAba);
    if (!aba) {
      return semDados('sem-aba', `Aba "${this.nomeDaAba}" não encontrada na planilha.`);
    }

    const ultimaColuna = indexToCol(Math.max(0, aba.columnCount - 1));
    const cabecalho = await this.sheets.batchGetValues(
      this.spreadsheetId,
      [
        a1(this.nomeDaAba, `A${LINHA_FAIXAS}:${ultimaColuna}${LINHA_FAIXAS}`),
        a1(this.nomeDaAba, `A${LINHA_CABECALHO}:${ultimaColuna}${LINHA_CABECALHO}`),
      ],
      'FORMATTED_VALUE',
    );
    const leiaute: LeiauteNovo = lerLeiaute(
      (cabecalho[0] ?? [])[0] ?? [],
      (cabecalho[1] ?? [])[0] ?? [],
      indexToCol,
    );

    /*
     * As colunas são achadas por NOME de cabeçalho, sempre. Hoje o `ID` está em
     * `HT` e o nome do produto em `D`, mas inserir uma coluna à esquerda
     * desloca as duas — e um relatório lendo a letra errada acusaria a base
     * inteira como órfã, que é pior do que não ter relatório nenhum.
     */
    const colunaId = colunaDoCampo(leiaute, 'ID', indexToCol);
    /*
     * O nome do produto mudou de cabeçalho entre as duas planilhas: era `NOME`
     * na BASE antiga e é `CADASTRO PRODUTOS ATUALIZADO NOVO` na aba combinada.
     * Aceita os dois porque a env de destino pode apontar para qualquer uma.
     */
    const colunaNome = colunaDoCampo(leiaute, 'CADASTRO PRODUTOS ATUALIZADO NOVO', indexToCol)
      ?? colunaDoCampo(leiaute, 'NOME', indexToCol);

    if (!colunaId || !colunaNome) {
      const faltando = [!colunaId ? 'ID' : null, !colunaNome ? 'nome do produto' : null]
        .filter((x): x is string => x !== null);
      return semDados(
        'sem-coluna',
        `A aba "${this.nomeDaAba}" não tem cabeçalho de ${faltando.join(' nem de ')} `
        + `na linha ${LINHA_CABECALHO}; sem isso não há como ligar linha e produto.`,
        { colunaId, colunaNome },
      );
    }

    // a leitura da planilha e a do banco não dependem uma da outra
    const [valores, produtos] = await Promise.all([
      this.sheets.batchGetValues(
        this.spreadsheetId,
        [
          a1(this.nomeDaAba, `${colunaId}${PRIMEIRA_LINHA_DADOS}:${colunaId}`),
          a1(this.nomeDaAba, `${colunaNome}${PRIMEIRA_LINHA_DADOS}:${colunaNome}`),
        ],
        'FORMATTED_VALUE',
      ),
      this.catalogo.listarBase(),
    ]);

    const ids = valores[0] ?? [];
    const nomes = valores[1] ?? [];
    /*
     * As duas colunas voltam com alturas DIFERENTES: o Sheets corta as células
     * vazias do fim de cada uma, e a de `ID` está quase toda vazia. Percorrer
     * pela menor esconderia exatamente as linhas sem ID, que são o achado.
     */
    const alturaLida = Math.max(ids.length, nomes.length);

    const linhas: LinhaDaPlanilha[] = [];
    for (let i = 0; i < alturaLida; i++) {
      const id = texto(ids[i]?.[0]);
      const nome = texto(nomes[i]?.[0]);
      if (id === '' && nome === '') continue; // buraco no meio da aba, não é divergência
      linhas.push({ linha: PRIMEIRA_LINHA_DADOS + i, id, nome });
    }

    /*
     * ID repetido fica com a PRIMEIRA linha. Casar o produto com as duas faria
     * a conta de "sem linha" fechar errado; a repetida cai em órfã apenas se o
     * ID dela não existir no banco, que é o comportamento certo.
     */
    const linhaPorId = new Map<string, LinhaDaPlanilha>();
    for (const l of linhas) {
      if (l.id !== '' && !linhaPorId.has(l.id)) linhaPorId.set(l.id, l);
    }
    const idsNoBanco = new Set(produtos.map((p) => p.id));

    const semLinha: ProdutoSemLinha[] = [];
    const divergentes: NomeDivergente[] = [];
    for (const p of produtos) {
      const linha = linhaPorId.get(p.id);
      if (!linha) {
        semLinha.push({
          produtoId: p.id,
          codigo: p.codigo,
          codigoInterno: p.codigoInterno,
          nome: p.nome,
        });
        continue;
      }
      if (!mesmoNome(p.nome, linha.nome)) {
        divergentes.push({
          produtoId: p.id,
          linha: linha.linha,
          nomeNoBanco: p.nome,
          nomeNaPlanilha: linha.nome,
        });
      }
    }

    const orfas: LinhaOrfa[] = linhas
      .filter((l) => l.id !== '' && !idsNoBanco.has(l.id))
      .map((l) => ({ linha: l.linha, id: l.id, nome: l.nome }));

    // linha sem ID E sem nome já foi descartada acima: aqui é produto mesmo
    const semId: LinhaSemId[] = linhas
      .filter((l) => l.id === '')
      .map((l) => ({ linha: l.linha, nome: l.nome }));

    const truncado = [semLinha, orfas, semId, divergentes].some((l) => l.length > limite);

    return {
      estado: 'ok',
      mensagem: this.frase(
        produtos.length, semLinha.length, orfas.length, semId.length, divergentes.length,
      ),
      spreadsheetId: this.spreadsheetId,
      aba: this.nomeDaAba,
      colunaId,
      colunaNome,
      resumo: {
        produtosNoBanco: produtos.length,
        linhasComProduto: linhas.filter((l) => l.nome !== '').length,
        linhasComId: linhaPorId.size,
        semLinhaNaPlanilha: semLinha.length,
        linhasOrfas: orfas.length,
        linhasSemId: semId.length,
        nomeDivergente: divergentes.length,
        limite,
        truncado,
      },
      semLinhaNaPlanilha: semLinha.slice(0, limite),
      linhasOrfas: orfas.slice(0, limite),
      linhasSemId: semId.slice(0, limite),
      nomeDivergente: divergentes.slice(0, limite),
    };
  }

  /** Uma frase que já responde "está tudo certo?" sem precisar abrir as listas. */
  private frase(
    produtos: number,
    semLinha: number,
    orfas: number,
    semId: number,
    divergentes: number,
  ): string {
    const total = semLinha + orfas + semId + divergentes;
    if (total === 0) {
      return `Banco e planilha conferem: ${produtos} produto(s) da BASE, nenhuma divergência.`;
    }
    return `${total} divergência(s) entre o banco (${produtos} produto(s) da BASE) e a planilha.`;
  }
}
