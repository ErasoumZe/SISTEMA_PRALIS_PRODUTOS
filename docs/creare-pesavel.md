# Pesável e balança no TXT do SIA

## Fonte e regra

O campo `Pesável` do SIA é uma classificação operacional (`S`/`N`), não uma consequência da unidade `KG` ou `UN`. A aba **BASE SIA FULL** tem os cabeçalhos `Pesável`, `Tecla` e `Validade` na segunda linha, mas a planilha pode estar defasada. Para atualizar o de-para, use uma exportação **atual da própria loja** no SIA Supervisor. Não preencha lacunas por nome, unidade ou semelhança.

O importador do de-para lê esses três campos. Ele recusa substituir o espelho se faltar `Pesável` ou se uma linha `S` não trouxer tecla/validade. O gerador do TXT usa o valor explicitamente confirmado no produto ou no espelho do SIA; se ambos discordarem, bloqueia aquele produto e mostra o motivo em `/admin/creare/health`. Na ausência de confirmação, não gera uma linha com `N` presumido. Um produto ainda inexistente no SIA pode receber `S`/`N` no formulário somente após conferência operacional; para `S`, informe também tecla e validade.

`weighableByMeasure` no JSON do Coolify é legado: pode continuar configurado, mas não define mais `Pesável` no TXT. Não é preciso mudar essa variável para corrigir o 13535.

## Implantação segura na TNP

1. Antes do deploy, desabilite temporariamente a tarefa **Download TXT SIA TNP** no PC da padaria. Não importe TXT antigo que ainda esteja na pasta; a versão 2 podia escrever `Pesável=N` por inferência.
2. Após o deploy e migração, obtenha uma exportação atual do cadastro da TNP no SIA. Na prévia do de-para, confira `semDadosBalanca=0` e confirme que o coditem **13535** consta com `Pesável=S` e sua tecla/validade reais. Não trate a planilha BASE SIA FULL como prova de que o SIA continua igual hoje.
3. Só então substitua o de-para da TNP. Essa ação troca o espelho inteiro da loja, por isso confira também faixa, número de linhas e colisões antes de confirmar.
4. Abra `/admin/creare/health` e confira a seção da TNP e seus `invalidos`, principalmente 13535. Produtos ainda sem classificação operacional ficam fora do novo TXT; resolva cada um pela fonte real.
5. Reabilite a tarefa e inspecione o próximo TXT **antes** de importá-lo. Os lotes abertos da versão anterior são invalidados; registros cuja linha mudou poderão ser reenviados. Verifique os campos posicionais `Pesável`, `Tecla` e `Validade` do 13535 e uma amostra de produtos `N`. Importar no SIA continua sendo uma etapa manual.

Nenhum backfill automático altera o 13535 ou outros cadastros já existentes no SIA.
