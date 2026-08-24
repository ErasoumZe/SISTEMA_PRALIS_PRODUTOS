# Próximos passos — fechar homologação e preparar produção do Google Sheets

```text
Trabalhe no repositório Pralis a partir do estado atual. O objetivo desta execução é auditar e commitar a correção final encontrada no canário do Google Sheets, validar a planilha oficial somente por leitura e preparar um rollout controlado. Não avance para escrita em produção sem cumprir todos os gates e obter confirmação explícita do usuário no momento da execução.

## Estado verificado em 24/08/2026

- Branch atual: `fix/sheets-homologacao`.
- HEAD antes das mudanças finais: `6d807bd`.
- Acesso da service account à cópia de homologação está funcionando.
- Planilha de homologação: `HOMOLOGAÇÃO - CENTRAL PRODUTOS (BASE)`.
- Aba homologada: `(BASE) CADASTRO PRODUTOS`.
- Canário criado no PostgreSQL e espelhado na linha 162:
  - nome `ZZ HOMOLOG SHEETS 20260824`;
  - UUID `01a0346f-34fd-7d72-b8a1-a4169c0ad0dd`;
  - uma única ocorrência na coluna CP;
  - preço normal 15,00;
  - desconto de 20%;
  - preço promocional calculado 12,00;
  - 36 validações de dados presentes.
- Foi descoberto que a linha 161 estava incompleta. O código antigo copiava suas fórmulas e deixou AO/AP/AY vazias na linha 162.
- A correção atual usa a linha 12 como modelo validado, repara fórmulas ausentes em retries e ajusta AP para consultar `$BB$<linha>:$BH$<linha>` do próprio produto.
- Na cópia de homologação, a faixa auxiliar `AH11:AI17` da aba `(TNP/LI/HORA - EXP.) DATAS/NUMEROS - VLD SAIDA` estava vazia. Ela foi preenchida somente na HOMOLOGAÇÃO com 1..7 e DOM..SAB, após validação contra o arquivo XLSX local.
- Resultados já obtidos depois da correção:
  - API unitária: 89/89;
  - integração com PostgreSQL/Testcontainers: 17/17;
  - typecheck da API: limpo;
  - `git diff --check`: limpo.
- A API temporária foi encerrada. O container local `pralis_pg` permaneceu saudável.
- Nenhum push, merge ou deploy desta correção final foi feito.
- A planilha oficial não foi alterada nesta homologação.

## Changes esperados

Há quatro arquivos de código modificados e ainda sem commit:

- `stack/api/src/modules/google-sheets/product-sheet.service.ts`;
- `stack/api/src/modules/google-sheets/fake-sheets.gateway.ts`;
- `stack/api/src/modules/google-sheets/product-sheet.service.test.ts`;
- `stack/api/src/modules/google-sheets/product-sheet.integration.test.ts`.

Também existem as alterações documentais criadas para esta retomada:

- `docs/prompts/README.md` modificado;
- `docs/prompts/proximos-passos-sheets-producao.md` novo.

Preserve esses dois arquivos, mas não os misture no commit de correção da API. Ao final, proponha um commit documental separado junto com qualquer atualização de `docs/homologacao-google-sheets.md`.

Se o estado real divergir, pare e explique antes de fazer staging ou commit.

## Regras obrigatórias de segurança

1. Preserve todas as mudanças existentes. Não use `git reset --hard`, `git clean`, checkout destrutivo, stash ou comandos que descartem trabalho.
2. Nunca mostre valores de `.env`, chave privada, JSON da service account, cookies, tokens ou segredos da hospedagem.
3. Não adicione `.env`, JSON de credencial, Downloads, logs, dumps, artefatos de build ou dados temporários ao Git.
4. PostgreSQL é a fonte de verdade. Sheets continua sendo um destino independente.
5. Não altere a planilha oficial durante o preflight. Toda verificação inicial nela deve ser somente leitura.
6. Não use a planilha de homologação como produção e não troque IDs por suposição.
7. Não faça push, merge, deploy, migração ou canário oficial silenciosamente. Antes do primeiro efeito externo de produção, apresente o gate e peça confirmação explícita ao usuário.
8. Se qualquer gate falhar, pare. Não contorne a falha alterando dados oficiais para fazer o teste passar.

## Fase 1 — Auditar e fechar o commit atual

1. Execute e inspecione:
   - `git status --short --branch`;
   - `git diff --stat`;
   - `git diff`;
   - `git diff --cached`;
   - `git diff --check`.
2. Confirme no diff que:
   - formato e validação continuam vindo da linha anterior;
   - fórmulas vêm da linha-modelo validada 12;
   - apenas fórmulas ausentes são reparadas;
   - retry encontra a linha por UUID em CP e não duplica;
   - AP usa os dias da própria linha;
   - uma linha-modelo incompleta causa falha segura;
   - nenhum valor/ID da linha-modelo é copiado;
   - nenhuma credencial ou ID oficial virou fallback no código.
3. Rode novamente, registrando exit code e contagens:
   - `npm test` em `stack/shared`;
   - `npm run typecheck` em `stack/api`;
   - `npm test` em `stack/api`;
   - `npm run test:integration` em `stack/api` com Docker ativo;
   - `npm run build` em `stack/pwa`;
   - `npm ls --all` na raiz;
   - `git diff --check`.
4. Faça busca por segredos somente nos arquivos que serão commitados. Não imprima valores encontrados; informe apenas arquivo/tipo e retire qualquer segredo do staging.
5. Se tudo passar, faça staging exclusivamente dos quatro arquivos esperados e confira `git diff --cached`.
6. Crie um único commit com a mensagem:
   `fix(sheets): repara formulas usando modelo validado`
7. Não faça push ainda. Mostre o hash, os arquivos e confirme que o working tree ficou limpo ou explique qualquer alteração preservada fora do commit.

## Fase 2 — Preflight SOMENTE LEITURA da planilha oficial

Use o destino oficial já documentado no projeto. Antes de chamar o Google, confirme no `.env`/configuração qual ID seria usado, mas não revele o valor de credenciais. Se houver divergência entre documentação, ambiente e pedido do usuário, pare.

Faça apenas leituras e valide:

1. A service account autentica e possui acesso à planilha oficial.
2. O título do spreadsheet é o esperado para a CENTRAL PRODUTOS (BASE).
3. A aba exata `(BASE) CADASTRO PRODUTOS` existe.
4. Cabeçalhos E5=`NOME`, AC5=`CODIGO INT.` e CP5=`ID` estão corretos.
5. `sheetId`, `rowCount` e `columnCount` são compatíveis com o mapeamento até CP/CW.
6. A linha 12 contém todas as fórmulas obrigatórias:
   H, P, U, AD, AF, AH, AK, AO, AP, AR, AT, AV, AX, AY, BI, BJ e BR.
7. A fórmula AP atual da planilha oficial é registrada, incluindo se ainda usa `$BB$11:$BH$11`. Não altere fórmulas existentes em massa.
8. A faixa auxiliar `AH11:AI17` da aba de DATAS/NUMEROS contém exatamente a correspondência 1=DOM, 2=SEG, 3=TER, 4=QUA, 5=QUI, 6=SEX e 7=SAB.
9. As abas auxiliares referenciadas pelas fórmulas existem e as faixas necessárias não estão vazias.
10. As validações de dados da linha imediatamente anterior à primeira linha livre estão presentes. Se ela estiver incompleta, identifique uma linha segura apenas para formato/validação ou corrija o algoritmo antes de produção; não edite a planilha oficial neste preflight.
11. Confirme que o produto de homologação não foi criado na planilha oficial.

Produza uma tabela `PASSOU/FALHOU` para cada gate. Se algum falhar, declare `BLOQUEADO PARA PRODUÇÃO` e forneça a correção mínima, sem realizá-la na planilha oficial.

## Fase 3 — Preparar o rollout, sem executá-lo silenciosamente

Se as fases 1 e 2 passarem:

1. Identifique a plataforma real de produção e o fluxo atual de deploy a partir dos arquivos do repositório e da configuração já disponível. Não invente Coolify, Vercel, servidor, domínio ou comandos.
2. Liste as variáveis necessárias sem mostrar valores:
   - `GOOGLE_SHEETS_ENABLED`;
   - `GOOGLE_SHEETS_SPREADSHEET_ID`;
   - `GOOGLE_SHEETS_BASE_TAB`;
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL`;
   - `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`.
