# Conciliação de Pesável — TNP

Produtos novos no Pralis começam com `Pesável=N`, mas a escolha pode ser alterada para `S` no cadastro. Produtos antigos já classificados como `S` ou `N` permanecem como estão. A unidade (`KG`, `UN` etc.) não define Pesável.

Para produtos antigos ainda sem classificação, há uma conciliação **manual e opt-in** com a aba `BASE SIA FULL` da planilha configurada em `GOOGLE_SHEETS_SPREADSHEET_ID`. O vínculo é apenas `Cód. produto` da planilha com `codigo_interno` do produto TNP. O processo não usa nome, unidade, barcode ou horário para adivinhar. Para `S`, exige também Tecla e Validade numéricas, em até três dígitos. Produto sem fonte ou com código interno duplicado permanece bloqueado para exportação.

1. Execute a prévia, sem gravar: `npm run creare:pesavel:conciliar --workspace @pralis/api`.
2. Confira o resumo, em especial conflitos com S/N já preenchidos, linhas sem fonte, códigos duplicados e a quantidade que será classificada como S/N. Compare a planilha com o SIA atual, pois ela pode estar defasada. Faça backup do banco antes de aplicar.
3. Somente após homologar a fonte, execute: `npm run creare:pesavel:conciliar --workspace @pralis/api -- --apply "--confirm=CONCILIAR PESAVEL TNP"`.
4. Rode a prévia novamente e confira `/admin/creare/health`. Inspecione os campos posicionais do próximo TXT antes de importar no SIA.

O script só preenche `products.pesavel IS NULL` da TNP, em transação. Valores `S` e `N` já existentes nunca são sobrescritos. Não altera o de-para nem o cadastro do SIA. **Não roda no deploy.** A simples leitura da aba não prova que o SIA atual tenha os mesmos valores; conflitos devem ser resolvidos com uma exportação atual do SIA, não por importação cega do TXT.
