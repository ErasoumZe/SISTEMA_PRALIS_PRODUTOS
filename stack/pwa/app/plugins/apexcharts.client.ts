import VueApexCharts from 'vue3-apexcharts';

// Registra o componente <apexchart> globalmente (apenas no client — ApexCharts não roda no SSR).
export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.use(VueApexCharts);
});
