<script setup lang="ts">
import { useDisplay } from 'vuetify';

const { user, logout } = useAuth();
const route = useRoute();
const { mdAndUp } = useDisplay();

const isAdmin = computed(() => user.value?.role === 'admin');
const drawer = ref(true); // no desktop é permanente; no mobile começa fechado (onMounted)
const rail = ref(false); // colapsado (só ícones) no desktop
const isRail = computed(() => mdAndUp.value && rail.value); // sidebar realmente recolhida
const brandLogo = '/cicluz/logo-cicluz.png';
const brandSymbol = '/cicluz/cicluz-simbolo.png';

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
  // Relatório de vendas cobre só TNP e LI. Esconder o item de quem não pode
  // entrar evita mandar a pessoa numa tela que responde 403. O servidor
  // continua recusando o acesso direto — o menu não é controle de permissão.
  const lojaComVendas = user.value?.loja === 'TNP' || user.value?.loja === 'LI';
  if (isAdmin.value || lojaComVendas) {
    items.push({ title: 'Vendas', icon: 'payments', to: '/vendas', section: 'Geral' });
  }
  // Diagnóstico de duplicados: leitura para quem tem loja, admin vê qualquer catálogo.
  if (isAdmin.value) items.push({ title: 'Central de Produtos', icon: 'merge_type', to: '/produtos/central', section: 'Administração' });
  items.push({ title: 'Duplicados', icon: 'content_copy', to: '/produtos/duplicados', section: 'Administração' });
  if (isAdmin.value) items.push({ title: 'Usuários', icon: 'group', to: '/usuarios', section: 'Administração' });
  return items;
});
const sections = computed(() => [...new Set(nav.value.map((n) => n.section))]);

const titulo = computed(() => {
  const map: Record<string, string> = {
    '/': 'Produtos',
    '/dashboard': 'Dashboard',
    '/vendas': 'Relatório de vendas',
    '/vendas/de-para': 'Produtos do PDV sem cadastro',
    '/vendas/produtos': 'Produtos vendidos no período',
    '/produtos/central': 'Central de Produtos',
    '/produtos/duplicados': 'Cadastros duplicados',
    '/usuarios': 'Usuários',
    '/importar': 'Importar da base',
    '/produtos/novo': 'Novo produto',
  };
  return map[route.path] ?? (route.path.startsWith('/produtos/') ? 'Editar produto' : 'Cicluz');
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
      rail-width="72"
      width="288"
      color="surface"
      class="nav-drawer"
    >
      <!-- Marca Cicluz: o próprio logo recolhe/expande o menu no desktop. -->
      <button
        type="button"
        class="sidebar-brand"
        :class="{ 'sidebar-brand--rail': rail }"
        :title="rail ? 'Expandir menu' : 'Recolher menu'"
        :aria-label="rail ? 'Expandir menu' : 'Recolher menu'"
        @click="toggleNav"
      >
        <img
          :src="rail ? brandSymbol : brandLogo"
          alt="Cicluz Gestão Profissional"
          class="sidebar-brand__image"
          width="220"
          height="72"
        >
      </button>

      <div v-if="!rail" class="sidebar-context px-4 pb-3">
        {{ isAdmin ? 'GESTÃO DE PRODUTOS' : `GESTÃO DE PRODUTOS · ${user?.loja ?? ''}` }}
      </div>

      <!-- navegação -->
      <div v-for="sec in sections" :key="sec" class="mt-2 px-2">
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

    <v-app-bar flat color="surface" :height="mdAndUp ? 72 : 60" class="app-bar-border px-md-2">
      <!-- no desktop quem recolhe/expande é o logo; aqui só no mobile p/ abrir o menu -->
      <v-btn v-if="!mdAndUp" icon="menu" variant="text" class="ms-1" @click="toggleNav" />
      <div class="px-1" style="min-width: 0; flex: 1 1 auto">
        <div class="text-subtitle-1 text-md-h6 font-weight-bold text-truncate" style="line-height: 1.1">{{ titulo }}</div>
        <div v-if="subtitulo" class="text-caption text-medium-emphasis text-truncate d-none d-sm-block">{{ subtitulo }}</div>
      </div>
      <v-chip
        v-if="user"
        :color="isAdmin ? 'primary' : 'secondary'"
        variant="tonal"
        size="small"
        class="ms-2 me-2 me-md-4 font-weight-medium flex-shrink-0"
        :prepend-icon="isAdmin ? 'shield_person' : 'storefront'"
      >
        {{ isAdmin ? 'Admin' : (user.loja || '—') }}
      </v-chip>
    </v-app-bar>

    <v-main class="app-main">
      <v-container fluid class="content-frame pa-4 pa-md-6">
        <slot />
      </v-container>
    </v-main>
  </v-app>
</template>

<style scoped>
.nav-drawer {
  border-right: 1px solid var(--cx-line) !important;
  background: rgb(255 255 255 / 0.94) !important;
}
.app-bar-border {
  border-bottom: 1px solid var(--cx-line) !important;
  background: rgb(255 255 255 / 0.9) !important;
  backdrop-filter: saturate(160%) blur(18px);
}
.sidebar-brand {
  display: flex;
  align-items: center;
  width: calc(100% - 24px);
  height: 84px;
  margin: 4px 12px 0;
  padding: 12px;
  border: 0;
  border-radius: var(--cx-r-md);
  background: transparent;
  cursor: pointer;
  transition: background 120ms var(--cx-ease);
}
.sidebar-brand:hover {
  background: var(--cx-surface-sunken);
}
.sidebar-brand:focus-visible {
  outline: 3px solid var(--cx-focus);
  outline-offset: 2px;
}
.sidebar-brand--rail {
  justify-content: center;
  width: 56px;
  margin-inline: 8px;
  padding: 8px;
}
.sidebar-brand__image {
  display: block;
  width: 100%;
  max-width: 220px;
  height: 58px;
  object-fit: contain;
  object-position: left center;
}
.sidebar-brand--rail .sidebar-brand__image {
  width: 44px;
  height: 44px;
  object-position: center;
}
.sidebar-context {
  color: var(--cx-ink-soft);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
}
/* item de navegação: ativo vira pílula com leve tom da marca */
.nav-item :deep(.v-list-item-title) {
  font-weight: 600;
  font-size: 0.92rem;
}
.nav-item {
  min-height: 44px;
}
.nav-item.v-list-item--active {
  background: var(--cx-brand-wash);
  color: var(--cx-brand-strong);
}
.app-main {
  min-width: 0;
  background: var(--cx-canvas);
}
.content-frame {
  width: 100%;
  max-width: 1440px;
  min-width: 0;
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
@media (max-width: 600px) {
  .content-frame {
    padding: 16px !important;
  }
}
</style>
