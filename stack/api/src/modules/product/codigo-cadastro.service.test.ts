import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import type { CurrentUser } from '@/types/fastify-jwt';
import { CodigoCadastroService, CONFIRMACAO_CODIGO_CADASTRO, LOTE_MAXIMO } from './codigo-cadastro.service';
import type { CodigoCadastroRepo, ResultadoTroca, TrocaPedida } from './codigo-cadastro.repository';
import type { ParSia, ProdutoParaReconciliar } from './codigo-cadastro.motor';

const JOSE: CurrentUser = { id: 'u1', name: 'José', email: 'j@c.br', loja: null, role: 'admin' };
const FRASE = CONFIRMACAO_CODIGO_CADASTRO;

const produto = (over: Partial<ProdutoParaReconciliar> = {}): ProdutoParaReconciliar => ({
  id: 'p1', loja: 'BASE', nome: '5STAR', codigoBarras: '7891000249239', codigoInterno: '00034', ...over,
});

const par = (over: Partial<ParSia> = {}): ParSia => ({
  loja: 'LI', coditem: '10365', chaveBarras: '7891000249239', descricao: '5STAR 40G', ...over,
});

/**
 * Repositório falso COM ESTADO: honra o `codigoAnteriorEsperado` de verdade.
 *
 * Um fake que devolvesse conflito por decreto provaria só o contador — e
 * passaria igual se a guarda otimista fosse removida do SQL.
 */
class RepoFalso implements CodigoCadastroRepo {
  trocas: TrocaPedida[] = [];
  cunhagens: number[] = [];
  constructor(
    private produtos: ProdutoParaReconciliar[] = [produto()],
    private pares: ParSia[] = [par()],
    private maior = 1335,
    private sia = 13439,
  ) {}

  async listarProdutos() { return this.produtos.map((p) => ({ ...p })); }
  async listarPares() { return this.pares; }
  async maiorCodigo() { return this.maior; }
  async tetoSia() { return this.sia; }

  private aplicar(pedido: TrocaPedida): ResultadoTroca {
    const alvo = this.produtos.find((p) => p.id === pedido.productId);
    const atual = alvo?.codigoInterno ?? null;
    if (!alvo || atual !== pedido.codigoAnteriorEsperado) return 'mudou-embaixo';
    alvo.codigoInterno = pedido.codigoNovo;
    this.maior = Math.max(this.maior, Number(pedido.codigoNovo));
    return 'trocado';
  }

  async trocar(pedido: TrocaPedida) { this.trocas.push(pedido); return this.aplicar(pedido); }

  async cunhar(pedido: Omit<TrocaPedida, 'codigoNovo'>, teto: number) {
    const codigo = String(Math.max(teto, this.maior) + 1).padStart(5, '0');
    this.cunhagens.push(Number(codigo));
    const completo = { ...pedido, codigoNovo: codigo };
    this.trocas.push(completo);
    return { resultado: this.aplicar(completo), codigo };
  }
}

/** Planilha desligada: o teto tem que sair do SIA sozinho. */
const SEM_PLANILHA = { ler: async () => ({ estado: 'sem-destino', linhas: [], teto: 0, descartadas: 0, faltando: [] }) };

const montar = (repo: CodigoCadastroRepo, planilha: unknown = SEM_PLANILHA) => new CodigoCadastroService(repo, planilha as never);

describe('previa', () => {
  it('conta os produtos por balde', async () => {
    const repo = new RepoFalso([
      produto({ id: 'a' }),
      produto({ id: 'b', codigoBarras: '7899999999999' }),
      produto({ id: 'c', codigoBarras: '7891000000000', codigoInterno: '11111' }),
    ], [par(), par({ chaveBarras: '7891000000000', coditem: '11111' })]);
    const r = await montar(repo).previa();
    expect(r.resumo).toMatchObject({ exato: 1, novo: 1, 'ja-correto': 1 });
    expect(r.confirmacao).toBe(FRASE);
  });

  it('tira o teto do SIA quando a planilha está desligada', async () => {
    const r = await montar(new RepoFalso()).previa();
    expect(r.teto).toBe(13439);
    expect(r.tetoDe).toBe('de-para do SIA');
    expect(r.planilha.estado).toBe('sem-destino');
  });

  it('a planilha ganha do SIA quando ela está à frente', async () => {
    const planilha = { ler: async () => ({ estado: 'ok', linhas: [{}], teto: 13500, descartadas: 0, faltando: [] }) };
    const r = await montar(new RepoFalso(), planilha).previa();
    expect(r.teto).toBe(13500);
    expect(r.tetoDe).toBe('planilha MIX');
  });

  it('a prévia não grava nada', async () => {
    const repo = new RepoFalso();
    await montar(repo).previa();
    expect(repo.trocas).toEqual([]);
  });
});

