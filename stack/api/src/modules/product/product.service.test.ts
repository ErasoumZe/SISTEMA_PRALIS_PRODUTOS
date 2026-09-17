import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import type { ProductSchemas } from '@pralis/shared';
import { ProductService } from './product.service';
import { PRAZO_ESPELHO_NA_TELA } from '@/modules/google-sheets/espelho-na-tela';
import type { ProductRepository } from './product.repository';
import type { ProductSheetService } from '@/modules/google-sheets/product-sheet.service';
import type { ProductSheetLojaService } from '@/modules/google-sheets/product-sheet-loja.service';
import type { TaxRuleService } from '@/modules/apoio/tax-rule.service';
import type { CurrentUser } from '@/types/fastify-jwt';
import { creareDriveParado } from '@/modules/creare/creare-drive.fake';

type Product = ProductSchemas.ProductEntity;

/*
 * Espelho das abas de loja: desligado em todos os testes deste arquivo. Eles
 * cuidam de cadastro e fiscal; o espelho tem os proprios testes. O stub existe
 * so para o servico ter o colaborador na posicao certa do construtor.
 */
const espelhoLojaFalso = {
  async espelharVarios() { return 'desligado' as const; },
  async espelharNasAbasDeLoja() { return 'espelhado' as const; },
} as unknown as ProductSheetLojaService;

const ID = '0197d7c4-2c9a-7000-8000-000000000001';

const admin: CurrentUser = {
  id: 'u-1', name: 'José', email: 'sistema@cicluz.com.br', loja: null, role: 'admin',
};

const produto = (over: Partial<Product> = {}): Product =>
  ({ id: ID, loja: 'BASE', nome: 'PAO FRANCES', ...over }) as Product;

/**
 * Repositório falso que registra a ORDEM das operações — é o que prova que a
 * planilha é limpa ANTES do banco.
 */
function fakes(opts: {
  removeOutcome?: string;
  deleteThrows?: Error;
} = {}) {
  const ordem: string[] = [];
  const repo = {
    async findById() { return produto(); },
    async delete() {
      ordem.push('banco:delete');
      if (opts.deleteThrows) throw opts.deleteThrows;
      return true;
    },
  } as unknown as ProductRepository;

  const sheets = {
    async removeProduct() {
      ordem.push('planilha:remove');
      return {
        outcome: opts.removeOutcome ?? 'removed',
        rowNumber: 12,
        message: 'mensagem de teste',
      };
    },
    async registerPending() { ordem.push('planilha:registerPending'); },
    async syncProduct() { ordem.push('planilha:sync'); return { outcome: 'synced' }; },
  } as unknown as ProductSheetService;

  const service = new ProductService(repo, sheets, espelhoLojaFalso, {} as TaxRuleService, creareDriveParado());
  return { service, ordem };
}

describe('ProductService.delete — espelhamento da exclusão', () => {
  it('apaga da planilha ANTES do banco', async () => {
    const { service, ordem } = fakes();

    await service.delete(admin, ID);

    expect(ordem).toEqual(['planilha:remove', 'banco:delete']);
  });

  it('falha na planilha ABORTA a exclusão — o produto continua no banco', async () => {
    const { service, ordem } = fakes({ removeOutcome: 'failed' });

    await expect(service.delete(admin, ID)).rejects.toMatchObject({ code: 'SHEET_DELETE_FAILED' });
    expect(ordem).toEqual(['planilha:remove']); // nunca chegou no banco
  });

  it('integração mal configurada também aborta — nada é excluído às escuras', async () => {
    const { service, ordem } = fakes({ removeOutcome: 'misconfigured' });

    await expect(service.delete(admin, ID)).rejects.toMatchObject({ code: 'SHEET_DELETE_FAILED' });
    expect(ordem).toEqual(['planilha:remove']);
  });

  it('integração desligada não bloqueia a exclusão', async () => {
    const { service, ordem } = fakes({ removeOutcome: 'disabled' });

    await service.delete(admin, ID);

    expect(ordem).toEqual(['planilha:remove', 'banco:delete']);
  });

  it('produto ausente da planilha não bloqueia a exclusão', async () => {
    const { service, ordem } = fakes({ removeOutcome: 'absent' });

    await service.delete(admin, ID);

    expect(ordem).toEqual(['planilha:remove', 'banco:delete']);
  });

  it('se o banco falhar depois da planilha limpa, a linha é devolvida', async () => {
    const { service, ordem } = fakes({ deleteThrows: new Error('conexão perdida') });

    await expect(service.delete(admin, ID)).rejects.toThrow('conexão perdida');
    expect(ordem).toEqual([
      'planilha:remove', 'banco:delete', 'planilha:registerPending', 'planilha:sync',
    ]);
  });

  it('não-admin nem chega a tocar na planilha', async () => {
    const { service, ordem } = fakes();
    const comum: CurrentUser = { ...admin, role: 'user', loja: 'TNP' };

    await expect(service.delete(comum, ID)).rejects.toMatchObject({ code: 'ONLY_ADMIN_DELETE' });
    expect(ordem).toEqual([]);
  });
});

