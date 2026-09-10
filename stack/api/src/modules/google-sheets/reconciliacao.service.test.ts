import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { env } from '@/config/env';
import { FakeSheetsGateway } from './fake-sheets.gateway';
import { ReconciliacaoService } from './reconciliacao.service';
import type { ReconciliacaoRepository, ProdutoDoCatalogo } from './reconciliacao.repository';

/**
 * Nenhum teste daqui toca na planilha real: o gateway é sempre o duplo em
 * memória, e o catálogo do banco é um objeto literal. É o mesmo arranjo de
 * `product-sheet-loja.service.test.ts`.
 */

const ABA = '(TNP/LI) CADASTRO PRODUTOS';

const anterior = {
  ligado: env.GOOGLE_SHEETS_ENABLED,
  id: env.GOOGLE_SHEETS_SPREADSHEET_ID,
  aba: env.GOOGLE_SHEETS_BASE_TAB,
  email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  chave: env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
};

beforeEach(() => {
  env.GOOGLE_SHEETS_ENABLED = true;
  env.GOOGLE_SHEETS_SPREADSHEET_ID = 'planilha-de-teste';
  env.GOOGLE_SHEETS_BASE_TAB = ABA;
  env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'conta@teste.local';
  env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = 'chave-de-teste';
});
afterEach(() => {
  env.GOOGLE_SHEETS_ENABLED = anterior.ligado;
  env.GOOGLE_SHEETS_SPREADSHEET_ID = anterior.id;
  env.GOOGLE_SHEETS_BASE_TAB = anterior.aba;
  env.GOOGLE_SERVICE_ACCOUNT_EMAIL = anterior.email;
  env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = anterior.chave;
});

const produto = (over: Partial<ProdutoDoCatalogo> = {}): ProdutoDoCatalogo => ({
  id: 'uuid-1', codigo: 'PR-1', codigoInterno: '00001', nome: 'ARROZ TIPO 1', status: 'ativo', ...over,
});

/** Catálogo do banco de mentira — o serviço só lê `listarBase()`. */
const catalogo = (produtos: ProdutoDoCatalogo[]): ReconciliacaoRepository =>
  ({ listarBase: async () => produtos } as unknown as ReconciliacaoRepository);

interface LinhaFake { linha: number; id?: string; nome?: string }

/**
 * Aba no leiaute NOVO: rótulos de faixa na linha 3, cabeçalhos na 5, dados a
 * partir da 11. `colunaId` é parâmetro de propósito — é o que permite provar
 * que o relatório acha a coluna pelo NOME e não pela letra.
 */
const planilha = (opcoes: { colunaId?: string; linhas?: LinhaFake[]; titulo?: string } = {}) => {
  const colunaId = opcoes.colunaId ?? 'HT';
  const g = new FakeSheetsGateway({ title: opcoes.titulo ?? ABA, columnCount: 240, rowCount: 9930 });
  g.set('C3', 'CADASTRO GERAL'); // linha de faixas: é o que marca a planilha nova
  g.set('D5', 'CADASTRO PRODUTOS ATUALIZADO NOVO');
  g.set(`${colunaId}5`, 'ID');
  for (const l of opcoes.linhas ?? []) {
    if (l.nome) g.set(`D${l.linha}`, l.nome);
    if (l.id) g.set(`${colunaId}${l.linha}`, l.id);
  }
  return g;
};

describe('(a) identidade da linha', () => {
  it('acha a coluna ID pelo CABEÇALHO, não por letra fixa', async () => {
    // mesma aba, ID deslocado uma coluna para a direita (alguém inseriu coluna)
    const g = planilha({ colunaId: 'HU', linhas: [{ linha: 11, id: 'uuid-1', nome: 'ARROZ TIPO 1' }] });
    const s = new ReconciliacaoService(g, catalogo([produto()]));

    const r = await s.reconciliar();

    expect(r.estado).toBe('ok');
    expect(r.colunaId).toBe('HU');
    expect(r.colunaNome).toBe('D');
    // o produto foi reconhecido: nada de "sumiu do banco" nem de "linha órfã"
    expect(r.resumo.semLinhaNaPlanilha).toBe(0);
    expect(r.resumo.linhasOrfas).toBe(0);
  });

  it('aba sem cabeçalho ID devolve estado próprio, não conta a base inteira como órfã', async () => {
    const g = new FakeSheetsGateway({ title: ABA, columnCount: 240 });
    g.set('C3', 'CADASTRO GERAL');
    g.set('D5', 'CADASTRO PRODUTOS ATUALIZADO NOVO');
    const s = new ReconciliacaoService(g, catalogo([produto()]));

    const r = await s.reconciliar();

    expect(r.estado).toBe('sem-coluna');
    expect(r.mensagem).toContain('ID');
    expect(r.semLinhaNaPlanilha).toEqual([]);
  });
});