describe('adotarExatos', () => {
  it('recusa frase errada e não grava', async () => {
    const repo = new RepoFalso();
    await expect(montar(repo).adotarExatos(JOSE, 'pode ir')).rejects.toThrow(/confirma/i);
    expect(repo.trocas).toEqual([]);
  });

  it('adota o balde exato e registra a fonte', async () => {
    const repo = new RepoFalso();
    const r = await montar(repo).adotarExatos(JOSE, FRASE);
    expect(r).toMatchObject({ aplicadas: 1, conflitos: 0, restantes: 0 });
    expect(repo.trocas[0]).toMatchObject({
      productId: 'p1', codigoAnteriorEsperado: '00034', codigoNovo: '10365', alteradoPorUserId: 'u1',
    });
    expect(repo.trocas[0]!.fonte).toMatch(/SIA LI/);
  });

  /*
   * O caso que a revisão pegou: BASE e cópia de loja caindo as duas no balde
   * exato faziam a segunda ser contada como conflito falso. Agora a cópia nem
   * entra na lista — quem responde por ela é a BASE.
   */
  it('não conta conflito quando roda duas vezes seguidas', async () => {
    const repo = new RepoFalso();
    const servico = montar(repo);
    await servico.adotarExatos(JOSE, FRASE);
    const segunda = await servico.adotarExatos(JOSE, FRASE);
    expect(segunda).toMatchObject({ aplicadas: 0, conflitos: 0 });
  });

  it('dois produtos disputando o mesmo código não são adotados em lote', async () => {
    const repo = new RepoFalso([produto({ id: 'a' }), produto({ id: 'b' })]);
    const r = await montar(repo).adotarExatos(JOSE, FRASE);
    expect(r.aplicadas).toBe(0);
    expect(repo.trocas).toEqual([]);
  });

  it('corta o lote e diz quantos sobraram', async () => {
    const muitos = Array.from({ length: LOTE_MAXIMO + 5 }, (_, i) => produto({
      id: `p${i}`, codigoBarras: `789100024${String(i).padStart(4, '0')}`,
    }));
    const pares = muitos.map((p, i) => par({ chaveBarras: String(p.codigoBarras), coditem: String(20000 + i) }));
    const r = await montar(new RepoFalso(muitos, pares)).adotarExatos(JOSE, FRASE);
    expect(r.aplicadas).toBe(LOTE_MAXIMO);
    expect(r.restantes).toBe(5);
  });
});

