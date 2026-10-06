# TXT incremental TNP: entrega no PC separada da importacao no SIA

O modo `GET /creare/produtos.txt?loja=TNP&modo=pendentes` compara cada registro
posicional com a ultima versao **salva e verificada pelo robo no PC**, nao com
a ultima versao importada no SIA. O download pode ser repetido sem duplicar o
arquivo local. Depois de salvar o TXT e conferir SHA-256, ASCII, quantidade de
linhas e 363 posicoes, `SINCRONIZAR-TXT-TNP.ps1` chama
`POST /creare/lotes/{id}/entrega?loja=TNP` com o SHA-256 do lote. Essa entrega
libera o proximo TXT; **nao confirma importacao no SIA**.

Exemplo: 11 produtos ja entregues em arquivos anteriores e 98 novos produtos
aptos geram um TXT com 98 linhas, nao 109. O numero real depende do conteudo
dos registros e de edicoes posteriores: um dos 11 tambem pode reaparecer se
for alterado. `totalProdutos` no health e o tamanho do catalogo, nao a contagem
incremental.

O arquivo completo, sem `modo=pendentes`, continua sendo a fotografia do
catalogo. Nao use esse link para conferir o incremental.

## Implantacao segura

1. Fazer backup das tabelas `creare_export_batch` e `creare_export_state`.
2. O startup da API executa `drizzle-kit push` e depois
   `ensure-creare-delivery-index.ts`. O segundo passo e necessario: em
   producao o push cria a tabela e coluna, mas pode conservar o indice parcial
   antigo. O reparo idempotente preenche o cursor a partir dos confirmados e
   troca o indice antes de iniciar o servidor. Confira no log
   `Indice de entrega Criare corrigido.` ou `... ja correto.`. O lote antigo
   ainda aberto continua aberto; nao e marcado como importado.
3. Publicar a API e so depois copiar a nova versao de
   `automacao/robo-sia/SINCRONIZAR-TXT-TNP.ps1` para a pasta
   `C:\importação-sia` no PC da padaria. A tarefa agendada usa o mesmo caminho.
4. Rodar o script uma vez manualmente. Se o lote antigo de 7 linhas ja estiver
   salvo e o hash corresponder ao marcador local, ele registra apenas a entrega
   sem gravar outro TXT. Ainda nessa execucao, o robo gera apenas os registros
   novos ou alterados. Conferir quantidade, codigos e dados antes de importar.

Em caso de rollback da API, desabilite antes a tarefa agendada. A versao antiga
da API considera todos os lotes ainda nao confirmados no SIA como abertos; ela
nao entende a nova coluna de entrega e pode travar ao tentar criar lotes.
Preserve os TXTs e as tabelas; prefira corrigir a API nova sem reverter o
esquema de producao.

Se a chamada de entrega falhar, o TXT salvo permanece no PC. Na proxima
execucao, o robo reconhece o mesmo ID/hash e tenta a entrega novamente, sem
duplicar o arquivo. A API nao consegue comprovar que o SIA realmente aplicou
cada linha: o operador deve conservar os TXTs e conferir o log de importacao.
**Importe todos os TXTs na ordem em que foram criados.** O arquivo novo nao
repete registros de arquivos anteriores que nao foram aplicados. Se algum TXT
for perdido ou falhar no SIA, mantenha-o para reimportacao; nao presuma que o
proximo lote corrigira automaticamente a falta. A exportacao completa existe
para recuperacao controlada, nao para uso diario.
`POST /creare/lotes/{id}/confirmar` continua disponivel para essa auditoria,
mas nao bloqueia o proximo download.

Um lote criado antes de uma edicao e imutavel. A edicao aparece no lote
seguinte depois que o primeiro for salvo e reconhecido. Produtos invalidos ou
sem correspondencia continuam fora e devem ser verificados no health.

## Ocultar a janela da tarefa a cada 5 minutos (sem senha)

Nao altere `SINCRONIZAR-TXT-TNP.ps1` para esconder a propria janela: quando ele
comeca a executar, a janela do `powershell.exe` ja foi aberta. A alteracao
necessaria e na acao da tarefa `Download TXT SIA TNP`. Se a interface do
Agendador pede a senha do usuario Servidor ao salvar, use o utilitario
`automacao/robo-sia/OCULTAR-TAREFA-TXT-TNP.ps1`. Ele usa a sessao Windows
atual e a API do Agendador; nao pede nem armazena senha.

1. No PC da padaria, confirme que `whoami` mostra `servidor\servidor`.
2. Copie **somente** `OCULTAR-TAREFA-TXT-TNP.ps1` para `C:\importação-sia`.
   Nao substitua o robo.
3. Abra o Windows PowerShell nessa conta e execute a conferencia, sem alterar nada:

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File 'C:\importação-sia\OCULTAR-TAREFA-TXT-TNP.ps1'
   ```

   O Agendador pode mostrar apenas `Servidor` como UserId, mesmo quando
   `whoami` mostra `servidor\servidor`. A versao corrigida do utilitario
   qualifica esse nome local antes de comparar os SIDs; a verificacao da
   mesma conta continua obrigatoria. Se aparecer erro de identificacao,
   nao use `-Aplicar`: envie a saida do diagnostico.

4. Se o diagnostico mostrar login `3`, aplique:

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File 'C:\importação-sia\OCULTAR-TAREFA-TXT-TNP.ps1' -Aplicar
   ```

   Se mostrar login diferente de `3`, use `-Aplicar -SomenteUsuarioConectado`
   **apenas se aceitar que a tarefa passe a rodar somente enquanto a conta
   Servidor estiver conectada**. Sem essa opcao, o utilitario para sem mudar
   nada. Se a conta da tarefa nao for a mesma da sessao, tambem para.

5. O utilitario salva o XML original em `C:\importação-sia\backup-tarefas` e
   preserva os disparadores, incluindo a repeticao a cada 5 minutos. Teste:

   ```powershell
   Start-ScheduledTask -TaskName 'Download TXT SIA TNP'
   Get-ScheduledTaskInfo -TaskName 'Download TXT SIA TNP' | Select-Object LastRunTime,LastTaskResult,NextRunTime
   Get-Content -LiteralPath 'C:\importação-sia\logs\sincronizar-tnp.log' -Tail 5
   ```

   O esperado e `LastTaskResult` igual a `0`, uma linha recente no log e
   nenhuma janela de PowerShell abrindo na area de trabalho. Se houver erro
   de permissao, **nao apague nem recrie a tarefa**: conserve o backup e
   envie a mensagem de erro para diagnostico.
