/**
 * O que a aba `(TNP/LI) CADASTRO PRODUTOS` tem para virar cadastro.
 *
 * Existe porque repopular o catálogo a partir dela só faz sentido se os campos
 * obrigatórios estiverem lá. O GRUPO é o mais crítico: sem ele o cadastro
 * recusa (`GROUP_REQUIRED`), porque é dele que sai a regra fiscal.
 *
 * Só leitura.
 */
import 'reflect-metadata';
import 'dotenv/config';

const PRODUCAO = '1iQGitC8CMl8OGgW05buMcfqr9xer0d9CexnT6U6Dwvw';
const ABA = '(TNP/LI) CADASTRO PRODUTOS';
const PRIMEIRA = 11;

const texto = (v: unknown): string =>
  String(v ?? '').normalize('NFKC').replace(/\p{Cf}/gu, '').replace(/\s+/g, ' ').trim();

async function main() {
  const { GoogleSheetsClient, a1 } = await import('@/modules/google-sheets/google-sheets.client');
  const c = new GoogleSheetsClient();

  const colunas = {
    status: 'C', nome: 'D', barras: 'F', marca: 'G', emb: 'H', qt: 'J',
    grupoRevenda: 'M', grupoTransf: 'O', id: 'HT',
    quantidade: 'HU', medidaBase: 'HV', medida: 'HW',
  } as const;

  const chaves = Object.keys(colunas) as Array<keyof typeof colunas>;
  const lido = await c.batchGetValues(
    PRODUCAO,
    chaves.map((k) => a1(ABA, `${colunas[k]}${PRIMEIRA}:${colunas[k]}2000`)),
    'FORMATTED_VALUE',
  );
  const col = (i: number) => ((lido[i] ?? []) as string[][]).map((r) => texto(r?.[0]));
  const dados = Object.fromEntries(chaves.map((k, i) => [k, col(i)])) as Record<string, string[]>;

  const nomes = dados.nome ?? [];
  const total = nomes.filter(Boolean).length;
  console.log(`linhas com nome: ${total}\n`);

  const conta = (k: string) => nomes.reduce((n, nome, i) => (nome && (dados[k]?.[i] ?? '') ? n + 1 : n), 0);
  for (const k of chaves) {
    const n = conta(k);
    console.log(`  ${k.padEnd(13)} ${String(n).padStart(5)}  ${String(Math.round((n / total) * 100)).padStart(3)}%`);
  }

  // o grupo decide se o cadastro passa: revenda OU transformacao
  let comAlgumGrupo = 0;
  let ambos = 0;
  let nenhum = 0;
  const semGrupo: string[] = [];
  nomes.forEach((nome, i) => {
    if (!nome) return;
    const r = dados.grupoRevenda?.[i] ?? '';
    const t = dados.grupoTransf?.[i] ?? '';
    if (r && t) ambos += 1;
    if (r || t) comAlgumGrupo += 1;
    else { nenhum += 1; if (semGrupo.length < 6) semGrupo.push(nome); }
  });
  console.log(`\n  com algum grupo : ${comAlgumGrupo}`);
  console.log(`  com os DOIS     : ${ambos}   <- ambiguo: revenda ou transformacao?`);
  console.log(`  SEM grupo       : ${nenhum}   <- o cadastro recusaria estes`);
  if (semGrupo.length) console.log(`     ex.: ${semGrupo.join(' | ')}`);

  const inativos = nomes.reduce((n, nome, i) => (nome && /INATIV/i.test(dados.status?.[i] ?? '') ? n + 1 : n), 0);
  console.log(`\n  marcados INATIVO: ${inativos}`);

  // nomes repetidos viram cadastro duplicado
  const vistos = new Map<string, number>();
  for (const nome of nomes) if (nome) vistos.set(nome.toUpperCase(), (vistos.get(nome.toUpperCase()) ?? 0) + 1);
  const repetidos = [...vistos.entries()].filter(([, n]) => n > 1);
  console.log(`  nomes repetidos : ${repetidos.length}`);
  repetidos.slice(0, 5).forEach(([n, q]) => console.log(`     ${q}x ${n}`));
  process.exit(0);
}

main().catch((e) => { console.error('FALHOU:', e?.stack ?? e?.message ?? e); process.exit(1); });
