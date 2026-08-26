# Descoberta da integração Criare/SIA Supervisor

> Estado em 25/08/2026: a infraestrutura segura de geração foi implementada
> atrás de feature flag, mas continua **BLOQUEADA para ativação/homologação**.
> O importador posicional de produtos é um canal oficial documentado; ainda
> faltam dados da instalação, regras de campos e ambiente de homologação.

## 1. Fontes analisadas

- Manual `LAYOUTS PARA INTEGRACAO - IMPORTACAO`, arquivo Word fornecido pelo
  usuário. O rodapé identifica **Criare Informática Ltda.** e o produto citado
  no texto é **SIA Supervisor**.
- `arquivo_importar_tnp.txt`, exemplo real com dois registros de produto.
- Três capturas do cadastro de produto. Elas mostram o produto PÃO DE SAL
  PRALIS KG e destacam os campos que a operação deseja cadastrar.
- Modelo atual do Pralis em `stack/shared/src/product`, tabela PostgreSQL e
  formulário PWA.

As instruções contidas no manual foram tratadas como especificação do sistema
externo, não como ordem para alterar ou executar o projeto.

## 2. Canal oficial encontrado

O manual documenta um **arquivo posicional de produtos**, parcial ou completo,
com um registro de **363 caracteres**. O arquivo pode ter qualquer nome e ficar
em qualquer caminho, desde que o caminho seja configurado no SIA Supervisor em
`Sistema > Parâmetros`.

O documento não informa:

- versão instalada nas lojas TNP, LI e HORA;
- codificação do arquivo;
- terminação de linha exigida;
- se o Supervisor monitora, importa sob comando, move ou apaga o arquivo;
- semântica de reenvio, alteração, inativação e rejeição;
- relatório ou arquivo de retorno;
- limites de tamanho, concorrência, timeout ou atomicidade;
- existência de API REST/SOAP ou SFTP;
- ambiente de homologação.

Portanto, o arquivo posicional é o candidato preferencial, mas ainda não está
aprovado para produção.

## 3. Layout de produto autenticado pelo exemplo

As posições abaixo são inclusivas.

| Campo | Posições | Tamanho | Observação |
|---|---:|---:|---|
| Código de Barras | 1–13 | 13 | alfanumérico, esquerda, espaços à direita |
| Código do Grupo | 14–17 | 4 | numérico, zeros à esquerda |
| Descrição Abreviada | 18–41 | 24 | alfanumérico |
| Unitário | 42–51 | 10 | decimal implícito, 2 ou 3 casas conforme configuração |
| Unidade | 52–53 | 2 | alfanumérico |
| Alíquota ECF | 54–55 | 2 | posição no ECF; ST=10, isento=11, não tributado=12 |
| Promoção | 56–65 | 10 | 2 casas implícitas |
| Código Interno | 66–71 | 6 | numérico |
| Fornecedor/Fabricante | 72–111 | 40 | correção de sobreposição do manual |
| Referência | 112–141 | 30 | alfanumérico |
| Cesta/Kit | 142 | 1 | S/N |
| Custo | 143–152 | 10 | 3 casas implícitas |
| Descrição | 153–202 | 50 | alfanumérico |
| Código da Cesta | 203–208 | 6 | numérico |
| Início Promoção | 209–216 | 8 | DD/MM/AA |
| Validade Promoção | 217–224 | 8 | DD/MM/AA |
| Quantidade | 225–234 | 10 | estoque atual, 3 casas implícitas |
| IAT | 235 | 1 | A/T |
| IPPT | 236 | 1 | P/T |
| NCM | 237–244 | 8 | numérico |
| Vazio | 245–248 | 4 | quatro espaços; o tamanho `3` impresso no manual está errado |
| Código Interno Estendido | 249–257 | 9 | numérico |
| Pesável | 258 | 1 | S/N |
| Tecla | 259–261 | 3 | código do teclado da balança |
| CEST | 262–268 | 7 | numérico |
| Redução ICMS | 269–272 | 4 | percentual sem pontuação |
| Alíquota Cheia | 273–277 | 5 | percentual sem pontuação |
| Alíquota FCP | 278–281 | 4 | percentual sem pontuação |
| CST PIS/COFINS | 282–283 | 2 | numérico |
| Alíquota PIS | 284–291 | 8 | percentual sem pontuação |
| Alíquota COFINS | 292–299 | 8 | percentual sem pontuação |
| Quantidade Máxima | 300–309 | 10 | decimal |
| Quantidade Mínima | 310–319 | 10 | decimal |
| Código de Barras Estendido | 320–333 | 14 | alfanumérico |
| Ativo | 334 | 1 | S/N |
| Controla Estoque | 335 | 1 | S/N |
| ID Origem | 336–341 | 6 | numérico |
| Fator Origem | 342–351 | 10 | 3 casas implícitas |
| Validade Balança | 352–354 | 3 | alfanumérico, alinhado à direita |
| Categoria | 355–363 | 9 | **código numérico**, não descrição textual |

