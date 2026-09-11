# Prompt para concluir o fiscal após o PR #38

> Criado em 11/09/2026 após o merge do PR #38 no `main` (`14455ca`).
> Destinado ao Claude Code com acesso ao repositório, GitHub, testes e ambientes do Pralis.

## Prompt para copiar e executar

```text
Você está trabalhando no projeto Pralis/Cicluz. Atue como Tech Lead, desenvolvedor backend/frontend sênior, engenheiro de banco, integrações, QA e responsável por release.

OBJETIVO

Concluir de ponta a ponta o preenchimento fiscal dos produtos vindos da Central/BASE, importados pelas lojas TNP e LI e refletidos na planilha Google Sheets e na integração Creare/SIA via TXT e importador automático.

O PR #38 já foi mergeado no `main` pelo merge commit `14455ca7167b7ad2e671eae28dc811607969df9f`. Ele acrescentou uma tentativa de completar a carga fiscal quando um produto sem carga é salvo, mas ainda há lacunas funcionais e de dados. Não declare o trabalho concluído apenas porque o PR #38 está mergeado ou porque os testes antigos passam.

RESULTADO ESPERADO

Ao final, um produto deve ter comportamento determinístico e auditável:

1. A BASE/Central define ou recebe um grupo fiscal válido.
2. A classificação fiscal procura fontes oficiais por chaves exatas e registra a origem de cada valor.
3. A importação para TNP ou LI não perde o fiscal e não mistura informação entre lojas.
4. Ao terminar e salvar o cadastro na loja, os dados fiscais disponíveis são persistidos e sincronizados na linha correta.
5. Campo sem fonte oficial não vira zero, valor inventado ou falso sucesso: vira pendência fiscal visível, com motivo.
6. O TXT do Creare/SIA usa o de-para da loja correta e nunca deriva o código ECF por semelhança.
7. Produtos antigos podem ser corrigidos por backfill idempotente, com dry-run, amostra, retomada, reconciliação e rollback.

LEITURA E BASELINE OBRIGATÓRIOS

Antes de alterar qualquer arquivo:

1. Leia por completo o `AGENTS.md` aplicável.
2. Execute `git fetch origin --prune` e confirme que o trabalho parte do `origin/main` contendo `14455ca` ou de um commit posterior que já contenha o PR #38.
3. Não continue empilhando commits na branch já mergeada `auditoria/v1-2026-09-09`. Crie uma branch nova baseada no `origin/main`, por exemplo:
   `fix/fiscal-completo-pos-pr38-2026-09-11`.
4. Verifique e preserve o worktree do usuário. Não use `git reset --hard`, force push, checkout destrutivo ou limpeza ampla.
5. Leia integralmente, no mínimo:
   - `stack/api/src/modules/product/product.service.ts`;
   - `stack/api/src/modules/product/product.repository.ts` e tabelas/schema fiscal;
   - `stack/api/src/modules/apoio/tax-rule.service.ts`;
   - `stack/api/src/modules/google-sheets/product-sheet.service.ts`;
   - `stack/api/src/modules/google-sheets/product-sheet-loja.service.ts`;
   - `stack/api/src/modules/google-sheets/product-sheet.mapper.ts`;
   - `stack/api/src/modules/google-sheets/leiaute-planilha-nova.ts`;
   - fluxos de criação, Central/unificação, `importFromBase`, atualização e propagação BASE-loja;
   - módulo `stack/api/src/modules/creare/`, gerador TXT, importação do de-para e health;
   - `docs/creare-aliquota-ecf.md`, `docs/creare-fase1-runbook.md`, `docs/integracao-creare.md`, `docs/status-integracoes.md` e documentação do robô/importador automático.
6. Inspecione o histórico e o diff completo dos commits `03e442f`, `96154d9` e do merge `14455ca`.
7. Rode os testes atuais antes de mudar e registre o baseline.
8. Consulte a planilha oficial apenas em modo leitura durante a investigação. Não edite nem faça backfill em produção nesta fase.

EVIDÊNCIAS JÁ OBSERVADAS — REVALIDE, NÃO PRESUMA

Planilha oficial:
`https://docs.google.com/spreadsheets/d/1iQGitC8CMl8OGgW05buMcfqr9xer0d9CexnT6U6Dwvw/edit?gid=948520965#gid=948520965`

Na aba `(TNP/LI) CADASTRO PRODUTOS`, a faixa fiscal começa em `DC`. No recorte das linhas 1198 e 1201–1212, quase tudo continua vazio.

Casos importantes:

- `BOLO REDONDO LARANJA`, linha 1211:
  - destino contém somente CST `1` e NCM `19059090`;
  - a aba `(TNP) FISCAL - CADASTRO ECF`, linha 2660, contém código `012658`, redução `5333` = 53,33%, alíquota cheia `18000` = 18%, FCP zero, PIS zero, COFINS zero, ECF `18,00%`, ECF ID `03`, NCM `19059090` e categoria `PRODUTOS DA CASA (ALIQUOTA EFETIVA)`;
  - ICMS, CEST e `% NCM` estão sem valor nessa linha-fonte e não podem ser inventados.

- `BEBIDA LACTEA PIRAKIDS 200ML`, linha 1204:
  - possui correspondência exata na fonte ECF, código `011962`, ECF `SUBST TRIB`, ID `10`, NCM `22029900`, categoria fiscal e CEST `1711500`;
  - o cadastro atual está no grupo `MER BEBIDAS - ÁGUAS`, gerando CST de grupo `4`, enquanto a linha ECF contém CST `99`. Isso é conflito de fonte/regra e deve ficar explícito; não escolha silenciosamente um dos dois.

- Existem correspondências exatas por nome no ECF para Sorvete, Trento, Agrião e várias Águas Crystal, mas os grupos atualmente gravados não existem entre as 76 regras fiscais oficiais:
  - `SORVETES`;
  - `BOMBONIERI`;
  - `MAT. PRIMA (FARINHA)`;
  - `SUCO, ISOT E AGUA`;
  - `GERAL`.

- A tabela oficial possui grupos mais específicos, como `MER BOMBONIERI - CHOCOLATES`, `MER SORVETES - POTES`, `MER SORVETES - PICOLÉS`, `MER BEBIDAS - ÁGUAS` e `MER MAT. PRIMA - FARINHAS`. Não faça equivalência por semelhança textual: alguns grupos legados são ambíguos e exigem de-para aprovado.

- Não há correspondência exata por nome para `teste ze`, `LINGUICA CALABRESA DEF. 2,5 KG` e os dois nomes `AGUA CRYSTAL ... DELIVERY`. Eles devem ficar pendentes ou usar de-para/alias explícito e aprovado; nunca fuzzy matching fiscal.

- O código atual lê o cadastro ECF de uma constante hardcoded:
  `ABA_ECF = '(TNP) FISCAL - CADASTRO ECF'`.
  Isso não prova que os mesmos valores sejam válidos para LI.

- `RegistroEcf` atualmente não modela NCM, CST e `% NCM` da aba-fonte. O mapper grava NCM, CST e demais campos do objeto `product.fiscal`, mas não existe mapeamento de `% NCM`.

- A planilha possui dois cabeçalhos `REDUCAO_ICMS` na faixa fiscal. O resolvedor por cabeçalho tende a escolher apenas um. Determine a função real de cada coluna antes de escrever.

- No PR #38, `semCargaFiscal()` dispara somente no update e a chamada possui `.catch(() => null)`. Um grupo inexistente ou falha de fonte pode resultar em cadastro salvo com fiscal vazio e sem motivo visível.

- Na criação comum, classificação por grupo/EAN não recebe o nome. Verifique também a criação pela Central/unificação, que pode não passar por `classify()`.

REGRAS INEGOCIÁVEIS

- Não invente NCM, CST, CSOSN, CEST, redução, alíquotas, categoria, ECF, grupo ou equivalência de produto.
- Não derive `ALIQUOTA ECF` ou `ALIQUOTA ECF ID` a partir de CST, NCM, grupo ou alíquota. O próprio estudo do projeto mostrou que essa derivação alteraria incorretamente muitos produtos. ECF deve vir de registro exato do SIA/Creare da loja correspondente.
- Não copie automaticamente a fonte TNP para LI sem comprovar equivalência por dado oficial.
- Não copie CST de um tributo para outro.
- Preserve zeros reais como zeros. Ausência deve continuar `null`/pendente, não zero plausível.
- Preserve zeros à esquerda de NCM, CEST, código interno, código ECF e EAN.
- Nome normalizado pode remover caixa, acento, espaços excedentes e Unicode `Cf`, mas isso serve apenas para igualdade exata normalizada. Não use distância, contains, startsWith ou aproximação fiscal.
- Nome duplicado/ambíguo na fonte nunca pode escolher uma linha por sorteio.
- Falha do Google não deve desfazer o cadastro no Postgres, mas deve gerar integração pendente/failed observável.
- Nenhuma escrita massiva em produção sem dry-run, backup validado, amostra aprovada, plano de rollback e reconciliação posterior.
- Nunca exponha ou grave tokens, cookies, senhas, chaves privadas ou conteúdo de `.env`.