/**
 * Fakes do caminho de EDIÇÃO. `update` não pode falhar por causa do Google —
 * mas também não pode MENTIR que deu tudo certo.
 */
function fakesUpdate(opts: { syncOutcome?: string; loja?: string; syncThrows?: Error } = {}) {
  const chamadas: string[] = [];
  const update = vi.fn(async () => {
    chamadas.push('banco:update');
    return produto({ loja: (opts.loja ?? 'BASE') as Product['loja'], nome: 'NOME NOVO' });
  });
  const repo = {
    async findById() { return produto({ loja: (opts.loja ?? 'BASE') as Product['loja'] }); },
    update,
    async listByBaseProductId() { return []; }, // sem cópias de loja neste cenário
  } as unknown as ProductRepository;

  const sheets = {
    async registerPending() { chamadas.push('planilha:registerPending'); },
    async syncProduct() {
      chamadas.push('planilha:sync');
      if (opts.syncThrows) throw opts.syncThrows;
      return { outcome: opts.syncOutcome ?? 'synced', rowNumber: 12, message: 'ok' };
    },
  } as unknown as ProductSheetService;

  return {
    service: new ProductService(repo, sheets, espelhoLojaFalso, {} as TaxRuleService, creareDriveParado()),
    chamadas,
    update,
  };
}

describe('ProductService.update — o resultado do espelho não pode sumir', () => {
  it('edição bem espelhada devolve sheetSync synced', async () => {
    const { service } = fakesUpdate();

    const r = await service.update(admin, ID, { nome: 'NOME NOVO' });

    expect(r.sheetSync).toBe('synced');
    expect(r.nome).toBe('NOME NOVO');
  });

  it('entrega o antes e o autor ao repositório para gravar o histórico junto da edição', async () => {
    const { service, update } = fakesUpdate();

    await service.update(admin, ID, { nome: 'NOME NOVO' });

    expect(update).toHaveBeenCalledWith(ID, { nome: 'NOME NOVO' }, expect.objectContaining({
      nomeAnterior: 'PAO FRANCES', alteradoPorUserId: admin.id, alteradoPorNome: admin.name,
    }));
  });

  it('falha no Google NÃO derruba a edição, mas aparece como failed', async () => {
    const { service, chamadas } = fakesUpdate({ syncOutcome: 'failed' });

    const r = await service.update(admin, ID, { nome: 'NOME NOVO' });

    expect(r.nome).toBe('NOME NOVO'); // a edição valeu
    expect(r.sheetSync).toBe('failed'); // e o usuário fica sabendo
    expect(chamadas).toContain('banco:update');
  });

  it('exceção inesperada no espelho também vira failed, sem derrubar a edição', async () => {
    const { service } = fakesUpdate({ syncThrows: new Error('rede caiu') });

    const r = await service.update(admin, ID, { nome: 'NOME NOVO' });

    expect(r.nome).toBe('NOME NOVO');
    expect(r.sheetSync).toBe('failed');
  });

  it('produto de loja chama o espelho principal para preencher a faixa TNP/LI', async () => {
    const { service, chamadas } = fakesUpdate({ loja: 'TNP' });

    const r = await service.update(admin, ID, { nome: 'NOME NOVO' });

    expect(r.sheetSync).toBe('synced');
    expect(r.espelhoLoja).toBe('espelhado');
    expect(chamadas).toEqual(['banco:update', 'planilha:sync']);
  });

  it('produto de loja usa o espelho legado somente quando o leiaute principal pula a escrita', async () => {
    const chamadas: string[] = [];
    const repo = {
      async findById() { return produto({ loja: 'LI', baseProductId: 'base-1' }); },
      async update() { chamadas.push('banco:update'); return produto({ loja: 'LI', baseProductId: 'base-1' }); },
    } as unknown as ProductRepository;
    const sheets = {
      async syncProduct() { chamadas.push('planilha:sync'); return { outcome: 'skipped' as const }; },
    } as unknown as ProductSheetService;
    const legado = {
      async espelharVarios() { chamadas.push('planilha:legado'); return 'espelhado' as const; },
      async espelharNasAbasDeLoja() { chamadas.push('planilha:alinhada'); return 'espelhado' as const; },
    } as unknown as ProductSheetLojaService;
    const service = new ProductService(repo, sheets, legado, {} as TaxRuleService, creareDriveParado());

    const r = await service.update(admin, ID, { nome: 'NOME NOVO' });

    expect(r.espelhoLoja).toBe('espelhado');
    expect(chamadas).toEqual(['banco:update', 'planilha:sync', 'planilha:legado']);
  });
});