### Inconsistências resolvidas apenas pela aritmética e pelo exemplo

1. `Código Interno` ocupa 66–71. Logo, `Fornecedor/Fabricante` só pode
   começar em 72; o início 71 impresso no manual causaria sobreposição.
2. `Vazio` ocupa 245–248, portanto tem 4 caracteres, não 3. Os dois registros
   do exemplo contêm exatamente quatro espaços e fecham em 363.

Essas correções devem ser confirmadas por escrito com a Criare antes da
homologação, embora sejam necessárias para o layout ser internamente coerente.

## 4. Validação do TXT fornecido

O arquivo contém dois registros não vazios, ambos com 363 caracteres, e **6.879
quebras LF extras**. Antes de usá-lo como fixture, as linhas vazias precisam ser
removidas sem alterar os dois registros.

O primeiro registro decodifica, entre outros valores, como:

- grupo `0005`, descrição `SKOL 473ML`, preço `0000000690` (R$ 6,90 se a
  loja usa duas casas), unidade `UN` e alíquota ECF `10`;
- código interno `013120`, custo `0000000100` (0,100), quantidade
  `0000000096` (0,096), IAT `A`, IPPT `T` e NCM `22030000`;
- código interno estendido `000013120`, pesável `N`, CEST `0302103`, CST
  PIS/COFINS `99`, EAN estendido `07891149100828`, ativo `S`, controla estoque
  `S` e categoria `000000003`.

O segundo registro é `SKOL 473ML DELIVERY`, preço R$ 9,00, código interno
`713120`, não controla estoque e aponta origem `013120` com fator `0000001000`.

O exemplo contém somente bytes ASCII. Assim, ele **não permite escolher** entre
ASCII, UTF-8 ou Windows-1252 para textos acentuados. Remover acentos pode ser
uma política de compatibilidade futura, mas não é uma regra presente no manual.

Também não é possível concluir que todo EAN deva ir em `CODBARRA_EX`: o
exemplo faz isso, mas o manual mantém os dois campos e não documenta a
precedência. Para código interno acima de seis dígitos, por outro lado, o manual
diz expressamente para preencher `COD.INTERNO_EX` **em vez de** `Código
Interno`; se o estendido estiver preenchido, ele prevalece.

## 5. Mapeamento preliminar Pralis -> layout

