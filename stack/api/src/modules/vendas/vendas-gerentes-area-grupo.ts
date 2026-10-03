import { VendasGerentes } from '@pralis/shared';
import type { ProdutoCadastro } from './vendas-margem';

/**
 * Sugestão provisória para produtos TNP ainda sem área manual. Só grupos com
 * correspondência clara ou categoria mais próxima na planta entram aqui.
 * Grupo fiscal não prova a posição física: Bomboniere → Mercearia é uma
 * aproximação revisável; pães genéricos, cigarros, matéria-prima, higiene e
 * fabricação própria genérica ficam pendentes.
 */
export function sugerirAreaPorGrupo(grupo: string | null | undefined): VendasGerentes.AreaTnp | null {
  const nome = String(grupo ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
  if (!nome) return null;
  const raiz = nome.replace(/^MER /, '');
  if (/^BISCOITOS(?: |$)/.test(raiz)) return 'biscoitos';
  if (/^BOMBONIERI(?: |$)/.test(raiz)) return 'mercearia';
  if (/^LATICINIOS(?: |$)/.test(raiz)) return 'laticinios';
  if (/^FRIOS(?: |$)/.test(raiz)) return 'frios';
  if (/^MERCEARIA(?: |$)/.test(raiz)) return 'mercearia';
  if (/^BEBIDAS(?: |$)/.test(raiz) || /^(AGUA|SUCO CAIXINHA|SUCO NATURAL|CHAS GUARAVITON|ACHOC GELADOS|REF 220 ML|REF 350 ML|PET 600 ML)$/.test(raiz)) return 'bebidas';
  if (/^VITRINE PAES(?: |$)/.test(raiz)) return 'vitrine_paes';
  if (/^VASCA PAES(?: |$)/.test(raiz)) return 'vasca_paes';
  if (/^MESA PAES(?: |$)/.test(raiz)) return 'mesa_paes';
  if (/^PAES EMPACOTADOS(?: |$)/.test(raiz)) return 'paes_empacotados';
  if (/^VITRINE(?: GELADA| SECA)?$/.test(raiz)) return 'vitrine';
  if (/^FAB PROPRIA (?:BEBIDAS COPA|COPA)$/.test(raiz)) return 'copa';
  if (/^FAB PROPRIA (?:LANCHES CHAPA|CHAPA)$/.test(raiz)) return 'chapa';
  if (raiz === 'COPA') return 'copa';
  if (raiz === 'CHAPA') return 'chapa';
  return null;
}

export function areaEfetiva(produto: ProdutoCadastro): { area: VendasGerentes.AreaTnp; inferida: boolean } | null {
  const manual = VendasGerentes.areaTnpSchema.safeParse(produto.areaVenda);
  if (manual.success) return { area: manual.data, inferida: false };
  const sugestao = sugerirAreaPorGrupo(produto.grupo);
  return sugestao ? { area: sugestao, inferida: true } : null;
}
