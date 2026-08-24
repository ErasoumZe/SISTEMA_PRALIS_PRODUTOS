# Início — Pralis como front-end para Google Sheets e CREARE

```text
Trabalhe no repositório Pralis a partir do estado atual, preservando integralmente todas as alterações existentes. O objetivo desta execução é fechar os bloqueadores presentes nos Changes, deixar a integração Google Sheets pronta para homologação e preparar a arquitetura para o Pralis enviar produtos ao Sheets e ao CREARE como destinos independentes.

Contexto verificado:
- A branch é `main`, HEAD `0060dfd`, com diversas alterações sem commit.
- As correções das fases 01 e 02 e a preparação da fase 03 estão nos Changes.
- A nova planilha informada tem o ID `1Xx9u0byq4pg92bP8zxRkbjpn8y-k4A-q4OeDGukoU3g` e gid `1481665756`.
- Essa planilha respondeu 401 para acesso anônimo. Não suponha o nome da aba e não tente escrever sem service account autorizada.
- As variáveis Google não estão configuradas no `.env` local.
- Não existe documentação técnica suficiente do CREARE no workspace.

Regras de segurança:
1. Antes de editar, execute e inspecione `git status --short`, `git diff --stat`, `git diff`, `git diff --cached` e `git diff --check`.
2. As alterações atuais pertencem ao usuário. Não use reset, clean, checkout destrutivo ou stash e não descarte arquivos.
3. Não faça commit, push, deploy, migração em produção ou escrita em serviço externo sem autorização expressa.
4. Não mostre, grave ou versione credenciais. Nunca coloque service account, chave privada ou `.env` no Git.
5. PostgreSQL continua sendo a fonte de verdade. Google Sheets e CREARE nunca devem depender um do outro.

## Parte 1 — Fechar os bloqueadores dos Changes

Revise e corrija estes itens com testes:

1. `npm ls --all` atualmente falha porque `@react-email/render@1.1.2` declara peers `react` e `react-dom` ausentes. Investigue a cadeia exata e resolva pelo mecanismo suportado, na workspace correta. Não adicione dependências cegamente nem use `--legacy-peer-deps`, override incompatível ou `npm audit fix --force`. Atualize `docs/auditoria-dependencias.md` para refletir o resultado real.
2. No serviço Sheets, a reserva do UUID em CP ocorre antes de garantir que a linha existe fisicamente na grade. Separe as responsabilidades para executar nesta ordem:
   - garantir capacidade da grade, adicionando exatamente as linhas necessárias;
   - reservar a linha gravando o UUID em CP;
   - registrar o row number;
   - copiar formato, validações e fórmulas;
   - gravar as células manuais.
   Cubra o caso `linha = rowCount + 1` e prove que nenhuma escrita de valor ocorre antes da expansão.
3. Corrija o comentário do serviço que afirma que `PASTE_FORMAT` inclui validações. A documentação oficial define que ele exclui data validation. O código deve manter as requisições separadas `PASTE_FORMAT` e `PASTE_DATA_VALIDATION`, e o fake/teste deve detectar a ausência de qualquer uma delas.
4. Confirme que a normalização de `\\n` literal, desconto negativo em AZ, dias `SEG...DOM`, colunas Q/S/AB/AU/BK/BM/BP, expansão exata e sanitização de erros continuam cobertos por testes que falhariam na versão antiga.
5. Investigue a fórmula AP da planilha local, que aparentemente referencia `$BB$11:$BH$11` de forma absoluta. Não altere fórmulas da planilha por suposição. Registre esse item como gate obrigatório da homologação na nova planilha.

## Parte 2 — Revalidação completa

1. Verifique se o Docker está disponível. Se estiver desligado, não declare a suíte aprovada: informe que o usuário precisa iniciar o Docker Desktop.
2. Com Docker disponível, execute:
   - `npm test` em `stack/shared`;
   - `npm run typecheck` em `stack/api`;
   - `npm test` em `stack/api`;
   - `npm run test:integration` em `stack/api`;
   - `npm run build` em `stack/pwa`;
   - `npm ls --all` na raiz;
   - `npm audit --omit=dev` e auditoria completa;
   - `git diff --check`.
3. Registre comandos e resultados reais. Teste ignorado/skipped por Docker indisponível não conta como aprovado.
4. Não afirme que a integração real funciona apenas porque o FakeSheetsGateway passou.

## Parte 3 — Preparar a nova planilha para homologação

1. Atualize `docs/homologacao-google-sheets.md` registrando o novo spreadsheet ID somente como destino informado para homologação; nunca o transforme em fallback do código.
2. Registre como pergunta bloqueadora se essa planilha é uma CÓPIA de homologação ou a oficial. Nenhuma escrita pode ocorrer antes dessa confirmação.
3. O gid não substitui o título da aba usado pela API. Assim que houver acesso da service account, primeiro execute o health check somente leitura para descobrir/confirmar:
   - autenticação;
   - acesso ao spreadsheet;
   - nome exato da aba BASE;
   - cabeçalhos esperados;
   - rowCount e columnCount.
4. Prepare o checklist do teste canário, mas não o execute sem credenciais e confirmação:
   - um produto `ZZ HOMOLOG` inequivocamente identificável;
   - produto + sync no PostgreSQL;
   - uma única linha e UUID em CP;
   - fórmulas, validações e formatação;
   - AZ negativo e AY calculado corretamente;
   - dias da promoção e, especialmente, se AP usa a linha do próprio produto;
   - Q/S/AB/AU/BK/BM/BP;
   - idempotência, falha/retry e concorrência;
   - limpeza somente dos dados de teste autorizados.
5. Se faltarem credenciais, pare com uma lista objetiva do que o usuário deve configurar. Não peça que a chave privada seja colada no chat; ela deve ir diretamente para o `.env` local ignorado ou gerenciador de segredos.

## Parte 4 — Especificar Pralis -> Sheets + CREARE

Crie `docs/plano-pralis-sheets-creare.md`, sem implementar o adaptador CREARE ainda, contendo:

1. Arquitetura obrigatória:
   `Formulário -> API -> PostgreSQL -> outbox Sheets` e, de forma separada, `PostgreSQL -> outbox CREARE`.
2. O navegador nunca recebe credenciais nem chama diretamente Google ou CREARE.
3. Uma falha em um destino não bloqueia, reverte nem duplica o outro.
4. Proposta de estados do produto: `rascunho`, `aprovado`, `publicado parcialmente`, `publicado`, `inativo`, sem alterar o schema nesta execução.
5. Proposta de status por destino/loja: `pending`, `processing`, `synced`, `failed`, tentativas, próxima tentativa, erro sanitizado, external ID e timestamps.
6. Proposta de versionamento do produto (`updatedAt` + versão monotônica) para eventos antigos não sobrescreverem edições novas.
7. Mapeamento dos campos que já existem: identidade, comercial, estoque, custo, margem, transformação, fiscal, promoção e foto.
8. Lacunas confirmadas:
   - seleção de lojas de destino em vez de TNP/LI/HORA hardcoded;
   - `localVenda1/2` existem, mas o formulário envia null;
   - uma promoção no Sheets versus várias no banco;
   - URL Cloudinary versus caminho interno AppSheet;
   - campos e identificadores CREARE ainda desconhecidos;
   - criação, edição e inativação precisam gerar eventos separados.
9. Esboço de `product_creare_sync` por produto + empresa/loja, com external ID, operação, payload version, status, tentativas, erro e timestamps.
10. Sequência recomendada de implementação e rollout com feature flags independentes para Sheets e CREARE.

## Parte 5 — Descoberta obrigatória do CREARE

Não invente API, tabelas, campos ou autenticação. Produza em `docs/plano-pralis-sheets-creare.md` uma seção de informações necessárias:

- nome completo do produto, fornecedor e versão do CREARE;
- URL ou telas que identifiquem o sistema;
- manual oficial de API ou importador;
- exemplo oficial CSV/XLSX/XML/JSON ou exportação de um produto correto;
- sandbox/homologação;
- códigos das empresas/lojas TNP, LI e HORA;
- regras de criação, alteração, inativação, idempotência e retorno de erro;
- lista de campos fiscais obrigatórios;
- contato técnico do fornecedor.

Priorize REST oficial, SOAP oficial ou importador oficial de arquivos. Escrita direta em Firebird/outro banco é proibida sem schema, procedures, regras transacionais, versão suportada, autorização formal do fornecedor e ambiente de homologação.

## Organização para commits futuros

Não faça os commits agora. Ao finalizar, proponha a separação exata dos arquivos/hunks em:
1. `fix(sheets): corrige mapeamento e seguranca da sincronizacao`;
2. `chore(deps): atualiza dependencias vulneraveis`;
3. `docs: registra baseline e plano de homologacao`.

Se um arquivo contiver mudanças de mais de um grupo, indique os hunks que precisam ser staged separadamente. Não misture credenciais, artefatos de build ou arquivos temporários.

Critério de saída:
- bloqueadores do código corrigidos com testes;
- `npm ls --all` limpo;
- toda a suíte aprovada, inclusive integração com Docker;
- documentação atualizada e coerente com o comportamento real;
- nenhuma chamada ao Google/CREARE e nenhum segredo versionado;
- plano Sheets + CREARE criado sem suposições sobre o contrato externo;
- working tree preservada e organização de commits proposta.

Resposta final obrigatória:
- Liste o que foi corrigido e os arquivos alterados.
- Apresente todos os comandos/testes com resultados reais.
- Informe separadamente o estado Sheets e o estado CREARE.
- Liste as ações manuais que dependem do usuário.
- Declare `PRONTO PARA HOMOLOGAÇÃO SHEETS` ou `BLOQUEADO`, sem declarar produção pronta.
```
