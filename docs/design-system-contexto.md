# Design system Cicluz — contexto da primeira entrega

Base: `main` após a PR #90 (`a4c2070`). O tema Vuetify, Noto Sans, Material Symbols Rounded e a identidade roxa da Cicluz já existiam.

## Decisões

- Manter Vuetify e a marca; usar tokens `--cx-*` de `app/assets/css/main.css` como fonte de espaçamento, tipografia, superfícies e estados.
- Aplicar padrões gradualmente com classes `cx-*`, preservando as telas ainda não revisadas.
- Reservar sombra para elementos sobrepostos; cards de conteúdo usam borda e contraste de superfície.
- Na primeira PR, mudar somente a fundação visual e a tela Produtos. Busca, filtros, seleção, edição, status e exclusão preservam os mesmos fluxos.
- Conferir a página em 360 px, tablet e desktop, inclusive foco de teclado e movimento reduzido.

Próxima etapa: formulário de produto Base/TNP/LI e telas administrativas, após revisão da primeira entrega.
