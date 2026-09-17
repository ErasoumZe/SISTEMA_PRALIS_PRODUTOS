import 'reflect-metadata';
import { beforeEach, describe, expect, it } from 'vitest';
import { env } from '@/config/env';
import { AppError } from '@/config/api.replies';
import { CreareDriveService } from './creare-drive.service';
import { FakeDriveGateway } from './creare-drive.fake';
import type { CreareService } from './creare.service';

const PASTA_TNP = 'pasta-da-tnp';
const ARQUIVO_TNP = 'cadastro-tnp.txt';

/** Um `CreareService` que devolve o arquivo pedido, ou o erro pedido. */
const creareFalso = (resposta: Buffer | AppError | Error): CreareService => ({
  generate: async () => {
    if (resposta instanceof Error) throw resposta;
    return resposta;
  },
} as unknown as CreareService);

const ligar = (ligado: boolean, pastas: string) => {
  (env as { CREARE_DRIVE_ENABLED: boolean }).CREARE_DRIVE_ENABLED = ligado;
  (env as { CREARE_DRIVE_FOLDERS_JSON: string }).CREARE_DRIVE_FOLDERS_JSON = pastas;
};

const CONFIG_TNP = JSON.stringify({ TNP: PASTA_TNP });
const CATALOGO = Buffer.from('linha do catalogo\n', 'latin1');

describe('publicar o TXT na pasta do Drive', () => {
  let drive: FakeDriveGateway;

  beforeEach(() => {
    drive = new FakeDriveGateway();
    ligar(true, CONFIG_TNP);
  });

  const servico = (creare: CreareService) => new CreareDriveService(creare, drive);

  it('atualiza o arquivo que ja existe na pasta', async () => {
    drive.criadoPorUmaPessoa(PASTA_TNP, ARQUIVO_TNP, Buffer.from('conteudo velho'));

    const r = await servico(creareFalso(CATALOGO)).publicar('TNP');

    expect(r).toBe('publicado');
    expect(drive.texto(PASTA_TNP, ARQUIVO_TNP)).toBe('linha do catalogo\n');
    expect(drive.atualizacoes).toHaveLength(1);
  });

  /*
   * O caso que decide o desenho inteiro deste modulo.
   *
   * Conta de servico nao tem cota de armazenamento no Google: criar arquivo
   * dentro do "Meu Drive" de alguem falha com `storageQuotaExceeded`, mesmo
   * compartilhado como Editor. E "Drive compartilhado", que resolveria, nao
   * existe em conta Gmail comum -- e a pasta da loja e exatamente esse caso.
   *
   * Por isso NAO tentamos criar: devolvemos um estado que diz o que falta.
   */
  it('nao tenta criar o arquivo -- pede que uma pessoa crie', async () => {
    const r = await servico(creareFalso(CATALOGO)).publicar('TNP');

    expect(r).toBe('sem_arquivo');
    expect(drive.atualizacoes).toHaveLength(0);
    expect(drive.arquivos.size).toBe(0);
  });

  it('desligado nao encosta no Drive', async () => {
    ligar(false, CONFIG_TNP);
    drive.criadoPorUmaPessoa(PASTA_TNP, ARQUIVO_TNP);

    expect(await servico(creareFalso(CATALOGO)).publicar('TNP')).toBe('desligado');
    expect(drive.atualizacoes).toHaveLength(0);
  });

  it('loja sem pasta configurada nao publica em pasta nenhuma', async () => {
    expect(await servico(creareFalso(CATALOGO)).publicar('LI')).toBe('sem_pasta');
    expect(drive.atualizacoes).toHaveLength(0);
  });

  /* Sem de-para o arquivo INSERE em vez de atualizar, e duplica o catalogo. */
  it('sem de-para da loja, nao publica -- e diz por que', async () => {
    const erro = new AppError('de-para ausente', 503, 'CREARE_DEPARA_MISSING');

    expect(await servico(creareFalso(erro)).publicar('TNP')).toBe('sem_depara');
    expect(drive.atualizacoes).toHaveLength(0);
  });

  it('nenhum produto casado nao publica arquivo vazio', async () => {
    const erro = new AppError('nada casou', 422, 'CREARE_EMPTY');

    expect(await servico(creareFalso(erro)).publicar('TNP')).toBe('sem_produtos');
  });

  it('Google fora do ar vira falha, nao excecao', async () => {
    drive.criadoPorUmaPessoa(PASTA_TNP, ARQUIVO_TNP);
    drive.falhar = true;

    await expect(servico(creareFalso(CATALOGO)).publicar('TNP')).resolves.toBe('falhou');
  });

  it('erro inesperado na geracao tambem vira falha', async () => {
    await expect(servico(creareFalso(new Error('boom'))).publicar('TNP')).resolves.toBe('falhou');
  });
});

describe('o que republicar depois de salvar', () => {
  let drive: FakeDriveGateway;

  beforeEach(() => {
    drive = new FakeDriveGateway();
    drive.criadoPorUmaPessoa(PASTA_TNP, ARQUIVO_TNP);
    ligar(true, CONFIG_TNP);
  });

  const servico = () => new CreareDriveService(creareFalso(CATALOGO), drive);

  /* Produto da BASE desce para as lojas: o arquivo delas mudou. */
  it('salvar na BASE republica todas as lojas configuradas', async () => {
    expect(await servico().publicarAposSalvar('BASE')).toEqual({ TNP: 'publicado' });
  });

  it('salvar na propria loja republica a loja', async () => {
    expect(await servico().publicarAposSalvar('TNP')).toEqual({ TNP: 'publicado' });
  });

  /* A LI nao tem pasta aqui: republicar a TNP por causa dela seria entregar
     cadastro que nao mudou, e esconder que a LI nao esta configurada. */
  it('salvar numa loja sem pasta nao republica a loja alheia', async () => {
    expect(await servico().publicarAposSalvar('LI')).toEqual({});
    expect(drive.atualizacoes).toHaveLength(0);
  });

  it('desligado devolve vazio sem consultar nada', async () => {
    ligar(false, CONFIG_TNP);

    expect(await servico().publicarAposSalvar('BASE')).toEqual({});
    expect(drive.atualizacoes).toHaveLength(0);
  });

  it('JSON de pastas invalido nao derruba o salvamento', async () => {
    ligar(true, '{isso nao e json');

    expect(await servico().publicarAposSalvar('BASE')).toEqual({});
  });
});