TRABALHO A IMPLEMENTAR

FASE 1 — REPRODUÇÃO E MATRIZ DE FONTE DA VERDADE

1. Escreva testes de regressão que falhem no estado pós-PR #38 para cada lacuna abaixo.
2. Produza uma matriz por campo e por loja com:
   - campo;
   - fonte primária;
   - fonte secundária permitida;
   - chave de casamento;
   - escopo BASE/TNP/LI;
   - regra de precedência;
   - comportamento em conflito;
   - comportamento quando ausente.
3. Diferencie explicitamente:
   - grupo comercial legado;
   - grupo fiscal canônico;
   - grupo/código do SIA por loja;
   - fiscal canônico compartilhável;
   - fiscal específico da loja/PDV.
4. Se alguma precedência depender de decisão contábil, não bloqueie todo o desenvolvimento: modele o conflito como pendência e entregue relatório/dry-run, mas não aplique valor arbitrário.

FASE 2 — CLASSIFICAÇÃO COMPLETA E OBSERVÁVEL

1. Refatore a classificação para receber uma entrada explícita com, no mínimo:
   `nome`, `codigoBarras`, `codigoInterno`, `grupo`, `loja` e fiscal anterior.
2. Faça criação manual, criação/atualização pela Central, importação da BASE, troca de grupo/EAN e salvamento de cadastro incompleto usarem o mesmo motor, respeitando o escopo de cada operação.
3. O nome deve ser passado quando disponível. Não obrigue o usuário a salvar duas vezes para obter o ECF.
4. Não faça `classify()` depender de grupo válido para sequer consultar uma correspondência exata de ECF. A busca pode retornar evidências parciais, mas o produto só será considerado fiscalmente pronto quando todas as validações obrigatórias passarem.
5. Substitua o `.catch(() => null)` silencioso por resultado tipado, por exemplo:
   - `complete`;
   - `partial`;
   - `pending_invalid_group`;
   - `pending_no_exact_product_match`;
   - `pending_ambiguous_match`;
   - `pending_source_conflict`;
   - `source_unavailable`.
6. Persista status, motivos e proveniência suficientes para a tela, health, backfill e reconciliação. Use migration revisável se o banco precisar de novos campos/tabelas.
7. Diferencie falha temporária da fonte de ausência real de correspondência.
8. Não sobrescreva carga fiscal manual/aprovada sem política explícita, versionamento e auditoria.

FASE 3 — GRUPOS LEGADOS E QUALIFICAÇÃO NA BASE

1. Crie um de-para explícito e versionável entre grupo legado e grupo fiscal canônico.
2. Não preencha automaticamente equivalências ambíguas. Gere uma lista para decisão administrativa.
3. A BASE/Central deve impedir que um produto seja marcado como fiscalmente pronto quando o grupo não possui regra.
4. A loja continua sem poder escolher arbitrariamente o grupo da BASE, mas deve enxergar claramente:
   - grupo inválido;
   - fiscal pendente;
   - quem precisa corrigir;
   - motivo técnico em linguagem humana.
5. Permita editar e salvar os demais campos sem mascarar a pendência fiscal.
6. Corrija a Central/unificação para não gravar grupos genéricos como se fossem regras válidas.

FASE 4 — CAMPOS FISCAIS E PLANILHA

1. Audite todas as colunas A:Q da aba ECF e o schema `product_fiscal`.
2. Modele e transporte somente campos com significado confirmado. Investigue especificamente:
   - NCM da fonte ECF como possível fallback quando não houver de-para por EAN/PLU;
   - CST da fonte ECF versus CST PIS/COFINS calculado pelo grupo;
   - `% NCM`;
   - ICMS;
   - CEST;
   - redução, alíquota cheia, FCP, PIS, COFINS, ECF e ECF ID.
3. Em conflito, não use uma precedência silenciosa. Registre ambas as fontes e marque pendência até a regra ser aprovada.
4. Descubra por metadados/cabeçalhos a função das duas colunas `REDUCAO_ICMS`. Corrija o layout ou o mapeamento apenas com evidência. Não escreva o mesmo valor nas duas por conveniência.
5. Garanta que a tradução por cabeçalho escreve a coluna fiscal correta e nunca sobrescreve fórmulas.
6. Defina quem é dono da faixa fiscal compartilhada da aba `(TNP/LI) CADASTRO PRODUTOS`:
   - se for fiscal canônico da BASE, produto de loja não pode sobrescrevê-la;
   - se houver fiscal diferente por loja, crie representação separada ou outro destino explícito.
