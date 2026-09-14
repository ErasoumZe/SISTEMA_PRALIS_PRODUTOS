/**
 * Até que linha cada COLUNA tem conteúdo, num CSV exportado da planilha.
 *
 * Existe porque "a linha tem alguma coisa" não é a mesma pergunta que "a linha
 * tem PRODUTO". Nas abas de cadastro, toda linha até a última da grade devolve
 * texto — `INATIVO`, `NÃO`, `NÃO REVISADO`, a data de hoje — porque são
 * fórmulas preenchidas até o fim. Apagar por esse critério não apagaria nada.
 *
 * O critério certo é por coluna: as colunas que uma PESSOA preenche param onde
 * o cadastro acaba; as de fórmula vão até o fim. A diferença entre as duas é
 * exatamente a gordura que dá para cortar.
 *
 * Só leitura de arquivo local. Não toca na planilha.
 *
 * Uso: tsx scripts/ate-onde-tem-dado.ts <arquivo.csv> [--cabecalho 5]
 */
import { readFileSync } from 'node:fs';

const arg = (nome: string): string | undefined => {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

/** Divide CSV respeitando aspas: célula de cadastro tem vírgula com frequência. */
const linhasDoCsv = (csv: string): string[][] => {
  const linhas: string[][] = [];
  let celula = '';
  let linha: string[] = [];
  let entreAspas = false;
  for (let i = 0; i < csv.length; i += 1) {
    const c = csv[i];
    if (entreAspas) {
      if (c === '"') {
        if (csv[i + 1] === '"') { celula += '"'; i += 1; } else entreAspas = false;
      } else celula += c;
      continue;
    }
    if (c === '"') { entreAspas = true; continue; }
    if (c === ',') { linha.push(celula); celula = ''; continue; }
    if (c === '\n') { linha.push(celula); linhas.push(linha); linha = []; celula = ''; continue; }
    if (c === '\r') continue;
    celula += c;
  }
  if (celula !== '' || linha.length) { linha.push(celula); linhas.push(linha); }
  return linhas;
};

/** 0 -> A, 26 -> AA */
const coluna = (i: number): string => {
  let n = i + 1;
  let out = '';
  while (n > 0) {
    const resto = (n - 1) % 26;
    out = String.fromCharCode(65 + resto) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
};

function main() {
  const arquivo = process.argv[2];
  if (!arquivo || arquivo.startsWith('--')) {
    console.error('Uso: tsx scripts/ate-onde-tem-dado.ts <arquivo.csv> [--cabecalho 5]');
    process.exit(1);
  }
  const linhaCabecalho = Number(arg('cabecalho') ?? 5);

  const linhas = linhasDoCsv(readFileSync(arquivo, 'utf8'));
  const cabecalho = linhas[linhaCabecalho - 1] ?? [];
  const largura = Math.max(...linhas.map((l) => l.length));

  /** Por coluna: última linha com conteúdo e quantas linhas preenchidas. */
  const porColuna = Array.from({ length: largura }, () => ({ ultima: 0, quantas: 0 }));
  for (let i = 0; i < linhas.length; i += 1) {
    const l = linhas[i] ?? [];
    for (let c = 0; c < largura; c += 1) {
      if (String(l[c] ?? '').trim() === '') continue;
      const alvo = porColuna[c]!;
      alvo.ultima = i + 1;
      alvo.quantas += 1;
    }
  }

  /*
   * Colunas que vão até o FIM da grade são fórmula preenchida até embaixo.
   * Colunas que param antes são as que alguém preencheu de verdade.
   */
  const fim = linhas.length;
  const ateOFim = porColuna.filter((p) => p.ultima >= fim - 1).length;
  const param = porColuna
    .map((p, i) => ({ ...p, i }))
    .filter((p) => p.ultima > 0 && p.ultima < fim - 1);

  console.log(`arquivo: ${arquivo}`);
  console.log(`linhas no export: ${fim} · colunas: ${largura}\n`);
  console.log(`colunas que vao ate o fim da grade (fórmula): ${ateOFim}`);
  console.log(`colunas que PARAM antes (preenchidas por gente): ${param.length}\n`);

  if (param.length) {
    const ordenadas = [...param].sort((a, b) => b.ultima - a.ultima);
    console.log('as que param mais TARDE — é o piso do corte:');
    for (const p of ordenadas.slice(0, 15)) {
      console.log(
        `  ${coluna(p.i).padStart(3)}  ultima linha ${String(p.ultima).padStart(5)}  `
        + `${String(p.quantas).padStart(5)} preenchidas  ${String(cabecalho[p.i] ?? '').slice(0, 40)}`,
      );
    }
    console.log(`\nMAIOR "ultima linha" entre as colunas de gente: ${ordenadas[0]?.ultima}`);
    console.log('Cortar ABAIXO disso nao perde nada que uma pessoa tenha escrito.');
  }
}

main();
