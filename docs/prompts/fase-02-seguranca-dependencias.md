# Fase 02 — Segurança das dependências

```text
Faça uma atualização controlada das dependências vulneráveis do monorepo, sem usar `npm audit fix --force` cegamente e sem misturar mudanças funcionais.

Contexto da auditoria anterior: havia alertas envolvendo Nuxt, Drizzle ORM, @fastify/static/find-my-way, googleapis/uuid, nanoid, postcss, shell-quote, tar, fast-uri, esbuild, brace-expansion e svgo. Refaça a auditoria porque o lockfile pode ter mudado.

Procedimento:
1. Leia o baseline e confirme que a Fase 01 foi aprovada.
2. Execute auditoria normal e `--omit=dev`. Separe vulnerabilidades de runtime, build e desenvolvimento; identifique caminho da dependência e advisory.
3. Priorize correções críticas/altas alcançáveis em runtime. Atualize uma família por vez, respeitando compatibilidade entre Nuxt/Vue/Vuetify/Fastify/Drizzle/googleapis.
4. Consulte changelogs/documentação oficial quando houver salto de major. Adapte código somente quando necessário para compatibilidade e explique a mudança.
5. Não aplique overrides que produzam combinações sem suporte. Não esconda advisories ignorando-os.
6. Depois de cada grupo relevante, rode testes e typecheck. Ao final, rode toda a suíte, build PWA e `git diff --check`.
7. Gere `docs/auditoria-dependencias.md` com antes/depois, vulnerabilidades restantes, exposição real, justificativa e plano para o que não puder ser corrigido agora.

Restrições:
- Preserve o comportamento da integração Sheets.
- Não faça deploy, commit ou push.
- Não altere credenciais.

Critério de saída:
- Zero vulnerabilidade crítica/alta de runtime, ou bloqueio documentado com mitigação concreta e decisão humana requerida.
- Testes, typecheck e build aprovados.

Finalize com arquivos alterados, tabela antes/depois, comandos/resultados e `APROVADO PARA FASE 03` ou `BLOQUEADO`.
```
