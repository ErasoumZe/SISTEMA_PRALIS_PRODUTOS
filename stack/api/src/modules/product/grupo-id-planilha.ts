import { env } from '@/config/env';
import { GoogleSheetsClient, a1, type SheetsGateway } from '@/modules/google-sheets/google-sheets.client';

/** A planilha contém U+2060 invisível em vários nomes de grupo. */
export const chaveDeGrupo = (nome: string | null | undefined): string => String(nome ?? '')
  .replace(/\p{Cf}/gu, '')
  .normalize('NFD')
  .replace(/\p{M}/gu, '')
  .toUpperCase()
  .replace(/\s+/g, ' ')
  .trim();

/** Zero é marcador de campo vazio no layout, não um ID de grupo utilizável. */
export const grupoIdPreenchido = (id: string | null | undefined): boolean =>
  Boolean(id?.trim() && !/^0+$/.test(id.trim()));

export type GrupoIdResultado =
  | { estado: 'encontrado'; id: string }
  | { estado: 'ausente' | 'ambiguo' | 'fonte_invalida' | 'indisponivel' };

/** Recusa IDs não numéricos e nomes que apontam para dois IDs diferentes. */
export function lerGrupoIds(linhas: string[][]): Map<string, string | null> | null {
  if (chaveDeGrupo(linhas[0]?.[0]) !== 'NOME GRUPO' || chaveDeGrupo(linhas[0]?.[1]) !== 'ID GRUPO') {
    return null;
  }
  const ids = new Map<string, string | null>();
  for (const [nome = '', codigo = ''] of linhas.slice(1)) {
    const chave = chaveDeGrupo(nome);
    const id = String(codigo).trim();
    if (!chave || !/^\d{1,4}$/.test(id) || Number(id) === 0) continue;
    const anterior = ids.get(chave);
    if (anterior !== undefined && anterior !== id) ids.set(chave, null);
    else if (anterior === undefined) ids.set(chave, id);
  }
  return ids.size ? ids : null;
}

/** Leitura somente dos IDs oficiais. Não escreve na planilha nem no banco. */
export class GrupoIdPlanilha {
  private cache: { chave: string; ate: number; ids: Map<string, string | null> | null } | null = null;

  constructor(private readonly sheets: SheetsGateway = new GoogleSheetsClient()) {}

  async buscar(nome: string | null | undefined): Promise<GrupoIdResultado> {
    const chave = chaveDeGrupo(nome);
    if (!chave) return { estado: 'ausente' };
    const idPlanilha = env.GOOGLE_SHEETS_SPREADSHEET_ID;
    const aba = env.GOOGLE_SHEETS_GRUPO_IDS_TAB;
    if (!idPlanilha || !aba || !env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) {
      return { estado: 'indisponivel' };
    }
    const origem = `${idPlanilha}:${aba}`;
    if (!this.cache || this.cache.chave !== origem || this.cache.ate <= Date.now()) {
      try {
        const [linhas] = await this.sheets.batchGetValues(idPlanilha, [a1(aba, 'AC5:AD')], 'FORMATTED_VALUE');
        this.cache = { chave: origem, ate: Date.now() + 5 * 60_000, ids: lerGrupoIds(linhas ?? []) };
      } catch {
        return { estado: 'indisponivel' };
      }
    }
    if (!this.cache.ids) return { estado: 'fonte_invalida' };
    if (!this.cache.ids.has(chave)) return { estado: 'ausente' };
    const id = this.cache.ids.get(chave);
    return id ? { estado: 'encontrado', id } : { estado: 'ambiguo' };
  }
}
