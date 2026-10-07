import { inject, injectable } from 'tsyringe';
import { FatorPontos, type FatorPontosSchemas } from '@pralis/shared';
import { AppError } from '@/config/api.replies';
import { FatorPontosRepository } from './fator-pontos.repository';

type Loja = 'TNP' | 'LI';

/**
 * A régua de pontos de cada relatório.
 *
 * QUAL RÉGUA UM RELATÓRIO USA: a vigente no PRIMEIRO DIA do período
 * consultado. É a mesma regra da matriz de metas, e ela garante que todos os
 * números de um relatório estejam na mesma unidade — um período que atravessa
 * a troca sai inteiro na régua antiga, e a soma dos dias bate com o total.
 *
 * Converter dia a dia dentro do mesmo relatório seria mais preciso na
 * fronteira e pior em tudo o mais: o total deixaria de ser a soma do que está
 * na tela, e ninguém saberia explicar a diferença.
 */
@injectable()
export class FatorPontosService {
  constructor(@inject(FatorPontosRepository) private repo: FatorPontosRepository) {}

  /** O fator de faturamento (e de meta) que vale nessa data. */
  async fatorEm(loja: Loja, data: string): Promise<number> {
    const versao = await this.repo.vigenteEm(loja, data);
    return versao?.faturamento ?? FatorPontos.FATOR_PADRAO;
  }

  /** A régua inteira, para quem precisa também do ticket. */
  async vigenteEm(loja: Loja, data: string): Promise<FatorPontosSchemas.FatorVersao | null> {
    return this.repo.vigenteEm(loja, data);
  }

  async consultar(loja: Loja, hoje: string): Promise<FatorPontosSchemas.FatorPontosResposta> {
    const [versoes, vigenteHoje] = await Promise.all([
      this.repo.listar(loja),
      this.repo.vigenteEm(loja, hoje),
    ]);
    return {
      loja,
      versoes,
      vigenteHoje,
      padrao: FatorPontos.FATOR_PADRAO,
      /*
       * A lista é literal de propósito: quem muda a régua precisa saber o que
       * vai mudar de valor na tela ANTES de salvar. Manter isto aqui, e não na
       * página, deixa o servidor dono da resposta.
       */
      ondeSeAplica: [
        'Pontuação por dia e PDV (Relatório Gerentes)',
        'Pontuação por hora e PDV',
        'Meta do período e "quanto falta"',
        'Metas por turno',
        'Áreas da loja',
        'Ranking de produtos (Relatório de vendas)',
      ],
    };
  }

  async salvar(
    entrada: FatorPontosSchemas.SalvarFatorBody,
    criadoPor: string | null,
  ): Promise<FatorPontosSchemas.FatorVersao> {
    /*
     * A validação da regra pura roda aqui também, e não só no Zod da rota:
     * é ela que carrega a MENSAGEM que a tela mostra, e é ela que um teste
     * de unidade consegue exercitar sem subir servidor.
     */
    for (const [campo, valor] of [['faturamento', entrada.faturamento], ['ticketMedio', entrada.ticketMedio]] as const) {
      const erro = FatorPontos.erroDoFator(valor);
      if (erro) throw new AppError(`${campo === 'faturamento' ? 'Faturamento' : 'Ticket médio'}: ${erro}`, 422, 'FATOR_INVALIDO');
    }
    return this.repo.salvar({ ...entrada, criadoPor });
  }

  /**
   * Apagar uma vigência muda a pontuação dos dias que ela cobria — por isso
   * existe, mas só para desfazer um cadastro errado recém-feito.
   */
  async apagar(id: string): Promise<void> {
    const apagou = await this.repo.apagar(id);
    if (!apagou) throw new AppError('Esta vigência não existe mais.', 404, 'FATOR_NAO_ENCONTRADO');
  }
}
