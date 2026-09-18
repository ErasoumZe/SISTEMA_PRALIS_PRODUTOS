# Custo, pela base de discriminação de mercadorias

> 18/09/2026. Terceira parte, depois do [código de cadastro](codigo-interno-planilha-mix.md)
> e da [importação](importar-mix-para-base.md).

## 1. A regra não é palpite: é o DB-05

O `docs/backlog.md` já definia, antes de qualquer código:

> **DB-05** — Custo manual e não obrigatório agora; **preparar/oculto para buscar
> último custo da base de discriminação no futuro**.

A aba `TNP - DISCRIMINAÇÃO MERCADORIAS (MER)` da planilha
`CICLUZ GP - TNP - DISCRIMINAÇÃO/ESTOQUE (MER)` **é** essa base. Então o custo
do produto é o da **compra mais recente** ali — regra aprovada, não escolha minha.

## 2. O que a aba é

Cada linha é um **lançamento de compra**, não um cadastro: o mesmo produto
aparece uma vez por nota.

| Coluna | Uso |
|---|---|
| `PRODUTOS` | o nome — é a chave de junção |
| `VALOR CUSTO UN` | o custo unitário daquela compra |
| `DATA REF` | qual compra é a mais recente |

Exemplo real da aba:

```
SPAL (COCA COLA) - 02/03/26 | COCA COLA 600ML | 24,00 | 4,31 | ...
```

## 3. A chave é o nome — e por que aqui isso vale

A aba **não tem código de produto**. Nome normalmente seria fraco demais para
decidir (foi a regra que você deu para o código). Aqui vale porque os nomes são
literalmente os mesmos do PDV — conferido letra a letra entre as três fontes:

| Nome | discriminação | MIX | de-para do SIA |
|---|---|---|---|
| `COCA COLA 600ML` | ✓ | `10474` | ✓ |
| `SPRITE LATA 220ML` | ✓ | `10491` | ✓ |
| `ICE TEA LEAO PESSEGO 450ML` | ✓ | `10504` | ✓ |

Mesmo assim, a regra é conservadora: **dois cadastros com o mesmo nome não
recebem custo**. Não dá para saber a qual deles a nota se refere, e errar
atribui custo errado aos dois — e custo errado calcula preço errado.

## 4. O que fica de fora

| Motivo | O que significa |
|---|---|
| sem lançamento | o produto não foi comprado nessa base |
| já está certo | o custo do cadastro já é o da última compra |
| nome ambíguo no cadastro | dois produtos com o mesmo nome |
| custo ilegível | o valor não é um número |

**Zero não é custo.** `0,00` é recusado como ilegível: zero seria um número, e o
cálculo do preço de venda o trataria como um.

## 5. Decisões de segurança

- **Cabeçalho procurado, não fixado.** A aba tem título e blocos mesclados antes
  da grade, e esse topo muda quando alguém acrescenta um bloco. A leitura varre
  as 30 primeiras linhas atrás de `PRODUTOS` + `VALOR CUSTO UN` + `DATA REF`.
- **A data manda, não a posição.** A aba não é ordenada por data; a compra mais
  recente pode estar acima da mais antiga. Lançamento sem data nunca ganha de um
  com data.
- **Guarda contra sobrescrever edição.** O `UPDATE` casa o custo anterior: se
  alguém editou o produto entre a prévia e o clique, a linha não é atingida e
  entra na contagem de conflitos, em vez de apagar o que a pessoa digitou.
- **Só a Base e os órfãos.** Custo é do produto, e a cópia de loja herda pelo
  caminho que já existe.
- **Aviso de janela cheia.** Se a leitura encher o limite de linhas, o lançamento
  mais recente pode estar justamente na cauda não lida — a tela avisa antes.
- **Planilha só lida, nunca escrita.**

## 6. O que isto NÃO faz

Não calcula preço de venda e não mexe em margem. Grava custo como custo; quem
transforma custo em preço é o cálculo automático, nos produtos que já estão com
ele ligado. A tela mostra o valor antigo ao lado do novo antes de gravar.

## 7. Validação

| Portão | Resultado |
|---|---|
| `npm test` | 601 (API) + 91 (shared) |
| `npm run test:integration` | 247, 20 arquivos |
| `npm run typecheck` | limpo |
| build do PWA | completo |

Mutação provando que os testes mordem: trocar "a data decide" por "a posição na
planilha decide" derrubou os dois testes específicos.

## 8. Antes de ligar

Env nova: **`GOOGLE_SHEETS_MER_SPREADSHEET_ID`** =
`14dqPQTRc1Xf2PufPDJJWBb-xyw3O0FOzUZVzBjemEaU`. Sem ela a tela não lê nada, de
propósito. As três `GOOGLE_SHEETS_MER_*` já estão no compose.

A conta de serviço precisa de acesso de leitura a essa planilha — ela é de
`clientesgp@cicluz.com.br`, dona diferente das outras duas.
