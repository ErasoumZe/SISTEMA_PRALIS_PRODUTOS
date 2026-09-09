# Prompt mestre - resolver a auditoria completa do Pralis

> Criado em 09/09/2026 a partir do relatório `Pralis-Relatorio-Completo-2026-09-08.pdf`.
> Pode ser entregue ao Codex, Claude Code ou outro agente com acesso ao projeto.

## Prompt para copiar e executar

```text
Você está trabalhando no projeto Pralis/Cicluz e deve atuar com a abrangência de uma equipe sênior: Tech Lead, Arquitetura, Backend, Frontend, Banco de Dados, DevOps/SRE, Segurança, QA, Produto, Revisão e Release.

OBJETIVO

Resolver de ponta a ponta os achados técnicos e funcionais da auditoria de 08/09/2026, consolidar a V1 e deixar o projeto em estado publicável e homologável. Trabalhe com autonomia no código, testes, documentação, migrações e automações locais. Não pare após produzir um plano: implemente, teste, revise e documente tudo que puder ser concluído com as evidências disponíveis.

LEITURA OBRIGATÓRIA ANTES DE ALTERAR

1. Leia por completo o AGENTS.md aplicável à pasta do projeto.
2. Leia o relatório:
   C:\Users\José\Desktop\Cicluz\CADASTRO DE PRODUTOS\output\pdf\Pralis-Relatorio-Completo-2026-09-08.pdf
3. Leia CHECKLIST.md, docs/backlog.md, docs/status-integracoes.md, docs/espelho-abas-loja.md, docs/creare-fase1-runbook.md e docs/rollout-vendas.md.
4. Inspecione o estado atual do Git, GitHub, banco local, testes, planilha de produção em modo somente leitura e configuração acessível dos ambientes.
5. Trate números, checklists e conclusões da auditoria como um snapshot, não como verdade eterna. Revalide antes de decidir.

REGRAS DE EXECUÇÃO

- Preserve alterações existentes do usuário. Não use git reset --hard, checkout destrutivo, limpeza ampla ou force push.
- Nunca exponha, grave em arquivo, commit, log ou relatório senhas, tokens, cookies, chaves privadas ou conteúdo de .env.
- Não invente margens, classificações fiscais, NCM, CST, ECF, identidade de produtos conflitantes, equivalência de grupos ou regras comerciais.
- A alíquota de ECF deve ser copiada do SIA. Nunca derive por semelhança fiscal.
- Normalize caracteres invisíveis, inclusive U+2060 e demais Unicode Cf, apenas nas chaves de comparação. Preserve o texto oficial apresentado quando necessário.
- Diferencie sempre: implementado, testado, mergeado, publicado, configurado, homologado e observado em operação.
- Use branches e commits pequenos e semanticamente claros. Antes de começar, investigue o PR #25 e incorpore seu conteúdo sem duplicar ou perder trabalho.
- Todo bug corrigido precisa de teste de regressão que falhe antes da correção e passe depois.
- Mudanças de banco devem usar migrações SQL revisáveis. Não dependa de drizzle-kit push --force no boot de produção.
- Integrações externas devem ser idempotentes, retomáveis, observáveis e resistentes a falhas parciais.
- Não transforme ausência de dado em zero plausível ou sucesso silencioso.
- Não faça escrita em planilha, banco ou ambiente de produção enquanto não houver: destino confirmado, backup/restauração verificados, previsualização ou dry-run, plano de rollback e critério de aceite. Se esses requisitos dependerem do usuário, conclua todo o trabalho preparatório e registre um bloqueio preciso, sem fingir homologação.
- Não execute lote massivo na Central, backfill de vendas ou aplicação no SIA sem amostra aprovada e reconciliação posterior.

ESTRATÉGIA DE ENTREGA

Use uma branch de integração baseada na main remota atual. Reaproveite ou integre o PR #25 após revisar o diff. Organize o trabalho em fases abaixo. Cada fase deve terminar com testes, revisão do diff, um commit claro e atualização do registro de andamento. Se uma fase for bloqueada por dado ou acesso externo, avance nas demais que forem independentes.

FASE 0 - BASELINE, INVENTÁRIO E PROTEÇÃO

1. Registre no relatório de execução:
   - commit local, main remota, branch e worktree;
   - PRs abertos, checks, proteção da main e workflows;
   - versões instaladas e árvore de dependências;
   - estado dos containers locais;
   - contagens do banco local claramente rotuladas como local;
   - respostas públicas não destrutivas de health/docs;
   - estado da planilha de produção somente leitura;
   - arquivos e versão da cópia local do robô.
2. Identifique o SHA efetivamente publicado no Coolify. Se a aplicação não o expõe, implemente versão de build/commit em um endpoint de health, sem mostrar segredos.
3. Crie uma matriz ambiente x serviço x versão x banco x planilha x flags, sem registrar valores secretos.
4. Defina e implemente healthchecks separados:
   - liveness: processo responde;
   - readiness: banco acessível e configuração mínima válida;
   - diagnóstico administrativo das integrações, protegido por admin.
5. Documente backup e restauração. Faça teste de restauração em ambiente descartável antes de qualquer migração de produção.

FASE 1 - CORRIGIR FUNCIONALIDADES DO CADASTRO

F01 - Margem do grupo perdida no contrato HTTP

- Reproduza com Fastify inject: TaxRuleService entrega margemPadrao, mas GET /apoio/grupos-fiscais a remove.
- Inclua margemPadrao, nullable e numérica, no schema de resposta e nos tipos compartilhados.
- Garanta que a resposta real preserva 0, null e valores como 0.3 sem conversão ambígua.
- Acrescente testes de rota/contrato e teste de comportamento do frontend.

F02 - Margem zero, ausência e margem herdada

- Modele claramente:
  - null = sem margem pontual, usar margem válida do grupo;
  - 0 = margem pontual explicitamente zero;
  - valor > 0 = margem pontual explícita.
- Remova verificações truthy que convertem zero em null no ProductForm.
- Centralize a resolução do preço para card, formulário, detalhe, exportação e planilha.
- O card não pode passar margemGrupo fixa em zero quando a fonte tem margem.
- Defina rótulos inequívocos para markup sobre custo e margem sobre receita.
- Não reintroduza default de 70% sem decisão de negócio registrada. Trate esse ponto como decisão pendente se não houver fonte oficial.

F03 - Código de barras repetido

- Adicione busca/filtro exato por codigoBarras no contrato de listagem ou uma rota específica.
- Faça o aviso visual consultar o campo correto.
- Valide conflito na criação e atualização, incluindo concorrência.
- Normalize barcode com a mesma função usada por fiscal, vendas e SIA, sem confundir PLU e EAN.
- Prepare migração para integridade no banco, mas só aplique unicidade depois de relatório de duplicatas, decisão de normalização, limpeza homologada e backup.
- Considere unicidade parcial para valores não vazios e a regra por loja.

F04 - Falha do espelho de loja invisível

- Padronize o resultado de integração nos contratos de create, update, import, Central, propagação e delete.
- Faça o frontend mostrar synced, pending, failed, disabled e misconfigured sem transformar falha externa em falso erro de cadastro.
- Crie tela ou visão administrativa das pendências por produto, loja, destino, tentativas e último erro sanitizado.
- Implemente replay seguro e idempotente.

Outros pedidos antigos do cadastro

- Corrija montarComoSeCompra para representar embalagem, quantidade da embalagem, medida de compra e descrição segundo os exemplos validados.
- Mantenha a regra de ocultar 1 kg atrás de configuração/decisão até receber exemplos oficiais; não adivinhe.
- Remova refReceituario do formulário, contratos e banco com migração não destrutiva e plano de retenção, se o pedido ainda estiver válido após revalidação.
- Implemente tabela e autocomplete de marcas, preservando marcas existentes e evitando duplicatas por caixa/acento/espaço.
- Faça grupos, setores e locais usarem listas governadas, com migração dos textos existentes e fallback visível para legados.
- Filtre grupos por tipo quando a regra oficial permitir; grupo fiscal e grupo comercial devem ter conceitos separados se não forem equivalentes.
- Complete filtros de catálogo para tipo, grupo, local e setores primário/secundário com paginação no banco.
- Crie fluxo explícito de importar todos os novos, com dry-run, contagem, seleção e resultado de importados/pulados/falhos.
- Crie tela separada de promoção e papel/permissão de gerente somente após validar regras de autorização, datas, horários, sobreposição e integração com PDV.

FASE 2 - CENTRAL DE PRODUTOS E QUALIDADE DOS DADOS

F05 - Grupo preenchido não significa regra fiscal válida

- Separe grupo comercial, grupo do SIA e chave de regra fiscal.
- Crie catálogo canônico versionado e de-para explícito. Não una por simples nome.
- A elegibilidade automática deve exigir que cada dado obrigatório tenha origem válida para a loja destino.
- A edição posterior de produto vindo da Central não pode falhar inesperadamente por TAX_RULE_NOT_FOUND. Exiba pendência fiscal de forma controlada.

F06 - Defaults genéricos da Central

- Não grave automaticamente tipo revenda, UN, quantidade zero e qtCad 1 como se fossem dados confirmados.
- Modele status de qualificação por campo: confirmado, herdado, ausente ou precisa revisar.
- Produtos incompletos podem entrar como rascunho/inativo, sem serem tratados como prontos para SIA.
- Preserve a proveniência de cada campo.

F07 - Custo e preço por loja

- Impedir que snapshot do Compilart TNP sobrescreva silenciosamente custo/preço da Lisboa.
- Defina dados comerciais por loja e regras explícitas de herança da BASE.
- Se a decisão comercial estiver ausente, gere relatório/dry-run e bloqueie apenas a escrita ambígua.

F08 - Fiscal incompleto

- Modele CST ICMS, CST PIS/COFINS, CSOSN, NCM, redução e alíquotas com significado próprio.
- Não copie CST de um tributo para outro.
- Separe fiscal por loja; BASE não deve inventar fiscal comum.
- Crie validações por origem e lista de pendências para contabilidade.

Concorrência e lote da Central

- Torne decisão e aplicação idempotentes.
- Use transação e trava adequada para impedir duas aplicações do mesmo grupo.
- Transforme lote longo em job retomável, com progresso persistente, cancelamento e resultado individual.
- Use outbox para efeitos de planilha/loja e não espere milhares de gravações externas dentro da requisição web.
- O total de 3.952 elegíveis medido localmente não é autorização para executar nem prova de qualificação.
- Revalide e exporte, em modo somente leitura, lista da linha sem ID e dos 25 barcodes repetidos observados na planilha. Não apague nem una automaticamente.

FASE 3 - BANCO DE DADOS E CONSISTÊNCIA

F09 - Código interno concorrente

- Substitua MAX + 1 por sequence ou contador transacional.
- Preserve o mesmo código entre BASE e cópias das lojas.
- Defina unicidade compatível com essa regra e teste duas criações simultâneas.

F10 - Identidade não garantida no banco

- Avalie e implemente, após limpeza, constraints/índices para:
  - codigo do sistema;
  - uma cópia por loja/baseProductId;
  - barcode por loja quando não vazio;
  - referências de unificação e cópias.
- Gere migrações em fases: auditoria, correção de dados, validação e constraint.

F11 - Concorrência de edição

- Adicione versionamento otimista ou updatedAt/version.
- O update deve detectar snapshot antigo e devolver conflito compreensível.
- Teste duas edições concorrentes e a herança BASE-loja.

F12 - Operações parciais

- Crie outbox persistente para Sheets, espelho de lojas e demais destinos.
- Grave mudança de negócio + evento na mesma transação.
- Consumidor deve ter idempotência, retry com backoff, dead-letter e erro sanitizado.
- Crie reconciliador que compare Postgres e planilha por ID sem escrever no modo dry-run.

FASE 4 - GOOGLE SHEETS

- Revise e integre o PR #25; confirme que todas as envs lidas por env.ts chegam ao container.
- Complete os fluxos hoje ausentes:
  - edição de BASE propagada e espelhada nas cópias;
  - criação/atualização pela Central refletida em TNP/LI;
  - exclusão de produto de loja;
  - retry persistente por destino;
  - comunicação de falha ao frontend.
- Coordene gravações concorrentes com um único worker ou trava distribuída.
- Reduza escrita parcial entre RAW e USER_ENTERED ou deixe-a reconciliável.
- Crie testes com gateway simulado e homologação real controlada.
- Antes de ativar: previsualize um produto TNP e um LI, confirme ID/cabeçalhos/linha, grave uma amostra, releia e compare todas as colunas esperadas.
- HORA permanece fora até haver decisão e fonte operacional.

FASE 5 - CRIARE/SIA E AUTOMAÇÕES

- Confirme em produção: flag, config por loja, token forte, de-para carregado, casados, inválidos e colisões.
- Não exponha valores de token no diagnóstico.
- Fortaleça ROBO-SIA-AUTO.ps1:
  - ErrorActionPreference apropriado;
  - saída não zero em todo caminho de falha;
  - confirmação objetiva da empresa selecionada;
  - não pressionar Sim/OK/Enter em diálogo desconhecido;
  - validar título e conteúdo esperado do diálogo;
  - capturar evidência do resultado real do importador;
  - nunca declarar ATUALIZADO apenas porque clicou no botão.
- Mantenha downloader atômico e validação de 363 posições.
- Homologue LI com 10 itens representativos e confira no SIA: coditem, nome, grupo, ECF, NCM, custo, preço, unidade, ativo/inativo e repetição.
- Resolva duas ou três casas de custo por observação real; não deduza pelo arquivo.
- Produto com promoção deve ficar claramente bloqueado até existir intervalo de datas e contrato aprovado.
- Documente instalação e rollback nas máquinas reais. Versione a cópia correta do robô e identifique sua versão em log.
- Não ligar TNP ou HORA por analogia com LI; cada loja exige de-para e homologação.

FASE 6 - VENDAS E ROBÔ

- Transforme o código atual do robô e scripts auxiliares em versão reproduzível, sem segredos.
- Commitar, após revisão, backfill-vendas.js e utilitários necessários; deixar fora arquivos de recusados e dados sensíveis.
- No backfill, classifique erros:
  - 401/403: abortar e pedir correção de autenticação;
  - 429/5xx/rede: retry com backoff e checkpoint;
  - 4xx de validação: isolar linhas com limite, registrar sem dados sensíveis;
  - não dividir indefinidamente um erro sistêmico.
- Processar histórico em streaming/páginas e salvar checkpoint por loja/tipo/data.
- Executar --so-contar antes de enviar. Conciliar origem, enviados, inseridos, atualizados, ignorados e recusados.
- Criar heartbeat por loja e alerta para atraso, fila pendente e último sucesso.
- Confirmar que DIAS_REPROCESSAR=3 está na versão realmente instalada, não apenas na cópia local.
- Nomear claramente margem estimada com custo atual. Para histórico real, modelar custo por vigência ou snapshot sem reescrever números passados.

FASE 7 - SEGURANÇA E PERMISSÕES

- Substitua cadastro público livre por convite, domínio permitido ou aprovação administrativa conforme decisão do proprietário. Enquanto a decisão não vier, implemente a opção mais restritiva configurável e documente impacto.
- Em produção, falhar o boot se JWT_SECRET, COOKIE_SECRET, DATABASE_URL ou demais segredos obrigatórios estiverem ausentes/fracos/default.
- Usar gerador criptograficamente seguro para códigos de verificação/reset.
- Armazenar código de reset/verificação de forma segura, uso único, com expiração e contagem de tentativas.
- Adicionar rate limit por IP e por conta nas rotas de login, registro, resend, forgot, verify e reset.
- Uniformizar resposta e tempo onde necessário para reduzir enumeração.
- Invalidar sessões existentes após troca/reset de senha e enviar notificação sem incluir senha.
- Definir política de sessão, rotação e encerramento global.
- Manter CORS com lista explícita; recusar curingas inseguros em produção com credentials.
- Respostas 500 não devem expor mensagens internas. Logs devem ser estruturados e sanitizados.
- Restringir Swagger em produção ou exigir admin se não for necessário ao público.
- Validar conteúdo real e processamento seguro de imagens, não só MIME informado.
- Revisar autorização de todas as rotas por papel e loja, com matriz e testes negativos.
- Preparar HTTPS e restrição de acesso administrativo ao Coolify/Cloudflare; não alterar controles críticos sem plano de acesso emergencial.

FASE 8 - DEPENDÊNCIAS, IMAGENS E DEVOPS

- Tratar os achados atuais do npm audit com análise de alcance:
  - Pralis runtime: fast-uri alto e alertas moderados;
  - árvore completa: xlsx alto e demais transitivos;
  - robô: js-yaml alto, mysql2 e qs moderados.
- Não usar npm audit fix --force automaticamente.
- Atualize correções compatíveis primeiro; versões maiores em PR isolado com testes.
- Para SheetJS/xlsx, escolher versão/distribuição mantida, restringir arquivos de entrada e homologar exportacaoSIA.xls.
- Separar build/admin tools do runtime da API. Produção deve instalar apenas o necessário.
- Usar usuário não root e imagens fixadas/reproduzíveis; adicionar scan de imagem e SBOM.
- Retirar drizzle-kit push --force do start:prod.
- Implementar comando/estágio explícito de migração com lock, backup, log e rollback documentado.
- Adicionar .github/workflows para:
  - testes unitários;
  - testes de integração com PostgreSQL;
  - typecheck;
  - build do frontend;
  - auditoria/scan com política definida;
  - validação do Compose e migrations.
- Propor e, se houver permissão, configurar proteção da main: PR obrigatório, pelo menos uma revisão e checks verdes.
- Publicar por SHA imutável e expor essa versão no health.
- Criar ambiente de homologação separado, com banco e planilha que não apontem para produção.
- Configurar observabilidade: logs, métricas, erros, disponibilidade, filas e alertas. Não registrar dados ou segredos desnecessários.

FASE 9 - FRONTEND, DESEMPENHO E MANUTENIBILIDADE

- Eliminar o aviso de colisão useLayout entre Nuxt e Vuetify.
- Adicionar verificação de tipos dos componentes/templates Vue no pipeline.
- Implementar testes E2E dos fluxos críticos com ambiente isolado.
- Paginar e filtrar produtos no banco; não carregar catálogo inteiro e relações para paginação apenas visual.
- Decompor ProductForm.vue e product-sheet.service.ts em unidades menores sem alterar comportamento sem teste.
- Unificar schemas de resposta para impedir que campos adicionados no serviço desapareçam no HTTP.
- Padronizar estados de loading, erro, sucesso parcial e retry.
- Verificar acessibilidade, responsividade, scanner de barcode e mensagens de decisão fiscal/comercial.

FASE 10 - DOCUMENTAÇÃO, BACKLOG E RELEASE

- Substitua documentos contraditórios por uma fonte única de andamento.
- Atualize CHECKLIST.md e backlog com data, origem dos números e estes estados:
  não iniciado, implementado, testado, mergeado, publicado, homologado, bloqueado.
- Crie issues para toda pendência restante, com prioridade, responsável, dependência, risco e critério de aceite.
- Marque como superseded documentos históricos, preservando evidência.
- Documente matriz de fontes da verdade por campo e loja.
- Crie runbooks de deploy, migration, rollback, backup/restore, Sheets, Criare e vendas.
- Produza changelog e relatório final comparando cada achado F01-F12 e cada item do backlog com evidência de solução.

DECISÕES EXTERNAS QUE NÃO PODEM SER INVENTADAS

Ao chegar a uma delas, produza uma proposta com opções, impacto e recomendação; continue o restante e consolide as perguntas para o usuário:

1. Margens oficiais dos 73 grupos vazios e confirmação sobre o antigo default de 70%.
2. Catálogo canônico e de-para entre grupos comerciais, fiscais e SIA.
3. Fiscal faltante da TNP e significado exato de cada CST/alíquota.
4. Identidade real dos barcodes conflitantes/repetidos.
5. Regra de custo e preço por loja e herança da BASE.
6. Regra exata de descrição para 1 kg e exemplos de “como se compra”.
7. Listas oficiais de marcas, setores e locais.
8. Papel gerente, aprovação e contrato completo de promoções.
9. Entrada de usuários por convite, domínio ou aprovação.
10. Entrada operacional da loja HORA.

VALIDAÇÃO OBRIGATÓRIA

Ao final de cada fase relevante e novamente antes do release, execute:

- npm test
- npm run test:integration
- npm run typecheck
- npm run build
- testes do robô: npm run check e npm run teste
- testes novos de contrato e concorrência
- auditoria de dependências e scan de imagem
- validação das migrações em banco vazio e cópia restaurada
- smoke tests autenticados em homologação
- reconciliação read-only PostgreSQL x Sheets x SIA para a amostra

Não reduza a suíte para obter verde. Corrija flakiness e warnings relevantes. Registre comandos, versão, duração e resultado. Não declare E2E se usou mocks de Google ou SIA.

CRITÉRIOS DE ACEITE DA V1

- Margem de grupo chega à interface; null e zero têm significados distintos; card e detalhe calculam igual.
- Barcode repetido é detectado no campo correto e protegido contra corrida conforme a política aprovada.
- Cadastro BASE e cópias por loja mantêm identidade e código interno sem colisão.
- Central não transforma dado ausente em dado confirmado e não mistura preço/fiscal entre lojas.
- Todos os efeitos de integração têm pendência persistente, retry e reconciliação.
- Planilha BASE, TNP e LI são atualizadas corretamente nos fluxos aprovados e erros ficam visíveis.
- Criare LI passa pela amostra real e tem evidência do SIA; promoção continua bloqueada se o contrato faltar.
- Vendas têm heartbeat, backfill conciliado e robô versionado na máquina real.
- Autenticação não permite entrada organizacional irrestrita; reset e sessões seguem controles de segurança.
- Produção usa migrações explícitas, CI verde, release por SHA, backup restaurável e rollback documentado.
- Documentação e issues refletem o estado real, sem chamar código mergeado de homologado.

FORMATO DA ENTREGA FINAL

Entregue um relatório em português com:

1. Resumo executivo.
2. Tabela de todos os achados F01-F12: antes, correção, testes, commit, PR, deploy e homologação.
3. Tabela completa do backlog: concluído, parcial, bloqueado ou removido por decisão.
4. Commits e PRs criados/atualizados.
5. Migrações e plano de rollback.
6. Resultado de todos os testes e scans.
7. Versões/SHAs por ambiente.
8. Evidências de homologação por integração e loja.
9. Pendências externas consolidadas, cada uma com uma única pergunta objetiva ao usuário.
10. Próxima ação recomendada.

CONDIÇÃO DE PARADA

Não pare só porque encontrou uma dificuldade. Investigue alternativas seguras, conclua tudo que for independente e mantenha o trabalho organizado. Pare uma frente apenas quando depender de decisão comercial/fiscal, credencial/acesso indisponível, intervenção na máquina real ou ação de produção sem os gates de segurança. Nesse caso, registre exatamente:

- o que está bloqueado;
- qual evidência falta;
- onde ela é obtida;
- comando/tela/procedimento exato;
- risco de prosseguir sem ela;
- todo trabalho preparatório já concluído.

Não declare “tudo resolvido” enquanto existir achado sem correção ou sem uma decisão explícita de escopo.
```

## Observação de uso

O prompt foi escrito para conduzir uma execução extensa sem transformar decisões fiscais e comerciais em suposições. Ele autoriza o agente a corrigir o projeto e preparar a operação, mas mantém gates claros antes de escritas em produção, lotes da Central, backfill e aplicação no SIA.
