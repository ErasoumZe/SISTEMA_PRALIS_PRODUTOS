<script setup lang="ts">
import { BrowserMultiFormatReader } from '@zxing/browser';

const open = defineModel<boolean>('open', { default: false });
const emit = defineEmits<{ scanned: [code: string] }>();

const video = ref<HTMLVideoElement | null>(null);
const erro = ref('');
let controls: { stop: () => void } | null = null;

async function start() {
  erro.value = '';
  await nextTick();
  if (!video.value) return;
  try {
    const reader = new BrowserMultiFormatReader();
    controls = await reader.decodeFromConstraints(
      { video: { facingMode: 'environment' } },
      video.value,
      (result) => {
        if (result) {
          emit('scanned', result.getText());
          fechar();
        }
      },
    );
  } catch {
    erro.value = 'Não foi possível acessar a câmera. Permita o acesso à câmera e tente de novo.';
  }
}

function parar() {
  controls?.stop();
  controls = null;
}
function fechar() {
  parar();
  open.value = false;
}

watch(open, (v) => (v ? start() : parar()));
onBeforeUnmount(parar);
</script>

<template>
  <v-dialog v-model="open" max-width="460" @after-leave="parar">
    <v-card rounded="xl">
      <v-card-title class="d-flex align-center pe-2">
        <v-icon class="me-2" color="primary">barcode_scanner</v-icon>
        <span class="text-subtitle-1 font-weight-bold">Ler código de barras</span>
        <v-spacer />
        <v-btn icon="close" variant="text" size="small" @click="fechar" />
      </v-card-title>
      <v-card-text class="pt-0">
        <v-alert v-if="erro" type="error" variant="tonal" density="compact" class="mb-3">{{ erro }}</v-alert>
        <div class="scan-box">
          <video ref="video" class="scan-video" muted autoplay playsinline></video>
          <div class="scan-frame"></div>
        </div>
        <div class="text-caption text-medium-emphasis text-center mt-2">
          Aponte a câmera para o código de barras do produto.
        </div>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.scan-box {
  position: relative;
  width: 100%;
  aspect-ratio: 4 / 3;
  background: #000;
  border-radius: 14px;
  overflow: hidden;
}
.scan-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.scan-frame {
  position: absolute;
  inset: 18% 12%;
  border: 2px solid rgba(238, 122, 30, 0.9);
  border-radius: 10px;
  box-shadow: 0 0 0 999px rgba(0, 0, 0, 0.25);
}
</style>
