# Central de Produtos — reforma da unificação (16/09/2026)

Este documento é o que fica depois do merge: o que mudou, o que **você** precisa
configurar, e como conferir que funcionou. Ele distingue o que está *provado por
teste*, o que depende de *acesso externo* e o que é *operação no servidor*.

## 1. O que a Central é agora

> **Atualizado em 16/09/2026, segunda rodada.** A primeira versão desta reforma
> deixava a tela *presa* ao recorte dos vendidos e fazia a Central criar cadastro
> em TNP e LI sozinha. As duas coisas mudaram — o que está escrito abaixo é o
> comportamento atual.

O universo da tela é **tudo que já foi cadastrado um dia**: as seis fontes
históricas, a Base do sistema e a planilha oficial, no mesmo confronto.
**"Já vendidos · 12 meses"** é um *filtro opcional* sobre esse conjunto, que
reduz a lista aos produtos únicos que passaram pelos PDVs na janela móvel dos
últimos 12 meses — não é mais o universo da tela.

Fluxo, na ordem em que acontece:

1. Todas as fontes de cadastro entram no staging (SIA Lisboa, Compilart TNP,
   planilha antiga TNP, fiscal TNP, cadastro vivo do Pralis, planilha oficial).
2. As vendas dos últimos 12 meses entram como a fonte `vendas_pdv_12m`, com uma
   linha por produto distinto que passou pelo PDV.
3. O motor agrupa tudo por **quatro** chaves, da mais forte para a mais fraca:

   | Chave | O que ela liga | Alcance |
   |---|---|---|
   | ID do sistema | a linha da planilha ao produto da Base que a gerou | o mais forte: foi o próprio sistema que gravou |
   | Código de barras / código do Creare | o mesmo produto visto por lojas diferentes | cruza lojas |
   | Código interno | dois registros do mesmo catálogo | **só dentro da mesma loja** |
   | Nome normalizado | sugestão | chave fraca: sugere, nunca decide |

4. A tela mostra **tudo**. O botão "Já vendidos · 12 meses" filtra para o recorte
   das vendas quando você quiser olhar só por ele.
5. Você decide grupo a grupo, escolhendo o nome **entre os que já existem** nas
   fontes daquele produto. Nome inventado é recusado pela API (422).
6. Unificar grava **somente o produto da Base Geral**. TNP e LI continuam
   independentes e recebem o produto quando *você* importar da Base — e é a
   importação que preenche a faixa da loja na planilha.

As visões substituem os filtros técnicos que existiam antes:

| Visão | O que mostra |
|---|---|
| Todos | o conjunto inteiro, decidido ou não |
| Pendentes | o que ainda não foi decidido |
| Correspondência exata | casou por ID do sistema, código de barras **ou** código interno |
| Precisa analisar | nomes divergentes, código conflitante, sem fiscal, sem grupo |
| Concluídos | o que você já decidiu |

As ações em massa saíram da tela. A decisão voltou a ser uma por clique humano.

### O que mudou no significado dos números

"Viraram cadastro" contava **decisão**, não produto: um grupo continuava
concluído mesmo depois de o produto ser apagado — foi assim que a tela chegou a
1.631 "concluídos" com algumas centenas de produtos na Base. Agora o cartão se
chama **"Vinculados à Base"** e a reconciliação confere, a cada recálculo, se o
produto que aquela decisão criou **ainda existe** na tabela `products`. Se não
existe, o grupo volta para pendente em vez de seguir escondido.

Descarte ("não é o mesmo produto", "ignorar") não cria cadastro e por isso não é
conferido: continua valendo como decisão humana.

### O nome: quem ganha de quem

Só o nome **escolhido na tela** sobrescreve o que já está no Pralis. O nome que o
motor deduziu sozinho serve apenas para preencher cadastro sem nome — o lote
automático e o "criar todos os que faltam" unificam sem nome escolhido, e sem
essa distinção eles apagariam em massa a curadoria feita à mão.

### Consequência: o fiscal da loja mudou de dono

A Central copiava o fiscal por loja no mesmo clique em que criava as cópias: NCM
e redução do SIA para a LI, NCM e ICMS da contabilidade para a TNP. Sem as
cópias automáticas, **esse caminho deixou de existir**. Quem classifica o produto
da loja agora é o **backfill fiscal** (`BackfillFiscalService`), que já pega
justamente quem está sem linha fiscal nenhuma e lê a tabela fiscal oficial.

Na prática: depois de importar da Base para a loja, rode o backfill fiscal para
aquela loja. O produto importado nasce sem carga fiscal de propósito — nulo é
"não sei", e a Central não inventa.

### Por que a tela pode aparecer vazia

O universo são as vendas. Se o robô de vendas parar de alimentar
`venda_produto_dia`, a Central fica vazia **sem nada quebrar** — cadastro existe,
venda não. A tela agora avisa isso explicitamente em vez de mostrar branco.
Se o aviso aparecer, o problema é o robô, não a unificação.

## 2. O que você precisa fazer — na ordem

### 2.1 Compartilhar a planilha oficial (bloqueia a escrita)

A conta de serviço ainda recebe `403 — The caller does not have permission` na
planilha `1xoPA6FqhLgix0cQSiyEgX56sO_X8QErz-9aZtrkGZAY`. Seu navegador tem
acesso; a conta da API não. Compartilhe como **Editor** com:

```
pralis-google-sheets@pralis-sheets-integracao.iam.gserviceaccount.com
```

