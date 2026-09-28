# Exportacao incremental Criare — implantacao controlada

O endpoint antigo `GET /creare/produtos.txt?loja=TNP` continua sendo uma
**fotografia completa**. Ele nao confirma importacao e serve para recuperacao.
A API escolhe automaticamente o campo de barras de 13 ou 14 posicoes, mesmo
se uma configuracao antiga da loja ainda disser `barcodeField: "extended"`.

O modo novo `GET /creare/produtos.txt?loja=TNP&modo=pendentes` gera apenas
registros diferentes da ultima versao **confirmada** por produto/loja. O TXT
continua posicional (363 caracteres ASCII por linha). Retorna `204 No Content`
quando nao ha alteracoes. No `200`, os headers `X-Creare-Lote-Id`,
`X-Creare-Sha256` e `X-Creare-Registros` identificam o snapshot. Downloads
repetidos devolvem o mesmo lote enquanto ele estiver aberto; novas edicoes
esperam o lote seguinte.
O nome baixado permanece no formato antigo `produtos-TNP-AAAAMMDD.txt`,
usando a data de criacao do lote. O ID fica nos headers, nao no nome.

## Confirmacao — nunca no download

Depois de conferir no log do importador que **todos** os registros foram
aplicados na loja correta, confirme com
`POST /creare/lotes/{id}/confirmar?loja=TNP` e corpo JSON
`{"sha256":"<hash do TXT baixado>"}`. A operacao aceita sessao da loja/admin
ou o token de exportacao, respeitando a loja do usuario. Hash incorreto ou
lote de outra loja nao avanca o estado. Repetir a confirmacao e idempotente.

O script `automacao/robo-sia/confirmar-lote.ps1 -Loja TNP` confere o arquivo
local contra o hash e exige uma frase digitada pelo operador. O robo de tela
**nao confirma automaticamente**: ele apenas clica em "Aplicar ao cadastro";
isso nao prova que todos os itens foram gravados. Se o importador falhar, nao
confirme. O mesmo lote estara disponivel para nova tentativa.

Quem baixou pelo navegador pode passar `-Arquivo` apontando para o TXT em
Downloads. O script consulta `GET /creare/lotes/pendente?loja=TNP` e compara
o hash do arquivo local com o lote pendente antes de pedir a confirmacao.
O download pelo robo continua usando o marcador local `.lote.json`.

## Sequencia de implantacao

1. Aplicar a migracao `0028_fine_professor_monster.sql` em homologacao e
   depois em producao, com backup. Ela so cria duas tabelas; nao altera produtos.
2. Publicar a API e os scripts da mesma versao. Conferir que o gerador ja
   grava barras de 13 digitos nas posicoes 1–13 e usa espacos no campo vazio.
3. Manter o agendamento existente no modo completo enquanto se testa o modo
   incremental **manual**, com `-Incremental` e `-Limite 1`. O primeiro lote
   contem produtos ainda sem confirmacao; nao presumir que um produto existente
   no SIA ja foi exportado por este mecanismo.
4. Conferir 363 posicoes, codigo interno, barras, preco e fiscal do piloto;
   importar e conferir o log do SIA e a leitura no PDV. So entao executar
   `confirmar-lote.ps1`.
5. Depois da homologacao, mudar o agendamento para
   `ROBO-SIA-AUTO.ps1 -Loja TNP -Incremental`. Quando a API responder 204, o
   baixador sai com codigo 2 e o robo nao abre o importador. Sem confirmacao,
   o lote reaparece na proxima execucao.

Nao executar o modo completo e o incremental simultaneamente no mesmo
arquivo de destino. O download completo remove o marcador local de lote.

## Limites e recuperacao

- Alteracoes de nome, barras, preco, custo, fiscal e status entram porque a
  comparacao usa o registro posicional inteiro, nao so `updated_at`.
- Produtos sem de-para/codigo interno seguro ou invalidos continuam fora e
  aparecem em `/admin/creare/health`.
- **Exclusao fisica** no Pralis nao gera registro de inativacao no SIA.
  Inative o produto antes de excluir, confirme o lote e so depois considere
  exclusao definitiva.
- O banco comeca sem estado confirmado: a primeira consulta incremental traz
  todos os produtos elegiveis. Nao marcar como confirmados por suposicao.
- Um lote aberto e imutavel. Se uma correcao urgente precisar passar na frente,
  primeiro resolva ou descarte esse lote por um procedimento administrativo
  auditado (ainda nao implementado); nao edite as tabelas manualmente.
- O link completo segue disponivel para diagnostico/recuperacao, mas baixar
  esse arquivo nao altera o historico de confirmacoes do modo incremental.
