# Auditoria de 08/09/2026 — estado de cada achado

Fonte única do andamento. Atualizado em **09/09/2026**, na branch
`auditoria/v1-2026-09-09`.

Os estados são separados de propósito, porque foram confundidos antes:

| estado | significa |
|---|---|
| **implementado** | o código existe |
| **testado** | tem teste automático, com fase vermelha conferida |
| **mergeado** | está na `main` |
| **publicado** | o Coolify subiu (a `main` é produção) |
| **homologado** | alguém conferiu o efeito real, no sistema de destino |
| **bloqueado** | depende de decisão, dado ou acesso que não tenho |

Nada nesta branch está publicado nem homologado enquanto o PR não for mergeado
e o efeito conferido.

---

## Defeitos funcionais (F01–F04)

### F01 — a margem do grupo era removida pela API
**implementado + testado.** `ruleSchema` não declarava `margemPadrao`, e o
serializador do Zod remove tudo que não está no schema: o campo morria entre o
serviço e a tela, sem erro nenhum.

Isto reescreve um diagnóstico meu anterior. Eu havia dito que a margem por grupo
estava inerte por causa da aba `GRUPOS/REF.` com `#REF!`. A aba é um problema
real, mas **não era a causa**: mesmo com a aba sã, a margem não chegaria à tela.

Primeiro teste de contrato do projeto (Fastify inject), porque teste de serviço
isolado nunca pegaria um defeito que mora na costura.

### F02 — zero, ausência e margem herdada eram a mesma coisa
**implementado + testado.** Era circular: `null` carregava como `0` e `0` salvava
como `null`. Não havia como dizer "sem margem própria" nem "margem zero" — e isso
muda preço: ausência herda a margem do grupo, zero manda vender pelo custo.

Agora `margemPctParaFracao` / `fracaoParaMargemPct` no `@pralis/shared`, com teste
que prova a diferença no preço final (R$ 10,00 contra R$ 15,00).

O card passava `margemGrupo: 0` fixo: produto que herda a margem aparecia na lista
pelo custo e, ao abrir, com outro número. Duas telas, dois preços, o mesmo produto.

### F03 — o aviso de código de barras repetido não achava o repetido
**implementado + testado.** O formulário buscava com `q`, que procura nome, marca
e código do sistema — nunca código de barras.

Junto, um defeito vizinho que **anulava o F01 e o F02 na prática**:
`selectedTaxRule` casava grupo por texto exato, e os nomes carregam `U+2060`
invisível. O grupo aparecia escolhido e a margem dele nunca era encontrada.

### F04 — a falha do espelho de loja ficava invisível
**implementado + testado, parcial.** O resultado agora viaja em `details` e
aparece na tela, sem transformar falha de destino externo em erro de cadastro —
o produto **está** salvo.

**O que falta é o F12:** ainda não há fila persistente por destino nem reenvio
idempotente. Hoje a falha é visível, mas o reenvio é manual.

---

## Central de Produtos (F05–F08) — **bloqueado**

Não são defeitos de código, são decisões de negócio. Implementar por conta
própria significaria inventar regra fiscal e comercial.

| | o que falta decidir |
|---|---|
| F05 | catálogo canônico e de-para entre grupo comercial, grupo do SIA e chave fiscal |
| F06 | o que fazer com produto sem embalagem/gramatura: rascunho, inativo ou fora do lote |
| F07 | custo e preço do snapshot Compilart TNP valem para a Lisboa? |
| F08 | significado de cada CST/alíquota, e o fiscal faltante da TNP (contabilidade) |

Enquanto isso, vale o que a auditoria escreveu: **a quantidade de elegíveis não é
selo de prontidão fiscal.**

---

## Banco e consistência (F09–F12)

### F09 — código interno sob concorrência
**implementado + testado.** `MAX + 1` fora da transação: duas criações
simultâneas recebiam o mesmo número — e é por ele que o SIA casa o produto.
Agora a geração é transacional, com `pg_advisory_xact_lock`.

Fase vermelha conferida em duas etapas (geração fora da transação, e depois só
sem a trava): nos dois casos as 4 criações paralelas recebem o mesmo código.

Trava de aviso em vez de `sequence` porque não exige mudança de schema — o
`start:prod` ainda roda `drizzle-kit push --force`, e trocar isso é a fase 8.

### F10 — identidade não garantida pelo banco
**bloqueado, e de propósito.** Índice único exige limpeza real antes: subir a
restrição com duplicata existente **derruba o deploy**, porque o `push --force`
roda no boot. A ordem é auditoria → correção dos dados → validação → constraint.

### F11 — edições concorrentes podem se perder
**não iniciado.** Precisa de coluna de versão e de uma regra explícita para
"sobrescrita intencional igual ao padrão" na herança BASE→loja. Não é pequeno.

### F12 — operações parciais entre banco, lojas e planilha
**não iniciado.** É o outbox. É o que fecha o F04 de verdade.

---

## Segurança

**implementado + testado:** segredo padrão/fraco impede o boot em produção;
código de verificação passou a usar gerador criptográfico; reset de senha
derruba as sessões abertas; 5xx não devolve mais a mensagem interna.

**bloqueado, dependem de você:**

1. **Entrada de usuários.** Hoje qualquer pessoa se cadastra, escolhe a loja e
   ativa por e-mail. Ter um e-mail não prova vínculo com a loja. Convite,
   domínio permitido ou aprovação do admin?
2. **Limite de tentativas** por IP e por conta em login/reset — precisa decidir
   os números e se entra na API ou no proxy.
3. **Swagger público** em produção: restringir ou manter?
4. **Coolify em HTTP.** O painel administrativo devia estar em HTTPS e com
   acesso restrito por rede.

---

## Operação

**implementado:** CI (não havia nenhum) rodando tipos, testes, integração, build
e validação do Compose antes do merge. `/health` passou a dizer qual commit está
no ar — antes não havia como saber. `/health/pronto` separa readiness de
liveness.

**não iniciado:** tirar o `drizzle-kit push --force` do boot e trocar por
migração explícita com lock, backup e rollback. É a mudança mais arriscada da
lista e merece PR próprio.

---

## As dez decisões que só você pode tomar

Estão na auditoria e continuam de pé. As três que destravam mais coisa:

1. **Margens oficiais dos 73 grupos** — e se o antigo padrão de 70% volta ou não.
2. **Catálogo canônico de grupos** — sem ele, F05 a F08 ficam parados.
3. **Custo e preço por loja** — se o snapshot da TNP vale para a Lisboa.
