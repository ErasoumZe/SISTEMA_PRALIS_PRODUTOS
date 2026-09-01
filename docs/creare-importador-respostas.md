# Como o importador do SIA Supervisor funciona — respostas do fornecedor

> Fonte: áudio do suporte, recebido em 28/08/2026, transcrito pelo José.
> Responde as perguntas em aberto do item 9 de `descoberta-integracao-creare.md`.
> Onde este documento contradiz uma suposição anterior, **este vale**.

---

## 1. O importador é um executável separado

Não está na documentação porque, nas palavras do suporte, *"na época os caras só
criaram o executável"*. O manual `LAYOUTS PARA INTEGRACAO` descreve o **formato
do arquivo**, não o programa que o consome.

**Ele precisa rodar na mesma máquina em que o SIA está instalado.** Busca
configuração no SQL da instalação do SIA; em outro computador simplesmente não
funciona.

**Consequência:** a exportação do Pralis termina em um arquivo. Quem aplica é
esse executável, na máquina do SIA, com alguém na frente.

## 2. Não existe pasta monitorada

O arquivo pode estar em qualquer lugar — área de trabalho, pendrive, qualquer
caminho. O fluxo é manual, dentro do executável:

1. clicar nos três pontinhos e localizar o arquivo;
2. abrir;
3. **fazer leitura**;
4. **aplicar** para o SIA.

**Consequência — e é a mais importante deste documento:** *não há como o
cadastro sair do Pralis e chegar no SIA sozinho por este canal.* A automação
completa exigiria automatizar a interface gráfica de um executável de terceiros
numa máquina específica. Isso é frágil, não é suportado pelo fornecedor e não
vale o risco.

**O fluxo com um clique humano é a entrega final, não uma etapa intermediária.**
Ele já resolve o problema real: acabar com o cadastro digitado duas vezes.

## 3. O importador não apaga nem move o arquivo

Depois de aplicar, o arquivo continua onde estava. Não há consumo nem limpeza
automática. Reexecutar com o mesmo arquivo é possível — e, pela regra do item 4,
seguro.

## 4. A chave é o CÓDIGO INTERNO — ele decide inserir ou atualizar

Palavras do suporte: *"é pelo código interno... se aquele código interno não
existe na base ele adiciona, se já existir ele faz o update"*.

**Este é o ponto de maior risco da integração.** Se o Pralis mandar um código
interno próprio, inventado por ele, **todo produto exportado vira produto NOVO
no SIA** — e o catálogo da loja duplica inteiro na primeira exportação.

### 4.1 Qual código interno, exatamente — VERIFICADO, e não é trivial

No `arquivo_importar_tnp.txt`:

| | registro 1 | registro 2 |
|---|---|---|
| Descrição | SKOL 473ML | SKOL 473ML DELIVERY |
| `internalCode` (66-71) | `013120` | `713120` |
| `extendedInternalCode` (249-257) | `000013120` | `000713120` |
| `CODBARRA_EX` (320-333) | `07891149100828` | `00000000713120` |

No banco do Compilart, esses mesmos dois produtos:

| | SKOL 473ML | SKOL 473ML DELIVERY |
|---|---|---|
| `codigo_produto.CODIGO` (padrão) | `07891149100828` | `00000000713120` |
| `produto.ID_PRODUTO` | `4376` | `4386` |

Conferido nos 4.309 produtos: **`CODIGO` nunca é igual a `ID_PRODUTO`** — são
numerações independentes. E o código interno do arquivo (`13120`) **não é
nenhum dos dois** para o registro 1, embora coincida com o código padrão no
registro 2.

Ou seja: existe um terceiro número, o código interno do SIA. A frase do suporte
*"o código interno seria id do produto"* quer dizer que **no SIA** o código
interno faz o papel de identidade do produto — não que ele seja igual ao
`ID_PRODUTO` do Compilart.

**Pendência (pequena, mas obrigatória):** descobrir, por produto, qual é o
código interno que o SIA já tem. Candidatos a investigar, nesta ordem:

- a tabela `codigo_produto` completa (hoje só lemos o código **padrão**, via
  `ID_CODIGO_PRODUTO_PADRAO`; pode haver outros códigos por produto);
- o padrão visível nos dois exemplos: base `13120`, delivery `713120` — sugere
  que a variante delivery é `700000 + código base`;
- consultar direto no SIA a lista de produtos com seus códigos internos.

**Até isso estar resolvido, a exportação não deve ser habilitada.** Errar aqui
não estraga imposto, mas duplica o catálogo inteiro da loja.

## 5. Excluir: jamais

Palavras do suporte: *"excluir nunca, nunca pode excluir nada da base de dados
do SIA, de produto. Você pode inativar, mas excluir jamais"*.

**Consequência para o código:** o Pralis já espelha exclusão de produto na
planilha (`product.service.ts` chama `sheets.removeProduct`). Esse
comportamento **não pode** ser estendido ao Creare. Produto excluído no Pralis
vira, no arquivo, `ATIVO = "N"` (posição 334) — nunca uma remoção.

---

## O que continua em aberto

| # | Pendência | Onde se resolve |
|---|---|---|
| 1 | Posição no ECF das alíquotas **18%**, **8,4%** e **7%** | Leitura X no caixa |
| 2 | Código interno do SIA por produto (item 4.1) | tabela `codigo_produto` ou consulta no SIA |
| 3 | O importador devolve relatório de erro? | não perguntado no áudio |
| 4 | Casas decimais do preço unitário (2 ou 3) | Supervisor → Utilitários → Configurações → Configurações internas |

As pendências 1 e 2 são bloqueantes. A 3 e a 4 são conferíveis no primeiro
teste real de importação.

---

## O que já está fechado

- **Alíquota ECF**: substituição = `10`, isento = `11`, não tributado = `12`,
  tributado = a posição da alíquota no ECF. Regra do manual, confirmada pelo
  arquivo de exemplo.
- **A alíquota do arquivo é a EFETIVA**, não a cheia: produto reduzido de 18%
  para 7% vai com o código do 7%, `REDUCAO_ICMS = 61,11` e
  `ALIQUOTA_CHEIA = 18,00`. Validado nos 4.309 produtos — seis das sete
  combinações caem exatamente numa alíquota da tabela do ECF.
- **Layout de 363 posições**, com as duas correções ao manual confirmadas
  contra o arquivo real (`Fornec./Fabric` começa em 72, `VAZIO` tem 4 bytes).
- **Codificação e quebra de linha do exemplo**: ASCII/CP1252, `LF` (não CRLF).
