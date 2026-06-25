# Backlog — Sistema de Cadastro de Produtos (Pralis)

> Origem: reunião de alinhamento (migração planilha/AppSheet → sistema próprio).
> Rede com lojas **TNP**, **Lisboa (LI)** e **Oro/Hora (HORA)**.
> A **planilha é a fonte da verdade** dos cálculos; mudança de fórmula lá precisa refletir aqui.
> Stack atual: Postgres/Drizzle + Fastify + Nuxt/Vuetify (NÃO é Firebird — o Firebird/Compilarte/Cia é o ERP legado, fonte de fiscal/custo no futuro).

## Status (o que já existe no sistema hoje)
- ✅ Base geral + catálogo por loja; importar da base (PROC-03 parcial).
- ✅ Login vinculado à loja; admin sem loja (cadastra na Base por padrão, escolhe catálogo).
- ✅ Sem campo "loja" no formulário (UX-03 parcial).
- ✅ Dashboard admin com contadores (UX-08): total produtos, lojas, ativas.
- ✅ Filtro ativo/inativo + paginação na base (UX-07 parcial).
- ✅ Admin excluir usuário; recuperação de senha por e-mail.
- ✅ Cálculo de valor de venda parece correto (validado na reunião) — falta BUG-01 (exibição no card).

---

## 1. Bugs
- **BUG-01** — Card inicial mostra `valor_venda_pontual` quando deveria mostrar `valor_venda_calculado` (quando flag "cálculo automático = sim"). Detalhe = calculado; auto desligado = pontual.
- **BUG-02** — Input de margem ambíguo: "0,7" vira 0,7% em vez de 70%. Normalizar/validar (faixa 0–1000%).

## 2. UX / Frontend
- **UX-01** — Unificar Revenda × Transformação num **seletor único**; troca os campos abaixo conforme o tipo.
- **UX-02** — Mover campos **do produto** (estoque mín/máx, setor de estoque, custo, margem) pra fora da seção exclusiva de revenda → aparecem em revenda E transformação. Exclusivo: grupo de transformação só em transformação.
- **UX-03** — Bloco inicial unificado (cadastro inicial + geral viram um só): foto, código de barras (abaixo da foto), marca, nome, quantidade, status. Sem campo loja.
- **UX-04** — Campo **"Como se compra"** (concatenação): embalagem (saco/pacote/com) + qtd da embalagem + medida + descrição automática. Texto informativo, não referencia tabela.
- **UX-05** — Reordenar: cadastro geral → revenda/transformação → **Fiscal** → (Promoção por último, separada).
- **UX-06** — **Tela de Promoção separada** (gerente): filtra produto, ativa promoção com horário início/fim, dia da semana, desconto valor fixo OU "até X%" (etiquetas 10/20/30/40/50%).
- **UX-07** — Filtros na base (manter visão **card**): ativo/inativo ✅, revenda/transformação, grupo (conforme tipo), local de venda, setor (primário/secundário). Fiscal não precisa.
- **UX-08** — Dashboard admin ✅ (contadores). Loja conta como ativa só se tiver produto.

## 3. Modelagem de banco
- **DB-01** — Tabela de **marcas**; salvar marca nova; campo vira dropdown reutilizável.
- **DB-02** — Tabela de **grupos de mercadoria** (flag revenda/transformação), populada com os grupos já definidos (das validações da planilha). Campo = dropdown. Deixar **oculto/preparado** o "adicionar grupo".
- **DB-03** — **Descrição automática** = nome + gramatura (peso + tipo). Regra de ocultar o "1" de "1 kg" em fabricação própria vendida por quilo. ⚠️ Depende da fórmula da planilha — confirmar critérios.
- **DB-04** — **Código interno** automático, sequencial, **sem dígito** (00001...). Mesmo código entre lojas (base única).
- **DB-05** — **Custo** manual e não obrigatório agora; preparar/oculto para buscar último custo da base de discriminação no futuro.
- **DB-06** — **Margem** default 70%, validação 0–1000% (ver BUG-02).
- **DB-07** — **Setor de estoque** também em transformação (produção).
- **DB-08** — Remover coluna/campo **"referência do receituário"** (campo morto). *(Obs: no sistema atual é `refReceituario` em transformação.)*

## 4. Regras de negócio / cálculos
- **CALC-01** — Valor de venda = `(custo da caixa ÷ qtd da caixa) + margem (70%)`. Ex.: 84,90 ÷ 30 → 2,83 → +70% → ~4,81. (Alimenta `valor_venda_calculado`; ver BUG-01.)
- **CALC-02** — Transformação também calcula valor de venda (pra compor custo de produção).
- **CALC-03** — Fracionamento por peso (balança) = **produto único**: cadastra preço/kg, PDV fatora pelo peso. (Depende de PDV/balança — fora do app de cadastro.)

## 5. Governança / processo
- **PROC-01** — Recomendação: só **admin** cadastra na base geral; lojas só importam (mantém códigos sincronizados). Decisão de negócio em aberto.
- **PROC-02** — Sincronização de códigos entre lojas (migração): casar códigos existentes; criar "inativo 01/02..." na loja com menos itens pra alinhar numeração. Tarefa pontual/manual.
- **PROC-03** — Importar da base geral pra loja: tudo OU só os novos. Admin pode excluir. (Importar ✅; "só os novos" pendente.)

## 6. Ordem sugerida (dependências)
1. Definir o **mix/base de produtos** (input 12 meses, cruzar caixa + Compilarte/Cia). Bloqueia fiscal, custo automático e discriminação.
2. **Modelagem** (marcas, grupos, código interno, descrição automática).
3. **UX de cadastro** (bloco unificado, seletor revenda/transformação, campos comuns, "como se compra").
4. **Cálculos** + correção dos bugs.
5. **Promoção** e **Fiscal** (dependem da base pronta).
6. **Governança/migração**.

## ⚠️ Pontos a confirmar antes de codar
1. Critérios exatos da regra de ocultar "1 kg" na descrição (DB-03) — depende da fórmula atual da planilha.
2. Governança: cadastro só na base geral (recomendado) vs. por loja — muda PROC-01 e a estratégia de código interno (DB-04).
3. Lista oficial dos grupos de mercadoria (revenda e transformação) pra popular DB-02.
