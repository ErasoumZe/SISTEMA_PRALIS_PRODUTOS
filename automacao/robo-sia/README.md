# Robô do SIA — ciclo das 22:30 (uma máquina por loja)

Todo dia às 22:30, na máquina **da loja**, o cadastro do Pralis vira cadastro no
PDV. São três passos, nessa ordem:

```
1. baixar   -> baixar-cadastro.ps1     pega o TXT da API e valida
2. importar -> ROBO-SIA-AUTO.ps1       "Importar arquivo" (só LÊ o arquivo)
3. aplicar  -> ROBO-SIA-AUTO.ps1       "Aplicar ao cadastro" (é o que GRAVA)
```

O passo 2 apenas parseia o arquivo para a grade. Quem escreve em `produto`,
`codigos`, `estoques`, `tributacaopiscofins` e `aliquotas_internas_produto` é o
passo 3.

## A LOJA É O PARÂMETRO MAIS IMPORTANTE

```powershell
.\ROBO-SIA-AUTO.ps1 -Loja TNP     # máquina da padaria
.\ROBO-SIA-AUTO.ps1 -Loja LI      # máquina da Lisboa
```

Sem `-Loja` o padrão é `LI`, que era o comportamento antigo. O arquivo fica em
`C:\cadastro-sia\cadastro-<loja>.txt` — um por loja, para nunca haver dúvida
sobre de qual cadastro veio o que está em disco. `-Arquivo` sobrescreve o
caminho quando for preciso.

**Rodar a loja errada não é engano inofensivo.** O TXT carrega o `CODITEM` do
SIA daquela loja, e o importador usa o `CODITEM` para decidir entre ATUALIZAR e
INSERIR. O mesmo número é outro produto no outro cadastro: aplicar o arquivo da
Lisboa na padaria grava por cima de produtos diferentes, em silêncio.

**Cada loja precisa do seu de-para** carregado na API antes de qualquer
exportação (`npm run creare:depara -- <exportação do SIA> --loja TNP`). Sem ele
a API recusa a exportação com `CREARE_DEPARA_MISSING` — de propósito, porque
sem `CODITEM` o importador insere tudo e duplica o catálogo.

## Antes de tudo: variáveis de ambiente da máquina

Definir em **Sistema → Variáveis de ambiente** (não no script, que é versionado):

| Variável | O que é |
|---|---|
| `PRALIS_API_BASE` | domínio da **API** no Coolify (`API_URL`), sem barra no fim |
| `CREARE_EXPORT_TOKEN` | o mesmo token configurado no Coolify (mínimo 32 caracteres) |

`PRALIS_API_BASE` é o domínio da **API**, não o do site. No `docker-compose.coolify.yaml`
são dois serviços com domínios diferentes: `API_URL` (api) e `APP_URL` (pwa).
Pegue o valor de `API_URL` no painel do Coolify.

O token nunca aparece em log: o script registra a URL, jamais o `Authorization`.

## Passo 1 — baixar

```powershell
.\baixar-cadastro.ps1 -Loja TNP -Destino 'C:\cadastro-sia\cadastro-tnp.txt'
.\baixar-cadastro.ps1 -Loja TNP -Destino 'C:\cadastro-sia\cadastro-tnp.txt' -Limite 10
```

O `-Limite 10` é a primeira execução real: dez produtos, conferidos no log antes
de liberar o catálogo inteiro.

Quando o `ROBO-SIA-AUTO.ps1` chama o download, ele já repassa a `-Loja` e o
destino derivado dela — não é preciso repetir nada.

O que ele faz antes de deixar o arquivo entrar:

- baixa para `<destino>.baixando` e só troca o arquivo real depois de validar;
- exige que **toda** linha tenha exatamente **363** posições;
- exige ASCII imprimível (o importador quebra a leitura com
  `' XXX' is not a valid integer value` se vier caractere estranho);
- guarda o anterior em `<destino>.anterior`.

**Se o download falhar, ele sai com código 1 e NÃO toca no arquivo que já
existe.** Isso é de propósito: passar adiante faria o robô importar o catálogo
de ontem achando que era o de hoje. Não importar é melhor que importar velho.

Erros com mensagem própria: `401` (token errado), `503` (exportação desligada ou
sem configuração), `422` (a API recusou gerar — veja
`GET /admin/creare/health`).

## Passo 2 e 3 — importar e aplicar

`ROBO-SIA-AUTO.ps1` abre o importador e dirige a tela: escolhe a empresa,
preenche o caminho do arquivo, clica em **Importar arquivo**, fecha os avisos,
troca para a aba **Dados no arquivo** e clica em **Aplicar ao cadastro**.

### A sessão precisa estar logada e desbloqueada

Isso não é detalhe: o robô usa automação de **tela** (`SetForegroundWindow`,
`SendKeys`, cliques em janelas). Com a máquina bloqueada ou a sessão desconectada
não existe desktop interativo, e ele falha ou clica no lugar errado.

