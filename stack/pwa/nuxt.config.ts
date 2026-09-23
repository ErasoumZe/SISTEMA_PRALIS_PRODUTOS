// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  devtools: { enabled: false },
  // App interno 100% autenticado (cookie httpOnly cross-domain não chega no SSR).
  // SPA evita hydration mismatch e deixa o cliente saber a largura real no 1º paint.
  ssr: false,
  // O manifest interno do Nuxt não é usado; o manifest instalável vem do PWA.
  experimental: { appManifest: false },

  modules: ['vuetify-nuxt-module', '@vite-pwa/nuxt'],

  pwa: {
    registerType: 'autoUpdate',
    manifest: {
      id: '/',
      name: 'Cicluz Gestão',
      short_name: 'Cicluz Gestão',
      description: 'Gestão profissional de produtos da Cicluz.',
      theme_color: '#050507',
      background_color: '#050507',
      display: 'standalone',
      start_url: '/',
      scope: '/',
      icons: [
        { src: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/pwa/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
      ],
    },
    workbox: {
      navigateFallback: '/',
      globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff2}'],
    },
  },

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
        { rel: 'icon', type: 'image/png', href: '/pwa/icon-192.png' },
        { rel: 'apple-touch-icon', href: '/pwa/icon-512.png' },
      ],
      meta: [
        { name: 'theme-color', content: '#050507' },
        { name: 'mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
        { name: 'apple-mobile-web-app-title', content: 'Cicluz Gestão' },
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
              // o roxo da marca não muda — é a essência da Cicluz
              primary: '#6515DD',
              secondary: '#35128C',
              /*
               * Os NEUTROS puxam para o roxo em vez de para o azul.
               * `#F4F6FA` era um cinza-azulado genérico; `#F5F4F8` tem um sopro
               * da matiz da marca. São poucos pontos de diferença e é o que faz
               * a tela parecer escolhida em vez de herdada do framework.
               */
              background: '#F5F4F8',
              surface: '#FFFFFF',
              'surface-variant': '#F0EFF5',
              'on-surface': '#1C1B22',
              'on-background': '#1C1B22',
              success: '#157F3C',
              error: '#C62828',
              warning: '#B7791F',
              info: '#2563A8',
              // aliases legados usados por componentes existentes; agora seguem Cicluz.
              bordo: '#35128C',
              laranja: '#6515DD',
              bege: '#F1ECFE',
            },
            variables: {
              /*
               * Fio mais claro: com a sombra fora dos cartões, a linha passou a
               * ser o único separador — e separador que se nota demais vira
               * grade. `0.16` de um cinza-azul desenhava caixa; `0.09` do
               * próprio texto desenha limite.
               */
              'border-color': '#1C1B22',
              'border-opacity': 0.09,
              'high-emphasis-opacity': 0.94,
              'medium-emphasis-opacity': 0.62,
            },
          },
        },
      },
      /*
       * `rounded: 'xl'` no cartão são 24px — arredondado de banner, não de
       * conteúdo: o canto come o texto da primeira linha e a caixa parece uma
       * pílula gorda. `lg` (8px) é apertado demais para um cartão grande. O
       * meio-termo vem do CSS (`--cx-r-lg`, 14px), e aqui o cartão fica só com
       * o que o Vuetify precisa saber: que ele é plano e tem fio.
       */
      defaults: {
        global: { ripple: true },
        VCard: { flat: true, border: true, rounded: 'lg' },
        VBtn: { rounded: 'lg', class: 'text-none', fontWeight: '600' },
        VTextField: { variant: 'outlined', rounded: 'lg' },
        VSelect: { variant: 'outlined', rounded: 'lg' },
        VTextarea: { variant: 'outlined', rounded: 'lg' },
        VChip: { rounded: 'lg' },
        VList: { rounded: 'lg' },
        VDialog: { rounded: 'lg' },
      },
    },
  },
});