describe('decidir', () => {
  it('adota o código escolhido entre os pares do produto', async () => {
    const repo = new RepoFalso([produto({ codigoBarras: '11151' })], [par({ chaveBarras: '11151', coditem: '10784' })]);
    const r = await montar(repo).decidir(JOSE, {
      productId: 'p1', codigo: '10784', codigoAtualEsperado: '00034', confirmacao: FRASE,
    });
    expect(r.codigo).toBe('10784');
  });

  it('recusa código que não está entre os pares', async () => {
    const repo = new RepoFalso();
    await expect(montar(repo).decidir(JOSE, {
      productId: 'p1', codigo: '99999', codigoAtualEsperado: '00034', confirmacao: FRASE,
    })).rejects.toThrow(/pares/i);
    expect(repo.trocas).toEqual([]);
  });

  /*
   * A guarda que importa: quem está com a tela velha não pode sobrescrever
   * quem decidiu primeiro. O fake honra o código anterior de verdade, então
   * este teste falha se o `WHERE` sair do SQL.
   */
  it('recusa quando o código mudou desde que a tela carregou', async () => {
    const repo = new RepoFalso();
    const servico = montar(repo);
    await servico.adotarExatos(JOSE, FRASE); // alguém decidiu antes
    await expect(servico.decidir(JOSE, {
      productId: 'p1', codigo: '10365', codigoAtualEsperado: '00034', confirmacao: FRASE,
    })).rejects.toThrow(/mudou desde/i);
  });

  it('reenvio do mesmo pedido não grava duas vezes', async () => {
    const repo = new RepoFalso([produto({ codigoBarras: '11151' })], [par({ chaveBarras: '11151', coditem: '10784' })]);
    const servico = montar(repo);
    const pedido = { productId: 'p1', codigo: '10784', codigoAtualEsperado: '00034', confirmacao: FRASE };
    await servico.decidir(JOSE, pedido);
    await expect(servico.decidir(JOSE, pedido)).rejects.toThrow(/mudou desde/i);
  });

  it('cunha a partir do teto do SIA', async () => {
    const repo = new RepoFalso([produto({ codigoBarras: '7899999999999' })]);
    const r = await montar(repo).decidir(JOSE, {
      productId: 'p1', cunhar: true, codigoAtualEsperado: '00034', confirmacao: FRASE,
    });
    expect(r.codigo).toBe('13440');
  });

  it('recusa cunhar para produto que tem par no SIA', async () => {
    const repo = new RepoFalso();
    await expect(montar(repo).decidir(JOSE, {
      productId: 'p1', cunhar: true, codigoAtualEsperado: '00034', confirmacao: FRASE,
    })).rejects.toThrow(/"exato"/);
    expect(repo.trocas).toEqual([]);
  });

  /**
   * O caso TRIDENT: o produto não casa por código de barras com ninguém, ganha
   * SUGESTÃO por nome — e ainda assim precisa poder ser cunhado, porque quem
   * decide pode olhar as sugestões e concluir que nenhuma serve.
   *
   * Enquanto a guarda olhava `candidatos.length`, a sugestão trancava a
   * cunhagem justamente nos produtos que mais precisam de número novo.
   */
  it('cunha mesmo havendo sugestão por nome, porque sugestão não é par', async () => {
    const repo = new RepoFalso(
      [produto({ nome: 'TRIDENT MENTA', codigoBarras: '7899999999999' })],
      [par({ coditem: '12345', chaveBarras: '7890000000001', descricao: 'TRIDENT MENTA 8G' })],
    );
    const servico = montar(repo);

    const alvo = (await servico.previa()).itens.find((i) => i.productId === 'p1')!;
    expect(alvo.balde).toBe('novo');
    expect(alvo.candidatos.map((c) => c.coditem)).toContain('12345');
    expect(alvo.candidatos[0]!.semelhanca).toBeGreaterThan(55);

    const r = await servico.decidir(JOSE, {
      productId: 'p1', cunhar: true, codigoAtualEsperado: '00034', confirmacao: FRASE,
    });
    expect(r.codigo).toBe('13440');
  });

  /**
   * Nenhum código para dois cadastros.
   *
   * O balde `disputado` só freia a adoção EM LOTE. Decidindo um a um, nada
   * impedia dar a `b` o número que `a` já tem — e o banco não tem unicidade em
   * `codigo_interno` para barrar embaixo.
   */
  it('recusa adotar código que outro cadastro já tem', async () => {
    const repo = new RepoFalso([
      produto({ id: 'a', nome: 'JÁ NUMERADO', codigoInterno: '10784', codigoBarras: '11151' }),
      produto({ id: 'b', nome: 'OUTRO', codigoBarras: '11151' }),
    ], [par({ chaveBarras: '11151', coditem: '10784' })]);

    await expect(montar(repo).decidir(JOSE, {
      productId: 'b', codigo: '10784', codigoAtualEsperado: '00034', confirmacao: FRASE,
    })).rejects.toThrow(/já é do cadastro "JÁ NUMERADO"/);
    expect(repo.trocas).toEqual([]);
  });

  /** A contrapartida: a sugestão também pode ser ACEITA, sem passar por cunhagem. */
  it('aceita adotar o código sugerido por nome', async () => {
    const repo = new RepoFalso(
      [produto({ nome: 'TRIDENT MENTA', codigoBarras: '7899999999999' })],
      [par({ coditem: '12345', chaveBarras: '7890000000001', descricao: 'TRIDENT MENTA 8G' })],
    );
    const r = await montar(repo).decidir(JOSE, {
      productId: 'p1', codigo: '12345', codigoAtualEsperado: '00034', confirmacao: FRASE,
    });
    expect(r.codigo).toBe('12345');
    expect(repo.cunhagens).toEqual([]);
  });

  it('recusa cunhar quando não há teto nenhum', async () => {
    const repo = new RepoFalso([produto({ codigoBarras: '7899999999999' })], [], 0, 0);
    await expect(montar(repo).decidir(JOSE, {
      productId: 'p1', cunhar: true, codigoAtualEsperado: '00034', confirmacao: FRASE,
    })).rejects.toThrow(/numeração está/i);
  });

  it('recusa pedido sem código e sem cunhar, e pedido com os dois', async () => {
    const repo = new RepoFalso();
    const servico = montar(repo);
    await expect(servico.decidir(JOSE, {
      productId: 'p1', codigoAtualEsperado: '00034', confirmacao: FRASE,
    })).rejects.toThrow(/OU/);
    await expect(servico.decidir(JOSE, {
      productId: 'p1', codigo: '10365', cunhar: true, codigoAtualEsperado: '00034', confirmacao: FRASE,
    })).rejects.toThrow(/OU/);
    expect(repo.trocas).toEqual([]);
  });

  it('recusa produto que não está na lista', async () => {
    await expect(montar(new RepoFalso()).decidir(JOSE, {
      productId: 'sumiu', codigo: '10365', codigoAtualEsperado: null, confirmacao: FRASE,
    })).rejects.toThrow(/Produto/i);
  });

  it('recusa frase errada', async () => {
    await expect(montar(new RepoFalso()).decidir(JOSE, {
      productId: 'p1', codigo: '10365', codigoAtualEsperado: '00034', confirmacao: 'x',
    })).rejects.toThrow(/confirma/i);
  });
});
