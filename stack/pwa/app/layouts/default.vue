<script setup lang="ts">
import { useDisplay } from 'vuetify';
import { Telas } from '@pralis/shared';

const { user, logout, podeVer } = useAuth();
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

// Ao girar o celular ou redimensionar a janela, não deixar o menu móvel aberto
// sobre a página. Ao voltar ao desktop, a navegação permanente reaparece.
watch(mdAndUp, (desktop) => {
  drawer.value = desktop;
});

/**
 * O menu sai do CATÁLOGO DE TELAS, não de uma lista escrita aqui.
 *
 * A lista à mão tinha dois defeitos que esta tela sozinha não podia ver: telas
 * inteiras ficavam fora dela (código de cadastro, de-para do SIA, importação —
 * alcançadas só por URL decorada), e o que ela escondia por `isAdmin` não
 * batia com o que a guarda de rota protegia. Agora as três leituras — menu,
 * rota e servidor — respondem à mesma pergunta.
 */
const nav = computed(() => Telas.TELAS
  .filter((t) => !t.foraDoMenu && podeVer(t.id))
  .map((t) => ({ title: t.titulo, icon: t.icone, to: t.path, section: t.secao })));

const sections = computed(() => Telas.SECOES.filter((sec) => nav.value.some((n) => n.section === sec)));

const tela = computed(() => Telas.telaDoPath(route.path));
const titulo = computed(() => tela.value?.titulo
  ?? (route.path.startsWith('/produtos/') ? 'Editar produto' : 'Cicluz'));
const subtitulo = computed(() => tela.value?.subtitulo ?? '');

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
/*
 * Lateral e barra do topo em vidro: translúcidas sobre a tela, com desfoque e
 * saturação. É o que dá profundidade sem sombra — o conteúdo passa POR TRÁS
 * delas ao rolar, em vez de sumir atrás de uma parede opaca.
 */
.nav-drawer {
  border-right: 1px solid var(--cx-line) !important;
  background: rgb(255 255 255 / 0.82) !important;
  backdrop-filter: saturate(180%) blur(20px);
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
/*
 * A pílula do item ativo é RECUADA da borda da lateral. Colada na borda ela
 * vira faixa e se confunde com a divisa da barra; recuada, lê-se como um
 * objeto selecionado dentro da lista.
 */
.nav-item {
  min-height: 42px;
  margin-inline: 8px;
  border-radius: var(--cx-r-md);
  transition: background 140ms var(--cx-ease), color 140ms var(--cx-ease);
}
.nav-item:hover:not(.v-list-item--active) {
  background: var(--cx-surface-sunken);
}
.nav-item.v-list-item--active {
  background: var(--cx-brand-wash);
  color: var(--cx-brand-strong);
}
/* o ícone acompanha o texto: ícone cinza ao lado de texto roxo parece defeito */
.nav-item.v-list-item--active :deep(.v-icon) {
  color: var(--cx-brand);
}
/* rótulo de seção: pequeno, espaçado e discreto — é placa, não item */
.nav-drawer :deep(.v-list-subheader) {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--cx-ink-faint);
  min-height: 34px;
  padding-inline-start: 20px !important;
  opacity: 1;
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
