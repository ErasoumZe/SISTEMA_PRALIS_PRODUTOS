import { injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { db } from '@/db/databases';
import { siaProdutoDePara } from './creare.table';
import type { CreareStore } from './creare.config';

/** Uma linha do cadastro que já existe no SIA. */
export interface SiaDePara {
  chaveBarras: string;
  codigoBarras: string;
  coditem: string;
  descricao: string;
  codGrupo: string;
  aliqSaidaEcf: string;
  reducao: string | null;
  aliquotaInterna: string | null;
  cstSaida: string;
  csosn: string;
  ncm: string;
  ativo: string;
  pesavel: string | null;
  teclaBalanca: string | null;
  validadeBalanca: string | null;
}

@injectable()
export class CreareDeParaRepository {
  /** Índice por chave de barras — é assim que o produto do Pralis encontra o seu par. */
  async porBarras(loja: CreareStore): Promise<Map<string, SiaDePara>> {
    const linhas = await db
      .select({
        chaveBarras: siaProdutoDePara.chaveBarras,
        codigoBarras: siaProdutoDePara.codigoBarras,
        coditem: siaProdutoDePara.coditem,
        descricao: siaProdutoDePara.descricao,
        codGrupo: siaProdutoDePara.codGrupo,
        aliqSaidaEcf: siaProdutoDePara.aliqSaidaEcf,
        reducao: siaProdutoDePara.reducao,
        aliquotaInterna: siaProdutoDePara.aliquotaInterna,
        cstSaida: siaProdutoDePara.cstSaida,
        csosn: siaProdutoDePara.csosn,
        ncm: siaProdutoDePara.ncm,
        ativo: siaProdutoDePara.ativo,
        pesavel: siaProdutoDePara.pesavel,
        teclaBalanca: siaProdutoDePara.teclaBalanca,
        validadeBalanca: siaProdutoDePara.validadeBalanca,
      })
      .from(siaProdutoDePara)
      .where(eq(siaProdutoDePara.loja, loja));

    return new Map(linhas.map((linha) => [linha.chaveBarras, linha]));
  }

  async total(loja: CreareStore): Promise<number> {
    return (await this.porBarras(loja)).size;
  }
}
