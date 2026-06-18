# Visão Geral do Sistema Pralis — como funciona e como foi feito

Documento de referência: explica **o que é o sistema**, **como cada parte funciona** e
**como foi construído**, em linguagem acessível.

---

## 1. O que é

Um sistema web para **cadastrar os produtos da padaria Pralis** — substituindo a antiga planilha
do Google. Tem **login**, uma **galeria de produtos** e um **formulário de cadastro** (com dados
de loja, revenda/transformação, promoção e fiscal). Roda **em produção na nuvem**:

- **App (front):** https://produtos.cicluzieai.com.br
- **API (back):** https://api-produtos.cicluzieai.com.br (documentação em `/docs`)

---

## 2. Arquitetura (a visão de cima)

São **3 peças** que conversam entre si + **1 peça compartilhada**:

```
┌──────────────┐    HTTP (fetch)   ┌──────────────┐   SQL    ┌────────────┐
│   FRONT      │  ───────────────▶ │     API      │ ───────▶ │  BANCO     │
│ Nuxt+Vuetify │  ◀─────────────── │   Fastify    │ ◀─────── │ PostgreSQL │
│ (navegador)  │     JSON          │  (servidor)  │          │            │
└──────────────┘                   └──────────────┘          └────────────┘
        │                                  │
        └──────────┬───────────────────────┘
                   ▼
         ┌─────────────────────┐
         │   SHARED            │  contratos (Zod) + regras de negócio
         │  (usado pelos dois) │  → front e API "falam a mesma língua"
         └─────────────────────┘
```

- O **front** é o que o usuário vê (telas). Ele não tem dados — ele **pede** tudo pra API.
- A **API** é o cérebro: recebe pedidos, valida, aplica regras, fala com o banco.
- O **banco** guarda os dados de verdade (produtos, usuários).
- O **shared** é a "lei" comum: os **formatos dos dados** (contratos) e as **regras** (ex.: como
  calcular preço) ficam num lugar só, então front e API nunca divergem.

Tudo isso vive num **monorepo** (um repositório só, com as 3 partes em `stack/`).

---

## 3. Cada parte, por dentro

### 3.1. `stack/shared` — o contrato + as regras
A fonte única da verdade. Escrito com **Zod** (biblioteca que descreve e valida formatos de dados).

- `product.schemas.ts` / `product.enums.ts` — descrevem o que é um "produto" (campos, tipos,
  valores possíveis de medida/embalagem etc.).
- `product.requests.ts` / `product.replies.ts` — o formato do que **entra** e **sai** da API.
- `product.rules.ts` — as **regras de negócio puras** (funções):
  - `montarDescricao` (nome + qtd + medida)
  - `calcularVVenda` (custo ÷ qt × margem)
  - `calcularVVendaFinal` (aplica promoção por dia/horário)
  - etc.
  Essas regras vieram da **engenharia reversa das fórmulas da planilha** e têm **testes** que
  conferem cada cálculo (`product.rules.test.ts`).

> 💡 Por que isso é poderoso: o front usa essas mesmas funções pro **preview ao vivo** (você vê o
> preço enquanto digita), e a API usa pra **validar/gravar**. Mesma regra, dois lugares, sem cópia.

### 3.2. `stack/api` — o servidor (Fastify + TypeScript)
Organizado por **módulos** (cada funcionalidade na sua pasta). Cada módulo tem o mesmo padrão:

```
modules/product/
├─ product.table.ts       # a "planta" das tabelas no banco (Drizzle)
├─ product.repository.ts  # quem fala com o banco (SELECT/INSERT/UPDATE/DELETE)
├─ product.service.ts     # as regras/decisões (ex.: gerar código, validar)
├─ product.controller.ts  # recebe o pedido HTTP e responde
└─ product.routes.ts      # define os endereços (GET /products, POST /products...)
```

**Como um pedido flui** (ex.: criar produto):
1. O front faz `POST /products` com o JSON do produto.
2. A **rota** confere se você está logado (middleware) e valida o corpo com o **schema Zod**.
3. O **controller** chama o **service**.
4. O **service** gera o código (`PR-XXXX`), e manda o **repository** gravar.
5. O **repository** insere no **Postgres** (produto + loja + fiscal numa transação).
6. Volta o produto criado → vira JSON → front recebe.

Tecnologias-chave da API:
- **Fastify** — o servidor web (rápido e moderno).
- **Drizzle ORM** — traduz TypeScript ↔ SQL (você escreve código, ele gera as queries).
- **PostgreSQL** — o banco de dados.
- **tsyringe** — "injeção de dependência" (monta as peças do módulo automaticamente).
- **Swagger** — gera a documentação da API sozinho (em `/docs`).

