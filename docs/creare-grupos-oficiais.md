# ID dos grupos no TXT do SIA

Fonte: planilha `1xoPA6FqhLgix0cQSiyEgX56sO_X8QErz-9aZtrkGZAY`, aba
`TNP/LI/HORA - VLD EXP -  GRUPOS/REF (VLD)`, colunas AC (`NOME GRUPO`) e
AD (`ID GRUPO`), a partir da linha 5. Conferido em 29/09/2026: o grupo
`MER MERCEARIA - HIGIENE PESSOAL` aponta para o ID `60` (linha 46).
O `gid=1901841352` do link enviado abre a aba de cadastro, não a aba de grupos;
o título acima identifica a fonte correta. A aba de grupos observada tem
`gid=469332227`.

O cadastro e a exportação consultam esse de-para em leitura, com cache de cinco
minutos. A chave do nome ignora acentos, caixa, espaços repetidos e caracteres
invisíveis como U+2060. IDs não numéricos e pares ambíguos não são usados.
Se a planilha responder mas não contiver o grupo, o TXT continua bloqueando
esse produto. Se o Google estiver indisponível, a API pode reaproveitar um par
nome/ID já presente nos produtos locais; sem par, o produto permanece inválido.

No Coolify, o ID da planilha (`GOOGLE_SHEETS_SPREADSHEET_ID`) deve ser o da
fonte acima e a conta de serviço (`GOOGLE_SERVICE_ACCOUNT_EMAIL` e
`GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`) precisa ter acesso de leitura. A nova
`GOOGLE_SHEETS_GRUPO_IDS_TAB` é opcional: seu valor padrão já é o título correto.
Não mudar `GOOGLE_SHEETS_GRUPOS_TAB` para esta correção: ela é usada pela regra
de margem em outras colunas. Nenhuma alteração de `CREARE_STORE_CONFIG_JSON`
é necessária para o ID 60.

Após publicar a API, consultar `/admin/creare/health`: o papel higiênico deve
sair de `exemplosInvalidos` e `casados` deve aumentar em um. A primeira consulta
`modo=pendentes` ainda pode devolver o lote aberto anterior, imutável; não o
confirmar apenas para destravar produtos novos. O modo completo reflete o
catálogo atual, mas não confirma importação no SIA.
