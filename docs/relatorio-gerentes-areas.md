# Relatório Gerentes — mapa e áreas da TNP

## Regra de atribuição

A planta fornecida é da Unidade Catedral (TNP). Cada produto **do catálogo TNP** pode ter uma única `Área da loja (Relatório Gerentes)`. O PDV pelo qual a venda passou não altera essa área. Produtos sem vínculo confiável ou sem área escolhida não são atribuídos por nome, setor de estoque ou suposição: seus pontos aparecem na cobertura fora das barras.

Cada nome da legenda tem seleção e cor próprias. Bebidas, Laticínios e Mercearia dividem a mesma faixa no desenho original; a divisão visual dessa faixa é aproximada e não interfere no cálculo. “Mesa pães” aparece na legenda, mas não tem posição delimitada na planta; pode ser selecionada e participar do gráfico depois que um produto receber essa área.

## Fontes e limites

- **Mês e semana:** `venda_produto_dia`, que o robô atual já envia. Os pontos por área usam o total diário dos produtos (`0,25 ponto por R$ 1`). Essa fonte não permite calcular número de cupons, ticket ou hora por área.
- **Dia, 06h–22h:** `venda_item_pdv`, itens de cupons confirmados com horário. A mesma fonte alimenta o novo gráfico horário da aba PDVs. Horas sem itens recebidos permanecem sem dado, não são inventadas como zero.
- O fechamento diário do caixa é outra fonte. Seus totais podem divergir das vendas por produto e dos itens detalhados, inclusive por cobertura parcial, crediário e outros lançamentos.

**Dependência operacional:** o código do robô instalado na padaria não está neste repositório e, conforme o levantamento existente em `docs/vendas-detalhe-pdv-2026-09-24.md`, ainda não envia `venda_item_pdv`. Portanto, o modo horário só terá dados reais após adaptar e homologar esse robô. A API e a interface não criam horários a partir de dados diários.

## Homologação após deploy

1. Confirmar que a migração adicionou `products.area_venda` e que a planta protegida carrega na aba Áreas da TNP.
2. Editar um produto TNP com vendas registradas, selecionar uma área, salvar e conferir mês/semana. Validar que apenas sua barra aparece; desmarcar a área e confirmar que a barra desaparece.
3. Conferir que produtos sem área aparecem no indicador de cobertura, não nas barras.
4. Conferir com uma conta LI que a planta e os dados TNP não são acessíveis.
5. Quando o robô passar a enviar itens com horário, comparar um dia com os cupons de origem e checar 06h–22h, cobertura, quantidade, vendas e ticket. Até lá, o modo Dia deve informar ausência de detalhe.
