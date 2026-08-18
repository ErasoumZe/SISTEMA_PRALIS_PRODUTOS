# Fase 08 — Descoberta técnica do CREARE

```text
Descubra e especifique o canal oficial de integração com o sistema CREARE antes de escrever o adaptador. Não confunda empresas/produtos homônimos e não tente escrever diretamente no banco legado.

Solicite ou localize com o usuário:
- Nome completo do fornecedor/produto, versão, URL/telas e contato técnico.
- Manual oficial de API/importação e exemplo de exportação de um produto.
- Ambiente sandbox/homologação e credenciais de menor privilégio.
- Empresas/lojas/códigos de filial, tabelas fiscais, unidades e regras obrigatórias.
- Como o CREARE identifica criação, alteração, inativação e erro.

Avalie nesta ordem:
1. REST API oficial.
2. SOAP oficial.
3. Importador oficial CSV/XLSX/XML.
4. Pasta monitorada/SFTP/conector homologado pelo fornecedor.
5. Outro mecanismo formalmente documentado.

Escrita direta em Firebird ou outro banco só pode ser considerada se o fornecedor fornecer schema, procedures, regras transacionais, versão suportada, autorização escrita e ambiente de homologação. Sem isso, classifique como proibida/alto risco.

Produza `docs/descoberta-integracao-creare.md` contendo:
- Identificação inequívoca do sistema e versão.
- Opções suportadas com fontes oficiais anexadas/referenciadas.
- Autenticação, endpoints/layout, limites, timeout, idempotência e erros.
- Mapeamento preliminar baseado no dicionário da Fase 07.
- Campos obrigatórios ausentes e decisões pendentes.
- Regras multiempresa/loja e fiscais.
- Estratégia de homologação, reconciliação e rollback.
- Recomendação `GO/NO-GO` para um mecanismo específico.

Não implemente o adaptador, não use dados reais de clientes em testes e não altere CREARE/Firebird/produção.

Se não houver documentação ou acesso suficientes, pare e entregue um pacote objetivo de perguntas para o fornecedor. Não invente API, campos ou tabelas.

Critério de saída: interface oficial escolhida, sandbox disponível, layout autenticado e mapeamento aprovado. Declare `APROVADO PARA FASE 09` ou `BLOQUEADO`.
```
