import { inject, injectable } from 'tsyringe';
import { z } from 'zod/v4';
import { env } from '@/config/env';
import { AppError } from '@/config/api.replies';
import { CreareService } from './creare.service';
import type { CreareStore } from './creare.config';
import { DRIVE_GATEWAY, type DriveGateway } from './creare-drive.di';

/**
 * Publica o TXT do cadastro da loja numa pasta do Google Drive.
 *
 * POR QUE O DRIVE, E NÃO UMA PASTA
 *
 * A máquina da loja enxerga a pasta do Drive montada (`H:\...`); a API não —
 * ela roda em container e `H:` só existe lá. Publicando no Drive, o Drive para
 * Desktop entrega o arquivo na loja sem nada agendado e sem ninguém logado.
 *
 * O ARQUIVO É O CATÁLOGO INTEIRO, E ISSO É DE PROPÓSITO
 *
 * Cada publicação reescreve o arquivo com TODOS os produtos da loja. Publicar
 * só o produto recém-salvo seria menor e mais rápido, mas salvar dois produtos
 * antes de importar faria o segundo apagar o primeiro — e o primeiro nunca
 * chegaria ao PDV, em silêncio. Com o catálogo inteiro não há o que perder, e
 * reaplicar produto inalterado é inofensivo: o importador casa pelo `coditem`
 * e atualiza com o mesmo valor.
 *
 * NUNCA LANÇA
 *
 * Todo caminho devolve um estado. Salvar produto não pode falhar porque o
 * Google está fora do ar, e quem chama grava o produto primeiro.
 */

export type ResultadoPublicacao =
  | 'publicado'
  | 'desligado'
  | 'sem_pasta'
  /** O arquivo ainda não existe na pasta. Uma PESSOA precisa criá-lo uma vez. */
  | 'sem_arquivo'
  | 'sem_depara'
  | 'sem_produtos'
  | 'falhou';

/*
 * Chave livre, e nao `z.enum` como chave do record: no Zod v4 um record com
 * chave de enum exige TODAS as chaves do enum, entao `{"TNP":"..."}` sozinho
 * era recusado e a publicacao saia como `sem_pasta` sem dizer por que.
 * As lojas validas sao filtradas depois.
 */
const pastasSchema = z.record(z.string(), z.string().trim().min(1));
const LOJAS_VALIDAS = new Set<string>(['TNP', 'LI', 'HORA']);

@injectable()
export class CreareDriveService {
  constructor(
    @inject(CreareService) private creare: CreareService,
    @inject(DRIVE_GATEWAY) private drive: DriveGateway,
  ) {}

  /**
   * Nunca lança nem inclui o JSON recebido no erro: configuração não deve
   * vazar em log nem em resposta.
   */
  private pastas(): Partial<Record<CreareStore, string>> {
    if (!env.CREARE_DRIVE_FOLDERS_JSON.trim()) return {};
    try {
      const parsed = pastasSchema.safeParse(JSON.parse(env.CREARE_DRIVE_FOLDERS_JSON));
      if (!parsed.success) return {};
      const saida: Partial<Record<CreareStore, string>> = {};
      for (const [loja, pasta] of Object.entries(parsed.data)) {
        if (LOJAS_VALIDAS.has(loja)) saida[loja as CreareStore] = pasta;
      }
      return saida;
    } catch {
      return {};
    }
  }

  /** As lojas que têm pasta configurada. Vazio = ninguém recebe nada. */
  lojasConfiguradas(): CreareStore[] {
    return Object.keys(this.pastas()) as CreareStore[];
  }

  /** O nome é por loja: duas lojas nunca dividem arquivo, nem por engano. */
  private nomeDoArquivo(loja: CreareStore): string {
    return `cadastro-${loja.toLowerCase()}.txt`;
  }

  async publicar(loja: CreareStore): Promise<ResultadoPublicacao> {
    if (!env.CREARE_DRIVE_ENABLED) return 'desligado';
    const pasta = this.pastas()[loja];
    if (!pasta) return 'sem_pasta';

    let arquivo: Buffer;
    try {
      arquivo = await this.creare.generate(loja);
    } catch (erro) {
      /*
       * Os dois casos esperados ganham nome próprio porque são ACIONÁVEIS e
       * vão aparecer na tela: sem de-para importado, e loja sem nenhum produto
       * casado. O resto é falha mesmo.
       */
      if (erro instanceof AppError && erro.code === 'CREARE_DEPARA_MISSING') return 'sem_depara';
      if (erro instanceof AppError && erro.code === 'CREARE_EMPTY') return 'sem_produtos';
      return 'falhou';
    }

    try {
      const nome = this.nomeDoArquivo(loja);
      const existente = await this.drive.acharArquivo(pasta, nome);
      /*
       * Não criamos o arquivo: conta de serviço não tem cota de armazenamento
       * e a criação falharia com `storageQuotaExceeded` dentro do "Meu Drive"
       * de alguém — que é onde a pasta da loja mora (conta Gmail comum não tem
       * "Drive compartilhado", que seria a saída). Atualizar arquivo alheio
       * funciona, porque a cota continua sendo do dono.
       *
       * Então o arquivo é criado UMA VEZ por uma pessoa, e `sem_arquivo` é o
       * recado de que esse passo ainda não foi dado.
       */
      if (!existente) return 'sem_arquivo';
      await this.drive.atualizarArquivo(existente, arquivo);
      return 'publicado';
    } catch {
      return 'falhou';
    }
  }

  /**
   * O que publicar depois de salvar um produto daquele catálogo.
   *
   * Produto de loja mexe só no arquivo da própria loja. Produto da BASE pode
   * descer para todas elas (`propagarParaLojas`), então republica todas as
   * configuradas — são uma ou duas, e republicar arquivo que não mudou é
   * barato perto de deixar o PDV com cadastro velho.
   */
  async publicarAposSalvar(loja: string): Promise<Partial<Record<CreareStore, ResultadoPublicacao>>> {
    if (!env.CREARE_DRIVE_ENABLED) return {};
    const configuradas = this.lojasConfiguradas();
    const alvos = loja === 'BASE'
      ? configuradas
      : configuradas.filter((l) => l === loja);

    const resultado: Partial<Record<CreareStore, ResultadoPublicacao>> = {};
    for (const alvo of alvos) resultado[alvo] = await this.publicar(alvo);
    return resultado;
  }
}
