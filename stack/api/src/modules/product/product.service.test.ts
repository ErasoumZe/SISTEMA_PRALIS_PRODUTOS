import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import type { ProductSchemas } from '@pralis/shared';
import { ProductService } from './product.service';
import type { ProductRepository } from './product.repository';
import type { ProductSheetService } from '@/modules/google-sheets/product-sheet.service';
import type { ProductSheetLojaService } from '@/modules/google-sheets/product-sheet-loja.service';
import type { TaxRuleService } from '@/modules/apoio/tax-rule.service';
import type { CurrentUser } from '@/types/fastify-jwt';

type Product = ProductSchemas.ProductEntity;

/*
 * Espelho das abas de loja: desligado em todos os testes deste arquivo. Eles
 * cuidam de cadastro e fiscal; o espelho tem os proprios testes. O stub existe
 * so para o servico ter o colaborador na posicao certa do construtor.
 */
const espelhoLojaFalso = {
  async espelharVarios() { return 'desligado' as const; },
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

  const service = new ProductService(repo, sheets, espelhoLojaFalso, {} as TaxRuleService);
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
  const repo = {
    async findById() { return produto({ loja: (opts.loja ?? 'BASE') as Product['loja'] }); },
    async update() {
      chamadas.push('banco:update');
      return produto({ loja: (opts.loja ?? 'BASE') as Product['loja'], nome: 'NOME NOVO' });
    },
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

  return { service: new ProductService(repo, sheets, espelhoLojaFalso, {} as TaxRuleService), chamadas };
}

describe('ProductService.update — o resultado do espelho não pode sumir', () => {
  it('edição bem espelhada devolve sheetSync synced', async () => {
    const { service } = fakesUpdate();

    const r = await service.update(admin, ID, { nome: 'NOME NOVO' });

    expect(r.sheetSync).toBe('synced');
    expect(r.nome).toBe('NOME NOVO');
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

  it('produto de loja não é espelhado nesta etapa: skipped, sem chamar o Google', async () => {
    const { service, chamadas } = fakesUpdate({ loja: 'TNP' });

    const r = await service.update(admin, ID, { nome: 'NOME NOVO' });

    expect(r.sheetSync).toBe('skipped');
    expect(chamadas).toEqual(['banco:update']);
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

  return { service: new ProductService(repo, sheets, espelhoLojaFalso, {} as TaxRuleService), patches };
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

  const taxRules = {
    async classify() {
      return {
        grupo: 'MER PADARIA', ncm: '19051000', cstPisCofins: '01', tributacaoSimples: null,
        aliquotaSimples: null, icmsRe: null, baseFiscal: null, codigoFiscal: null,
        produtoFiscal: null, cstReforma: null, cClassTrib: null, aliquotaIbs: null,
        aliquotaCbs: null, origem: null,
      };
    },
  } as unknown as TaxRuleService;

  return new ProductService(repo, sheets, espelhoLojaFalso, taxRules);
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
    const atual = fiscalDe('19051000');
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
    const service = new ProductService(repo, sheets, espelhoLojaFalso, taxRules);

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
    const service = new ProductService(repo, sheets, espelhoLojaFalso, taxRules);

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
    const taxRules = {
      async classify() {
        return {
          grupo: 'NOVO GRUPO', ncm: '19059090', cstPisCofins: '01', tributacaoSimples: 'REGRA',
          aliquotaSimples: 7.4, icmsRe: 0, baseFiscal: 'REGRA', codigoFiscal: null,
          produtoFiscal: null, cstReforma: null, cClassTrib: null, aliquotaIbs: null,
          aliquotaCbs: null, origem: 'grupo',
        };
      },
    } as unknown as TaxRuleService;
    const service = new ProductService(repo, sheets, espelhoLojaFalso, taxRules);

    await service.update(colaboradorTnp, ID, { grupo: 'NOVO GRUPO', fiscal: fiscalMalicioso });

    expect((payloadGravado?.fiscal as Product['fiscal'])?.ncm).toBe('19059090');
    expect((payloadGravado?.fiscal as Product['fiscal'])?.ncm).not.toBe('99999999');
    expect((payloadGravado?.fiscal as Product['fiscal'])?.tributacaoSimples).toBe('REGRA');
  });
});
