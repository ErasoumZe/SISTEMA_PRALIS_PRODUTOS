# Fase 04 — Operação, fila e reprocessamento

```text
Torne a sincronização com Google Sheets segura para operação contínua e múltiplas instâncias da API.

Problemas a resolver:
- A criação do produto não deve aguardar indefinidamente uma chamada de rede.
- Deve haver timeout explícito, retry automático com backoff e limite de tentativas.
- Uma fila somente em memória/processo não é suficiente em ambiente com mais de uma instância.
- O administrador precisa enxergar pendentes/falhas e reprocessá-los sem Swagger.

Implemente:
1. Use a tabela de sync como outbox durável. A transação de criação grava produto + evento pending atomicamente.
2. Crie worker executado com processo/comando claramente separado ou mecanismo equivalente, com claim atômico no PostgreSQL (`FOR UPDATE SKIP LOCKED`, lease ou estratégia robusta). Evite processamento duplicado entre instâncias.
3. Acrescente estados/metadados necessários, como processing, next_attempt_at e lease/locked_at, por migração Drizzle consistente.
4. Configure timeout da API Google, backoff exponencial com jitter, máximo de tentativas e possibilidade de retry manual. Erros permanentes devem ter mensagem sanitizada e acionável.
5. Mantenha idempotência por UUID em CP mesmo se o worker morrer depois de escrever na planilha e antes de marcar synced.
6. Crie endpoints admin para resumo/listagem paginada e retry individual/em lote, com validação e autorização.
7. Crie tela admin simples mostrando produto, status, tentativas, último erro sanitizado, datas e botão de tentar novamente. Evite expor stack trace/credenciais.
8. Adicione logs estruturados com correlation/product/sync ID e métricas básicas, sem dados sensíveis.
9. Documente execução do worker no desenvolvimento e no Coolify, health check e procedimento operacional.

Testes obrigatórios:
- Timeout, backoff, limite, retry manual, erro permanente.
- Dois workers concorrentes não processam o mesmo item.
- Recuperação de lease expirado.
- Crash simulado após escrita externa não duplica linha.
- Autorização de todos os endpoints admin.
- Componentes/fluxo da tela admin na cobertura adotada pelo projeto.
- Suíte completa, typecheck, build e diff check.

Não implemente ainda edições de produtos nem CREARE. Não faça deploy, commit ou push.

Critério de saída: processamento assíncrono durável, concorrência segura, operação visível ao admin e testes aprovados. Declare `APROVADO PARA FASE 05` ou `BLOQUEADO`.
```