describe('ProductService.importFromBase — faixa da loja na aba geral', () => {
  it('sincroniza o lote novo no espelho principal e não chama o legado', async () => {
    const chamadas: string[] = [];
    const base = produto({ id: ID, loja: 'BASE' });
    const copia = produto({
      id: '0197d7c4-2c9a-7000-8000-000000000010',
      loja: 'LI',
      baseProductId: ID,
    });
    const repo = {
      async findById(id: string) { return id === ID ? base : null; },
      async existsByBase() { return false; },
      async findDuplicate() { return null; },
      async findByCodigo() { return null; },
      async create() { chamadas.push('banco:create'); return copia; },
    } as unknown as ProductRepository;
    const sheets = {
      async syncStoreProducts(produtos: Product[]) {
        chamadas.push(`planilha:lote:${produtos.length}`);
        return produtos.map(() => ({ outcome: 'synced' as const, rowNumber: 11 }));
      },
    } as unknown as ProductSheetService;
    const legado = {
      async espelharVarios() { chamadas.push('planilha:legado'); return 'espelhado' as const; },
      async espelharNasAbasDeLoja() { chamadas.push('planilha:alinhada'); return 'espelhado' as const; },
    } as unknown as ProductSheetLojaService;
    const service = new ProductService(repo, sheets, legado, {} as TaxRuleService, creareDriveParado());
    const usuarioLi: CurrentUser = { ...admin, role: 'user', loja: 'LI' };

    const r = await service.importFromBase(usuarioLi, [ID]);

    expect(r).toMatchObject({ imported: 1, skipped: 0, espelhoLoja: 'espelhado' });
    expect(chamadas).toEqual(['banco:create', 'planilha:lote:1', 'planilha:alinhada']);
  });

  it('usa o espelho legado quando o destino principal ainda está no leiaute antigo', async () => {
    const chamadas: string[] = [];
    const base = produto({ id: ID, loja: 'BASE' });
    const copia = produto({ loja: 'TNP', baseProductId: ID });
    const repo = {
      async findById() { return base; },
      async existsByBase() { return false; },
      async findDuplicate() { return null; },
      async findByCodigo() { return null; },
      async create() { return copia; },
    } as unknown as ProductRepository;
    const sheets = {
      async syncStoreProducts() { chamadas.push('planilha:lote'); return [{ outcome: 'skipped' as const }]; },
    } as unknown as ProductSheetService;
    const legado = {
      async espelharVarios() { chamadas.push('planilha:legado'); return 'espelhado' as const; },
    } as unknown as ProductSheetLojaService;
    const service = new ProductService(repo, sheets, legado, {} as TaxRuleService, creareDriveParado());
    const usuarioTnp: CurrentUser = { ...admin, role: 'user', loja: 'TNP' };

    const r = await service.importFromBase(usuarioTnp, [ID]);

    expect(r.espelhoLoja).toBe('espelhado');
    expect(chamadas).toEqual(['planilha:lote', 'planilha:legado']);
  });
});

/**
 * Fakes da PROPAGAÇÃO BASE -> lojas.
 * `copias` são os produtos das lojas importados daquele produto da BASE.
 */
function fakesPropagacao(antes: Partial<Product>, depois: Partial<Product>, copias: Partial<Product>[]) {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const base = produto({ loja: 'BASE', ...antes });
  const atualizado = produto({ loja: 'BASE', ...depois });

  const repo = {
    async findById() { return base; },
    async update(id: string, patch: Record<string, unknown>) {
      patches.push({ id, patch });
      return id === base.id ? atualizado : produto({ id });
    },
    async listByBaseProductId() {
      return copias.map((c, i) => produto({ id: `copia-${i}`, loja: 'TNP', baseProductId: base.id, ...c }));
    },
  } as unknown as ProductRepository;

  const sheets = {
    async registerPending() {},
    async syncProduct() { return { outcome: 'synced', rowNumber: 12, message: 'ok' }; },
  } as unknown as ProductSheetService;

  return { service: new ProductService(repo, sheets, espelhoLojaFalso, {} as TaxRuleService, creareDriveParado()), patches };
}

