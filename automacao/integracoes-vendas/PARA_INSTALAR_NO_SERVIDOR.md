# Cupons CREARE no Pralis — ativacao controlada

Esta pasta alimenta o Caixa principal via `POST /api/integracoes`; o destino Pralis
e opcional e ainda **nao homologado na padaria**. O bot "Vendas ao vivo" continua
responsavel pelos itens. Este pacote acrescenta CUPOM e PAGAMENTOS, sem duplicar itens.
Ela reprocessa o dia atual a cada minuto e varre cancelamentos dos ultimos 90 dias, inclusive se a
venda original for de outro dia.

## Substituicao segura

1. Identifique a pasta real pela ação da tarefa `Cicluz-CREARE-Sincronizacao`.
   Guarde backup da pasta antes da mudança; **não** substitua às cegas com o ZIP.
2. **Não copie nem apague** `.env.producao`, `.estado` ou `logs` do servidor.
   Copie somente o código desta versão, comparando `src/`, `queries/`, `test/`
   e os arquivos de instalação. Nunca inclua credenciais no repositório.
3. Publique primeiro a API/PWA com a tabela `venda_creare`; sem ela, o destino
   novo sera recusado. Confirme o deploy do commit, nao apenas o merge.
4. Na instalacao real, rode `npm.cmd run check` e `npm.cmd test` SEM iniciar
   outro agente. Configure `PRALIS_ENVIAR_CUPONS="true"` e
   `PRALIS_ENVIAR_ITENS="false"` no `.env.producao` real. Preserve as tres
   variaveis Pralis URL/token/empresa existentes, sem publica-las.
5. **Nao execute `instalar-tarefa-windows.ps1` automaticamente.** Em 07/10
   havia um PID antigo (10212, iniciado em 26/09) com o lock e a tarefa nova
   `Ready`. Identifique o supervisor/parent do PID e planeje a passagem para
   a tarefa nova. Reinstalar sem isso pode parar o Caixa ou deixar dois runners.
6. Depois do corte acompanhado, confira log fresco de `[sincronizar]`,
   `[pralis/venda_creare]`, fila Pralis de cupons vazia e conciliacao Caixa.
   O bot de itens deve seguir ligado. Compare pelo menos um dia/PDV com SIA.

## Recuperacao do que ficou pendente

Depois de instalar, para trazer vendas/cancelamentos de uma data especifica sem duplicar dados:

```powershell
npm run reprocessar -- --dia 2026-09-26
```

Para a venda que foi cancelada ha mais de 90 dias, use o ID do CREARE:

```powershell
npm run reprocessar -- --ids 123456
```

O script e idempotente: uma venda existente volta como `sem novidade`; a mesma venda com status
alterado para `CANCELADA` volta como `atualizada`.

Para popular historico de cupons **somente no Pralis**, em faixas de ate 31 dias:

```powershell
npm.cmd run reprocessar:pralis-cupons -- --de 2026-09-01 --ate 2026-09-30
```

Esse comando nao envia ao Caixa e nao altera o cursor do agente. Revise a faixa
e confira a cobertura/valores antes de seguir para o mes seguinte.
