<script setup lang="ts">
import type { AdminSchemas } from '@pralis/shared';

const api = useApi();
const { user: atual } = useAuth();
const users = ref<AdminSchemas.AdminUser[]>([]);
const loading = ref(true);
const erro = ref('');
const salvandoId = ref<string | null>(null);

async function load() {
  loading.value = true;
  erro.value = '';
  try {
    users.value = await api.listUsers();
  } catch {
    erro.value = 'Não foi possível carregar os usuários.';
  } finally {
    loading.value = false;
  }
}
onMounted(load);

async function toggleRole(u: AdminSchemas.AdminUser) {
  const novo = u.role === 'admin' ? 'user' : 'admin';
  const acao = novo === 'admin' ? `Promover ${u.name} a administrador?` : `Rebaixar ${u.name} para usuário comum?`;
  if (!confirm(acao)) return;
  salvandoId.value = u.id;
  erro.value = '';
  try {
    await api.setUserRole(u.id, novo);
    await load();
  } catch (e: unknown) {
    const err = e as { data?: { message?: string } };
    erro.value = err?.data?.message || 'Não foi possível alterar a permissão.';
  } finally {
    salvandoId.value = null;
  }
}

function quando(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR');
}
const lojaColor: Record<string, string> = { TNP: 'primary', LI: 'teal', HORA: 'orange' };
</script>

<template>
  <div>
    <div class="d-flex align-center mb-5">
      <div class="text-body-2 text-medium-emphasis">Gerencie quem tem acesso de administrador.</div>
      <v-spacer />
      <v-btn variant="tonal" color="primary" prepend-icon="mdi-refresh" :loading="loading" @click="load">Atualizar</v-btn>
    </div>

    <v-alert v-if="erro" type="error" variant="tonal" class="mb-4">{{ erro }}</v-alert>

    <v-card flat border rounded="lg">
      <v-progress-linear v-if="loading" indeterminate color="primary" />
      <v-table>
        <thead>
          <tr>
            <th class="text-left">Usuário</th>
            <th class="text-left">Loja</th>
            <th class="text-left">Permissão</th>
            <th class="text-center">Produtos</th>
            <th class="text-left">Desde</th>
            <th class="text-right">Ação</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in users" :key="u.id">
            <td>
              <div class="d-flex align-center ga-3 py-2">
                <v-avatar :color="u.role === 'admin' ? 'deep-purple' : 'primary'" size="38">
                  {{ u.name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase() }}
                </v-avatar>
                <div style="line-height: 1.2">
                  <div class="font-weight-medium">
                    {{ u.name }}
                    <v-chip v-if="u.id === atual?.id" size="x-small" color="grey" label class="ml-1">você</v-chip>
                  </div>
                  <div class="text-caption text-medium-emphasis">{{ u.email }}</div>
                </div>
              </div>
            </td>
            <td><v-chip :color="lojaColor[u.loja] || 'grey'" size="small" label>{{ u.loja }}</v-chip></td>
            <td>
              <v-chip :color="u.role === 'admin' ? 'deep-purple' : 'grey'" size="small" label :prepend-icon="u.role === 'admin' ? 'mdi-shield-crown' : 'mdi-account'">
                {{ u.role === 'admin' ? 'Administrador' : 'Usuário' }}
              </v-chip>
              <v-icon v-if="!u.emailVerified" size="16" color="warning" class="ml-2" title="E-mail não confirmado">mdi-email-alert</v-icon>
            </td>
            <td class="text-center font-weight-medium">{{ u.produtos }}</td>
            <td class="text-medium-emphasis">{{ quando(u.createdAt) }}</td>
            <td class="text-right">
              <v-btn
                v-if="u.id !== atual?.id"
                size="small"
                variant="tonal"
                :color="u.role === 'admin' ? 'error' : 'deep-purple'"
                :loading="salvandoId === u.id"
                :prepend-icon="u.role === 'admin' ? 'mdi-arrow-down-bold' : 'mdi-arrow-up-bold'"
                @click="toggleRole(u)"
              >
                {{ u.role === 'admin' ? 'Rebaixar' : 'Tornar admin' }}
              </v-btn>
              <span v-else class="text-caption text-medium-emphasis">—</span>
            </td>
          </tr>
          <tr v-if="!loading && !users.length">
            <td colspan="6" class="text-center text-medium-emphasis py-8">Nenhum usuário.</td>
          </tr>
        </tbody>
      </v-table>
    </v-card>
  </div>
</template>