describe('ProductService.update — herança BASE -> lojas', () => {
  it('a loja que ainda seguia a BASE recebe o campo novo', async () => {
    const { service, patches } = fakesPropagacao(
      { nome: 'PAO FRANCES' },
      { nome: 'PAO FRANCES INTEGRAL' },
      [{ nome: 'PAO FRANCES' }], // a loja não tinha mexido
    );

    const r = await service.update(admin, ID, { nome: 'PAO FRANCES INTEGRAL' });

    const naLoja = patches.find((p) => p.id === 'copia-0');
    expect(naLoja?.patch).toEqual({ nome: 'PAO FRANCES INTEGRAL' });
    expect(r.lojasAtualizadas).toBe(1);
  });

  it('a loja que TINHA valor próprio no campo não é sobrescrita', async () => {
    const { service, patches } = fakesPropagacao(
      { nome: 'PAO FRANCES' },
      { nome: 'PAO FRANCES INTEGRAL' },
      [{ nome: 'PAO DA CASA' }], // a loja renomeou por conta própria
    );

    const r = await service.update(admin, ID, { nome: 'PAO FRANCES INTEGRAL' });

    expect(patches.find((p) => p.id === 'copia-0')).toBeUndefined();
    expect(r.lojasAtualizadas).toBe(0);
  });

  it('a herança é por CAMPO: a loja mantém o que editou e segue no resto', async () => {
    const { service, patches } = fakesPropagacao(
      { nome: 'PAO FRANCES', marca: 'PRALIS', custo: 0.5 },
      { nome: 'PAO FRANCES INTEGRAL', marca: 'PRALIS', custo: 0.8 },
      [{ nome: 'PAO DA CASA', marca: 'PRALIS', custo: 0.5 }], // só o nome era próprio
    );

    await service.update(admin, ID, {});

    // custo (que ela seguia) desceu; nome (que era dela) não foi tocado
    expect(patches.find((p) => p.id === 'copia-0')?.patch).toEqual({ custo: 0.8 });
  });

  it('campo que a BASE não mudou não vira patch', async () => {
    const { service, patches } = fakesPropagacao(
      { nome: 'PAO FRANCES', marca: 'PRALIS' },
      { nome: 'PAO FRANCES', marca: 'PRALIS' },
      [{ nome: 'PAO FRANCES', marca: 'PRALIS' }],
    );

    const r = await service.update(admin, ID, {});

    expect(patches.filter((p) => p.id === 'copia-0')).toHaveLength(0);
    expect(r.lojasAtualizadas).toBe(0);
  });

  it('promoções da loja NUNCA são propagadas', async () => {
    const promoBase = [{ tipo: 'desconto', valor: null, descontoPct: 0.1, horaInicio: null, horaFim: null, dias: [false, false, false, false, false, false, false], descontoAte: null }];
    const { service, patches } = fakesPropagacao(
      { promocoes: [] as unknown as Product['promocoes'] },
      { promocoes: promoBase as unknown as Product['promocoes'] },
      [{ promocoes: [] as unknown as Product['promocoes'] }],
    );

    await service.update(admin, ID, {});

    const naLoja = patches.find((p) => p.id === 'copia-0');
    expect(naLoja?.patch?.promocoes).toBeUndefined();
  });

  it('editar produto de LOJA não propaga para ninguém', async () => {
    const { service, patches } = fakesPropagacao(
      { loja: 'TNP', nome: 'PAO FRANCES' },
      { loja: 'TNP', nome: 'OUTRO' },
      [{ nome: 'PAO FRANCES' }],
    );

    const r = await service.update(admin, ID, { nome: 'OUTRO' });

    expect(patches.filter((p) => p.id.startsWith('copia'))).toHaveLength(0);
    expect(r.lojasAtualizadas).toBe(0);
  });
});

const colaboradorTnp: CurrentUser = { ...admin, role: 'user', loja: 'TNP' };

const fiscalDe = (ncm: string) => ({
  ncm, cest: null, categoria: null, cstPisCofins: null, aliquotaCheia: null,
  aliquotaFcp: null, aliquotaPis: null, aliquotaCofins: null, reducaoIcms: null, icms: null,
}) as unknown as Product['fiscal'];

/** Fakes para o bloco fiscal: produto de loja, com fiscal já gravado. */
function fakesFiscal(fiscalAtual: Product['fiscal']) {
  const repo = {
    async findById() { return produto({ loja: 'TNP', grupo: 'MER PADARIA', fiscal: fiscalAtual }); },
    async update() { return produto({ loja: 'TNP', grupo: 'MER PADARIA', fiscal: fiscalAtual }); },
    async listByBaseProductId() { return []; },
  } as unknown as ProductRepository;

  const sheets = {
    async registerPending() {},
    async syncProduct() { return { outcome: 'skipped', rowNumber: null, message: '' }; },
  } as unknown as ProductSheetService;

  const classificacao = {
    grupo: 'MER PADARIA', ncm: '19051000', cstPisCofins: '01', tributacaoSimples: null,
    aliquotaSimples: null, icmsRe: null, baseFiscal: null, codigoFiscal: null,
    produtoFiscal: null, cstReforma: null, cClassTrib: null, aliquotaIbs: null,
    aliquotaCbs: null, origem: null, ecf: null,
  };
  const taxRules = {
    async classify() { return classificacao; },
    // `classificar` é o caminho que os cadastros usam: devolve o PORQUÊ junto
    async classificar() {
      return {
        estado: 'parcial', motivo: 'sem cadastro de ECF para este produto',
        classificacao, conflitos: [],
      };
    },
  } as unknown as TaxRuleService;

  return new ProductService(repo, sheets, espelhoLojaFalso, taxRules, creareDriveParado());
}

