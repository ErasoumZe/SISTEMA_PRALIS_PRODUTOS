import { google } from 'googleapis';
import { Readable } from 'node:stream';
import { env } from '@/config/env';

/**
 * Costura fina sobre a API do Google Drive, só para publicar o TXT do cadastro
 * numa pasta da loja.
 *
 * Ele só ATUALIZA um arquivo que já existe — nunca cria. O porquê está na nota
 * acima de `atualizarArquivo`, e é o que torna esta integração possível numa
 * pasta de conta Gmail comum.
 *
 * É um cliente separado do Sheets de propósito: o escopo é outro, e misturar
 * escopos faria a credencial do espelho da planilha ganhar permissão de
 * escrever arquivo no Drive sem ninguém ter pedido.
 *
 * REGRA: nenhuma credencial pode aparecer em log ou em mensagem de erro.
 */

export interface DriveGateway {
  /** Id do arquivo com esse nome na pasta, ou `null` se ele não existe lá. */
  acharArquivo(pastaId: string, nome: string): Promise<string | null>;
  atualizarArquivo(arquivoId: string, conteudo: Buffer): Promise<void>;
}

export class CreareDriveSobTesteError extends Error {
  constructor(operacao: string) {
    super(
      `Bloqueado: o cliente REAL do Google Drive foi acionado dentro de um teste (${operacao}). `
      + 'Injete um dublê de DriveGateway em vez de resolver o cliente real.',
    );
    this.name = 'CreareDriveSobTesteError';
  }
}

export class MissingGoogleCredentialsError extends Error {
  constructor() {
    super('Credenciais do Google não configuradas (GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY).');
    this.name = 'MissingGoogleCredentialsError';
  }
}

const sobTeste = (): boolean => !!process.env.VITEST || process.env.NODE_ENV === 'test';

/** Implementação real, com conta de serviço (JWT). */
export class GoogleDriveClient implements DriveGateway {
  private client: ReturnType<typeof google.drive> | null = null;

  constructor(
    private readonly clientEmail = env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private readonly privateKey = env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
  ) {}

  private drive() {
    /*
     * A MESMA trava do cliente do Sheets, pelo mesmo motivo: em 16/09/2026 uma
     * suíte de integração resolveu o cliente real pelo container e gravou 123
     * linhas de fixture na planilha de produção. Aqui o estrago seria entregar
     * um arquivo de teste na pasta que a loja importa no PDV.
     */
    if (sobTeste()) throw new CreareDriveSobTesteError('cliente do Drive');
    if (this.client) return this.client;
    if (!this.clientEmail || !this.privateKey) throw new MissingGoogleCredentialsError();
    const auth = new google.auth.JWT({
      email: this.clientEmail,
      key: this.privateKey,
      /*
       * `drive`, e não `drive.file`: o arquivo que vamos atualizar NÃO foi
       * criado por nós — ele é do dono da pasta, e `drive.file` só enxerga o
       * que o próprio app criou. A conta de serviço continua sem enxergar
       * nada além do que for explicitamente compartilhado com o e-mail dela.
       */
      scopes: ['https://www.googleapis.com/auth/drive'],
    });
    this.client = google.drive({ version: 'v3', auth });
    return this.client;
  }

  async acharArquivo(pastaId: string, nome: string): Promise<string | null> {
    const res = await this.drive().files.list({
      // aspas simples do nome escapadas: nome com `'` quebraria a consulta
      q: `name = '${nome.replace(/'/g, "\\'")}' and '${pastaId}' in parents and trashed = false`,
      fields: 'files(id)',
      pageSize: 2,
      // sem estes dois, a busca não enxerga Drive compartilhado
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    return res.data.files?.[0]?.id ?? null;
  }

  /*
   * NÃO existe `criarArquivo` aqui, e isso é a decisão central deste arquivo.
   *
   * Conta de serviço não tem cota de armazenamento no Google. Criar arquivo
   * dentro do "Meu Drive" de alguém falha com `storageQuotaExceeded` mesmo
   * compartilhado como Editor, e "Drive compartilhado" (que resolveria) não
   * existe em conta Gmail comum — só no Workspace. A pasta da loja é
   * exatamente esse caso: `ARQUIVO_SISTEMA_TNP`, compartilhada com uma conta
   * `@gmail.com`.
   *
   * ATUALIZAR arquivo alheio, por outro lado, funciona: a cota continua sendo
   * do dono. Por isso o arquivo é criado UMA VEZ por uma pessoa, e daí em
   * diante só recebe conteúdo novo.
   */
  async atualizarArquivo(arquivoId: string, conteudo: Buffer): Promise<void> {
    await this.drive().files.update({
      fileId: arquivoId,
      media: { mimeType: 'text/plain', body: Readable.from(conteudo) },
      supportsAllDrives: true,
    });
  }
}
