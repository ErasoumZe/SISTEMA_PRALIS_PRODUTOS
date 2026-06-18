export default defineNuxtRouteMiddleware(async (to) => {
  // valida no client (o cookie é httpOnly e enviamos com credentials)
  if (import.meta.server) return;

  const { user, fetchMe } = useAuth();
  if (!user.value) await fetchMe();

  const isLogin = to.path === '/login';
  if (!user.value && !isLogin) return navigateTo('/login');
  if (user.value && isLogin) return navigateTo('/');
});