describe('ProductService.update — bloco fiscal é do admin', () => {
  it('colaborador que reenvia o MESMO fiscal (payload inteiro da tela) passa', async () => {
    const atual = fiscalDe('19051000');
    const service = fakesFiscal(atual);

    await expect(
      service.update(colaboradorTnp, ID, { nome: 'OUTRO', fiscal: atual }),
    ).resolves.toBeTruthy();
  });

  it('colaborador que ALTERA o fiscal leva 403', async () => {
    const service = fakesFiscal(fiscalDe('19051000'));

    await expect(
      service.update(colaboradorTnp, ID, { fiscal: fiscalDe('99999999') }),
    ).rejects.toMatchObject({ statusCode: 403, code: 'ONLY_ADMIN_FISCAL' });
  });

  it('colaborador sem bloco fiscal no payload passa', async () => {
    const service = fakesFiscal(fiscalDe('19051000'));

    await expect(service.update(colaboradorTnp, ID, { nome: 'OUTRO' })).resolves.toBeTruthy();
  });

  it('admin altera o fiscal normalmente', async () => {
    const service = fakesFiscal(fiscalDe('19051000'));

    await expect(
      service.update(admin, ID, { fiscal: fiscalDe('99999999') }),
    ).resolves.toBeTruthy();
  });

  it('edição comum não consulta regra fiscal quando grupo e código de barras não mudaram', async () => {
    /*
     * O produto precisa ter CARGA fiscal para este caso existir. Com o bloco
     * vazio, a edição agora completa o que falta — e é para completar mesmo:
     * produto criado pela Central nunca passou por `classify()`, e abrir e
     * salvar era a única chance de ele receber alíquota e ECF.
     *
     * Aqui a pergunta é outra e continua valendo: quem JÁ está classificado não
     * é reclassificado só por alguém mexer no preço.
     */
    const atual = { ...fiscalDe('19051000'), aliquotaCheia: 7 } as unknown as Product['fiscal'];
    let classificacoes = 0;
    const repo = {
      async findById() { return produto({ loja: 'BASE', grupo: 'MER PADARIA', fiscal: atual }); },
      async update() { return produto({ loja: 'BASE', grupo: 'MER PADARIA', fiscal: atual, vVendaPontual: 12 }); },
      async listByBaseProductId() { return []; },
    } as unknown as ProductRepository;
    const sheets = {
      async registerPending() {},
      async syncProduct() { return { outcome: 'skipped', rowNumber: null, message: '' }; },
    } as unknown as ProductSheetService;
    const taxRules = {
      async classify() { classificacoes++; throw new Error('não deveria classificar'); },
    } as unknown as TaxRuleService;
    const service = new ProductService(repo, sheets, espelhoLojaFalso, taxRules, creareDriveParado());

    await service.update(admin, ID, {
      grupo: 'MER PADARIA', codigoBarras: null, fiscal: atual, vVendaPontual: 12,
    });

    expect(classificacoes).toBe(0);
  });

  it('produto legado sem grupo permite editar preço sem tentar classificação', async () => {
    let classificacoes = 0;
    const repo = {
      async findById() { return produto({ loja: 'BASE', grupo: null, fiscal: null }); },
      async update() { return produto({ loja: 'BASE', grupo: null, fiscal: null, vVendaPontual: 9 }); },
      async listByBaseProductId() { return []; },
    } as unknown as ProductRepository;
    const sheets = {
      async registerPending() {},
      async syncProduct() { return { outcome: 'skipped', rowNumber: null, message: '' }; },
    } as unknown as ProductSheetService;
    const taxRules = {
      async classify() { classificacoes++; throw new Error('não deveria classificar'); },
    } as unknown as TaxRuleService;
    const service = new ProductService(repo, sheets, espelhoLojaFalso, taxRules, creareDriveParado());

    await service.update(admin, ID, { grupo: null, fiscal: null, vVendaPontual: 9 });

    expect(classificacoes).toBe(0);
  });

  it('colaborador troca o grupo e o fiscal vem exclusivamente da regra', async () => {
    const fiscalAtual = fiscalDe('19051000');
    const fiscalMalicioso = fiscalDe('99999999');
    let payloadGravado: Record<string, unknown> | undefined;
    const repo = {
      async findById() { return produto({ loja: 'TNP', grupo: 'MER PADARIA', fiscal: fiscalAtual }); },
      async update(_id: string, payload: Record<string, unknown>) {
        payloadGravado = payload;
        return produto({ loja: 'TNP', grupo: 'NOVO GRUPO', fiscal: payload.fiscal as Product['fiscal'] });
      },
      async listByBaseProductId() { return []; },
    } as unknown as ProductRepository;
    const sheets = {
      async registerPending() {},
      async syncProduct() { return { outcome: 'skipped', rowNumber: null, message: '' }; },
    } as unknown as ProductSheetService;
    const daRegra = {
      grupo: 'NOVO GRUPO', ncm: '19059090', cstPisCofins: '01', tributacaoSimples: 'REGRA',
      aliquotaSimples: 7.4, icmsRe: 0, baseFiscal: 'REGRA', codigoFiscal: null,
      produtoFiscal: null, cstReforma: null, cClassTrib: null, aliquotaIbs: null,
      aliquotaCbs: null, origem: 'grupo', ecf: null,
    };
    const taxRules = {
      async classify() { return daRegra; },
      async classificar() {
        return { estado: 'parcial', motivo: 'sem cadastro de ECF', classificacao: daRegra, conflitos: [] };
      },
    } as unknown as TaxRuleService;
    const service = new ProductService(repo, sheets, espelhoLojaFalso, taxRules, creareDriveParado());

    await service.update(colaboradorTnp, ID, { grupo: 'NOVO GRUPO', fiscal: fiscalMalicioso });

    expect((payloadGravado?.fiscal as Product['fiscal'])?.ncm).toBe('19059090');
    expect((payloadGravado?.fiscal as Product['fiscal'])?.ncm).not.toBe('99999999');
    expect((payloadGravado?.fiscal as Product['fiscal'])?.tributacaoSimples).toBe('REGRA');
  });
});

