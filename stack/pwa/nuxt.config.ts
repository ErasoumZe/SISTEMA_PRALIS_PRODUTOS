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

  // CSS global (Montserrat + ajustes estilo Apple). Ícones são Material Symbols (via plugin).
  css: ['~/assets/css/main.css'],

  app: {
    head: {
      link: [
        // Montserrat (UI) e Material Symbols Rounded (ícones — display=block evita mostrar o texto da ligadura)
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=Montserrat:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800&display=swap',
        },
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,300..600,0..1,-25..0&display=block',
        },
        { rel: 'icon', type: 'image/png', href: '/brand/simbolo.png' },
      ],
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
      // ícones Material Symbols são registrados no plugin app/plugins/vuetify-icons.ts
      theme: {
        defaultTheme: 'pralis',
        themes: {
          pralis: {
            dark: false,
            colors: {
              // marca
              primary: '#5C3A34', // bordô
              secondary: '#EE7A1E', // laranja
              // base estilo Apple
              background: '#F5F5F7',
              surface: '#FFFFFF',
              'surface-variant': '#6E6E73',
              'on-surface': '#1D1D1F',
              'on-background': '#1D1D1F',
              // semânticas
              success: '#34A853',
              error: '#E5484D',
              warning: '#EE7A1E',
              info: '#5C3A34',
              // tokens auxiliares da marca
              bordo: '#5C3A34',
              laranja: '#EE7A1E',
              bege: '#F4ECDD',
            },
            variables: {
              'border-color': '#1D1D1F',
              'border-opacity': 0.08,
              'high-emphasis-opacity': 0.92,
              'medium-emphasis-opacity': 0.58,
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