### 3.3. `stack/pwa` — o front (Nuxt 4 + Vuetify)
O que o usuário vê. **Vuetify** = biblioteca de componentes visuais prontos (botões, campos, cards).

```
app/
├─ app.vue                    # a "moldura" (barra do topo, nome do usuário)
├─ pages/
│  ├─ login.vue              # tela de login/registro
│  ├─ index.vue              # galeria de produtos (cards)
│  └─ produtos/novo.vue + [id].vue   # cadastrar / editar
├─ components/ProductForm.vue # o formulário (página única: Inicial, Geral, Destino, Fiscal...)
├─ composables/
│  ├─ useApi.ts              # funções que chamam a API (list, save, delete, upload)
│  └─ useAuth.ts             # estado de login (quem está logado, entrar, sair)
└─ middleware/auth.global.ts  # "guarda": se não está logado, manda pro /login
```

Detalhe legal: o formulário importa as **regras do `shared`** e mostra a descrição e o preço
**em tempo real** enquanto você digita.

### 3.4. O banco (PostgreSQL + Drizzle)
As tabelas (definidas nos `*.table.ts`):
- `products` (identidade do produto) · `product_lojas` (dados por loja) ·
  `product_transformacao` · `product_fiscal` · `promocoes`
- `users` · `sessions` (login)
- `grupos_mercadoria` · `locais_venda` · `setores` (apoio)

O Drizzle gera **migrations** (arquivos SQL) que criam essas tabelas. Na nuvem, a API aplica isso
sozinha ao subir.

---

## 4. Segurança (como o sistema se protege)

- 🔑 **Senhas** guardadas com **argon2** (hash forte — nem nós vemos a senha real).
- 🍪 **Login por cookie httpOnly + secure** — o "crachá" não pode ser lido/roubado por JavaScript.
- 🛡️ **Helmet** — cabeçalhos de segurança no navegador.
- 🚧 **CORS travado** — só o domínio do front pode chamar a API.
- ✅ **Validação Zod** — todo dado que entra é conferido (nada passa malformado).
- 🔒 **HTTPS** — conexão criptografada (falta só o certificado "verde" confiável — próximo passo).

*(Pendências de hardening: certificado Let's Encrypt confiável, rate-limit anti-força-bruta,
e opcionalmente o WAF do Cloudflare.)*

---

## 5. Como foi construído (a jornada)

1. **Engenharia reversa da planilha** — entendemos os campos, fluxos e fórmulas do cadastro atual.
2. **Documentação** — viramos isso em specs (dicionário de dados, regras, tabelas de apoio).
3. **Protótipo** — uma tela HTML + Google Sheets pra validar a ideia (descartado depois).
4. **Sistema de verdade**, no mesmo stack seguro da Cicluz, em fases:
   - Contrato + schema (`shared` + tabelas Drizzle)
   - Regras de negócio em TypeScript **+ testes**
   - API (Fastify) com CRUD + Swagger
   - Banco PostgreSQL (Docker) + testes de integração (Testcontainers)
   - Front (Nuxt + Vuetify)
   - Autenticação, Promoção/Fiscal, Foto (Cloudinary)
   - **Deploy em produção** (Docker + Coolify + Cloudflare)

---

## 6. Como roda em produção (deploy)

- O código vive no **GitHub** (`SISTEMA_PRALIS`).
- O **Coolify** (painel no servidor da Cicluz) pega o `docker-compose.coolify.yaml`, **builda** as
  imagens (API e front) e sobe os 3 containers (Postgres + API + PWA), **isolados** da Cicluz.
- O **Cloudflare** cuida do DNS (os domínios `produtos` e `api-produtos` apontam pro servidor).
- 🔄 **Deploy automático:** todo `git push` na branch `main` faz o Coolify **atualizar sozinho**.

> Detalhes em [COMO-RODAR.md](COMO-RODAR.md) (local) e [COMO-DEPLOYAR.md](COMO-DEPLOYAR.md) (produção).

---

## 7. Resumo de uma frase
Um cadastro de produtos web, **seguro e testado**, onde o **front (Nuxt)** conversa com uma
**API (Fastify)** que guarda tudo num **Postgres**, com **regras e contratos compartilhados** entre
os dois — rodando **em produção** via Docker/Coolify, atualizando a cada `git push`.