3. Confirme que o ID configurado em produção é o oficial e não o de homologação.
4. Confirme que a service account tem Editor somente no destino necessário.
5. Verifique a migration/tabela `product_sheet_sync` e o procedimento de rollback. Não rode migration em produção durante o preflight.
6. Defina o rollback operacional:
   - desligar `GOOGLE_SHEETS_ENABLED`;
   - manter o produto no PostgreSQL;
   - preservar registros `pending/failed` para retry;
   - não apagar linhas oficiais automaticamente.
7. Apresente ao usuário:
   - commit a publicar;
   - branch e destino do merge;
   - comandos/ações de push e deploy;
   - variáveis que precisam estar configuradas;
   - produto-canário proposto;
   - riscos e rollback.
8. Pare e peça a frase de confirmação: `AUTORIZO DEPLOY E CANÁRIO SHEETS EM PRODUÇÃO`.

## Fase 4 — Somente após autorização explícita

Execute esta fase apenas se o usuário fornecer a confirmação solicitada na mesma sessão e se todos os gates anteriores estiverem verdes.

1. Faça push/merge pelo fluxo existente, sem force push.
2. Faça o deploy pelo mecanismo oficial já identificado.
3. Verifique health da API e `/admin/sheets/health` antes de cadastrar.
4. Cadastre exatamente um produto-canário inequivocamente identificável, com dados reversíveis e aprovados pelo usuário.
5. Valide no PostgreSQL e na planilha oficial:
   - produto persistido;
   - status de sync;
   - uma única ocorrência do UUID em CP;
   - nome e código interno;
   - fórmulas obrigatórias;
   - AP referenciando os dias da própria linha;
   - formato e validações;
   - Q/S/AB/AU/BK/BM/BP;
   - desconto negativo em AZ;
   - AY e AP calculados corretamente;
   - dias e horários da promoção.