/**
 * O guarda do fiscal não pode travar quem NÃO mexeu no fiscal.
 *
 * Reproduz o que aconteceu com a loja LI em 10/09/2026: o colaborador abriu um
 * produto importado, não tocou em nada do bloco fiscal e levou "Apenas o
 * administrador altera os dados fiscais do produto".
 *
 * A causa não era uma edição: era a tela não conseguir devolver o bloco
 * idêntico. Ela monta os números com `Number(x) || null` (um zero guardado
 * volta como `null`) e não conhece os campos derivados nem os de ECF.
 */
function fakesGuardaFiscal(p: Product) {
  const repo = {
    async findById() { return p; },
    async update() { return { ...p, nome: 'NOME NOVO' }; },
    async listByBaseProductId() { return []; },
  } as unknown as ProductRepository;
  const sheets = {
    async registerPending() {},
    async syncProduct() { return { outcome: 'synced' as const, rowNumber: 12 }; },
  } as unknown as ProductSheetService;
  return new ProductService(repo, sheets, espelhoLojaFalso, {} as TaxRuleService, creareDriveParado());
}

const daLoja: CurrentUser = { ...admin, role: 'user', loja: 'LI' };

/** Bloco fiscal como o banco guarda. */
const fiscalGuardado = (over: Record<string, unknown> = {}) => ({
  ncm: '18063110', cest: null, categoria: null, cstPisCofins: '1',
  aliquotaCheia: 0, aliquotaFcp: 0, aliquotaPis: 0, aliquotaCofins: 0,
  reducaoIcms: 0, icms: 0,
  tributacaoSimples: 'TRIBUTADO INTEGRAL', aliquotaSimples: 11.28, icmsRe: 3.69,
  baseFiscal: 'Regra geral', codigoFiscal: null, produtoFiscal: null,
  cstReforma: '000', cClassTrib: '000001', aliquotaIbs: 0, aliquotaCbs: 0,
  origemFiscal: 'grupo', aliquotaEcf: 'SUBST TRIB', aliquotaEcfId: '10',
  ...over,
});

describe('ProductService.update — o guarda do fiscal e os falsos positivos', () => {
  it('a loja salva mesmo com a tela devolvendo zero guardado como null', async () => {
    const p = produto({ loja: 'LI', fiscal: fiscalGuardado() as never });
    const service = fakesGuardaFiscal(p);

    // exatamente o que `buildFiscal()` monta: zeros viram null
    const daTela = {
      ncm: '18063110', cest: null, categoria: null, cstPisCofins: '1',
      aliquotaCheia: null, aliquotaFcp: null, aliquotaPis: null, aliquotaCofins: null,
      reducaoIcms: null, icms: null,
      tributacaoSimples: 'TRIBUTADO INTEGRAL', aliquotaSimples: 11.28, icmsRe: 3.69,
      baseFiscal: 'Regra geral', codigoFiscal: null, produtoFiscal: null,
      cstReforma: '000', cClassTrib: '000001', aliquotaIbs: null, aliquotaCbs: null,
      origemFiscal: 'grupo',
      // a tela nem conhece estes dois
    };

    const r = await service.update(daLoja, ID, { nome: 'NOME NOVO', fiscal: daTela as never });

    expect(r.nome).toBe('NOME NOVO');
  });

  it('a loja salva mesmo sem devolver os campos de ECF, que a tela não conhece', async () => {
    const p = produto({ loja: 'LI', fiscal: fiscalGuardado() as never });
    const service = fakesGuardaFiscal(p);
    const { aliquotaEcf: _a, aliquotaEcfId: _b, ...semEcf } = fiscalGuardado();

    const r = await service.update(daLoja, ID, { nome: 'NOME NOVO', fiscal: semEcf as never });

    expect(r.nome).toBe('NOME NOVO');
  });

  it('mas mudar um campo que a pessoa DIGITA continua barrado', async () => {
    const p = produto({ loja: 'LI', fiscal: fiscalGuardado() as never });
    const service = fakesGuardaFiscal(p);
    const adulterado = fiscalGuardado({ ncm: '99999999' });

    await expect(service.update(daLoja, ID, { nome: 'X', fiscal: adulterado as never }))
      .rejects.toMatchObject({ code: 'ONLY_ADMIN_FISCAL' });
  });

  it('trocar a alíquota cheia por um valor de verdade também é barrado', async () => {
    const p = produto({ loja: 'LI', fiscal: fiscalGuardado() as never });
    const service = fakesGuardaFiscal(p);
    const adulterado = fiscalGuardado({ aliquotaCheia: 18 });

    await expect(service.update(daLoja, ID, { nome: 'X', fiscal: adulterado as never }))
      .rejects.toMatchObject({ code: 'ONLY_ADMIN_FISCAL' });
  });
});

/**
 * Completar a carga fiscal de quem nunca a teve.
 *
 * Produto criado pela Central não passa por `classify()`, e produto cadastrado
 * antes de a fonte de ECF existir ficou com CST e NCM e mais nada. Como a
 * classificação só rodava quando o GRUPO mudava, esses produtos nunca recebiam
 * alíquota, redução, ECF nem CEST — abrir e salvar não adiantava.
 */
