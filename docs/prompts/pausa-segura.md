# Prompt de pausa segura

```text
Pause o trabalho atual de forma segura e deixe tudo preparado para retomarmos depois exatamente do ponto em que paramos.

Não continue implementando novas funcionalidades. Execute somente verificações e ajustes mínimos indispensáveis para não deixar arquivos corrompidos, comandos/processos iniciados por você ou uma alteração parcialmente aplicada. Não esconda falhas para produzir um estado aparentemente limpo.

Procedimento obrigatório:
1. Termine ou interrompa com segurança somente os processos que você iniciou nesta sessão. Não encerre processos do usuário ou serviços preexistentes. Informe o que permaneceu em execução.
2. Execute `git status --short`, `git diff --stat`, `git diff --check` e inspecione `git diff` e `git diff --cached`. Diferencie claramente alterações anteriores do usuário das realizadas nesta sessão.
3. Verifique se foram criados arquivos temporários, dumps, logs, exports, credenciais, `.env`, chaves ou dados de teste. Não apague nada material sem autorização. Garanta que segredos não estejam staged nem rastreados e não exiba seus valores.
4. Não execute `git reset --hard`, `git clean`, checkout destrutivo, stash, commit, amend, merge, rebase, push, deploy, migração ou rollback sem autorização expressa.
5. Não altere staging existente do usuário. Informe separadamente o que está staged, modificado sem staging e não rastreado.
6. Rode apenas validações rápidas e relevantes para os arquivos modificados. Se testes demorados já tiverem sido executados, registre o comando, horário aproximado e resultado; não os repita sem necessidade. Se algo não foi testado, diga explicitamente.
7. Se esta sessão alterou banco, Google Sheets, CREARE, infraestrutura ou outro serviço externo, registre exatamente o ambiente, o tipo de alteração, identificadores não sensíveis, dados de teste criados e o estado final. Não tente compensar ou apagar automaticamente.
8. Crie ou atualize `docs/pausa-segura.md` com o relatório de retomada. Preserve informações anteriores ainda válidas e não inclua segredos.

O relatório `docs/pausa-segura.md` deve conter:
- Data e hora da pausa e branch/commit HEAD atual.
- Objetivo e fase que estavam sendo executados.
- O que foi concluído, o que está parcialmente concluído e o que ainda não começou.
- Arquivos alterados nesta sessão e finalidade de cada um.
- Alterações preexistentes que foram preservadas.
- Decisões tomadas, suposições e perguntas em aberto.
- Comandos/testes executados e seus resultados reais.
- Falhas e riscos conhecidos, incluindo migrações ou efeitos externos.
- Estado do Git: staged, unstaged e untracked.
- Passo exato e seguro para retomar, com o primeiro arquivo/comando a revisar.
- Critérios que ainda precisam ser satisfeitos antes de commit, push ou produção.

Antes de encerrar, leia o relatório criado e confirme que ele corresponde ao estado real do repositório. Execute novamente `git status --short` e `git diff --check` depois de criar o relatório.

Resposta final obrigatória:
- Declare `PAUSA SEGURA CONCLUÍDA` ou `PAUSA COM BLOQUEIO`.
- Resuma o estado atual, testes, efeitos externos e riscos.
- Informe o caminho do relatório de retomada.
- Liste o primeiro passo recomendado ao voltar.
- Reforce que nenhum commit, push ou deploy foi feito, salvo se isso já tiver sido explicitamente autorizado e executado antes deste pedido.
```
