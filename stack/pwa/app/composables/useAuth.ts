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

  async function register(name: string, email: string, password: string) {
    await $fetch('/auth/register', { ...base, method: 'POST', body: { name, email, password } });
    return login(email, password);
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

  return { user, fetchMe, login, register, logout };
}
