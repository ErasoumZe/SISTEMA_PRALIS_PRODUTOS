# Fase 09 — Implementar a integração com CREARE

```text
Implemente a integração com o CREARE exatamente pelo mecanismo oficial aprovado na Fase 08. Se `docs/descoberta-integracao-creare.md` não contiver GO, sandbox e contrato suficiente, não programe por suposição: declare bloqueio.

Arquitetura obrigatória:
- PostgreSQL Pralis continua como fonte de verdade.
- Sheets e CREARE são destinos independentes; nunca envie ao CREARE lendo a planilha.
- Crie outbox/tabela própria, por exemplo `product_creare_sync`, com product_id, empresa/loja, operação, versão do payload, external_id, status, tentativas, próxima tentativa, erro sanitizado e timestamps.
- Grave produto + evento(s) CREARE atomicamente. Uma falha externa não pode desfazer o cadastro local nem bloquear Sheets.

Implemente:
1. Porta/interface de gateway e adaptador oficial isolado do domínio.
2. Mapper estrito baseado no dicionário aprovado, incluindo unidade, fiscais, lojas/empresas, status e identificadores.
3. Idempotência por chave suportada pelo CREARE; criação repetida não pode duplicar produto.
4. Worker durável, claim concorrente, timeout, retry com backoff/jitter, limite e dead-letter/revisão manual, reaproveitando infraestrutura genérica somente quando isso não acoplar os destinos.
5. Criação, atualização e inativação conforme o contrato oficial e a versão do produto.
6. Endpoints/tela admin para status, erro, external_id, retry e reconciliação por loja, protegidos por permissão.
7. Logs/auditoria sem segredos nem dados pessoais desnecessários.
8. Feature flag por ambiente e, se necessário, por loja.
9. Documentação de configuração, operação, recuperação e rollback.

Testes:
- Unitários do mapper para cada regra e campo obrigatório.
- Contrato contra mock/fake fiel à documentação.
- Integração com PostgreSQL/outbox e concorrência de workers.
- Idempotência, timeout, erro temporário/permanente, eventos fora de ordem, reconciliação e isolamento entre lojas.
- Homologação ponta a ponta exclusivamente no sandbox CREARE, com produto de teste autorizado.
- Regressão completa de Sheets, API e PWA.

Entrega em produção é uma etapa separada: prepare runbook e plano canário, mas pare e peça confirmação explícita antes de deploy ou envio real.

Critério de saída: sandbox aprovado ponta a ponta, nenhuma duplicação, falhas isoladas por destino/loja, reconciliação possível e toda a suíte verde. Declare `PRONTO PARA CANÁRIO CREARE` ou `BLOQUEADO`.
```
