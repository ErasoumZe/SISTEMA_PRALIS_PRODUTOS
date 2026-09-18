import fs from 'node:fs';
import XLSX from 'xlsx';

const origem = String.raw`C:\Users\José\Downloads\produtos_pralis_convertidos-compilart.xlsx`;
const destino = new URL('../src/modules/product/compilart-li.catalogo.json', import.meta.url);
const wb = XLSX.readFile(origem, { raw: false });
const rows = XLSX.utils.sheet_to_json(wb.Sheets.Produtos, { defval: '' });
const somenteDigitos = (v) => String(v ?? '').replace(/\D/g, '');
const dados = rows.map((r) => ({
  codigo: somenteDigitos(r['Cód. Interno']).padStart(5, '0'),
  ean: somenteDigitos(r['Código Produto Padrão']).replace(/^0+(?=\d)/, ''),
  nome: String(r['Descrição'] ?? '').trim(),
  ativo: String(r.Ativo ?? '').trim() === 'Sim',
  pagina: Number(r['Página PDF'] ?? 0),
}));
fs.writeFileSync(destino, `${JSON.stringify(dados, null, 2)}\n`, 'utf8');
console.log(`${dados.length} produtos gravados em ${destino.pathname}`);
