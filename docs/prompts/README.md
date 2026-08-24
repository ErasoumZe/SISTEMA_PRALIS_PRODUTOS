# Roteiro de implementação

Execute os prompts abaixo, na ordem, sempre a partir da raiz do repositório `pralis`.

1. [`fase-00-seguranca-e-baseline.md`](fase-00-seguranca-e-baseline.md)
2. [`fase-01-corrigir-integracao-sheets.md`](fase-01-corrigir-integracao-sheets.md)
3. [`fase-02-seguranca-dependencias.md`](fase-02-seguranca-dependencias.md)
4. [`fase-03-homologacao-google-sheets.md`](fase-03-homologacao-google-sheets.md)
5. [`fase-04-operacao-e-reprocessamento.md`](fase-04-operacao-e-reprocessamento.md)
6. [`fase-05-sincronizar-alteracoes.md`](fase-05-sincronizar-alteracoes.md)
7. [`fase-06-producao-controlada.md`](fase-06-producao-controlada.md)
8. [`fase-07-dicionario-de-dados.md`](fase-07-dicionario-de-dados.md)
9. [`fase-08-descoberta-creare.md`](fase-08-descoberta-creare.md)
10. [`fase-09-integracao-creare.md`](fase-09-integracao-creare.md)

## Como usar

- Cole o conteúdo integral de um arquivo no Claude Code.
- Não avance se o critério de saída da fase falhar.
- Antes de cada fase, confirme que o resultado da anterior foi revisado.
- Guarde credenciais somente em variáveis de ambiente ou no gerenciador de segredos da hospedagem. Nunca as envie ao Git.
- As fases 03, 06, 08 e 09 dependem de informações ou acessos externos e devem parar claramente quando eles não estiverem disponíveis.
- Não use `git reset --hard`, não descarte alterações existentes e não publique automaticamente.

O fluxo separa a integração em dois destinos independentes:

```text
Cadastro Pralis (PostgreSQL)
   |-- fila/outbox Google Sheets --> planilha BASE
   `-- fila/outbox CREARE --------> API/importador oficial CREARE
```

O PostgreSQL permanece como fonte de verdade. A planilha não deve virar ponte para o CREARE.

## Utilitário

Use [`pausa-segura.md`](pausa-segura.md) quando precisar interromper o trabalho no meio de qualquer fase. Ele registra o estado real e prepara uma retomada sem descartar nem publicar alterações.

## Próximo passo do estado atual

Use [`inicio-sheets-creare.md`](inicio-sheets-creare.md) para fechar os bloqueadores que ainda estão nos `Changes`, preparar a homologação da nova planilha e documentar a base da integração independente com o CREARE.
