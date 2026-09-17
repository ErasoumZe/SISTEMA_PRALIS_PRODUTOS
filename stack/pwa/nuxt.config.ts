// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  devtools: { enabled: false },
  // App interno 100% autenticado (cookie httpOnly cross-domain não chega no SSR).
  // SPA evita hydration mismatch e deixa o cliente saber a largura real no 1º paint.
  ssr: false,
  // SPA não precisa do app manifest (evita o erro "#app-manifest" em rebuilds)
  experimental: { appManifest: false },

  modules: ['vuetify-nuxt-module'],

  // CSS global da identidade Cicluz. Ícones são Material Symbols (via plugin).
  css: ['~/assets/css/main.css'],

  app: {
    head: {
      link: [
        // Noto Sans (mesma família do Sistema Caixa) e Material Symbols Rounded.
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;500;600;700&display=swap',
        },
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,300..600,0..1,-25..0&display=block',
        },
        { rel: 'icon', type: 'image/png', href: '/cicluz/cicluz-favicon.png' },
        { rel: 'manifest', href: '/manifest.webmanifest?v=4' },
        { rel: 'apple-touch-icon', href: '/cicluz/cicluz-gestao-v4-180.png?v=4', sizes: '180x180' },
      ],
      title: 'Cicluz Gestão Profissional — Produtos',
    },
  },

  // permite transpilar o pacote do monorepo (regras/tipos compartilhados)
  build: { transpile: ['@pralis/shared'] },

  runtimeConfig: {
    public: {
      apiBase: process.env.NUXT_PUBLIC_API_BASE || 'http://localhost:3344',
      // e-mail do admin principal — usado no cadastro para esconder o seletor de loja
      adminEmail: process.env.NUXT_PUBLIC_ADMIN_EMAIL || 'rodrigo@cicluz.com.br',
    },
  },

  vuetify: {
    vuetifyOptions: {
      /*
       * ÍCONES DESLIGADOS no módulo, de propósito.
       *
       * O conjunto de ícones que o sistema usa é o Material Symbols Rounded, e
       * ele entra por dois caminhos que não passam por aqui: a fonte vem do
       * Google Fonts pelo `<link>` no `head` acima, e o icon set é registrado
       * em tempo de execução por `app/plugins/vuetify-icons.ts`.
       *
       * Sem este `false`, o vuetify-nuxt-module empacotava o Material Design
       * Icons como padrão — a fonte inteira, que ninguém referencia. Medido no
       * build: 403 KB de `materialdesignicons-webfont.woff2` e o CSS dele
       * dentro de um `entry.css` de 573 KB, para zero ícone usado. Não havia
       * um `mdi-` sequer no código.
       *
       * A configuração do plugin acontece em runtime, tarde demais para
       * impedir o empacotamento: por isso a decisão precisa estar AQUI.
       */
      icons: false,
      // ícones Material Symbols são registrados no plugin app/plugins/vuetify-icons.ts
      theme: {
        defaultTheme: 'cicluz',
        themes: {
          cicluz: {
            dark: false,
            colors: {
              primary: '#6515DD',
              secondary: '#35128C',
              background: '#F4F6FA',
              surface: '#FFFFFF',
              'surface-variant': '#EEF1F6',
              'on-surface': '#1F2733',
              'on-background': '#1F2733',
              success: '#157F3C',
              error: '#C62828',
              warning: '#B7791F',
              info: '#2563A8',
              // aliases legados usados por componentes existentes; agora seguem Cicluz.
              bordo: '#35128C',
              laranja: '#6515DD',
              bege: '#F0EBFF',
            },
            variables: {
              'border-color': '#5B6675',
              'border-opacity': 0.16,
              'high-emphasis-opacity': 0.94,
              'medium-emphasis-opacity': 0.68,
            },
          },
        },
      },
      defaults: {
        global: { ripple: true },
        VCard: { rounded: 'xl' },
        VBtn: { rounded: 'lg', class: 'text-none', fontWeight: '600' },
        VTextField: { variant: 'outlined', rounded: 'lg' },
        VSelect: { variant: 'outlined', rounded: 'lg' },
        VTextarea: { variant: 'outlined', rounded: 'lg' },
        VChip: { rounded: 'lg' },
      },
    },
  },
});
