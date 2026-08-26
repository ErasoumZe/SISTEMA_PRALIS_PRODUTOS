# Relatório de entrega — 25/08/2026

## Resumo executivo

O código local foi comparado com `main`/`origin/main`, revisado e validado. As alterações descritas abaixo estão no diretório de trabalho, ainda sem commit e sem publicação em produção.

O fluxo principal está compilando e a bateria automatizada está verde: 31 testes do pacote compartilhado, 134 testes unitários da API, 24 testes de integração com PostgreSQL isolado, verificação TypeScript da API e build de produção do PWA.

## Entregue e verificado

### Identidade visual Cicluz

- Logos e favicon oficiais adicionados ao PWA.
- Tema migrado para a paleta Cicluz, com roxo principal, fundo claro, tipografia Noto Sans e tokens globais.
- Login, navegação lateral, barra superior, dashboard, listagem, importação e formulário alinhados à identidade Cicluz.
- Compatibilidade responsiva preservada; login verificado em 1440, 768 e 390 px, sem rolagem horizontal.
- Foco visível, alvos de toque em telas pequenas e preferência de movimento reduzido mantidos no CSS global.

### Produtos, governança e herança entre BASE e lojas

- Alterações da BASE podem ser propagadas para cópias de loja que ainda conservam o valor herdado.
- Valores sobrescritos pela loja são preservados e identificados na interface.
- A interface permite restaurar um bloco sobrescrito para o valor da BASE.
- Campos fiscais continuam protegidos para não administradores.
- Correção adicional: quando um colaborador muda grupo ou código de barras, a classificação fiscal é recalculada pelas regras do sistema e o payload não pode injetar NCM/CEST manualmente.
- Correção adicional: edição deixou de apagar acidentalmente `codigoInterno`, `localVenda1` e `localVenda2`.
- Código interno existente passou a ser exibido como somente leitura na edição.
- Atualização vazia no repositório não produz mais SQL inválido.

### Google Sheets

- Sincronização passou a abranger criação, alteração e exclusão do catálogo BASE.
- A API informa o resultado da sincronização e a interface mostra falhas de exclusão de forma explícita.
- Exclusão usa o UUID da coluna de controle, evitando depender de número de linha salvo.
- Diagnóstico de saúde verifica acesso, aba, cabeçalhos e estrutura esperada das abas BASE/TNP/LI/HORA.
- Testes cobrem sincronização, diagnóstico, exclusão e cenários de falha.

### Exportação CREARE

- Layout posicional de 363 caracteres modelado no pacote compartilhado.
- Gerador e parser estritos implementados e cobertos por testes.
- Módulo e rotas da API preparados atrás de feature flag; permanecem desativados por segurança.
- Documentação de descoberta e integração adicionada.
- A exportação não é considerada homologada nem pronta para uso fiscal em produção.

## Melhorias feitas durante a auditoria

Além de conferir o que já existia no diretório de trabalho, a auditoria corrigiu três riscos de perda/integridade de dados:

1. preservação do código interno e dos locais de venda durante a edição;
2. recálculo fiscal seguro para colaboradores ao mudar grupo/código de barras, sem aceitar campos fiscais forjados;
3. substituição completa do visual legado da padaria pela identidade Cicluz, sem remover as regras responsivas existentes.

## Validações executadas

| Validação | Resultado |
| --- | --- |
| Testes do `@pralis/shared` | 31/31 aprovados |
| Testes unitários do `@pralis/api` | 134/134 aprovados |
| Testes de integração do `@pralis/api` | 24/24 aprovados |
| TypeScript da API | aprovado |
| Build de produção Nuxt/PWA | aprovado |
| Login em 1440/768/390 px | aprovado, sem overflow horizontal |
| `git diff --check` | aprovado |

Avisos não bloqueantes observados: colisão de auto-import `useLayout` entre Nuxt/Vuetify, chunks grandes no build e aviso de depreciação do `pg` nos testes de integração.

## O que ainda falta

### Antes de colocar CREARE em produção

- Confirmar código numérico dos grupos do CREARE.
- Confirmar a posição das alíquotas no ECF de cada loja.
- Fechar o de/para de unidades (`UN`, `KG` etc.).
- Confirmar duas ou três casas decimais para preço.
- Definir pasta e mecanismo de consumo do arquivo por loja.
- Homologar com o fornecedor/ambiente de teste e somente depois habilitar a feature flag.
- Criar o botão/fluxo de download no PWA quando a homologação estiver concluída.

### Antes do deploy geral

- Executar o diagnóstico contra as credenciais e a planilha reais do ambiente que será publicado.
- Fazer smoke test autenticado nas telas internas com a API e o banco do ambiente de homologação.
- Revisar as abas TNP/LI/HORA: o código diagnostica a estrutura, mas não transforma automaticamente abas incompatíveis.
- Decidir a política para exclusão enquanto a integração Sheets estiver desligada. Hoje a exclusão do banco é permitida; se a linha já existia na planilha, ela poderá permanecer até reconciliação manual.
- Avaliar transação/retentativa para propagação BASE → lojas. Atualmente cada cópia é atualizada separadamente; uma falha intermediária pode deixar propagação parcial.
- Tratar os avisos de build/depreciação como manutenção técnica, sem bloquear a entrega funcional.
- Revisar o conjunto de mudanças, criar commit e publicar pelos processos normais. Nenhum commit ou deploy foi feito nesta auditoria.

## Estado do source control

- Branch: `main`.
- `HEAD` local e `origin/main` estavam em `3eb8898` no início da auditoria.
- Todo o trabalho descrito está como modificado/não rastreado no working tree.
- Nenhuma alteração do usuário foi descartada e nenhum commit foi criado.
