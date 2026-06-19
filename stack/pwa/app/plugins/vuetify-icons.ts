import { h } from 'vue';
// reaproveita as aliases internas do Vuetify (check, arrow_drop_down, etc.) —
// as ligaduras do Material Icons existem também no Material Symbols.
import { aliases } from 'vuetify/iconsets/md';

/**
 * Registra o Material Symbols Rounded como icon set padrão do Vuetify.
 * Cada ícone é a "ligadura" (ex.: search, inventory_2) renderizada pela fonte.
 */
export default defineNuxtPlugin((nuxtApp) => {
  // hook de runtime exposto pelo vuetify-nuxt-module
  (nuxtApp.hook as unknown as (n: string, cb: (o: { vuetifyOptions: { icons?: unknown } }) => void) => void)(
    'vuetify:before-create',
    ({ vuetifyOptions }) => {
      vuetifyOptions.icons = {
        defaultSet: 'symbols',
        aliases,
        sets: {
          symbols: {
            component: (props: { tag: string; icon: string }) =>
              h(props.tag, { class: 'material-symbols-rounded' }, props.icon),
          },
        },
      };
    },
  );
});
