import type { AuthSchemas } from '@pralis/shared';

type User = AuthSchemas.UserEntity;

/** Estado e ações de autenticação (cookie httpOnly via API). */
export function useAuth() {
  const user = useState<User | null>('auth-user', () => null);
  const apiBase = useRuntimeConfig().public.apiBase as string;
  const base = { baseURL: apiBase, credentials: 'include' as const };

  async function fetchMe() {
    try {
      const r = await $fetch<{ data: User }>('/auth/me', { ...base });
      user.value = r.data;
    } catch {
      user.value = null;
    }
    return user.value;
  }

  async function login(email: string, password: string) {
    const r = await $fetch<{ data: User }>('/auth/login', { ...base, method: 'POST', body: { email, password } });
    user.value = r.data;
    return r.data;
  }

  async function register(name: string, email: string, password: string, loja?: 'TNP' | 'LI' | 'HORA') {
    // não loga: a conta só ativa após confirmar o código enviado por e-mail.
    // admin não envia loja (o servidor define como sem loja / casa = BASE)
    await $fetch('/auth/register', { ...base, method: 'POST', body: { name, email, password, ...(loja ? { loja } : {}) } });
  }

  async function verify(email: string, code: string) {
    const r = await $fetch<{ data: User }>('/auth/verify', { ...base, method: 'POST', body: { email, code } });
    user.value = r.data;
    return r.data;
  }

  async function resend(email: string) {
    await $fetch('/auth/resend', { ...base, method: 'POST', body: { email } });
  }

  async function forgotPassword(email: string) {
    await $fetch('/auth/forgot-password', { ...base, method: 'POST', body: { email } });
  }

  async function resetPassword(email: string, code: string, password: string) {
    await $fetch('/auth/reset-password', { ...base, method: 'POST', body: { email, code, password } });
  }

  async function logout() {
    try {
      await $fetch('/auth/logout', { ...base, method: 'POST' });
    } catch {
      /* ignore */
    }
    user.value = null;
    await navigateTo('/login');
  }

  return { user, fetchMe, login, register, verify, resend, forgotPassword, resetPassword, logout };
}
