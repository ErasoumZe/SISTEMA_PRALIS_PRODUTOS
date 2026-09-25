import { Telas } from '@pralis/shared';

export default defineNuxtRouteMiddleware(async (to) => {
  // valida no client (o cookie é httpOnly e enviamos com credentials)
  if (import.meta.server) return;

  const { user, fetchMe, podeVer } = useAuth();
  if (!user.value) await fetchMe();

  const isLogin = to.path === '/login';
  if (!user.value && !isLogin) return navigateTo('/login');
  if (user.value && isLogin) return navigateTo('/');

  /*
   * A guarda cobre TODAS as telas do catálogo, não uma lista escrita aqui.
   *
   * A lista antiga tinha quatro caminhos. `/produtos/manutencao` — "ações que
   * não têm volta" — não estava entre eles: quem soubesse a URL entrava. O
   * servidor recusava as chamadas, mas a tela abria, e uma tela que abre
   * ensina que ela existe.
   */
  const tela = Telas.telaDoPath(to.path);
  if (user.value && tela && !podeVer(tela.id)) {
    /*
     * Devolver para a home CALADO fazia o bloqueio parecer defeito: em
     * 25/09/2026 a conta da loja clicava em "Importar da base", voltava para a
     * mesma tela e o dono do sistema foi olhar por que o botão tinha quebrado.
     * Não era o botão — era a permissão desligada, sem ninguém dizer isso.
     */
    useFlash().value = {
      tipo: 'warning',
      texto: `Você não tem acesso a "${tela.titulo}". Peça ao administrador para liberar em Permissões.`,
    };
    return navigateTo('/');
  }
});
