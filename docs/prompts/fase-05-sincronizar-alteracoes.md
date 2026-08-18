# Fase 05 — Sincronizar alterações e inativações

```text
Amplie a integração para manter a linha BASE atualizada quando um produto for editado ou inativado, sem sincronização bidirecional.

Regras:
1. PostgreSQL continua como fonte de verdade. Alterações manuais na planilha não devem sobrescrever o banco.
2. Modele eventos/outbox com operação e versão do produto. Eventos antigos não podem sobrescrever dados mais novos; coalesça ou rejeite versões obsoletas.
3. Localize a linha prioritariamente pelo UUID em CP, nunca apenas pela posição salva. Atualize o row number armazenado se a linha tiver sido movida.
4. Atualize somente colunas de entrada/manual que pertencem ao sistema. Preserve fórmulas, formatação, validações e colunas operacionais que tenham dono humano, conforme documentado.
5. Defina e implemente semântica de inativação. Não exclua fisicamente a linha sem regra expressa; atualize os campos de status esperados pela planilha.
6. Decida explicitamente o comportamento ao editar barcode/código e promoção. UUID permanece imutável.
7. Registre quem/quando alterou no banco quando o modelo já suportar isso, sem inventar dado na planilha.
8. Atualize documentação, tela admin e status de sincronização.

Testes obrigatórios:
- Edição comum, mudança de linha, linha ausente, status/inativação, evento repetido e eventos fora de ordem.
- Preservação de fórmulas/validações/colunas de responsabilidade humana.
- Falha externa não reverte a edição no banco.
- Homologação em cópia da planilha, nunca na oficial nesta fase.
- Suíte completa, typecheck, build e diff check.

Fora do escopo: importação das abas TNP/LI/HORA, bidirecionalidade e CREARE.

Critério de saída: criação, edição e inativação convergem de forma idempotente para uma única linha por produto. Declare `APROVADO PARA FASE 06` ou `BLOQUEADO`.
```