7. Mantenha as abas `(TNP) CADASTRO PRODUTOS` e `(LI) CADASTRO PRODUTOS` alinhadas na mesma linha, sem misturar os valores das faixas comerciais ou fiscais.

FASE 5 — TNP, LI, CREARE/SIA E TXT

1. Audite o de-para do SIA separadamente para TNP e LI.
2. Confirme no código e nos testes que o TXT de cada loja usa:
   - coditem da própria loja;
   - código ECF da própria loja;
   - grupo da própria loja;
   - NCM e demais campos conforme fonte aprovada;
   - custo/preço da própria loja.
3. A exportação deve recusar ou omitir com motivo produtos sem par exato, com colisão, com divergência de código interno ou fiscal obrigatório pendente.
4. O health administrativo deve informar contagens por loja, sem expor dados sensíveis:
   - completos;
   - parciais;
   - sem de-para;
   - grupo inválido;
   - conflito fiscal;
   - colisões;
   - elegíveis para TXT.
5. Revise o downloader e o importador automático:
   - download atômico;
   - validação das 363 posições;
   - código de saída não zero em falha;
   - arquivo anterior preservado quando o download falha;
   - confirmação objetiva de empresa/loja selecionada;
   - nenhuma confirmação automática de diálogo desconhecido;
   - log com versão/SHA, horário, loja, contagens e resultado, sem segredos;
   - prova de que o SIA terminou a importação, não apenas de que o botão foi clicado.
6. Não ative TNP/HORA por analogia com LI. Cada loja exige configuração, de-para, amostra e homologação próprios.

FASE 6 — BACKFILL FISCAL SEGURO

Implemente um comando ou job administrativo idempotente e retomável. Requisitos mínimos:

1. Modos:
   - padrão `--dry-run`;
   - `--product-id`;
   - `--loja BASE|TNP|LI`;
   - `--limit`;
   - `--cursor` ou checkpoint;
   - `--apply` explícito;
   - exportação de relatório sem dados sensíveis.
2. Classifique cada produto como:
   - seria atualizado;
   - já completo;
   - grupo inválido;
   - sem casamento;
   - casamento ambíguo;
   - conflito de fontes;
   - fonte indisponível;
   - falha de sincronização.
3. No `--apply`, use transações em lotes pequenos, preserve valores aprovados e registre antes/depois ou mecanismo equivalente de rollback.
4. Enfileire sincronização da planilha usando o mecanismo persistente existente; não faça milhares de chamadas Google dentro de uma requisição web.
5. Reexecutar o mesmo lote não pode duplicar, degradar ou reclassificar produtos já aprovados.
6. Forneça comando de reconciliação read-only Postgres x Google Sheets x fonte fiscal.
7. Não execute `--apply` em produção durante esta tarefa sem autorização explícita do José após apresentação do dry-run e da amostra.

FASE 7 — FRONTEND E EXPERIÊNCIA OPERACIONAL

1. Mostre no formulário/cartão administrativo o estado fiscal e seus motivos.
2. Diferencie claramente:
   - cadastro salvo;
   - fiscal completo;
   - fiscal pendente;
   - planilha sincronizada;
   - sincronização pendente/falhou;
   - elegível para Creare/TXT.
3. A mensagem de sucesso não pode sugerir “cadastro concluído” quando o fiscal ficou pendente.
4. Para a loja, informe que grupo inválido precisa ser corrigido na BASE, pois o campo é somente leitura.
5. Adicione uma visão/filtro administrativo de pendências fiscais e ação segura de reprocessar um produto.

TESTES OBRIGATÓRIOS

Crie testes que falhem antes da correção e cubram no mínimo:

1. Criação já passa nome e completa ECF quando existe casamento exato.
2. Produto da Central/importado não precisa ser salvo duas vezes.
3. `BOLO REDONDO LARANJA` recebe redução 53,33, alíquota cheia 18, ECF `18,00%`, ID `03` e categoria, preservando como ausentes os campos sem fonte.
4. NCM e códigos com zero à esquerda permanecem texto correto.
5. Zero fiscal real é persistido e enviado à planilha como zero, não vazio.
6. Grupo inválido gera pendência visível; não vira sucesso fiscal silencioso.
7. Nome ausente e nome duplicado/ambíguo não classificam por aproximação.
8. Conflito CST do grupo versus CST da fonte é detectado e não sobrescrito silenciosamente.
9. Produto TNP nunca usa de-para LI e produto LI nunca usa de-para TNP.
10. Importação da BASE preserva identidade, fiscal canônico e dados comerciais por loja.
11. Produto de loja não sobrescreve indevidamente a faixa fiscal compartilhada da BASE.
12. Mapper escreve todos os campos suportados nas colunas corretas da planilha nova e preserva fórmulas.
13. Cabeçalho fiscal duplicado é tratado segundo a decisão documentada.
14. Backfill dry-run não escreve; apply é idempotente; retomada não repete itens.
15. TXT tem exatamente 363 posições e usa ECF/de-para da loja correta.
16. Importador automático retorna falha real quando download, validação, seleção da empresa ou importação falham.

