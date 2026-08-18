# Fase 03 — Homologação real no Google Sheets

```text
Homologue a integração em uma CÓPIA descartável da planilha Google, nunca inicialmente na planilha oficial.

Pré-requisitos externos que você deve verificar sem revelar valores:
- ID da planilha de homologação.
- Aba BASE de homologação com a mesma estrutura da oficial.
- Service account com Google Sheets API habilitada e acesso de editor apenas à cópia.
- `GOOGLE_SHEETS_ENABLED`, spreadsheet ID, sheet name, client email e private key configurados fora do Git.

Se algum pré-requisito estiver ausente, não invente credenciais e não use a planilha oficial: pare com um checklist exato do que o usuário precisa fornecer/configurar.

Com os pré-requisitos presentes:
1. Confirme que Fases 01 e 02 foram aprovadas e rode a suíte antes do teste externo.
2. Faça backup/exportação da aba de homologação ou registre uma linha segura destinada ao teste.
3. Teste o endpoint de health como administrador.
4. Cadastre um produto de teste inequivocamente identificado, com barcode/código exclusivos, dados fiscais, produto de revenda, promoção com desconto e dias selecionados.
5. Verifique no PostgreSQL o produto e o registro de sync; na planilha, verifique a linha, UUID em CP, fórmulas, validações/dropdowns, formatação, desconto negativo, dias, datas/horas e colunas operacionais.
6. Repita/reprocesse a sincronização e prove idempotência: não pode surgir segunda linha.
7. Simule falha removendo temporariamente o acesso ou usando gateway controlado; prove que o produto permanece, status fica failed e retry posterior sincroniza sem duplicar.
8. Teste simultaneidade com dois produtos diferentes e confirme que não ocupam a mesma linha.
9. Remova somente os dados de teste da cópia, de forma verificável; não apague dados oficiais.
10. Registre evidências sem expor segredos em `docs/homologacao-google-sheets.md`.

Não fazer:
- Não editar a planilha oficial.
- Não fazer deploy ou habilitar produção.
- Não salvar JSON de service account no repositório.

Critério de saída:
- Cadastro, fórmulas, validações, idempotência, falha/retry e concorrência comprovados na cópia real.

Finalize com evidências, eventuais dados de teste remanescentes e `APROVADO PARA FASE 04` ou `BLOQUEADO`.
```