const regraComEcf = {
  grupo: 'MER PADARIA', cstPisCofins: '1', tributacaoSimples: 'TRIBUTADO INTEGRAL',
  aliquotaSimples: 11.28, icmsRe: 3.69, baseFiscal: 'Regra geral', margemPadrao: null,
  ncm: '19059090', codigoFiscal: null, produtoFiscal: null,
  cstReforma: null, cClassTrib: null, aliquotaIbs: null, aliquotaCbs: null,
  origem: 'grupo' as const,
  ecf: {
    reducaoIcms: 53.33, aliquotaCheia: 18, aliquotaFcp: 0,
    aliquotaPis: 0, aliquotaCofins: 0,
    aliquotaEcf: '18,00%', aliquotaEcfId: '03',
    categoria: 'PRODUTOS DA CASA (ALIQUOTA EFETIVA)', icms: 0, cest: null,
  },
};

function fakesCargaFiscal(p: Product, classifyEspiao: string[] = []) {
  const repo = {
    async findById() { return p; },
    async update(_id: string, payload: Record<string, unknown>) { return { ...p, ...payload }; },
    async listByBaseProductId() { return []; },
  } as unknown as ProductRepository;
  const sheets = {
    async registerPending() {},
    async syncProduct() { return { outcome: 'synced' as const, rowNumber: 12 }; },
  } as unknown as ProductSheetService;
  const taxRules = {
    async classify() { return regraComEcf; },
    async classificar(entrada: { grupo?: string | null; nome?: string | null }) {
      classifyEspiao.push(`${entrada.grupo ?? ''}|${entrada.nome ?? ''}`);
      return { estado: 'completo', motivo: 'Fiscal completo.', classificacao: regraComEcf, conflitos: [] };
    },
  } as unknown as TaxRuleService;
  return new ProductService(repo, sheets, espelhoLojaFalso, taxRules, creareDriveParado());
}

/** Bloco fiscal como fica um produto criado pela Central: quase tudo vazio. */
const fiscalMagro = {
  ncm: '19059090', cest: null, categoria: null, cstPisCofins: '1',
  aliquotaCheia: null, aliquotaFcp: null, aliquotaPis: null, aliquotaCofins: null,
  reducaoIcms: null, icms: null,
  tributacaoSimples: null, aliquotaSimples: null, icmsRe: null, baseFiscal: null,
  codigoFiscal: null, produtoFiscal: null, cstReforma: null, cClassTrib: null,
  aliquotaIbs: null, aliquotaCbs: null, origemFiscal: null,
  aliquotaEcf: null, aliquotaEcfId: null,
};

describe('ProductService.update — completa a carga fiscal que faltava', () => {
  it('produto com grupo e sem carga recebe alíquota, redução e ECF ao salvar', async () => {
    const chamou: string[] = [];
    const p = produto({ grupo: 'MER PADARIA', nome: 'BOLO REDONDO LARANJA', fiscal: fiscalMagro as never });
    const service = fakesCargaFiscal(p, chamou);

    // salva SEM tocar em grupo nem em código de barras
    const r = await service.update(admin, ID, { nome: 'BOLO REDONDO LARANJA' });

    expect(chamou).toEqual(['MER PADARIA|BOLO REDONDO LARANJA']); // o nome casa o ECF
    expect(r.fiscal).toMatchObject({
      aliquotaCheia: 18,
      reducaoIcms: 53.33,
      aliquotaEcf: '18,00%',
      aliquotaEcfId: '03',
      categoria: 'PRODUTOS DA CASA (ALIQUOTA EFETIVA)',
    });
  });

  it('quem JÁ tem carga não é reclassificado — completar é ato único', async () => {
    const chamou: string[] = [];
    const p = produto({
      grupo: 'MER PADARIA',
      fiscal: { ...fiscalMagro, aliquotaCheia: 7, aliquotaEcf: 'SUBST TRIB' } as never,
    });
    const service = fakesCargaFiscal(p, chamou);

    const r = await service.update(admin, ID, { nome: 'X' });

    expect(chamou).toEqual([]); // nem chamou a regra
    expect(r.fiscal).toMatchObject({ aliquotaCheia: 7, aliquotaEcf: 'SUBST TRIB' });
  });

  it('sem grupo não tenta nada: não há regra de onde tirar', async () => {
    const chamou: string[] = [];
    const p = produto({ grupo: null as never, fiscal: fiscalMagro as never });
    const service = fakesCargaFiscal(p, chamou);

    await service.update(admin, ID, { nome: 'X' });

    expect(chamou).toEqual([]);
  });

  it('Google fora do ar não derruba a edição — salva sem o fiscal', async () => {
    const p = produto({ grupo: 'MER PADARIA', fiscal: fiscalMagro as never });
    const repo = {
      async findById() { return p; },
      async update(_id: string, payload: Record<string, unknown>) { return { ...p, ...payload }; },
      async listByBaseProductId() { return []; },
    } as unknown as ProductRepository;
    const sheets = {
      async registerPending() {},
      async syncProduct() { return { outcome: 'synced' as const, rowNumber: 12 }; },
    } as unknown as ProductSheetService;
    const taxRules = {
      async classify() { throw new Error('Sheets fora do ar'); },
      // O motor NÃO lança: traduz a queda em estado, e o cadastro segue. Um
      // erro aqui derrubaria a edição por causa de imposto, que é o contrário
      // do contrato.
      async classificar() {
        return {
          estado: 'fonte_indisponivel',
          motivo: 'Não consegui ler a tabela fiscal agora.',
          classificacao: null,
          conflitos: [],
        };
      },
    } as unknown as TaxRuleService;
    const service = new ProductService(repo, sheets, espelhoLojaFalso, taxRules, creareDriveParado());

    const r = await service.update(admin, ID, { nome: 'NOME NOVO' });

    expect(r.nome).toBe('NOME NOVO'); // a edição valeu
  });
});

