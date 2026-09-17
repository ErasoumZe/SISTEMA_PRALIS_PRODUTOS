import type { CreareStore } from './creare.config';
import type { CreareDriveService, ResultadoPublicacao } from './creare-drive.service';
import type { DriveGateway } from './creare-drive.client';

/**
 * Dublês do caminho do Drive, para teste.
 *
 * Moram em `src` pelo mesmo motivo do `fake-sheets.gateway.ts`: o cliente real
 * recusa rodar sob teste, então quem exercita o serviço precisa de um dublê —
 * e um dublê compartilhado é melhor que cinco stubs inline discordando entre si.
 */

/** Não publica nada. É o que a maioria dos testes quer: o Drive não é o assunto. */
export class CreareDriveParado {
  readonly chamadas: string[] = [];

  async publicarAposSalvar(loja: string): Promise<Partial<Record<CreareStore, ResultadoPublicacao>>> {
    this.chamadas.push(loja);
    return {};
  }
}

export const creareDriveParado = (): CreareDriveService =>
  new CreareDriveParado() as unknown as CreareDriveService;

/** Gateway de Drive em memória: guarda o que foi criado e atualizado. */
export class FakeDriveGateway implements DriveGateway {
  /** id -> { pastaId, nome, conteudo } */
  readonly arquivos = new Map<string, { pastaId: string; nome: string; conteudo: Buffer }>();
  readonly criacoes: string[] = [];
  readonly atualizacoes: string[] = [];
  /** Ligue para simular Google fora do ar. */
  falhar = false;

  private proximoId = 1;

  async acharArquivo(pastaId: string, nome: string): Promise<string | null> {
    if (this.falhar) throw new Error('drive fora do ar');
    for (const [id, a] of this.arquivos) if (a.pastaId === pastaId && a.nome === nome) return id;
    return null;
  }

  /**
   * Cria o arquivo COMO SE uma pessoa o tivesse criado no Drive.
   *
   * Não faz parte do `DriveGateway`: o cliente real não cria nada (conta de
   * serviço não tem cota). Existe só para o teste montar o estado "o arquivo já
   * está lá" e "o arquivo ainda não está lá".
   */
  criadoPorUmaPessoa(pastaId: string, nome: string, conteudo = Buffer.from('')): string {
    const id = `arq-${this.proximoId += 1}`;
    this.arquivos.set(id, { pastaId, nome, conteudo });
    this.criacoes.push(`${pastaId}/${nome}`);
    return id;
  }

  async atualizarArquivo(arquivoId: string, conteudo: Buffer): Promise<void> {
    if (this.falhar) throw new Error('drive fora do ar');
    const atual = this.arquivos.get(arquivoId);
    if (!atual) throw new Error(`arquivo inexistente: ${arquivoId}`);
    this.arquivos.set(arquivoId, { ...atual, conteudo });
    this.atualizacoes.push(arquivoId);
  }

  /** O conteúdo publicado naquela pasta com aquele nome, como texto. */
  texto(pastaId: string, nome: string): string | null {
    for (const a of this.arquivos.values()) {
      if (a.pastaId === pastaId && a.nome === nome) return a.conteudo.toString('latin1');
    }
    return null;
  }
}
