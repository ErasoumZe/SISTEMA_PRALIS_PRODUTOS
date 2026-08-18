# Fase 06 — Entrada controlada em produção

```text
Prepare e execute uma liberação controlada da integração Google Sheets em produção. Esta fase altera ambiente real: antes de qualquer deploy ou escrita na planilha oficial, apresente o plano final, os alvos exatos e peça confirmação explícita do usuário.

Pré-requisitos obrigatórios:
- Fases 00–05 aprovadas e working tree/diff revisados.
- Backup recuperável do banco e da planilha oficial.
- Migração validada em staging/cópia de banco.
- Service account de produção com privilégio mínimo e planilha compartilhada diretamente.
- Segredos configurados no Coolify, nunca em arquivos versionados.
- Worker, health checks, logs e rollback documentados.
- Janela e responsável pela validação definidos.

Fluxo:
1. Refaça testes, typecheck, build, audit de dependências e diff check.
2. Mostre branch/commit/diff que será publicado. Não inclua alterações não relacionadas.
3. Prepare runbook em `docs/runbook-producao-google-sheets.md`: backup, migração, deploy inicialmente com integração desabilitada, health, habilitação, teste canário, observação, rollback e contatos.
4. PARE e solicite confirmação explícita antes do primeiro comando que modifique produção.
5. Após autorizado, publique com `GOOGLE_SHEETS_ENABLED=false`, aplique migrações uma única vez e valide API/PWA/worker.
6. Habilite a integração e faça exatamente um cadastro canário aprovado pelo usuário.
7. Confirme banco, outbox, linha, UUID, fórmulas, validações e logs. Observe erros/retries por um período combinado.
8. Se qualquer gate falhar, desabilite a integração e execute o rollback definido sem apagar evidências.

Não faça:
- Não force push, não resete dados e não imprima segredos.
- Não faça cadastro em massa no primeiro rollout.
- Não confunda sucesso do deploy com sucesso da sincronização canário.

Critério de saída: canário aprovado ponta a ponta, monitoramento limpo, rollback disponível. Entregue URLs/versões sem segredos e declare `PRODUÇÃO APROVADA` ou `ROLLBACK/BLOQUEADO`.
```
