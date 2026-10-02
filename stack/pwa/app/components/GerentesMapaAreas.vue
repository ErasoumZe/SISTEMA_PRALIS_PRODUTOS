<script setup lang="ts">
type Loja = 'TNP' | 'LI';

const props = defineProps<{ loja: Loja; modo: 'mes' | 'semana' | 'dia'; inicio: string; fim: string }>();
const api = useApi();
const imagemPlanta = ref('');
const erroPlanta = ref('');
let enderecoBlob = '';
async function carregarPlanta() {
  if (props.loja !== 'TNP') return;
  try {
    const imagem = await api.plantaGerentes();
    if (enderecoBlob) URL.revokeObjectURL(enderecoBlob);
    enderecoBlob = URL.createObjectURL(imagem);
    imagemPlanta.value = enderecoBlob;
    erroPlanta.value = '';
  } catch {
    erroPlanta.value = 'Não foi possível carregar a planta para esta conta.';
  }
}
onMounted(carregarPlanta);
watch(() => props.loja, carregarPlanta);
onBeforeUnmount(() => { if (enderecoBlob) URL.revokeObjectURL(enderecoBlob); });

// Grupos e cores transcritos da legenda da planta da Unidade Catedral.
// Ainda não há de-para entre área física e produto/PDV no cadastro.
const areas = [
  { id: 'caixa', nome: 'Caixa', cor: '#E6A23C', locais: [{ x: 80, y: 27, w: 18, h: 26 }] },
  { id: 'vitrine', nome: 'Vitrine', cor: '#ED6661', locais: [{ x: 66, y: 66, w: 29, h: 24 }] },
  { id: 'copa', nome: 'Copa', cor: '#E5C900', locais: [{ x: 51, y: 66, w: 15, h: 25 }] },
  { id: 'chapa', nome: 'Chapa', cor: '#64C446', locais: [{ x: 25, y: 66, w: 26, h: 25 }] },
  { id: 'mesas', nome: 'Mesas', cor: '#8C2DF4', locais: [{ x: 25, y: 24, w: 54, h: 38 }] },
  { id: 'paes', nome: 'Pães: vasca, vitrine, empacotados e mesa', cor: '#27C9D8', locais: [{ x: 1, y: 2, w: 59, h: 12 }, { x: 1, y: 14, w: 6, h: 20 }] },
  { id: 'mercearia', nome: 'Frios, bebidas, laticínios, mercearia e biscoitos', cor: '#5368D9', locais: [{ x: 60, y: 2, w: 35, h: 12 }, { x: 1, y: 24, w: 24, h: 39 }, { x: 1, y: 54, w: 15, h: 16 }] },
  { id: 'dml', nome: 'DML / Limpeza', cor: '#64748B', locais: [{ x: 1, y: 71, w: 24, h: 27 }] },
] as const;

const ativas = ref<string[]>(areas.map((area) => area.id));
const todasAtivas = computed(() => ativas.value.length === areas.length);
function alternarTodas() { ativas.value = todasAtivas.value ? [] : areas.map((area) => area.id); }

