/**
 * exportar-depara-sia.cjs
 * =====================================================================
 * Le o banco do SIA da loja e gera o CSV do DE-PARA ja com os nomes de
 * coluna que o importador do Pralis espera:
 *
 *     npm run creare:depara -- depara-<loja>.csv --loja TNP
 *
 * POR QUE ELE EXISTE
 *
 * O `descobrir-bdsia.js` do robo de vendas ja le esse banco, mas exporta
 * com os nomes CRUS da tabela -- `codbarra`, `aliquotasaida`, `aliquota`
 * -- e nao traz `csosn`. O importador do Pralis procura por `CODBARRAS`,
 * `ALIQSAIDA`, `ALIQINTERNA` e `CSOSNEMPRESA`, e recusa o arquivo inteiro
 * quando falta coluna. Este script faz a traducao, para ninguem ter de
 * renomear coluna na mao -- que e o tipo de passo que erra em silencio.
 *
 * POR QUE O DE-PARA IMPORTA
 *
 * O importador do Criare decide entre ATUALIZAR e INSERIR pelo CODITEM.
 * Sem o de-para da loja, todo produto que o Pralis mandar entra como NOVO
 * e duplica o catalogo. Foi o que aconteceu na TNP em 16/09/2026, as
 * 17:30 e 17:47: dois `INSERIDO na tabela PRODUTO`.
 *
 * SOMENTE LEITURA. So SELECT e information_schema. Nada e escrito,
 * alterado ou apagado -- nem no SIA, nem no Compilart.
 *
 * COMO USAR (na maquina da loja, que ja tem Node e o `mysql2` do robo):
 *
 *   1. copie este arquivo para a pasta do robo de vendas, a mesma do
 *      `index.js` -- e de la que o `mysql2` e encontrado;
 *   2. rode:
 *
 *        node exportar-depara-sia.cjs --loja TNP
 *        node exportar-depara-sia.cjs --loja TNP --host 192.168.0.10 --banco bdsia
 *
 * A senha e perguntada na hora e nao vai para arquivo, log nem tela. Ela
 * esta no `sia.ini`, nas chaves `dbusername` / `password`.
 *
 * Gera: depara-<loja>.csv -- e so esse arquivo que precisa ser enviado.
 *
 * A extensao e `.cjs` de proposito: o `package.json` da raiz do Pralis
 * declara `"type": "module"`, e um `.js` ali viraria ESM e quebraria no
 * `require`. Com `.cjs` o arquivo roda igual nos dois lugares.
 * =====================================================================
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');

/**
 * O `mysql2` e carregado SO na hora de conectar, e nao no topo.
 *
 * Ele nao existe na pasta do Pralis: quem o instala e o robo de vendas.
 * Carregando no topo, rodar este script no lugar errado cuspia um stack
 * trace de MODULE_NOT_FOUND antes mesmo de conferir os argumentos -- e a
 * pessoa nao ficava sabendo o que fazer. Assim ela le a instrucao.
 */
function carregarMysql() {
  try {
    return require('mysql2/promise');
  } catch {
    console.error('');
    console.error('Nao achei o modulo "mysql2" a partir desta pasta.');
    console.error('Copie este arquivo para a pasta do robo de vendas (a mesma do');
    console.error('index.js) e rode de la -- e onde o mysql2 esta instalado.');
    process.exit(1);
  }
  return null;
}

