// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  devtools: { enabled: false },
  ssr: true,

  modules: ['vuetify-nuxt-module'],

  css: ['@mdi/font/css/materialdesignicons.css'],

  // permite transpilar o pacote do monorepo (regras/tipos compartilhados)
  build: { transpile: ['@pralis/shared'] },

  runtimeConfig: {
    public: {
      apiBase: process.env.NUXT_PUBLIC_API_BASE || 'http://localhost:3344',
    },
  },

  vuetify: {
    moduleOptions: {
      // detecta a largura da viewport no SSR (client hints + cookie), evitando
      // o "salto"/desenquadramento do layout na primeira carga por breakpoint errado
      ssrClientHints: {
        viewportSize: true,
        prefersColorScheme: false,
      },
    },
    vuetifyOptions: {
      theme: {
        defaultTheme: 'light',
        themes: {
          light: {
            colors: {
              primary: '#7C3AED',
              secondary: '#6D28D9',
            },
          },
        },
      },
    },
  },
});