const categorias = computed(() => {
  if (!props.inicio || !props.fim) return [];
  if (props.modo === 'dia') return Array.from({ length: 17 }, (_, i) => `${String(i + 6).padStart(2, '0')}h`);
  const dias: string[] = [];
  const inicio = Date.parse(`${props.inicio}T00:00:00Z`);
  const fim = Date.parse(`${props.fim}T00:00:00Z`);
  if (!Number.isFinite(inicio) || !Number.isFinite(fim)) return [];
  for (let data = inicio; data <= fim; data += 86_400_000) {
    const dia = new Date(data);
    if (props.modo === 'semana' && dia.getUTCDay() === 0) continue;
    dias.push(`${String(dia.getUTCDate()).padStart(2, '0')}/${String(dia.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return dias;
});
</script>

<template>
  <div class="ga-layout">
    <section class="ga-card ga-mapa-card" aria-label="Mapa das áreas da loja">
      <div class="ga-heading">
        <span class="ga-icon"><v-icon icon="map" size="23" /></span>
        <div><h2>Mapa da loja</h2><p>Unidade Catedral · selecione as áreas para destacar na planta</p></div>
      </div>
      <v-alert v-if="loja !== 'TNP'" type="info" variant="tonal" class="my-4">A planta fornecida é da TNP. O mapa da LI ainda não foi enviado.</v-alert>
      <template v-else>
        <v-alert v-if="erroPlanta" type="error" variant="tonal" class="my-4">{{ erroPlanta }}</v-alert>
        <template v-if="imagemPlanta">
        <div class="ga-controles">
          <button type="button" class="ga-todas" @click="alternarTodas">{{ todasAtivas ? 'Desmarcar todas' : 'Marcar todas' }}</button>
          <span>{{ ativas.length }} de {{ areas.length }} áreas acesas</span>
        </div>
        <div class="ga-planta">
          <img :src="imagemPlanta" alt="Planta da Unidade Catedral com as áreas identificadas" />
          <template v-for="area in areas" :key="area.id">
            <div v-for="(local, indice) in area.locais" :key="`${area.id}-${indice}`"
              class="ga-local" :class="{ 'ga-local--inativo': !ativas.includes(area.id) }"
              :style="{ left: `${local.x}%`, top: `${local.y}%`, width: `${local.w}%`, height: `${local.h}%`, '--area-cor': area.cor }"
              :title="area.nome" />
          </template>
        </div>
        <div class="ga-legenda">
          <label v-for="area in areas" :key="area.id" class="ga-area" :class="{ 'ga-area--inativa': !ativas.includes(area.id) }">
            <input v-model="ativas" type="checkbox" :value="area.id" :aria-label="area.nome" />
            <span class="ga-swatch" :style="{ background: area.cor }" />
            <span>{{ area.nome }}</span>
          </label>
        </div>
        </template>
      </template>
    </section>

    <section class="ga-card ga-grafico-card" aria-label="Pontuação por área">
      <div class="ga-heading">
        <span class="ga-icon"><v-icon icon="bar_chart" size="23" /></span>
        <div><h2>Pontuação por área</h2><p>{{ modo === 'dia' ? 'Horas de 06h a 22h' : modo === 'semana' ? 'Dias da semana, segunda a sábado' : 'Dias do mês' }}</p></div>
      </div>
      <div class="ga-grafico-pendente">
        <v-icon icon="link_off" size="32" />
        <strong>Aguardando vínculo entre produtos e áreas</strong>
        <span>A planta não informa qual produto vendido pertence a cada área. Para não atribuir pontos ao lugar errado, as barras ficam indisponíveis até o de-para ser definido.</span>
      </div>
      <div v-if="categorias.length" class="ga-eixo" aria-label="Categorias do período">
        <span>{{ categorias[0] }}</span><span v-if="categorias.length > 2">{{ categorias[Math.floor((categorias.length - 1) / 2)] }}</span><span>{{ categorias[categorias.length - 1] }}</span>
      </div>
      <p class="ga-nota">O eixo vertical será em pontos. Horários só serão exibidos quando houver venda com hora comprovada pelo ERP; o fechamento diário não informa a hora nem a área.</p>
    </section>
  </div>
</template>

<style scoped>
.ga-layout { display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr); gap: 18px; }
.ga-card { min-width: 0; padding: 23px; border: 1px solid var(--cx-line); border-radius: 22px; background: var(--cx-surface); box-shadow: 0 8px 28px rgba(30, 23, 55, .035); }
.ga-heading { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
.ga-heading h2 { margin: 0; font-size: 1.15rem; letter-spacing: -.02em; }
.ga-heading p { margin: 3px 0 0; color: var(--cx-ink-soft); font-size: .83rem; }
.ga-icon { display: grid; place-items: center; flex: 0 0 42px; height: 42px; border-radius: 13px; color: var(--cx-brand); background: var(--cx-brand-wash); }
.ga-controles { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 10px; color: var(--cx-ink-soft); font-size: .78rem; }
.ga-todas { color: var(--cx-brand-strong); font-weight: 700; cursor: pointer; }
.ga-todas:focus-visible, .ga-area:focus-within { outline: 2px solid var(--cx-brand); outline-offset: 2px; }
.ga-planta { position: relative; width: 100%; aspect-ratio: 1181 / 930; overflow: hidden; border: 1px solid var(--cx-line); border-radius: 15px; background: #fff; }
.ga-planta img { position: absolute; width: 151.3%; max-width: none; height: 135.8%; left: -29.04%; top: -11.18%; }
.ga-local { position: absolute; z-index: 1; border: 2px solid transparent; border-radius: 8px; pointer-events: none; transition: background .2s, box-shadow .2s; }
.ga-local:not(.ga-local--inativo) { box-shadow: inset 0 0 22px color-mix(in srgb, var(--area-cor) 44%, transparent); }
.ga-local--inativo { background: rgba(255, 255, 255, .76); border-color: #d1d5db; }
.ga-legenda { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; margin-top: 13px; }
.ga-area { display: flex; align-items: center; gap: 8px; min-height: 37px; padding: 6px 8px; border: 1px solid var(--cx-line-soft); border-radius: 10px; cursor: pointer; font-size: .76rem; line-height: 1.25; }
.ga-area input { accent-color: var(--cx-brand); }
.ga-area--inativa { color: var(--cx-ink-soft); background: var(--cx-surface-sunken); }
.ga-swatch { flex: 0 0 10px; height: 10px; border-radius: 50%; }
.ga-grafico-card { display: flex; flex-direction: column; }
.ga-grafico-pendente { flex: 1; min-height: 340px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 25px; border: 1px dashed var(--cx-line); border-radius: 15px; color: var(--cx-ink-soft); text-align: center; }
.ga-grafico-pendente strong { color: var(--cx-ink); }
.ga-grafico-pendente span { max-width: 400px; font-size: .83rem; line-height: 1.5; }
.ga-eixo { display: flex; justify-content: space-between; gap: 10px; padding: 12px 4px 0; color: var(--cx-ink-soft); font-size: .72rem; }
.ga-nota { margin: 18px 0 0; color: var(--cx-ink-soft); font-size: .76rem; line-height: 1.5; }
@media (max-width: 1080px) { .ga-layout { grid-template-columns: 1fr; } }
@media (max-width: 560px) { .ga-card { padding: 17px; } .ga-legenda { grid-template-columns: 1fr; } }
</style>
