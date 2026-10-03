# Relatório Gerentes — mapa e áreas da TNP

## Regra de atribuição

A planta fornecida é da Unidade Catedral (TNP). Cada produto **do catálogo TNP** pode ter uma única `Área da loja (Relatório Gerentes)`. O PDV pelo qual a venda passou não altera essa área. Quando não há escolha manual, o relatório sugere a área pelo grupo de mercadorias (ex.: `MER BISCOITOS` → Biscoitos; `MER BEBIDAS` → Bebidas; `MER BOMBONIERI` → Mercearia). A última é uma **aproximação de categoria**, não uma posição física comprovada. A escolha manual sempre prevalece e a sugestão não grava nada no produto. Produtos sem vínculo confiável, sem grupo ou com grupo genérico/ambíguo não são atribuídos por nome, setor de estoque ou PDV: seus pontos aparecem na cobertura fora das barras.

Os grupos foram conferidos nas fontes locais `stack/api/src/db/base-products.json`, `docs/fiscal-por-grupo.csv` e na cópia local da planilha central (78 rótulos encontrados). São recortes históricos, não uma exportação atual do cadastro TNP. O relatório mostra a quantidade e os pontos atribuídos por grupo para que a gerência possa revisar e substituir as sugestões no cadastro. Atribuições históricas refletem o grupo e a área atuais do produto.

| Grupo ou família do cadastro | Área provisória |
| --- | --- |
| `MER BISCOITOS` | Biscoitos |
| `MER BEBIDAS` e grupos legados explícitos de bebidas | Bebidas |
| `MER LATICÍNIOS` | Laticínios |
| `MER FRIOS` | Frios |
| `MER MERCEARIA` | Mercearia |
| `MER BOMBONIERI` | Mercearia (aproximação, revisar) |
| `MER FAB. PRÓPRIA - BEBIDAS/COPA` | Copa |
| `MER FAB. PRÓPRIA - LANCHES/CHAPA` | Chapa |
| Vitrine, Vitrine pães, Vasca pães, Mesa pães e Pães empacotados explicitamente no grupo | Área homônima |

Grupos genéricos (`PADRAO`, `OUTROS`), Panificação, Confeitaria, Matéria-prima, Cigarros e demais categorias sem posição única continuam sem sugestão. A lista exata e normalização estão em `vendas-gerentes-area-grupo.ts`.

Cada nome da legenda tem seleção e cor próprias. Bebidas, Laticínios e Mercearia dividem a mesma faixa no desenho original; a divisão visual dessa faixa é aproximada e não interfere no cálculo. “Mesa pães” aparece na legenda, mas não tem posição delimitada na planta; pode ser selecionada e participar do gráfico depois que um produto receber essa área. A imagem exibida é uma edição sem a marcação vermelha do PDF fornecido, preservado como fonte.

## Fontes e limites

- **Mês e semana:** `venda_produto_dia`, que o robô atual já envia. Os pontos por área usam o total diário dos produtos (`0,25 ponto por R$ 1`). Essa fonte não permite calcular número de cupons, ticket ou hora por área.
- **Dia, 06h–22h:** `venda_item_pdv`, itens de cupons confirmados com horário. A mesma fonte alimenta o novo gráfico horário da aba PDVs. Horas sem itens recebidos permanecem sem dado, não são inventadas como zero.
- O fechamento diário do caixa é outra fonte. Seus totais podem divergir das vendas por produto e dos itens detalhados, inclusive por cobertura parcial, crediário e outros lançamentos.

**Dependência operacional:** o código do robô instalado na padaria não está neste repositório e, conforme o levantamento existente em `docs/vendas-detalhe-pdv-2026-09-24.md`, ainda não envia `venda_item_pdv`. Portanto, o modo horário só terá dados reais após adaptar e homologar esse robô. A API e a interface não criam horários a partir de dados diários.

## Homologação após deploy

1. Confirmar que a migração adicionou `products.area_venda` e que a planta protegida carrega na aba Áreas da TNP.
2. Conferir um produto TNP sem área manual cujo grupo seja Biscoitos/Bebidas/Laticínios/etc.: o relatório deve apontar sua área como **sugerida**. Editar esse produto e selecionar outra área; após salvar, a escolha manual deve prevalecer.
3. Conferir que produtos sem vínculo ou com grupo genérico/ambíguo aparecem no indicador de cobertura, não nas barras. Desmarcar uma área e confirmar que sua barra desaparece.
4. Conferir com uma conta LI que a planta e os dados TNP não são acessíveis.
5. Quando o robô passar a enviar itens com horário, comparar um dia com os cupons de origem e checar 06h–22h, cobertura, quantidade, vendas e ticket. Até lá, o modo Dia deve informar ausência de detalhe.
