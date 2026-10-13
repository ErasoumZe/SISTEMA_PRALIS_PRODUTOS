const test = require('node:test');
const assert = require('node:assert/strict');
const { selecionarLinha } = require('./CORRIGIR-BISCOITO-10824.cjs');

test('seleciona exclusivamente o produto certo e exige os valores validos', () => {
  const linha = { DATA_VENDA: '15/09/2026', PRODUTO_CODIGO: '00000000010824', PRODUTO: 'BISCOITO POLVILHO CEBOLA KG', QUANTIDADE: 1.114, TOTAL: 96.8 };
  assert.equal(selecionarLinha([linha]), linha);
  assert.throws(() => selecionarLinha([{ ...linha, TOTAL: 880567.6 }]));
  assert.throws(() => selecionarLinha([{ ...linha, DATA_VENDA: '16/09/2026' }]));
  assert.throws(() => selecionarLinha([linha, linha]));
});
