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
  if (user.value && tela && !podeVer(tela.id)) return navigateTo('/');
});
