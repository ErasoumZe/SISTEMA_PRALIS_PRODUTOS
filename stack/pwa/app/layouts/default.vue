<script setup lang="ts">
import { useDisplay } from 'vuetify';

const { user, logout } = useAuth();
const route = useRoute();
const { mdAndUp } = useDisplay();

const isAdmin = computed(() => user.value?.role === 'admin');
const drawer = ref(true); // no desktop é permanente; no mobile começa fechado (onMounted)
const rail = ref(false); // colapsado (só ícones) no desktop
const isRail = computed(() => mdAndUp.value && rail.value); // sidebar realmente recolhida
// vinculado (não string estática) p/ o Vite não tentar importar em build-time;
// resolve de public/ em runtime, com fallback p/ ícone enquanto o arquivo não existe
const brandLogo = '/brand/simbolo.png';

function toggleNav() {
  if (mdAndUp.value) rail.value = !rail.value;
  else drawer.value = !drawer.value;
}

// no mobile, começa com o menu fechado (no desktop o drawer é permanente)
onMounted(() => {
  if (!mdAndUp.value) drawer.value = false;
});

interface NavItem { title: string; icon: string; to: string; section: string }
const nav = computed<NavItem[]>(() => {
  const items: NavItem[] = [];
  if (isAdmin.value) items.push({ title: 'Dashboard', icon: 'dashboard', to: '/dashboard', section: 'Geral' });
  items.push({ title: 'Produtos', icon: 'inventory_2', to: '/', section: 'Geral' });
  if (isAdmin.value) items.push({ title: 'Usuários', icon: 'group', to: '/usuarios', section: 'Administração' });
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
const subtitulo = computed(() => {
  const map: Record<string, string> = {
    '/': 'Gerencie todos os produtos cadastrados',
    '/dashboard': 'Visão geral do seu negócio',
    '/usuarios': 'Gerencie os usuários do sistema',
  };
  return map[route.path] ?? '';
});

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
      rail-width="80"
      width="268"
      color="surface"
      class="px-2 nav-drawer"
    >
      <!-- marca — clicar no logo recolhe/expande o menu -->
      <div class="d-flex align-center py-5" :class="rail ? 'justify-center px-0' : 'ga-3 px-3'">
        <v-avatar
          size="42"
          color="primary"
          class="brand-badge"
          style="border-radius: 13px; cursor: pointer"
          :title="rail ? 'Expandir menu' : 'Recolher menu'"
          @click="toggleNav"
        >
          <v-img :src="brandLogo" cover>
            <template #error>
              <v-icon color="white" size="24">storefront</v-icon>
            </template>
          </v-img>
        </v-avatar>
        <div v-if="!rail" style="line-height: 1.05; min-width: 0; cursor: pointer" @click="toggleNav">
          <div class="text-subtitle-1 font-weight-bold">Pralis</div>
          <div class="text-caption text-medium-emphasis text-truncate" style="letter-spacing: 0.6px; font-size: 10px">
            {{ isAdmin ? 'PAINEL ADMINISTRATIVO' : 'PAINEL DO COLABORADOR' }}
          </div>
        </div>
      </div>

      <!-- navegação -->
      <div v-for="sec in sections" :key="sec" class="mt-3">
        <div v-if="!rail" class="text-caption text-disabled px-4 pb-1 font-weight-medium" style="letter-spacing: 0.6px; font-size: 10px">
          {{ sec.toUpperCase() }}
        </div>
        <v-list density="comfortable" nav class="pa-0">
          <v-list-item
            v-for="item in nav.filter((n) => n.section === sec)"
            :key="item.to"
            :to="item.to"
            :active="route.path === item.to"
            :prepend-icon="item.icon"
            :title="item.title"
            rounded="lg"
            color="primary"
            :class="['mb-1 nav-item', { 'nav-item--rail': isRail }]"
          />
        </v-list>
      </div>

      <!-- rodapé: perfil + recolher -->
      <template #append>
        <v-divider class="mx-2 mb-1" />
        <div v-if="!rail" class="d-flex align-center ga-3 px-3 py-3">
          <v-avatar color="bege" size="38" class="text-bordo font-weight-bold">{{ iniciais }}</v-avatar>
          <div style="min-width: 0; line-height: 1.15">
            <div class="text-body-2 font-weight-medium text-truncate">{{ user?.name }}</div>
            <div class="text-caption text-medium-emphasis">{{ isAdmin ? 'Administrador' : `Loja ${user?.loja}` }}</div>
          </div>
          <v-spacer />
          <v-btn icon="logout" variant="text" size="small" color="medium-emphasis" title="Sair" @click="logout" />
        </div>
        <div v-else class="d-flex flex-column align-center ga-1 py-3">
          <v-avatar color="bege" size="36" class="text-bordo font-weight-bold">{{ iniciais }}</v-avatar>
          <v-btn icon="logout" variant="text" size="small" color="medium-emphasis" title="Sair" @click="logout" />
        </div>
      </template>
    </v-navigation-drawer>

    <v-app-bar flat color="surface" height="72" class="app-bar-border">
      <!-- no desktop quem recolhe/expande é o logo; aqui só no mobile p/ abrir o menu -->
      <v-btn v-if="!mdAndUp" icon="menu" variant="text" @click="toggleNav" />
      <div class="px-1">
        <div class="text-h6 font-weight-bold" style="line-height: 1.1">{{ titulo }}</div>
        <div v-if="subtitulo" class="text-caption text-medium-emphasis">{{ subtitulo }}</div>
      </div>
      <v-spacer />
      <v-chip
        v-if="user"
        :color="isAdmin ? 'primary' : 'secondary'"
        variant="tonal"
        size="small"
        class="mr-4 font-weight-medium"
        :prepend-icon="isAdmin ? 'shield_person' : 'storefront'"
      >
        {{ isAdmin ? 'Admin' : `Loja ${user.loja}` }}
      </v-chip>
    </v-app-bar>

    <v-main style="background: #f5f5f7">
      <v-container fluid class="pa-4 pa-md-6" style="max-width: 1440px">
        <slot />
      </v-container>
    </v-main>
  </v-app>
</template>

<style scoped>
.nav-drawer {
  border-right: 1px solid rgba(29, 29, 31, 0.07);
}
.app-bar-border {
  border-bottom: 1px solid rgba(29, 29, 31, 0.07);
}
.brand-badge {
  box-shadow: 0 2px 8px rgba(92, 58, 52, 0.25);
}
/* item de navegação: ativo vira pílula com leve tom da marca */
.nav-item :deep(.v-list-item-title) {
  font-weight: 500;
  font-size: 0.92rem;
}

/* sidebar recolhida (rail): centraliza o ícone no quadrado do item.
   O v-list-item usa CSS grid (coluna prepend à esquerda); forçamos flex centralizado. */
.nav-item--rail {
  display: flex !important;
  align-items: center;
  justify-content: center !important;
  padding-inline: 0 !important;
}
.nav-item--rail :deep(.v-list-item__prepend) {
  margin-inline-end: 0 !important;
}
.nav-item--rail :deep(.v-list-item__spacer),
.nav-item--rail :deep(.v-list-item__content),
.nav-item--rail :deep(.v-list-item__append) {
  display: none !important;
}
</style>
