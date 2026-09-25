/**
 * O catálogo de telas do sistema — fonte ÚNICA para menu, guarda de rota e
 * permissão.
 *
 * Antes isto existia em três lugares que discordavam entre si: o menu em
 * `layouts/default.vue` escondia 5 itens por `isAdmin`, a guarda de rota em
 * `auth.global.ts` protegia 4 caminhos, e o servidor tinha `exigirAdmin`
 * copiado em 25 controllers. O resultado era tela sem guarda nenhuma — quem
 * soubesse a URL entrava em `/produtos/manutencao` ("ações que não têm volta").
 *
 * Uma tela só existe se estiver aqui. Quem não está nesta lista não aparece no
 * menu, não é protegida e não pode ser liberada — e é isso que torna a lista
 * confiável.
 */

/** Onde a tela aparece no menu. A ordem das seções é a ordem deste array. */
export const SECOES = ['Geral', 'Catálogo', 'Vendas', 'Administração'] as const;
export type Secao = (typeof SECOES)[number];

export interface Tela {
  id: string;
  titulo: string;
  /** Linha de apoio no cabeçalho da página. */
  subtitulo: string;
  path: string;
  secao: Secao;
  /** Ícone do Material Symbols, o mesmo conjunto que o menu já usa. */
  icone: string;
  /**
   * Some do menu, mas continua existindo e protegida.
   *
   * É para tela que se alcança por dentro de outra (um cartão, um link), não
   * por navegação: pôr todas no menu faria a lista deixar de ser lida.
   */
  foraDoMenu?: boolean;
  /**
   * Não pode ser desligada de ninguém.
   *
   * Sem isto, desligar "Produtos" de alguém deixaria a pessoa logada numa
   * conta sem nenhuma tela — sem nem uma página para onde ir.
   */
  sempreLiberada?: boolean;
}

