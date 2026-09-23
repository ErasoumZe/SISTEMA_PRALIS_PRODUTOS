import { inject, injectable } from 'tsyringe';
import { Telas } from '@pralis/shared';
import { AppError } from '@/config/api.replies';
import { env } from '@/config/env';
import type { CurrentUser } from '@/types/fastify-jwt';
import { PermissaoRepository, type PermissaoRepo } from './permissao.repository';
import {
  MOTIVO_EM_PORTUGUES,
  ehAdminRaiz,
  podeGerenciar,
  telasDe,
  type PessoaPermissao,
} from './permissao.motor';

export interface LinhaDePermissao {
  userId: string;
  nome: string;
  email: string;
  role: 'admin' | 'user';
  loja: string | null;
  ativo: boolean;
  adminRaiz: boolean;
  /** Este ator pode mexer nas permissões desta pessoa? */
  gerenciavel: boolean;
  /** Por que não, quando não. */
  motivo: string | null;
  telas: string[];
}

export interface PainelDePermissoes {
  telas: typeof Telas.TELAS;
  secoes: typeof Telas.SECOES;
  sempreLiberadas: readonly string[];
  pessoas: LinhaDePermissao[];
}

@injectable()
export class PermissaoService {
  constructor(@inject(PermissaoRepository) private repo: PermissaoRepo) {}

  /** As telas de quem está logado — é o que o menu e a guarda de rota consomem. */
  async telasDoUsuario(userId: string): Promise<string[]> {
    const pessoa = await this.repo.pessoa(userId);
    if (!pessoa) return [];
    return telasDe(pessoa, pessoa.regras, env.ADMIN_EMAIL);
  }

  /**
   * O mesmo, para quem JÁ tem a pessoa em mãos — o `authMiddleware`.
   *
   * Existe por custo: isto roda em toda requisição autenticada, e reler o
   * usuário que o middleware acabou de buscar dobraria as consultas do sistema
   * inteiro para não descobrir nada novo.
   */
  async telasDaPessoa(pessoa: PessoaPermissao): Promise<string[]> {
    if (ehAdminRaiz(pessoa.email, env.ADMIN_EMAIL)) return [...Telas.TODAS_AS_TELAS];
    return telasDe(pessoa, await this.repo.regrasDe(pessoa.id), env.ADMIN_EMAIL);
  }

  /**
   * A guarda do servidor.
   *
   * Substitui os `exigirAdmin` copiados em 25 controllers. A diferença que
   * importa: antes a pergunta era "é admin?", agora é "esta pessoa tem esta
   * tela?" — que é o que a tela de permissões promete decidir. Sem isto, ligar
   * um toggle mostraria a tela e a API recusaria mesmo assim.
   */
  async exigir(user: CurrentUser | undefined, telaId: string): Promise<CurrentUser> {
    if (!user) throw new AppError('Não autenticado', 401, 'UNAUTHENTICATED');
    const permitidas = await this.telasDoUsuario(user.id);
    if (!permitidas.includes(telaId)) {
      const tela = Telas.telaPorId(telaId);
      throw new AppError(
        `Você não tem acesso a "${tela?.titulo ?? telaId}". Peça a liberação ao administrador.`,
        403,
        'FORBIDDEN',
      );
    }
    return user;
  }

  private ator(user: CurrentUser): PessoaPermissao {
    return { id: user.id, email: user.email, role: user.role as 'admin' | 'user' };
  }

  async painel(user: CurrentUser): Promise<PainelDePermissoes> {
    await this.exigir(user, 'permissoes');
    const ator = this.ator(user);
    const pessoas = await this.repo.pessoas();

    return {
      telas: Telas.TELAS,
      secoes: Telas.SECOES,
      sempreLiberadas: Telas.TELAS_SEMPRE_LIBERADAS,
      pessoas: pessoas.map((p) => {
        const gestao = podeGerenciar(ator, p, env.ADMIN_EMAIL);
        return {
          userId: p.id,
          nome: p.nome,
          email: p.email,
          role: p.role,
          loja: p.loja,
          ativo: p.ativo,
          adminRaiz: ehAdminRaiz(p.email, env.ADMIN_EMAIL),
          gerenciavel: gestao.pode,
          motivo: gestao.pode ? null : MOTIVO_EM_PORTUGUES[gestao.motivo],
          telas: telasDe(p, p.regras, env.ADMIN_EMAIL),
        };
      }),
    };
  }

  async alternar(
    user: CurrentUser,
    pedido: { userId: string; telaId: string; permitido: boolean },
  ): Promise<{ userId: string; telas: string[] }> {
    await this.exigir(user, 'permissoes');

    if (!Telas.telaPorId(pedido.telaId)) {
      throw new AppError(`Tela desconhecida: ${pedido.telaId}.`, 422);
    }
    /*
     * Recusa ANTES de olhar quem é o alvo: uma tela sempre liberada não é
     * negociável para ninguém, e deixar a mensagem depender do alvo faria
     * parecer que é questão de permissão do ator.
     */
    if (Telas.TELAS_SEMPRE_LIBERADAS.includes(pedido.telaId) && !pedido.permitido) {
      const tela = Telas.telaPorId(pedido.telaId)!;
      throw new AppError(
        `"${tela.titulo}" não pode ser desligada: sem ela a pessoa ficaria logada sem nenhuma tela.`,
        422,
      );
    }

    const alvo = await this.repo.pessoa(pedido.userId);
    if (!alvo) throw new AppError('Usuário não encontrado.', 404, 'NOT_FOUND');

    const gestao = podeGerenciar(this.ator(user), alvo, env.ADMIN_EMAIL);
    if (!gestao.pode) throw new AppError(MOTIVO_EM_PORTUGUES[gestao.motivo], 403, 'FORBIDDEN');

    await this.repo.gravar({
      userId: pedido.userId,
      telaId: pedido.telaId,
      permitido: pedido.permitido,
      alteradoPorUserId: user.id,
      alteradoPorNome: user.name,
    });

    const depois = await this.repo.pessoa(pedido.userId);
    return {
      userId: pedido.userId,
      telas: depois ? telasDe(depois, depois.regras, env.ADMIN_EMAIL) : [],
    };
  }
}
