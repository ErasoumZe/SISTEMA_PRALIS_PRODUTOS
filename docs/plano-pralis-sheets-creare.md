# Plano — Pralis como origem para Google Sheets e CREARE

> **Especificação, não implementação.** Nada do adaptador CREARE foi construído.
> Nenhum schema foi alterado nesta execução. Este documento existe para ser
> revisado e corrigido **antes** de virar código.

Data: 24/08/2026 · branch `main` · HEAD `0060dfd`.

---

## 1. Arquitetura obrigatória

```text
Formulário (PWA)
      |  HTTPS, cookie de sessão
      v
   API (Fastify)
      |
      v
  PostgreSQL  ← FONTE DE VERDADE
      |
      +--→ outbox Sheets  --→ Google Sheets API  --→ planilha BASE
      |
      `--→ outbox CREARE  --→ API/importador oficial CREARE
```

Regras que a arquitetura precisa garantir:

1. **O navegador nunca recebe credencial** de Google ou CREARE, e nunca chama
   esses serviços diretamente. Todo acesso externo sai do servidor.
2. **Os dois destinos são independentes.** Falha em um não bloqueia, não reverte
   e não duplica o outro. Não existe ordem obrigatória entre eles.
3. **A planilha não é ponte para o CREARE.** O CREARE lê do PostgreSQL, nunca do
   Sheets. Se a planilha sumisse amanhã, o fluxo CREARE continuaria intacto.
4. **O produto é salvo antes de qualquer publicação.** O commit no PostgreSQL e o
   registro `pending` de cada destino acontecem na mesma transação; a publicação
   vem depois.
5. **Reprocessar é sempre seguro.** Toda publicação é idempotente por
   `(produto, destino)`.

### Por que outbox, e não chamada direta

Hoje a sincronização com o Sheets é disparada logo após o commit, dentro do
request. Funciona para um destino e um volume baixo, mas não escala para dois
destinos porque:

- o tempo de resposta do cadastro passa a depender de dois serviços externos;
- não há retry automático — uma falha fica parada até alguém chamar a rota
  administrativa;
- edição e inativação não geram eventos, então os destinos divergem em silêncio.

O padrão outbox resolve os três: o request só grava a intenção, e um worker
publica. **A implementação atual é um caso particular disto** (a tabela
`product_sheet_sync` já é meio outbox), então a migração é evolutiva, não uma
reescrita.

---

## 2. Estados propostos do produto

**Proposta — não implementada, não altera schema nesta execução.**

| Estado | Significado |
|---|---|
| `rascunho` | cadastrado, ainda não liberado para publicação |
| `aprovado` | liberado, aguardando publicação nos destinos |
| `publicado_parcial` | pelo menos um destino `synced` e pelo menos um pendente/falho |
| `publicado` | todos os destinos exigidos `synced` |
| `inativo` | descontinuado; gera evento de inativação nos destinos |

`publicado_parcial` é o estado que hoje não existe e faz falta: é exatamente a
situação de "salvou no banco, planilha pendente" que a interface já mostra, mas
que o modelo de dados não representa.

> **Derivado, não digitado.** Este estado deve ser calculado a partir dos status
> por destino, nunca preenchido à mão — senão vira mais uma fonte de verdade.

---

## 3. Status por destino/loja

Uma linha por `(produto, destino, loja)`. Campos propostos:

| Campo | Tipo | Observação |
|---|---|---|
| `status` | `pending` \| `processing` \| `synced` \| `failed` | `processing` evita dois workers pegando o mesmo item |
| `attempts` | int | contador de tentativas |
| `next_attempt_at` | timestamptz | backoff exponencial; o worker só pega o que já venceu |
| `last_error` | text | **sanitizado** — a função `sanitizeError` já existe |
| `external_id` | text | linha do Sheets, ou identificador devolvido pelo CREARE |
| `payload_version` | int | versão do produto que gerou este evento (ver §4) |
| `created_at` / `updated_at` / `synced_at` | timestamptz | |

`processing` + `next_attempt_at` é o que a `product_sheet_sync` atual não tem, e
é o que permite retry automático sem duas instâncias disputando o mesmo produto.

---

## 4. Versionamento do produto

**Problema:** com retry e fila, um evento antigo pode ser publicado depois de uma
edição mais nova e sobrescrever o dado correto.

**Proposta:** `products.version`, inteiro monotônico, incrementado a cada
alteração. O evento carrega `payload_version`. Antes de publicar, o worker
compara:

```
se payload_version < products.version  ->  descarta o evento (já é obsoleto)
```

`updatedAt` sozinho não basta: dois updates no mesmo milissegundo são
indistinguíveis, e relógio de servidor não é confiável para ordenação.

---

## 5. Mapeamento dos campos que já existem

Todos já presentes em `products` e tabelas 1:1/1:N — nenhum campo novo é
necessário para o Sheets.

| Bloco | Campos |
|---|---|
| **Identidade** | `nome`, `quantidade`, `medidaBase`, `codigoBarras`, `marca`, `embalagem`, `cDe`, `qtCad`, `medidaCompra`, `codigoInterno`, `grupo`, `tipo`, `status` |
| **Comercial** | `custo`, `margemPontual`, `vVendaPontual`, `auto` |
| **Estoque** | `estoqueMin`, `estoqueMax`, `setorEstoque` |
| **Venda** | `localVenda1`, `localVenda2` |
| **Transformação** | `precisao`, `qtd`, `unidade`, `produtoReceituario`, `refReceituario` |
| **Fiscal** | `ncm`, `cest`, `categoria`, `cstPisCofins`, `aliquotaCheia`, `aliquotaFcp`, `aliquotaPis`, `aliquotaCofins`, `reducaoIcms`, `icms` |
| **Promoção** | `tipo`, `valor`, `descontoPct`, `horaInicio`, `horaFim`, `dias[7]`, `descontoAte` |
| **Foto** | `fotoUrl` |

O mapeamento coluna a coluna para o Sheets está em
`docs/integracao-google-sheets.md`.

---

## 6. Lacunas confirmadas

Cada uma é uma decisão pendente, não um detalhe de implementação.

### 6.1 Lojas de destino estão hardcoded

A coluna D recebe `GOOGLE_SHEETS_DEFAULT_LOJAS` (`TNP,LI,HORA`) para **todo**
produto. Não há como cadastrar um produto que valha só para uma loja.

**Precisa:** seleção de lojas no formulário e persistência por produto. Impacta
diretamente o CREARE, onde loja provavelmente é empresa/filial distinta.

### 6.2 `localVenda1/2` existem mas o formulário envia `null`

`ProductForm.vue` fixa `localVenda1: null, localVenda2: null`. As colunas AQ/AS
são gravadas vazias sempre, embora a planilha tenha validação com a lista
`PATRIMONIO` e 4 das 150 linhas usem o campo.

**Precisa:** decidir se entra no formulário (com dropdown da lista de patrimônio)
ou se é campo de outra tela.

### 6.3 Uma promoção no Sheets, várias no banco

O banco aceita 0..N promoções; a planilha tem um único bloco por linha. Hoje
espelhamos **a primeira**.

**Precisa:** confirmar se uma promoção por produto é a regra de negócio real. Se
for, o banco deveria restringir; se não, o Sheets perde informação silenciosamente.

### 6.4 Foto: URL Cloudinary × caminho interno AppSheet

As linhas existentes têm caminho interno do AppSheet
(`(BASE) CADASTRO PRODUTOS_Images/…`); gravamos URL do Cloudinary. Conteúdos
diferentes na mesma coluna CO.

**Precisa:** decidir o formato canônico e o que fazer com o legado.

### 6.5 Campos e identificadores CREARE desconhecidos

Ver §8. Nada pode ser especificado antes disso.

### 6.6 Criação, edição e inativação precisam de eventos separados

Hoje só a **criação** gera sincronização. Editar um produto não atualiza a
planilha; inativar, idem. A partir da primeira edição os dois lados divergem.

**Precisa:** três tipos de evento (`create`, `update`, `deactivate`), cada um com
seu comportamento por destino — no Sheets, `update` reescreve a linha achada por
CP; `deactivate` provavelmente muda a coluna C para `INATIVO` em vez de apagar.

---

## 7. Esboço de `product_creare_sync`

**Proposta. Não criar tabela nem migration antes da descoberta da §8** — os
campos dependem do contrato real do CREARE.

```
product_creare_sync
  product_id        FK products, parte da PK
  empresa_loja      text, parte da PK        -- código da empresa/filial no CREARE
  operacao          text                     -- create | update | deactivate
  external_id       text                     -- id devolvido pelo CREARE
  payload_version   int                      -- ver §4
  status            text                     -- pending|processing|synced|failed
  attempts          int
  next_attempt_at   timestamptz
  last_error        text                     -- sanitizado
  created_at / updated_at / synced_at
  PRIMARY KEY (product_id, empresa_loja)