### 2.2 Conferir o leiaute ANTES de ligar a escrita

Todo o mapeamento de colunas foi levantado e provado contra a planilha
`1iQGit…`. A planilha oficial que você indicou é **outro arquivo**. As duas podem
ter o mesmo leiaute — mas "podem" não é prova, e escrever cadastro numa planilha
cujo leiaute ninguém conferiu grava cada campo na coluna errada, em silêncio.

Rode, depois de compartilhar:

```bash
cd stack/api && npx tsx scripts/conferir-planilha-oficial.ts
```

Ele é **só leitura** e confere, nesta ordem:

- acesso da conta de serviço;
- se as três abas que o sistema usa existem — cadastro, fiscal e grupos;
- se a linha 3 traz as faixas (é o que faz o código reconhecer o leiaute novo;
  sem ela, ele trataria a aba como o leiaute ANTIGO e escreveria por posição
  fixa, gravando tudo torto);
- se existe a coluna `ID` — sem ela o espelho não reencontra o produto e
  duplica a linha a cada sincronismo;
- quais campos do cadastro não teriam destino nesta aba.

Só ligue a escrita quando ele terminar com `RESULTADO: planilha oficial
CONFERIDA`.

> **Atenção à aba fiscal.** `tax-rule.service.ts` lê a aba fiscal e a de grupos
> pelo **mesmo** `GOOGLE_SHEETS_SPREADSHEET_ID`. Trocar a planilha sem que elas
> existam no arquivo novo derruba a classificação fiscal junto.

### 2.3 Variáveis no Coolify

Nenhuma variável **nova** foi criada, então o `docker-compose.coolify.yaml` não
precisou mudar. Mas dois **valores** mudam, e mudar só o código não muda uma
variável já cadastrada no servidor:

| Variável | Valor |
|---|---|
| `GOOGLE_SHEETS_SPREADSHEET_ID` | `1xoPA6FqhLgix0cQSiyEgX56sO_X8QErz-9aZtrkGZAY` |
| `GOOGLE_SHEETS_BASE_TAB` | `(TNP/LI) CADASTRO PRODUTOS` |

Mantenha `GOOGLE_SHEETS_ENABLED=false` até o passo 2.2 passar.

### 2.4 Creare/SIA — o que falta é operação, não código

O encadeamento já existe inteiro e não foi alterado nesta entrega:

```
API /creare/produtos.txt?loja=LI   (Bearer CREARE_EXPORT_TOKEN)
  └─ automacao/robo-sia/baixar-cadastro.ps1   baixa e valida
       └─ automacao/robo-sia/ROBO-SIA-AUTO.ps1
            abre o importador → empresa → arquivo → "Importar arquivo"
            → aba "Dados no arquivo" → "Aplicar ao cadastro"
```

O arquivo é posicional de 363 caracteres, gerado a partir do **banco** (não da
planilha), com os campos do layout conhecido. Se o download falhar, o robô sai
sem abrir o importador — nunca reaplica o cadastro do dia anterior.

Para ligar, falta:

1. `CREARE_EXPORT_ENABLED=true` no Coolify.
2. `CREARE_STORE_CONFIG_JSON` da loja preenchido.
3. `CREARE_EXPORT_TOKEN` com **pelo menos 32 caracteres**, com o mesmo valor no
   Coolify e na variável de ambiente da máquina da loja. Abaixo de 32 a API
   recusa o caminho por token de propósito, com 503.
4. A tarefa agendada instalada na máquina da loja
   (`automacao/robo-sia/INSTALAR-AGENDAMENTO-SIA.bat`).
5. O de-para do SIA importado. Confira antes em `GET /admin/creare/health`.

Nada disso é código pendente — é configuração que só existe no servidor e na
máquina da loja.

## 3. Como conferir depois do deploy

1. Abra a Central e clique em **Atualizar fontes**.
2. Confira o cabeçalho: "Produtos vendidos" é o tamanho do universo de 12 meses.
   Se vier zero, leia o aviso amarelo — o problema é o robô de vendas.
3. Abra **Correspondência exata** e confirme que aparecem produtos casados pelos
   **dois** códigos, não só por código de barras.
4. Unifique **um** produto e confirme que ele aparece na planilha oficial.
5. Só então considere ligar a exportação do Creare.

## 4. Pendências conhecidas

- **A chave mais forte está dormente.** O casamento por ID do sistema depende da
  coluna `ID` da planilha, que só chega quando a planilha é lida ONLINE — e isso
  exige `GOOGLE_SHEETS_ENABLED=true`. Com a variável desligada, a Central cai no
  CSV `docs/fonte_planilha_nova.csv`, que tem 1.186 linhas e **nenhuma coluna
  ID**: nesse modo o motivo `mesmo_id_sistema` não casa nada e a planilha só
  encontra a Base por código de barras ou nome. Ligar o Sheets é o que acende
  essa chave.
- **Acesso da conta de serviço à planilha oficial** — bloqueia a escrita.
- **Leiaute da planilha oficial não conferido** — impossível de provar enquanto
  o acesso não existir; o script do item 2.2 fecha isso em um comando.
- **Volume real da janela de 12 meses** — o banco local tem 5 linhas de teste,
  então o tamanho verdadeiro do universo só aparece em produção.
- **`DC` e `DP` da faixa fiscal** continuam como antes: só `DC` é escrito, na
  grafia percentual. A pergunta de qual coluna recebe `5333` e qual recebe
  `53,33` segue em aberto e não foi decidida por analogia.