describe('(b) as quatro divergências', () => {
  it('produto do banco SEM linha na planilha aparece na lista', async () => {
    const g = planilha({ linhas: [{ linha: 11, id: 'uuid-1', nome: 'ARROZ TIPO 1' }] });
    const s = new ReconciliacaoService(g, catalogo([
      produto(),
      produto({ id: 'uuid-2', codigo: 'PR-2', codigoInterno: '00002', nome: 'FEIJÃO PRETO' }),
    ]));

    const r = await s.reconciliar();

    expect(r.resumo.semLinhaNaPlanilha).toBe(1);
    expect(r.semLinhaNaPlanilha).toEqual([
      { produtoId: 'uuid-2', codigo: 'PR-2', codigoInterno: '00002', nome: 'FEIJÃO PRETO' },
    ]);
  });

  it('linha com ID que não existe mais no banco é órfã, com o número da linha', async () => {
    const g = planilha({
      linhas: [
        { linha: 11, id: 'uuid-1', nome: 'ARROZ TIPO 1' },
        { linha: 14, id: 'uuid-apagado', nome: 'PRODUTO EXCLUÍDO' },
      ],
    });
    const s = new ReconciliacaoService(g, catalogo([produto()]));

    const r = await s.reconciliar();

    expect(r.resumo.linhasOrfas).toBe(1);
    expect(r.linhasOrfas).toEqual([{ linha: 14, id: 'uuid-apagado', nome: 'PRODUTO EXCLUÍDO' }]);
  });

  it('linha com produto e SEM ID é contada (é o estado real da aba hoje)', async () => {
    /*
     * Reproduz em miniatura o achado da planilha de produção: quase toda linha
     * tem produto e nenhuma tem ID. Se a leitura parasse no fim da coluna de
     * ID — que o Sheets corta por estar vazia — essas linhas sumiriam do
     * relatório e a conta fecharia mentindo.
     */
    const g = planilha({
      linhas: [
        { linha: 11, id: 'uuid-1', nome: 'ARROZ TIPO 1' },
        { linha: 12, nome: 'FEIJÃO PRETO' },
        { linha: 13, nome: 'AÇÚCAR CRISTAL' },
        { linha: 40, nome: 'CAFÉ MOÍDO' },
      ],
    });
    const s = new ReconciliacaoService(g, catalogo([produto()]));

    const r = await s.reconciliar();

    expect(r.resumo.linhasSemId).toBe(3);
    expect(r.linhasSemId.map((l) => l.linha)).toEqual([12, 13, 40]);
    expect(r.resumo.linhasComProduto).toBe(4);
    expect(r.resumo.linhasComId).toBe(1);
  });

  it('mesmo produto com NOME diferente nos dois lados vira divergência', async () => {
    const g = planilha({ linhas: [{ linha: 11, id: 'uuid-1', nome: 'ARROZ TIPO 2' }] });
    const s = new ReconciliacaoService(g, catalogo([produto({ nome: 'ARROZ TIPO 1' })]));

    const r = await s.reconciliar();

    expect(r.nomeDivergente).toEqual([
      { produtoId: 'uuid-1', linha: 11, nomeNoBanco: 'ARROZ TIPO 1', nomeNaPlanilha: 'ARROZ TIPO 2' },
    ]);
  });

  it('caixa, espaço duplo e caractere invisível NÃO são divergência de nome', async () => {
    // U+2060 é o word joiner que a planilha carrega em quase todo grupo
    const g = planilha({ linhas: [{ linha: 11, id: 'uuid-1', nome: 'arroz⁠  tipo 1 ' }] });
    const s = new ReconciliacaoService(g, catalogo([produto({ nome: 'ARROZ TIPO 1' })]));

    const r = await s.reconciliar();

    expect(r.resumo.nomeDivergente).toBe(0);
  });
});