6. Reprocesse uma vez pelo endpoint administrativo e prove idempotência: mesma linha, mesmo CP, nenhuma duplicação.
7. Não exclua o canário nem altere linhas oficiais automaticamente. Informe sua linha/UUID e peça autorização específica caso a limpeza seja desejada.
8. Se houver falha:
   - desligue somente a feature flag Sheets, se isso fizer parte do rollback aprovado;
   - preserve banco e registros de sync;
   - não reverta cadastro nem apague linha manualmente;
   - registre erro sanitizado e evidências.

## Relatório obrigatório

Crie ou atualize `docs/homologacao-google-sheets.md` com:

- commit e branch;
- resultados dos testes;
- evidência não sensível do canário de homologação;
- correção da linha-modelo e de AP;
- estado da tabela auxiliar de dias em homologação e produção;
- preflight oficial PASSOU/FALHOU;
- ações externas realizadas;
- estado do deploy e do canário oficial;
- riscos e rollback;
- próximos passos para CREARE, sem implementar CREARE nesta execução.

Resposta final obrigatória:

- Informe o commit criado e se houve push/merge/deploy.
- Liste todos os testes com resultados reais.
- Separe claramente HOMOLOGAÇÃO e PRODUÇÃO.
- Informe qualquer escrita externa com planilha, aba, linha e UUID não sensível.
- Declare exatamente um estado:
  - `COMMIT PRONTO — AGUARDANDO AUTORIZAÇÃO DE PRODUÇÃO`;
  - `PRODUÇÃO SHEETS VALIDADA`;
  - `BLOQUEADO PARA PRODUÇÃO`.
- Não declare produção validada apenas por testes locais ou pelo canário de homologação.
```
