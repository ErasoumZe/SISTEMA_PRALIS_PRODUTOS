import type VueApexCharts from 'vue3-apexcharts';

// Componente registrado globalmente pelo plugin apexcharts.client.ts
declare module 'vue' {
  interface GlobalComponents {
    apexchart: typeof VueApexCharts;
  }
}

export {};