describe('(c) resumo e limite', () => {
  it('o resumo conta tudo mesmo com as listas cortadas pelo limite', async () => {
    const linhas: LinhaFake[] = [];
    for (let i = 0; i < 5; i++) linhas.push({ linha: 11 + i, id: `orfa-${i}`, nome: `ORFA ${i}` });
    const g = planilha({ linhas });
    const s = new ReconciliacaoService(g, catalogo([]));

    const r = await s.reconciliar({ limite: 2 });

    expect(r.resumo.linhasOrfas).toBe(5); // contagem inteira
    expect(r.linhasOrfas).toHaveLength(2); // lista cortada
    expect(r.resumo.truncado).toBe(true);
    expect(r.resumo.limite).toBe(2);
  });

  it('sem divergência nenhuma, a mensagem diz que confere', async () => {
    const g = planilha({ linhas: [{ linha: 11, id: 'uuid-1', nome: 'ARROZ TIPO 1' }] });
    const s = new ReconciliacaoService(g, catalogo([produto()]));

    const r = await s.reconciliar();

    expect(r.resumo).toMatchObject({
      produtosNoBanco: 1, semLinhaNaPlanilha: 0, linhasOrfas: 0, linhasSemId: 0, nomeDivergente: 0,
    });
    expect(r.mensagem).toContain('conferem');
  });
});

describe('(d) estados em vez de exceção', () => {
  it('integração desligada devolve estado e não chama o Google', async () => {
    env.GOOGLE_SHEETS_ENABLED = false;
    const g = planilha();
    const s = new ReconciliacaoService(g, catalogo([produto()]));

    const r = await s.reconciliar();

    expect(r.estado).toBe('desligado');
    expect(g.chamadas.getSheets).toBe(0);
    expect(g.chamadas.batchGet).toBe(0);
  });

  it('sem credencial devolve estado, citando o NOME da variável e nunca o valor', async () => {
    env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = '';
    const g = planilha();
    const s = new ReconciliacaoService(g, catalogo([produto()]));

    const r = await s.reconciliar();

    expect(r.estado).toBe('sem-credencial');
    expect(r.mensagem).toContain('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY');
    expect(g.chamadas.getSheets).toBe(0);
  });

  it('sem destino configurado devolve estado, sem tentar ler nada', async () => {
    env.GOOGLE_SHEETS_SPREADSHEET_ID = '';
    const g = planilha();
    const s = new ReconciliacaoService(g, catalogo([produto()]));

    const r = await s.reconciliar();

    expect(r.estado).toBe('sem-destino');
    expect(g.chamadas.getSheets).toBe(0);
  });

  it('aba inexistente devolve estado próprio', async () => {
    const g = planilha({ titulo: '(OUTRA) ABA' });
    const s = new ReconciliacaoService(g, catalogo([produto()]));

    const r = await s.reconciliar();

    expect(r.estado).toBe('sem-aba');
    expect(r.mensagem).toContain(ABA);
  });

  it('queda do Google vira estado "falhou", sem estourar e sem vazar segredo', async () => {
    const g = planilha({ linhas: [{ linha: 11, id: 'uuid-1', nome: 'ARROZ TIPO 1' }] });
    g.falharTudo = new Error('invalid_grant: private_key -----BEGIN PRIVATE KEY-----abc-----END PRIVATE KEY-----');
    const s = new ReconciliacaoService(g, catalogo([produto()]));

    const r = await s.reconciliar();

    expect(r.estado).toBe('falhou');
    expect(r.mensagem).not.toContain('BEGIN PRIVATE KEY');
    expect(r.resumo.produtosNoBanco).toBe(0);
  });
});

describe('(e) somente leitura', () => {
  it('nenhuma escrita sai para a planilha, em nenhum caminho', async () => {
    const g = planilha({
      linhas: [
        { linha: 11, id: 'uuid-1', nome: 'ARROZ TIPO 2' },
        { linha: 12, nome: 'SEM ID' },
        { linha: 13, id: 'uuid-orfa', nome: 'ÓRFÃ' },
      ],
    });
    const s = new ReconciliacaoService(g, catalogo([
      produto({ nome: 'ARROZ TIPO 1' }),
      produto({ id: 'uuid-2', nome: 'SÓ NO BANCO' }),
    ]));

    const r = await s.reconciliar();

    // o relatório encontrou de tudo…
    expect(r.resumo).toMatchObject({
      semLinhaNaPlanilha: 1, linhasOrfas: 1, linhasSemId: 1, nomeDivergente: 1,
    });
    // …e ainda assim não escreveu nada
    expect(g.writes).toEqual([]);
    expect(g.structuralRequests).toEqual([]);
    expect(g.operacoes).toEqual([]);
    expect(g.chamadas.batchUpdateValues).toBe(0);
    expect(g.chamadas.batchUpdate).toBe(0);
  });
});
