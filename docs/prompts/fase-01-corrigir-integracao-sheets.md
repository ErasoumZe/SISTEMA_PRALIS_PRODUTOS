# Fase 01 — Corrigir a integração com Google Sheets

```text
Audite e corrija a implementação existente de sincronização de novos produtos BASE com Google Sheets. O PostgreSQL deve continuar sendo a fonte de verdade e uma falha no Sheets não pode desfazer o produto salvo.

Antes de editar:
- Leia `docs/baseline-antes-integracoes.md`, `docs/integracao-google-sheets.md`, o módulo `stack/api/src/modules/google-sheets/`, serviço/repositório de produtos, migração da tabela de sync e os testes.
- Inspecione a planilha XLSX de referência na pasta irmã `../tabela`, especialmente a aba BASE, cabeçalhos, fórmulas, validações e valores das linhas existentes. Não suponha regras sem verificá-las.

Correções obrigatórias:
1. Corrija a normalização da chave privada do service account: sequências literais `\\n` precisam virar quebras de linha reais, sem corromper chaves que já tenham quebras reais. Adicione testes.
2. Corrija o sinal do desconto promocional gravado em AZ. A fórmula da planilha `(AZ*AO)+AO` exige fração negativa para desconto; por exemplo, 20% deve ser `-0,20`. Cubra com testes.
3. Grave os dias promocionais BB:BH no formato esperado pela fórmula: `SEG`, `TER`, `QUA`, `QUI`, `SEX`, `SAB`, `DOM` quando ativos e vazio quando inativos, nunca `SIM/NÃO`. Cubra todos os dias em teste.
4. Ao criar uma nova linha, copie tanto a formatação quanto as validações de dados da linha-modelo. `PASTE_FORMAT` não inclui validação; use também `PASTE_DATA_VALIDATION` ou mecanismo oficial equivalente. Ajuste o fake para que o teste consiga detectar a ausência dessa requisição.
5. Preencha corretamente as colunas operacionais verificadas na planilha: Q (revenda), S (transformação), AB (status usado por AD), AU (status da promoção), BP (`NÃO REVISADO`), BK (`DE:`) e BM (`ATÉ:`). Derive Q/S do tipo de produto sem criar combinações incoerentes. Preserve as fórmulas das colunas calculadas.
6. Corrija o crescimento da grade para não adicionar uma linha extra por erro de limite.
7. Revise a reserva/reutilização da linha em falhas. O retry não pode sobrescrever outro produto. Se a linha reservada estiver ocupada, procure nova linha vazia por UUID/código e atualize o registro de sync. Corrija a documentação se a garantia for diferente.
8. Não registre chave, JWT, senha ou payload sensível em logs.

Testes obrigatórios:
- Mapper: desconto, sete dias, valores auxiliares, campos vazios/nulos e primeira promoção.
- Serviço: busca idempotente por UUID em CP, linha vazia, expansão exata, format + data validation, falha parcial, retry e conflito de linha.
- Integração real com Postgres/Testcontainers: produto e pending na mesma transação; falha externa preserva produto e marca failed.
- Rode testes shared/API, typecheck, build PWA e `git diff --check`.

Não fazer nesta fase:
- Não acessar a planilha Google real.
- Não implementar sincronização de edições, exclusões ou CREARE.
- Não fazer commit, push ou deploy.

Critério de saída:
- Todos os itens obrigatórios possuem teste que falharia com a implementação antiga.
- Toda a suíte passa e a documentação representa o comportamento real.

Ao finalizar, liste arquivos alterados, explique cada correção, apresente comandos/resultados reais e declare `APROVADO PARA FASE 02` ou `BLOQUEADO`.
```