| Layout | Origem candidata no Pralis | Estado |
|---|---|---|
| Descrição abreviada / descrição | `montarDescricao(nome, quantidade, medidaBase)` | compatível, sujeito a truncamento validado |
| Unitário | valor calculado pelas regras comerciais | depende de 2/3 casas da loja |
| Unidade | `medidaBase` | mapa para G/ML/LT pendente |
| Promoção e datas | `promocoes[0]` | modelo atual tem horário/dias, mas não data inicial; sem mapeamento completo |
| Código interno | `codigoInterno` | o formulário hoje envia `null`; código padrão da tela externa não está mapeado |
| Fornecedor/Fabricante | possível `marca` | sem decisão de negócio |
| Custo | `custo` | banco usa 2 casas; layout aceita 3 |
| IPPT | `tipo` | `transformacao` não equivale necessariamente a produção própria |
| NCM / CEST | `fiscal.ncm` / `fiscal.cest` | compatível após validação estrita |
| Redução/cheia/FCP/PIS/COFINS | campos homônimos em `fiscal` | escala decimal do layout pendente |
| CST PIS/COFINS | `fiscal.cstPisCofins` | compatível após validação de domínio |
| Quantidades mínima/máxima | `estoqueMin` / `estoqueMax` | escala decimal pendente |
| Código de barras | `codigoBarras` | escolha entre campo curto/estendido pendente |
| Ativo | `status` | `ativo` -> S; `inativo` -> N |
| Categoria | `fiscal.categoria` | incompatível até provar que contém o código numérico Criare |

Campos sem origem segura hoje: código numérico do grupo, alíquota ECF,
cesta/kit, estoque atual, IAT, pesável, tecla de balança, controle de estoque,
ID/fator de origem, validade de balança e categoria Criare.

Nas capturas, `Cód. interno` e `Cód. padrão` são dois identificadores
distintos. O layout não nomeia `Cód. padrão`; não se deve presumir que seja
EAN, `COD.INTERNO_EX` ou outro campo.

## 6. Decisões necessárias

Solicitar ao responsável/fornecedor, idealmente por loja:

1. Nome e versão exata do SIA Supervisor instalado e confirmação de que este
   manual corresponde à versão.
2. Confirmação oficial das duas correções de posição acima.
3. Codificação e terminação de linha exigidas.
4. Quantidade de casas decimais de preço nas duas configurações citadas pelo
   manual e escala implícita dos percentuais/quantidades que ele não detalha.
5. Códigos numéricos de grupos e categorias e tabela/ordem das alíquotas ECF.
6. Domínio aceito em Unidade e conversão de `UN`, `KG`, `G`, `LT` e `ML`.
7. Significado e origem de `Cód. padrão`, precedência dos dois campos de
   código de barras e regra exata dos dois campos de código interno.
8. Regras/defaults aprovados para IAT, IPPT, pesável, tecla, controle de
   estoque, validade e origem.
9. Caminho configurado em cada loja, gatilho de importação, consumo/remoção
   do arquivo, retorno de erros e comportamento ao reenviar o mesmo produto.
10. Sandbox ou cópia de homologação e produto fictício autorizado para teste.
11. Códigos das empresas/lojas TNP, LI e HORA, caso a importação seja
    segregada por empresa.

## 7. Estratégia proposta após desbloqueio

Somente depois das respostas e da aprovação do mapeamento:

1. criar um serializer puro e estrito no `shared`, com contrato versionado;
2. validar tamanho em **bytes na codificação aprovada**, domínios, escalas e
   overflow; rejeitar em vez de truncar silenciosamente identificadores;
3. testar os dois registros fornecidos como fixtures normalizadas e incluir
   casos com acentos, limites, EAN e código interno curto/estendido;
4. integrar pela API usando outbox por produto e loja, independente do Google
   Sheets, com idempotência e reconciliação;
5. homologar a geração e a importação ponta a ponta fora de produção.

Não foi realizada escrita em Firebird, Supervisor, Google Sheets ou qualquer
serviço externo.

## 8. Decisão

**BLOQUEADO PARA ATIVAÇÃO.** O serializer estrito e o endpoint de download foram
implementados com `CREARE_EXPORT_ENABLED=false`; isso não aprova nenhum de-para
nem autoriza produção. Ainda não há base para declarar
`APROVADO PARA FASE 09`. Consulte também `docs/integracao-creare.md`.