/**
 * `estado` e `motivo` do fiscal pertencem ao SERVIDOR.
 *
 * A tela monta o bloco fiscal campo a campo e não conhece os dois; o zod os
 * preenche com `null` por padrão. Sem a limpeza na entrada, cada salvamento
 * apagaria a pendência — e um produto com grupo inválido voltaria a parecer
 * resolvido na primeira edição de preço.
 */
describe('ProductService — estado fiscal é do servidor', () => {
  const comPendencia = {
    ...fiscalMagro,
    aliquotaCheia: 7, // já tem carga: não entra no caminho de completar
    estado: 'pendente_conflito',
    motivo: 'O grupo diz CST 1 e o ECF diz CST 4.',
  };

  it('payload do cliente não apaga a pendência gravada', async () => {
    let gravado: Record<string, unknown> | undefined;
    const p = produto({ grupo: 'MER PADARIA', fiscal: comPendencia as never });
    const repo = {
      async findById() { return p; },
      async update(_id: string, payload: Record<string, unknown>) { gravado = payload; return p; },
      async listByBaseProductId() { return []; },
    } as unknown as ProductRepository;
    const sheets = {
      async registerPending() {},
      async syncProduct() { return { outcome: 'synced' as const, rowNumber: 12 }; },
    } as unknown as ProductSheetService;
    const service = new ProductService(repo, sheets, espelhoLojaFalso, {} as TaxRuleService, creareDriveParado());

    // é o que a tela manda: bloco fiscal completo, com estado NULO
    await service.update(admin, ID, {
      nome: 'NOME NOVO',
      fiscal: { ...comPendencia, estado: null, motivo: null } as never,
    });

    const fiscalGravado = (gravado?.fiscal ?? {}) as Record<string, unknown>;
    /*
     * A asserção é sobre a PRESENÇA da chave, não sobre o valor: `estado: null`
     * e "sem a chave" gravam coisas diferentes no banco — o primeiro apaga a
     * pendência, o segundo a preserva. Comparar valores com `??` mascarava
     * justamente essa diferença.
     */
    expect(Object.prototype.hasOwnProperty.call(fiscalGravado, 'estado')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(fiscalGravado, 'motivo')).toBe(false);
  });
});

/**
 * A planilha não pode segurar quem está no balcão.
 *
 * Medido em 14/09/2026: ler quatro células da aba combinada não voltou em 30
 * segundos — a planilha de produção está com 8,88 milhões de células, 88,8% do
 * limite do Google. Enquanto isso, `create`/`update` ESPERAVAM o espelho para
 * responder. O produto já estava salvo no banco desde o primeiro instante, mas
 * a tela girava, e quem cadastrava concluía que não tinha salvado e cadastrava
 * de novo.
 *
 * O prazo aqui não conserta a planilha. Ele devolve a tela para a pessoa e
 * entrega o espelho a quem tem paciência: a fila de reenvio, que roda a cada
 * cinco minutos e sabe repetir com recuo.
 */
describe('ProductService — planilha lenta não pendura a tela', () => {
  /** Serviço de planilha que nunca responde, como a planilha real hoje. */
  const sheetsQueTrava = {
    async registerPending() {},
    syncProduct: () => new Promise(() => {}),
  } as unknown as ProductSheetService;

  const repoSimples = {
    async findById() { return produto(); },
    async update() { return produto({ nome: 'NOME NOVO' }); },
    async listByBaseProductId() { return []; },
  } as unknown as ProductRepository;

  it('edição devolve `pending` em vez de esperar para sempre', async () => {
    vi.useFakeTimers();
    try {
      const service = new ProductService(
        repoSimples, sheetsQueTrava, espelhoLojaFalso, {} as TaxRuleService, creareDriveParado(),
      );

      const emCurso = service.update(admin, ID, { nome: 'NOME NOVO' });
      await vi.advanceTimersByTimeAsync(PRAZO_ESPELHO_NA_TELA + 1);
      const r = await emCurso;

      expect(r.nome).toBe('NOME NOVO'); // o banco decidiu, e decidiu na hora
      expect(r.sheetSync).toBe('pending');
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * `pending` e `failed` são coisas diferentes e a tela precisa distinguir:
   * uma volta sozinha pela fila, a outra já foi tentada e recusada.
   */
  it('planilha que responde a tempo continua devolvendo o resultado real', async () => {
    const { service } = fakesUpdate({ syncOutcome: 'synced' });

    const r = await service.update(admin, ID, { nome: 'NOME NOVO' });

    expect(r.sheetSync).toBe('synced');
  });
});
