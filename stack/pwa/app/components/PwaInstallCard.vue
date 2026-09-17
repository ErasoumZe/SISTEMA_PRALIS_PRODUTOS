<script setup lang="ts">
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const deferredPrompt = ref<BeforeInstallPromptEvent | null>(null);
const plataforma = ref<'android' | 'ios' | null>(null);
const instalado = ref(false);
const solicitando = ref(false);

function estaInstalado() {
  return window.matchMedia('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function detectarPlataforma() {
  const agente = navigator.userAgent;
  if (/android/i.test(agente)) return 'android' as const;
  if (/iPad|iPhone|iPod/.test(agente) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios' as const;
  return null;
}

function receberPrompt(event: Event) {
  event.preventDefault();
  deferredPrompt.value = event as BeforeInstallPromptEvent;
}

async function instalarAndroid() {
  if (!deferredPrompt.value) return;
  solicitando.value = true;
  try {
    await deferredPrompt.value.prompt();
    const escolha = await deferredPrompt.value.userChoice;
    if (escolha.outcome === 'accepted') instalado.value = true;
    deferredPrompt.value = null;
  } finally {
    solicitando.value = false;
  }
}

onMounted(() => {
  instalado.value = estaInstalado();
  plataforma.value = detectarPlataforma();
  window.addEventListener('beforeinstallprompt', receberPrompt);
  window.addEventListener('appinstalled', () => { instalado.value = true; });
});

onUnmounted(() => window.removeEventListener('beforeinstallprompt', receberPrompt));
</script>

<template>
  <v-card v-if="plataforma && !instalado" class="pwa-install-card mb-5" border rounded="xl" elevation="0">
    <div class="d-flex align-start ga-4 pa-4 pa-sm-5">
      <img src="/pwa/icon-192.png" alt="Ícone Cicluz Gestão" width="60" height="60" class="pwa-install-icon">
      <div class="flex-grow-1">
        <div class="text-subtitle-1 font-weight-bold">Instale o Cicluz Gestão</div>
        <template v-if="plataforma === 'android'">
          <p class="text-body-2 text-medium-emphasis mt-1 mb-3">
            Tenha acesso rápido pela tela inicial do Android, como um aplicativo.
          </p>
          <v-btn v-if="deferredPrompt" color="primary" prepend-icon="download" :loading="solicitando" @click="instalarAndroid">
            Instalar aplicativo
          </v-btn>
          <div v-else class="text-body-2 text-medium-emphasis">
            No Chrome, toque no menu <strong>⋮</strong> e escolha <strong>Instalar aplicativo</strong> ou <strong>Adicionar à tela inicial</strong>.
          </div>
        </template>
        <template v-else>
          <p class="text-body-2 text-medium-emphasis mt-1 mb-0">
            No Safari, toque em <strong>Compartilhar</strong> <span aria-hidden="true">⎋</span> e depois em
            <strong>Adicionar à Tela de Início</strong>.
          </p>
        </template>
      </div>
    </div>
  </v-card>
</template>

<style scoped>
.pwa-install-card {
  overflow: hidden;
  border-color: rgb(101 21 221 / 20%) !important;
  background: linear-gradient(135deg, rgb(20 17 27 / 5%), rgb(101 21 221 / 9%)) !important;
}
.pwa-install-icon {
  flex: 0 0 auto;
  border-radius: 16px;
  box-shadow: 0 8px 20px rgb(5 5 7 / 22%);
}
</style>
