# Vendas em (quase) tempo real — o que falta no robô da padaria

**Estado em 24/09/2026.** O sistema já está pronto para receber e mostrar
venda por venda: tabela `venda_item_pdv`, rota `POST /vendas/importar` com
`tipo: "venda_item_pdv"`, aba **Vendas** em `/vendas` (relê a cada 15 s, abre o
cupom ao clicar) e o detalhe por PDV. **Nada disso mostra dado até o robô da
loja enviar o novo lote.** O código do robô fica no PC da padaria
(`C:\Users\Server-Pralis\Documents\bot`) e não está neste repositório — por
isso este documento existe.

## Como é hoje

O robô acorda **uma vez por dia** (`HORARIO_EXECUCAO_TNP: "22:10"` no
`config.yaml`), roda as consultas de `queries/` no MySQL do Creare
(`localhost:3306`, banco `gerente`) e envia dois lotes ao Pralis: vendas por
produto × dia e fechamento de caixa × dia. Nenhum dos dois sabe o que é "uma
venda". Por isso não é tempo real — e nunca foi: é uma remessa diária.

## O que colocar no robô (quatro arquivos, nenhuma edição de código)

Nada do robô diário muda. Entra um **caminho separado**, que não toca na
planilha e só fala com o Pralis. Os quatro arquivos estão em `docs/robo/` e
vão para `C:\Users\Server-Pralis\Documents\bot`:

| arquivo | onde cai | o que é |
|---|---|---|
| `CREARE_COMPILART_ITENS_VENDA_PDV.sql` | `bot\queries\` | a consulta: uma linha por item de cupom com o vínculo que o ERP prova |
| `rodar-vendas-ao-vivo.js` | `bot\` | lê a consulta (últimos dias), monta o lote `venda_item_pdv` e envia ao Pralis; usa o mesmo cadeado do robô diário para nunca rodarem juntos |
| `rodar-vendas-ao-vivo.bat` | `bot\` | chama o `.js` em segundo plano e grava `logs\ao-vivo-agendado.txt` |
| `INSTALAR-AO-VIVO.bat` | `bot\` | registra no Agendador de Tarefas a execução **a cada 1 minuto** (tarefa "Bot Padaria - Vendas ao vivo"); rodar uma vez como administrador |

Ele reaproveita o que já existe no robô — conexão ao Creare, `.env.producao`
(`PRALIS_VENDAS_API_URL` e `PRALIS_VENDAS_API_TOKEN` já estão lá), o cadeado
e o cliente HTTP. A chave única no servidor é `loja + ID_ITEM_VENDA_BALCAO`:
reenviar não duplica; `ATUALIZADO_EM` mais novo corrige o item.

Por padrão lê **hoje e ontem** (`AO_VIVO_DIAS=1`). Para um backfill, rodar à
mão com `set AO_VIVO_DIAS=30 && node rodar-vendas-ao-vivo.js`, uma vez.

Também vale mandar `ID_DISPOSITIVO` no lote de fechamento
(`CREARE_COMPILART_FECHAMENTO_CAIXA.sql` já tem `d.ID_DISPOSITIVO` na
subconsulta): é o que permite ao detalhe do PDV confrontar itens e fechamento.
Essa é a única edição de código sugerida, e é opcional.

Também vale mandar `ID_DISPOSITIVO` no lote de fechamento
(`CREARE_COMPILART_FECHAMENTO_CAIXA.sql` já tem `d.ID_DISPOSITIVO` na
subconsulta): é o que permite ao detalhe do PDV confrontar itens e fechamento.

## O que validar ANTES de ligar — com dados reais, no PC da padaria

Não dá para testar daqui: não há acesso ao MySQL do Creare. Quatro pontos que
a consulta assume e precisam ser confirmados olhando o banco:

1. `item_venda_balcao.ID_ITEM_VENDA_BALCAO` existe com esse nome (é a chave do
   item; se for outro nome, trocar só o alias da primeira coluna).
2. Existe marcador de cancelamento **por item** (estorno de item numa venda
   válida)? A consulta hoje deriva `ITEM_CANCELADO` do `STATUS` da **venda**.
3. `DTHR_VENDABALCAO` está na hora local da loja (a tela assume
   America/Sao_Paulo e **não converte**).
4. Quais valores `venda_balcao.STATUS` assume além de `'F'` e `'C'`. Hoje só
   `'F'` conta como confirmada; venda em aberto aparece na lista sem somar.

## Ordem segura de implantação

1. Rodar a consulta nova **à mão** no MySQL da padaria para um dia conhecido e
   conferir 3 cupons contra o Creare (itens, hora, PDV, cancelamento).
2. Copiar os quatro arquivos e rodar **uma vez à mão**: `node rodar-vendas-ao-vivo.js`
   na pasta do bot. Ler `logs\ao-vivo.txt`; conferir em `/vendas` → aba Vendas.
3. Reenviar o mesmo dia e confirmar `inseridas: 0, ignoradas: N` na resposta.
4. Apontar para produção. Backfill por períodos curtos (uma semana por vez),
   comparando por dia o total dos itens com o fechamento — a diferença é
   informação (descontos, devoluções), não erro a corrigir.
5. Só então rodar `INSTALAR-AO-VIVO.bat` como administrador — a partir daí o
   Windows executa o envio a cada minuto. Para desligar:
   `schtasks /Delete /TN "Bot Padaria - Vendas ao vivo" /F`.

Enquanto isso não acontece, a aba Vendas mostra **"Aguardando o robô da
loja"** — e é a verdade.
