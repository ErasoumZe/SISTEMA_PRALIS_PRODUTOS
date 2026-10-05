# Atualização do robô CREARE no servidor — piloto Pralis

Esta pasta alimenta o Caixa principal via `POST /api/integracoes`; o destino Pralis
é opcional e ainda **não homologado na padaria**. Não instalar este piloto só
porque o CI passou. Antes, cumprir os portões em
`C:\projetos\PRALIS\21 - Corte seguro da integracao de vendas.md`.
Ela reprocessa o dia atual a cada minuto e varre cancelamentos dos ultimos 90 dias, inclusive se a
venda original for de outro dia.

## Substituicao segura

1. Identifique a pasta real pela ação da tarefa `Cicluz-CREARE-Sincronizacao`.
   Guarde backup da pasta antes da mudança; **não** substitua às cegas com o ZIP.
2. **Não copie nem apague** `.env.producao`, `.estado` ou `logs` do servidor.
   Copie somente o código desta versão, comparando `src/`, `queries/`, `test/`
   e os arquivos de instalação. Nunca inclua credenciais no repositório.
3. Antes de ativar o Pralis, rode `npm ci`, `npm run check` e `npm test` na
   instalação real. O destino novo permanece desligado sem as três envs Pralis.
4. Em janela acompanhada, siga a sequência de corte da nota 21. Só então
   abra PowerShell **como administrador** na pasta instalada e execute:

   ```powershell
   .\instalar-tarefa-windows.ps1
   ```

5. O instalador substitui a tarefa anterior com o mesmo nome. Confirme que a tarefa
   `Cicluz-CREARE-Sincronizacao` esta como `Running` e leia
   `logs\agente-saida.log`. Deve surgir uma linha a cada minuto com
   `cancelamentos_detectados` e `cancelamentos_reenviados`.

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