Execute ao final, conforme os scripts reais do repositório:

- typecheck de todos os workspaces;
- testes unitários completos;
- testes de integração com PostgreSQL;
- build do frontend/PWA;
- testes do gerador Creare/TXT;
- testes do robô/importador;
- validação das migrations em banco vazio e banco atualizado;
- lint/checks existentes;
- revisão de `git diff --check` e do diff completo.

Não reduza a suíte para conseguir verde. Registre comandos, totais, duração e resultado.

HOMOLOGAÇÃO CONTROLADA

Prepare um runbook e uma amostra, mas não faça escrita massiva sem autorização.

Ordem recomendada:

1. Dry-run geral e relatório agregado por motivo.
2. Dry-run específico do `BOLO REDONDO LARANJA`.
3. Backup verificável do registro e das células que seriam alteradas.
4. Aplicação canário em um único produto autorizado.
5. Releitura do Postgres e das células da linha 1211.
6. Conferência de que TNP e LI não foram misturadas.
7. Geração de TXT limitado à amostra da loja autorizada.
8. Validação estrutural de 363 posições.
9. Importação manual assistida no SIA correto, somente com autorização.
10. Evidência do resultado dentro do SIA e plano de rollback.

Para o Bolo, a expectativa baseada na fonte atual é preencher somente o que existe e foi validado. `% NCM`, ICMS, CEST ou qualquer outro campo ausente não devem ser inventados nem usados para forçar a linha inteira a deixar de aparecer vermelha.

ENTREGA, GIT E DOCUMENTAÇÃO

1. Faça commits pequenos, claros e separados por responsabilidade.
2. Abra um novo PR para `main`; não reutilize o PR #38 nem a branch mergeada.
3. Só peça merge com checks verdes e revisão final do diff.
4. Atualize/crie documentação com:
   - matriz de fontes por campo e loja;
   - estados fiscais e motivos;
   - comandos de dry-run/apply/rollback;
   - runbook da planilha;
   - runbook Creare/TXT/importador automático;
   - limitações e decisões contábeis pendentes.
5. Produza relatório final em português contendo:
   - causa raiz de cada falha;
   - antes/depois;
   - arquivos e migrations alterados;
   - testes e resultados;
   - commits e PR;
   - o que está implementado, testado, mergeado, publicado e homologado;
   - resultado do dry-run;
   - pendências que dependem de decisão fiscal, cada uma com uma pergunta objetiva.

CRITÉRIOS DE ACEITE

O trabalho só pode ser chamado de completo quando:

- nenhum fluxo autorizado exige “salvar duas vezes” para buscar fiscal;
- produto com grupo inválido não aparece como fiscalmente concluído;
- ausência, ambiguidade e conflito têm estados e motivos visíveis;
- valores fiscais têm origem auditável e escopo correto por loja;
- TNP e LI não compartilham código ECF/de-para sem comprovação;
- BASE, cópias de loja, planilha e Postgres mantêm identidade consistente;
- campos suportados chegam à coluna correta sem sobrescrever fórmulas;
- campos sem fonte permanecem pendentes, não inventados;
- backfill possui dry-run, idempotência, checkpoint, rollback e reconciliação;
- TXT e importador automático têm testes e evidência real da loja homologada;
- testes completos e CI estão verdes;
- documentação distingue implementado, testado, mergeado, publicado e homologado.

CONDIÇÃO DE PARADA

Não pare depois de escrever um plano. Implemente, teste, revise, documente e abra o PR com tudo que independe de decisão externa.

Quando houver decisão fiscal/contábil indispensável, não invente. Entregue o código preparado para representar a pendência e registre:

- produto/campo afetado;
- fontes conflitantes ou ausentes;
- risco de cada opção;
- recomendação técnica;
- uma pergunta objetiva para o José/contador;
- como aplicar a decisão posteriormente sem refazer a arquitetura.

Não execute mutação massiva em produção nem importação real no SIA sem os gates definidos acima.
```

## Resultado esperado do uso

Esse prompt orienta o Claude Code a corrigir o restante da cadeia fiscal sem transformar células vermelhas em valores fiscais inventados. Ele inclui cadastro, Central, BASE, lojas, Google Sheets, de-para por loja, TXT do Creare, robô automático, backfill e homologação.
