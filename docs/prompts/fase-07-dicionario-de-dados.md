# Fase 07 — Dicionário de dados e campos faltantes

```text
Mapeie integralmente os dados de produto antes de criar novos campos ou integrar com o CREARE. Esta é uma fase de análise e especificação; não implemente mudanças funcionais ainda.

Fontes que devem ser comparadas:
- Schema/tipos/validações do PostgreSQL e shared.
- Formulário e payload do PWA/API.
- XLSX local, todas as colunas C:CP da BASE, fórmulas, validações e tabelas auxiliares.
- Campos exigidos pelo CREARE, se a documentação já estiver disponível; caso contrário marque como `a confirmar`.

Produza `docs/dicionario-de-dados-produto.md` com uma tabela por campo contendo:
- Nome de negócio e descrição.
- Campo no PWA, API/shared, banco, coluna Sheets e campo CREARE.
- Tipo, unidade/formato, obrigatoriedade, valor padrão e exemplos válidos.
- Fonte de verdade, dono/responsável, editabilidade e destino.
- Regra de transformação/validação.
- Situação: implementado, descartado, faltante ou a confirmar.

Investigue explicitamente:
- lojasDestino, localVenda1/localVenda2, marcas e grupos/tabelas auxiliares.
- revenda versus transformação e regra de descrição para produto por KG.
- margem/grupo de margem, revisão fiscal, status e inativação.
- múltiplas promoções versus apenas a primeira.
- codigo interno, codigo gerado, barcode e identificadores externos.
- foto Cloudinary versus caminho esperado por AppSheet/CREARE.
- refReceituario e campos que o backlog pretende remover.
- auditoria: createdBy, updatedBy, timestamps e baseProductId.

Além do dicionário, crie:
1. Matriz `origem -> transformação -> destino`.
2. Lista priorizada de lacunas: bloqueadora, importante, melhoria.
3. Proposta de alterações de schema/API/PWA/Sheets, ainda sem implementar.
4. Perguntas de negócio que somente o responsável da padaria/CREARE pode responder.

Não presuma que célula vazia significa campo dispensável. Diferencie coluna manual, calculada e lookup. Não edite banco, planilha ou código funcional.

Critério de saída: todos os campos atuais rastreados de ponta a ponta, lacunas priorizadas e perguntas abertas explícitas. Declare `APROVADO PARA FASE 08` ou `BLOQUEADO POR DECISÕES DE NEGÓCIO`.
```
