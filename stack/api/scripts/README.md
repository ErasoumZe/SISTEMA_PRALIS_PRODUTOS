# Robô planilha para TXT Criare

Esta pasta concentra a implementação local solicitada e também recebe os TXT
gerados. Ela usa as dependências e as credenciais existentes em
`pralis/stack/api`, mas não grava nenhum arquivo fora desta pasta.

## Arquivos

- `ROBO-CREARE-PLANILHA.ps1`: comando de entrada;
- `creare-planilha-bot.ts`: leitura da planilha, validação, hash e geração;
- `creare-planilha.config.json`: lojas, de-paras, casas decimais e destino;
- `.creare-planilha-state.json`: estado local do último registro exportado;
- `ultimo-diagnostico.json`: resultado da última leitura;
- `creare-<loja>-<data>.txt`: arquivos produzidos quando houver produto completo
  novo ou alterado.

## Executar

Abra o PowerShell nesta pasta:

```powershell
# uma leitura
.\ROBO-CREARE-PLANILHA.ps1 -UmaVez

# leitura contínua a cada 60 segundos
.\ROBO-CREARE-PLANILHA.ps1

# verificar e forçar uma nova versão de um produto completo
.\ROBO-CREARE-PLANILHA.ps1 -UmaVez -Produto 'FAROFA TRADICIONAL YOKI' -Forcar
```

`-Forcar` não ignora validação. Produto sem NCM, alíquota ECF, grupo ou
categoria continua bloqueado e aparece em `ultimo-diagnostico.json`.

## Fontes fiscais

O robô resolve os campos nesta ordem, sempre por EAN exato antes de qualquer
regra mais ampla:

1. campos já preenchidos na linha do produto;
2. de-para por produto e regra do grupo da aba `(TNP) FISCAL - DE PARA PRODUTOS`;
3. cadastro fiscal legado da planilha `1itKr_GIBE7u0xCpsfM3YtzhaIFqhpVnC4pGFSj0B2nA`;
4. exceção documentada por EAN em `productOverrides`.

O código numérico do grupo também pode ser aprendido pelo cruzamento de EANs
entre as duas planilhas, mas somente quando todos os produtos encontrados para
aquele grupo concordam. Se houver divergência, o TXT é bloqueado.

A farofa Yoki (`7891095911486`) está registrada como exceção porque é produto
novo e não existe no cadastro legado: NCM `19019090`, CEST `1704600`, ECF `10`,
grupo `0010` e categoria `000000005`. A origem fica escrita no JSON de
configuração para auditoria.