export const TELAS: readonly Tela[] = [
  {
    id: 'produtos',
    titulo: 'Produtos',
    subtitulo: 'Gerencie todos os produtos cadastrados',
    path: '/',
    secao: 'Geral',
    icone: 'inventory_2',
    sempreLiberada: true,
  },
  {
    id: 'importar-da-base',
    titulo: 'Importar da base',
    subtitulo: 'Traga para a sua loja o que já existe no cadastro geral',
    path: '/importar',
    secao: 'Geral',
    icone: 'download',
  },
  {
    id: 'codigo-cadastro',
    titulo: 'Código de cadastro',
    subtitulo: 'A numeração vem do PDV',
    path: '/produtos/codigo-cadastro',
    secao: 'Catálogo',
    icone: 'pin',
    /*
     * Fora do menu por decisão do José em 23/09/2026: o trabalho de alinhar a
     * numeração com o PDV terminou. A TELA continua inteira e sob permissão —
     * some do menu, não do sistema —, porque apagá-la levaria junto o caminho
     * de volta se a rede renumerar.
     */
    foraDoMenu: true,
  },
  {
    id: 'importar-mix',
    titulo: 'Importar da planilha',
    subtitulo: 'Refaz a Base com todos os produtos da planilha',
    path: '/produtos/importar-mix',
    secao: 'Catálogo',
    icone: 'upload_file',
  },
  {
    id: 'depara-sia',
    titulo: 'De-para do SIA',
    subtitulo: 'A régua da numeração da rede',
    path: '/produtos/depara-sia',
    secao: 'Catálogo',
    icone: 'rule',
    /*
     * Fora do menu por decisão do José em 23/09/2026: o trabalho de alinhar a
     * numeração com o PDV terminou. A TELA continua inteira e sob permissão —
     * some do menu, não do sistema —, porque apagá-la levaria junto o caminho
     * de volta se a rede renumerar.
     */
    foraDoMenu: true,
  },
  {
    id: 'custo-discriminacao',
    titulo: 'Custo da discriminação',
    subtitulo: 'O valor da compra mais recente',
    path: '/produtos/custo-discriminacao',
    secao: 'Catálogo',
    icone: 'payments',
    /*
     * Fora do menu por decisão do José em 23/09/2026: o trabalho de alinhar a
     * numeração com o PDV terminou. A TELA continua inteira e sob permissão —
     * some do menu, não do sistema —, porque apagá-la levaria junto o caminho
     * de volta se a rede renumerar.
     */
    foraDoMenu: true,
  },
  {
    id: 'conferir-planilha',
    titulo: 'Conferir planilha',
    subtitulo: 'O que o banco e a planilha discordam',
    path: '/produtos/reconciliacao',
    secao: 'Catálogo',
    icone: 'fact_check',
  },
  {
    id: 'giulia-sia',
    titulo: 'Conciliação do SIA',
    subtitulo: 'Propostas de código conferidas uma a uma',
    path: '/produtos/giulia-sia',
    secao: 'Catálogo',
    icone: 'playlist_add_check',
    foraDoMenu: true,
  },
  {
    id: 'vendas',
    titulo: 'Relatório de vendas',
    subtitulo: 'O que saiu no período',
    path: '/vendas',
    secao: 'Vendas',
    icone: 'monitoring',
  },
  {
    id: 'vendas-de-para',
    titulo: 'Produtos do PDV sem cadastro',
    subtitulo: 'Ligue o que o PDV vendeu ao cadastro certo',
    path: '/vendas/de-para',
    secao: 'Vendas',
    icone: 'link',
    foraDoMenu: true,
  },
  {
    id: 'vendas-produtos',
    titulo: 'Produtos vendidos no período',
    subtitulo: 'Quanto cada produto saiu',
    path: '/vendas/produtos',
    secao: 'Vendas',
    icone: 'sell',
    foraDoMenu: true,
  },
  {
    id: 'vendas-painel',
    titulo: 'Painel de setores',
    subtitulo: 'Desempenho por setor de venda',
    path: '/vendas/painel',
    secao: 'Vendas',
    icone: 'grid_view',
    foraDoMenu: true,
  },
  {
    id: 'dashboard',
    titulo: 'Dashboard',
    subtitulo: 'Visão geral do seu negócio',
    path: '/dashboard',
    secao: 'Administração',
    icone: 'dashboard',
  },
  {
    id: 'central-de-produtos',
    titulo: 'Central de Produtos',
    subtitulo: 'Decida o que vira cadastro',
    path: '/produtos/central',
    secao: 'Administração',
    icone: 'merge_type',
  },
  {
    id: 'duplicados-historicos',
    titulo: 'Duplicados históricos',
    subtitulo: 'Unifique históricos no código SIA correto',
    path: '/produtos/duplicados-historicos',
    secao: 'Administração',
    icone: 'compare_arrows',
  },
  {
    id: 'historico',
    titulo: 'Histórico',
    subtitulo: 'Alterações de nome em tempo real',
    path: '/produtos/historico-nomes',
    secao: 'Administração',
    icone: 'history',
  },
  {
    id: 'manutencao',
    titulo: 'Manutenção do catálogo',
    subtitulo: 'Ações que não têm volta',
    path: '/produtos/manutencao',
    secao: 'Administração',
    icone: 'build',
  },
  {
    id: 'usuarios',
    titulo: 'Usuários',
    subtitulo: 'Gerencie os usuários do sistema',
    path: '/usuarios',
    secao: 'Administração',
    icone: 'group',
  },
  {
    id: 'permissoes',
    titulo: 'Permissões',
    subtitulo: 'Quem enxerga cada tela',
    path: '/permissoes',
    secao: 'Administração',
    icone: 'admin_panel_settings',
  },
];

export type TelaId = (typeof TELAS)[number]['id'];

const POR_PATH = new Map(TELAS.map((t) => [t.path, t]));

/**
 * Normaliza antes de procurar, e isso é a guarda, não enfeite.
 *
 * `telaDoPath` é quem a guarda de rota consulta. Caminho que não casa devolve
 * `null`, e `null` a guarda entende como "não é tela do catálogo, pode passar".
 * Logo `/produtos/manutencao/`, só pela barra no fim, abria uma tela de "ações
 * que não têm volta" para quem não tem a permissão. A query string e o
 * fragmento têm o mesmo efeito.
 *
 * O servidor continua recusando as chamadas dessas telas. Mas tela que abre
 * ensina que ela existe, que é a razão de a guarda existir.
 */
const normalizarPath = (path: string): string => {
  const semQuery = String(path ?? '').split(/[?#]/)[0] ?? '';
  return semQuery.length > 1 ? semQuery.replace(/\/+$/, '') || '/' : semQuery;
};

/** A tela de um caminho, ou `null` quando o caminho não é uma tela do catálogo. */
export const telaDoPath = (path: string): Tela | null => POR_PATH.get(normalizarPath(path)) ?? null;

export const telaPorId = (id: string): Tela | null => TELAS.find((t) => t.id === id) ?? null;

/** Ids que nunca podem ser desligados de ninguém. */
export const TELAS_SEMPRE_LIBERADAS: readonly string[] = TELAS
  .filter((t) => t.sempreLiberada)
  .map((t) => t.id);

export const TODAS_AS_TELAS: readonly string[] = TELAS.map((t) => t.id);
