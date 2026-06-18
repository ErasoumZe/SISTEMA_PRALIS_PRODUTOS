<script setup lang="ts">
import { useDisplay } from 'vuetify';

const { user, logout } = useAuth();
const route = useRoute();
const { mdAndUp } = useDisplay();

const isAdmin = computed(() => user.value?.role === 'admin');
const drawer = ref(true); // abre/fecha no mobile
const rail = ref(false); // colapsado (só ícones) no desktop

function toggleNav() {
  if (mdAndUp.value) rail.value = !rail.value;
  else drawer.value = !drawer.value;
}

interface NavItem { title: string; icon: string; to: string; section: string }
const nav = computed<NavItem[]>(() => {
  const items: NavItem[] = [];
  if (isAdmin.value) items.push({ title: 'Dashboard', icon: 'mdi-view-dashboard-outline', to: '/dashboard', section: 'Geral' });
  items.push({ title: 'Produtos', icon: 'mdi-package-variant-closed', to: '/', section: 'Geral' });
  if (isAdmin.value) items.push({ title: 'Usuários', icon: 'mdi-account-group-outline', to: '/usuarios', section: 'Administração' });
  return items;
});
const sections = computed(() => [...new Set(nav.value.map((n) => n.section))]);

const titulo = computed(() => {
  const map: Record<string, string> = {
    '/': 'Produtos',
    '/dashboard': 'Dashboard',
    '/usuarios': 'Usuários',
    '/importar': 'Importar da base',
    '/produtos/novo': 'Novo produto',
  };
  return map[route.path] ?? (route.path.startsWith('/produtos/') ? 'Editar produto' : 'Pralis');
});
const subtitulo = computed(() => (route.path === '/dashboard' ? 'Visão geral do painel administrativo' : ''));

const iniciais = computed(() =>
  (user.value?.name ?? '?')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase(),
);
</script>

<template>
  <v-app>
    <v-navigation-drawer
      v-model="drawer"
      :permanent="mdAndUp"
      :temporary="!mdAndUp"
      :rail="mdAndUp && rail"
      rail-width="76"
      width="264"
      color="#0f172a"
      theme="dark"
    >
      <!-- marca + botão de recolher -->
      <div class="d-flex align-center px-4 py-4" :class="rail ? 'justify-center' : 'ga-3'">
        <v-avatar color="primary" size="38" rounded="lg">
          <v-icon color="white">mdi-package-variant-closed</v-icon>
        </v-avatar>
        <div v-if="!rail" style="line-height: 1.1; min-width: 0">
          <div class="text-subtitle-1 font-weight-bold">Pralis</div>
          <div class="text-caption text-medium-emphasis text-truncate" style="letter-spacing: 1px">CADASTRO DE PRODUTOS</div>
        </div>
        <template v-if="!rail">
          <v-spacer />
          <v-btn v-if="mdAndUp" icon="mdi-chevron-left" variant="text" size="small" title="Recolher" @click="toggleNav" />
        </template>
      </div>

      <v-divider class="border-opacity-25" />

      <!-- navegação -->
      <div v-for="sec in sections" :key="sec" class="mt-2">
        <div v-if="!rail" class="text-caption text-medium-emphasis px-5 py-1" style="letter-spacing: 1px">{{ sec.toUpperCase() }}</div>
        <v-list density="comfortable" nav class="px-2">
          <v-list-item
            v-for="item in nav.filter((n) => n.section === sec)"
            :key="item.to"
            :to="item.to"
            :active="route.path === item.to"
            :prepend-icon="item.icon"
            :title="item.title"
            rounded="lg"
            color="primary"
          />
        </v-list>
      </div>

      <!-- rodapé: perfil + sair (ou expandir, quando recolhido) -->
      <template #append>
        <v-divider class="border-opacity-25" />
        <div v-if="!rail" class="d-flex align-center ga-3 px-4 py-3">
          <v-avatar color="primary" size="38">{{ iniciais }}</v-avatar>
          <div style="min-width: 0; line-height: 1.15">
            <div class="text-body-2 font-weight-medium text-truncate">{{ user?.name }}</div>
            <div class="text-caption text-medium-emphasis">{{ isAdmin ? 'Administrador' : `Loja ${user?.loja}` }}</div>
          </div>
          <v-spacer />
          <v-btn icon="mdi-logout" variant="text" size="small" title="Sair" @click="logout" />
        </div>
        <div v-else class="d-flex flex-column align-center ga-1 py-3">
          <v-btn v-if="mdAndUp" icon="mdi-menu" variant="text" size="small" title="Expandir" @click="toggleNav" />
          <v-avatar color="primary" size="34">{{ iniciais }}</v-avatar>
          <v-btn icon="mdi-logout" variant="text" size="small" title="Sair" @click="logout" />
        </div>
      </template>
    </v-navigation-drawer>

    <v-app-bar flat color="white" border height="68">
      <v-app-bar-nav-icon :icon="mdAndUp ? 'mdi-menu' : 'mdi-menu'" @click="toggleNav" />
      <div class="px-2">
        <div class="text-h6 font-weight-bold" style="line-height: 1.1">{{ titulo }}</div>
        <div v-if="subtitulo" class="text-caption text-medium-emphasis">{{ subtitulo }}</div>
      </div>
      <v-spacer />
      <v-chip
        v-if="user"
        :color="isAdmin ? 'deep-purple' : 'primary'"
        size="small"
        label
        class="mr-4"
        :prepend-icon="isAdmin ? 'mdi-shield-crown' : 'mdi-store'"
      >
        {{ isAdmin ? 'Admin' : `Loja ${user.loja}` }}
      </v-chip>
    </v-app-bar>

    <v-main style="background: #f1f5f9">
      <v-container fluid class="pa-6" style="max-width: 1400px">
        <slot />
      </v-container>
    </v-main>
  </v-app>
</template>