```

Chave composta por produto **e** empresa/loja: o mesmo produto pode estar `synced`
na TNP e `failed` na LI, e os dois estados precisam coexistir.

---

## 8. Descoberta obrigatória do CREARE

> **Nada aqui pode ser suposto.** Não há documentação técnica do CREARE no
> workspace. Sem as respostas abaixo, qualquer especificação de integração seria
> ficção.

### 8.1 Identificação do sistema

- [ ] Nome completo do produto e do **fornecedor**
- [ ] **Versão** em uso nas lojas
- [ ] URL de acesso, ou prints das telas de cadastro de produto que identifiquem
      o sistema

### 8.2 Contrato de integração

- [ ] Manual oficial de **API** ou do **importador** de arquivos
- [ ] **Exemplo oficial** de payload: CSV, XLSX, XML ou JSON — de preferência a
      exportação de um produto já cadastrado corretamente
- [ ] Existe ambiente de **sandbox/homologação**? Como obter acesso?
- [ ] Autenticação: tipo, onde as credenciais são emitidas, política de rotação

### 8.3 Domínio

- [ ] **Códigos das empresas/lojas** TNP, LI e HORA dentro do CREARE
- [ ] Regras de **criação**, **alteração** e **inativação** de produto
- [ ] Como o CREARE trata **reenvio** do mesmo produto (idempotência): existe
      chave externa? Ele rejeita duplicado ou cria outro registro?
- [ ] Formato de **retorno de erro** — como distinguir erro definitivo (payload
      inválido) de transitório (indisponibilidade), que é o que decide se vale
      retry
- [ ] Lista de **campos fiscais obrigatórios** e suas validações
- [ ] Como o CREARE identifica o produto: código interno, EAN, código próprio?

### 8.4 Contato

- [ ] **Contato técnico do fornecedor** (nome, e-mail, telefone) e canal de
      suporte para integração

### 8.5 Ordem de preferência técnica

1. **REST oficial** — preferido
2. **SOAP oficial**
3. **Importador oficial de arquivos** (CSV/XLSX/XML) — aceitável, mas exige
   definir onde o arquivo é depositado e como o resultado é lido

**Escrita direta em Firebird — ou em qualquer banco do CREARE — está proibida**
sem, cumulativamente: schema documentado, procedures oficiais, regras
transacionais, versão suportada, **autorização formal do fornecedor** e ambiente
de homologação. Gravar direto no banco de um ERP de terceiro quebra as
validações dele, corrompe dados de forma silenciosa e elimina qualquer suporte.

---

## 9. Sequência recomendada de implementação

Cada etapa entrega valor sozinha e pode parar sem quebrar as anteriores.

| # | Etapa | Depende de |
|---|---|---|
| 1 | Concluir a homologação Sheets (criação) | credenciais + planilha confirmada |
| 2 | Eventos de `update` e `deactivate` para o Sheets | §6.6 |
| 3 | Worker de outbox com retry e backoff | §3 |
| 4 | `products.version` e descarte de evento obsoleto | §4 |
| 5 | Seleção de lojas de destino | §6.1 |
| 6 | **Descoberta CREARE** | §8 — **bloqueia tudo abaixo** |
| 7 | `product_creare_sync` + migration | 6 |
| 8 | Adaptador CREARE em sandbox | 6, 7 |
| 9 | Homologação CREARE | 8 |
| 10 | Produção gradual | 9 |

### Feature flags independentes

```
GOOGLE_SHEETS_ENABLED=false      # já existe
CREARE_ENABLED=false             # proposto
```

Uma flag por destino, avaliadas separadamente. Desligar o CREARE não pode afetar
o Sheets, e vice-versa. Ligar em uma loja de cada vez deve ser possível.

---

## 10. O que este documento NÃO decide

- Não altera schema, não cria migration, não implementa adaptador.
- Não define contrato do CREARE — isso depende da §8.
- Não decide as lacunas da §6; elas precisam de decisão de negócio.
