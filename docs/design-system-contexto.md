# Design system Cicluz — contexto da primeira entrega

Base: `main` após a PR #90 (`a4c2070`). O tema Vuetify, Noto Sans, Material Symbols Rounded e a identidade roxa da Cicluz já existiam.

## Decisões

- Manter Vuetify e a marca; usar tokens `--cx-*` de `app/assets/css/main.css` como fonte de espaçamento, tipografia, superfícies e estados.
- Aplicar padrões gradualmente com classes `cx-*`, preservando as telas ainda não revisadas.
- Reservar sombra para elementos sobrepostos; cards de conteúdo usam borda e contraste de superfície.
- Na primeira PR, mudar somente a fundação visual e a tela Produtos. Busca, filtros, seleção, edição, status e exclusão preservam os mesmos fluxos.
- Conferir a página em 360 px, tablet e desktop, inclusive foco de teclado e movimento reduzido.

## Segunda entrega — formulário Base/TNP/LI

- Baseada na `main` após o merge da PR #91 (`1aee40a`).
- Reorganizar apenas a hierarquia visual do formulário compartilhado: introdução, seções Produto, Revenda/Transformação, Fiscal e Promoção, além dos subtítulos internos e da área de ações.
- Preservar campos, condições Base/loja, regras fiscais, valores, validações, foto, botões e chamadas de gravação.
- Usar os tokens existentes, sem criar outro tema ou dependência. Em telas pequenas, seletores e ações se adaptam à largura disponível.
- Conferência visual local com dados simulados do produto 13125 em 360 px, 768 px e desktop. A opção de promoção foi ajustada para quebrar o texto em 360 px; sem rolagem horizontal nesses breakpoints. Nenhum dado de produção foi alterado nessa conferência.

## Terceira entrega — Dashboard e Central de Produtos

- Baseada na `main` após o merge da PR #92 (`b5bafa2`).
- Alinhar a visão administrativa aos tokens compartilhados: superfícies claras, bordas discretas, tipografia e espaçamento consistentes. Preservar métricas, gráficos, atualização e links.
- Reorganizar a Central em introdução, indicadores, filtros e cartões de conciliação. Os filtros de situação usam botões com estado pressionado para acesso por teclado, mantendo os mesmos valores e ações.
- Não alterar carregamento, classificação, unificação, descarte ou persistência.
- Conferência visual local com dados simulados em desktop, 768 px e 360 px, sem rolagem horizontal. Foram corrigidos o contraste da ação “Ignorar” e a capitalização da data do Dashboard. O preview não acessou produção.

Próxima etapa: demais telas administrativas e fluxos de importação, após revisão desta entrega.
