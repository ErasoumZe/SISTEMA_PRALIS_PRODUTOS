# Fase 00 — Segurança e baseline

```text
Estamos trabalhando no repositório Pralis. Antes de alterar qualquer código, crie um baseline verificável do estado atual.

Objetivos:
1. Leia a estrutura do monorepo, os scripts dos package.json, os arquivos de ambiente de exemplo, docker-compose e a documentação existente.
2. Execute `git status`, `git diff --stat`, `git diff --check` e examine todo o diff atual. As alterações sem commit pertencem ao usuário: preserve-as.
3. Identifique os comandos corretos de instalação, banco/migração, testes, typecheck, build e execução local.
4. Rode a suíte atual sem modificar arquivos. Registre separadamente shared, API unitária, API integração, typecheck e build do PWA. Se algum teste exigir Docker ou serviço externo, explique exatamente a dependência.
5. Verifique se segredos, chaves privadas, senhas ou arquivos .env foram adicionados ao Git. Não exiba valores secretos no relatório.
6. Confira se as migrações e snapshots do Drizzle estão consistentes e em ordem.
7. Crie `docs/baseline-antes-integracoes.md` com: commit/branch atual, arquivos modificados, comandos executados, resultados, riscos existentes e procedimento de rollback. Não inclua segredos.

Restrições:
- Não implemente correções nesta fase.
- Não faça commit, push, deploy, reset, checkout destrutivo ou alteração no banco de produção.
- Não invente resultados. Inclua o comando e o resultado real de cada verificação.

Critério de saída:
- Baseline documentado, nenhum segredo versionado e resultado real de todos os testes relevantes conhecido.
- Se encontrar segredo versionado ou inconsistência de migração, pare e destaque como bloqueador.

Ao finalizar, apresente: resumo, arquivos criados/alterados, testes executados, falhas e decisão clara `APROVADO PARA FASE 01` ou `BLOQUEADO`.
```