function arg(nome, padrao) {
  const i = process.argv.indexOf(`--${nome}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
}

const LOJA = String(arg('loja', '')).toUpperCase();
const HOST = arg('host', 'localhost');
const PORTA = Number(arg('porta', 3306));
const BANCO = arg('banco', 'bdsia');
const USUARIO = arg('usuario', 'SISTEMA');

if (!['TNP', 'LI', 'HORA'].includes(LOJA)) {
  console.error('Informe a loja: --loja TNP   (valores aceitos: TNP, LI, HORA)');
  process.exit(1);
}

/**
 * Cada coluna do CSV e os nomes que ela pode ter na tabela `produto`, em
 * ordem de preferencia. O nome da ESQUERDA e o que sai no arquivo, porque
 * e o que o importador do Pralis procura.
 */
const COLUNAS = [
  ['CODITEM', ['coditem', 'codproduto']],
  ['CODBARRAS', ['codbarras', 'codbarra']],
  ['DESCRICAO', ['descricao', 'nome']],
  ['CODGRUPO', ['codgrupo', 'grupo']],
  ['ALIQSAIDA', ['aliqsaida', 'aliquotasaida']],
  ['REDUCAO', ['reducao']],
  ['ALIQINTERNA', ['aliqinterna', 'aliquota']],
  ['CSTSAIDA', ['cstsaida', 'cst_saidas', 'cst']],
  ['CSOSNEMPRESA', ['csosnempresa', 'csosn']],
  ['NCM', ['ncm']],
  ['ATIVO', ['ativo']],
];

function perguntarSenha() {
  if (process.env.SIA_SENHA) return Promise.resolve(process.env.SIA_SENHA);
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`Senha do usuario "${USUARIO}" (do sia.ini, ela nao aparece): `, (r) => {
      rl.close();
      console.log('');
      resolve(r);
    });
    rl._writeToOutput = (s) => { if (!/^Senha/.test(s)) rl.output.write('*'); else rl.output.write(s); };
  });
}

/** CSV com `;` e aspas dobradas -- o mesmo dialeto que o importador ja le. */
function paraCsv(cabecalho, linhas) {
  const celula = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cabecalho.join(';')]
    .concat(linhas.map((l) => cabecalho.map((c) => celula(l[c])).join(';')))
    .join('\r\n');
}

async function main() {
  const mysql = carregarMysql();
  const senha = await perguntarSenha();
  const conn = await mysql.createConnection({
    host: HOST, port: PORTA, user: USUARIO, password: senha, database: BANCO,
  });

  try {
    const [cols] = await conn.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'produto'`,
      [BANCO],
    );
    const existe = new Map(cols.map((c) => [String(c.COLUMN_NAME).toLowerCase(), String(c.COLUMN_NAME)]));

    if (!existe.has('coditem')) {
      console.error(`\nA tabela "produto" de "${BANCO}" nao tem a coluna coditem.`);
      console.error('Banco errado. Confira `pathdatabase` no sia.ini.');
      console.error(`Colunas achadas: ${[...existe.keys()].sort().join(', ')}`);
      process.exit(1);
    }

    const escolhidas = COLUNAS.map(([saida, candidatas]) => {
      const achada = candidatas.find((c) => existe.has(c));
      return { saida, real: achada ? existe.get(achada) : null };
    });

    /*
     * Coluna sem correspondente sai VAZIA em vez de derrubar a exportacao:
     * o importador do Pralis exige que a COLUNA exista, nao que ela tenha
     * valor. Derrubar aqui obrigaria a editar o CSV na mao.
     */
    const ausentes = escolhidas.filter((c) => !c.real).map((c) => c.saida);
    if (ausentes.length) {
      console.log(`\nAviso: sem correspondente no banco, sairao vazias: ${ausentes.join(', ')}`);
    }

    const select = escolhidas
      .filter((c) => c.real)
      .map((c) => `\`${c.real}\` AS \`${c.saida}\``)
      .join(', ');
    const [linhas] = await conn.query(`SELECT ${select} FROM produto ORDER BY coditem`);

    for (const linha of linhas) for (const c of ausentes) linha[c] = '';

    const cabecalho = COLUNAS.map(([saida]) => saida);
    const arquivo = path.resolve(process.cwd(), `depara-${LOJA.toLowerCase()}.csv`);
    fs.writeFileSync(arquivo, `﻿${paraCsv(cabecalho, linhas)}\r\n`, 'utf8');

    const comBarras = linhas.filter((l) => String(l.CODBARRAS || '').trim() !== '').length;
    console.log('');
    console.log(`  banco:    ${HOST}:${PORTA}/${BANCO}  (somente leitura)`);
    console.log(`  loja:     ${LOJA}`);
    console.log(`  produtos: ${linhas.length}`);
    console.log(`  com codigo de barras: ${comBarras}  (sem barras nao casa e fica de fora)`);
    console.log(`  colunas:  ${escolhidas.map((c) => `${c.saida}${c.real ? '' : ' (vazia)'}`).join(', ')}`);
    console.log('');
    console.log(`  CSV gerado: ${arquivo}`);
    console.log('');
    console.log('  Proximo passo, no Pralis:');
    console.log(`     npm run creare:depara -- "${arquivo}" --loja ${LOJA}`);
    console.log(`     npm run creare:depara -- "${arquivo}" --loja ${LOJA} --apply`);
    console.log('  O primeiro so confere; o segundo grava.');
  } finally {
    await conn.end();
  }
}

main().catch((erro) => {
  // Mensagem do MySQL sem a query: a query carrega nomes de coluna do
  // catalogo da loja, e log de erro costuma ser colado em lugar publico.
  console.error(`\nFALHOU: ${erro.code || ''} ${String(erro.message).split('\n')[0]}`);
  process.exit(1);
});

