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
2. Aplicar a migracao `0030_powerful_thena.sql` antes de publicar a API. Ela
   cria o cursor de entrega e preserva o estado ja confirmado. O lote antigo
   ainda aberto continua aberto; nao e marcado como importado.
3. Publicar a API e so depois copiar a nova versao de
   `automacao/robo-sia/SINCRONIZAR-TXT-TNP.ps1` para a pasta
   `C:\importação-sia` no PC da padaria. A tarefa agendada usa o mesmo caminho.
4. Rodar o script uma vez manualmente. Se o lote antigo de 7 linhas ja estiver
   salvo e o hash corresponder ao marcador local, ele registra apenas a entrega
   sem gravar outro TXT. Ainda nessa execucao, o robo gera apenas os registros
   novos ou alterados. Conferir quantidade, codigos e dados antes de importar.

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