- A tarefa agendada precisa rodar **como o usuário logado**, com "Executar
  somente quando o usuário estiver conectado".
- Não marque "Executar estando o usuário conectado ou não" — nesse modo a sessão
  fica sem desktop e a automação não funciona.
- A máquina pode estar com a tela apagada, mas **não bloqueada** (Win+L quebra).
- Nada de RDP desconectado: ao fechar a sessão remota o desktop some.

O passo 1 (baixar) não tem essa restrição — é só HTTP.

## O download já está dentro do robô

`ROBO-SIA-AUTO.ps1` chama o `baixar-cadastro.ps1` antes de abrir o importador,
repassando a `-Loja`, e **só continua se ele terminar com código 0**. É essa
checagem que impede uma falha de rede de virar reimportação do arquivo de
ontem: sem arquivo novo, o robô sai sem abrir nada.

Rodar o `baixar-cadastro.ps1` sozinho continua servindo para conferir o arquivo
à mão, sem encostar no PDV.

## Logs

| O quê | Onde |
|---|---|
| download | `C:\cadastro-sia\logs\baixar-cadastro-<data>.txt` |
| robô (tela) | `C:\cadastro-sia\logs\robo-<data>.txt` |
| importador Criare | `C:\Program Files (x86)\Criare\logs\` |

Depois de uma execução real, procure no log do Criare as linhas
`AplicarNoCadastro() ... ATUALIZADO ... coditem: X`. É a confirmação de que
gravou — e de que atualizou em vez de inserir.

## Arquivos para implantação

Os três arquivos do ciclo estão versionados nesta pasta:

- `baixar-cadastro.ps1`: baixa e valida o arquivo;
- `ROBO-SIA-AUTO.ps1`: chama o download e, somente se ele terminar bem, importa
  e aplica no cadastro;
- `INSTALAR-AGENDAMENTO-SIA.bat <LOJA>`: registra a tarefa interativa das
  22:30 já com a loja (`INSTALAR-AGENDAMENTO-SIA.bat TNP`). A tarefa fica com o
  nome "Robo Cadastro SIA - TNP", então dá para ver pelo nome qual loja aquela
  máquina atende. Sem argumento assume `LI`.

A versão trazida para o repositório é a cópia atual fornecida em 03/09/2026.
Antes de substituir o arquivo da Lisboa, guarde uma cópia do que estiver rodando
na máquina e compare os dois; não houve acesso remoto ao servidor para confirmar
que aquela cópia é idêntica.

## Observador da planilha a cada minuto

O fluxo novo fica separado do robô diário acima. Ele lê a aba combinada, monta
um registro por produto e por loja e grava um TXT somente quando o registro
completo mudou desde a última exportação:

```powershell
# uma leitura, sem ficar em execução
.\teste-creare\ROBO-CREARE-PLANILHA.ps1 -UmaVez

# processo contínuo; relê a cada 60 segundos
.\teste-creare\ROBO-CREARE-PLANILHA.ps1

# diagnóstico/reprocessamento de um produto
.\teste-creare\ROBO-CREARE-PLANILHA.ps1 -UmaVez -Produto 'FAROFA TRADICIONAL YOKI' -Forcar
```

Arquivos envolvidos:

- `teste-creare/ROBO-CREARE-PLANILHA.ps1`: inicializador local;
- `teste-creare/creare-planilha.config.json`: planilha, saída e de-paras por loja;
- `teste-creare/creare-planilha-bot.ts`: leitura, validação, estado e geração;
- `teste-creare/.creare-planilha-state.json`: hash do último registro exportado;
- `teste-creare/ultimo-diagnostico.json`: produtos recusados e campos faltantes.

### Regra de cadastro completo

O TXT só é criado quando a linha tem, para a loja: código de barras, código
interno, custo, preço, NCM, ID da alíquota ECF, CST PIS/COFINS, unidade e os
de-paras numéricos de grupo e categoria. O arquivo é escrito primeiro em um
temporário e renomeado no fim; uma leitura interrompida não deixa TXT parcial.

Para a TNP, o robô consulta também o cadastro legado informado na configuração.
Ele copia o fiscal por EAN exato e aprende o código de grupo apenas quando todos
os EANs cruzados concordam. `groupCodes`, `categoryCodes` e `productOverrides`
continuam disponíveis para exceções documentadas. Não use códigos da TNP na LI:
grupo, categoria e alíquota ECF são cadastros locais do SIA.

Promoção preenchida permanece bloqueada nesta versão. A planilha descreve
recorrência por dias e horários, enquanto o layout do Criare exige duas datas
`DD/MM/AA`; sem uma regra de conversão homologada, inventar datas poderia manter
um desconto ativo fora da janela pretendida.

### Primeira execução e alterações

A primeira execução normal cria a linha de base e não exporta o catálogo
inteiro. Depois dela, mudanças em nome, EAN, status, preço, custo, estoque ou
fiscal alteram o registro e geram outro arquivo. `-Forcar` ignora o hash somente
para a seleção pedida; ainda exige cadastro completo.
