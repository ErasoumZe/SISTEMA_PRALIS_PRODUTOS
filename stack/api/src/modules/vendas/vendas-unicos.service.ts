import { inject, injectable } from 'tsyringe';
import type { VendasUnicos } from '@pralis/shared';
import { AppError } from '@/config/api.replies';
import { VendasUnicosRepository } from './vendas-unicos.repository';

type Loja = 'TNP' | 'LI';

/** Mesmo teto do relatório: período aberto demais trava a consulta. */
const MAX_DIAS = 800;

function validarPeriodo(inicio: string, fim: string): void {
  const dias = Math.floor(
    (new Date(`${fim}T00:00:00Z`).getTime() - new Date(`${inicio}T00:00:00Z`).getTime()) / 86_400_000,
  );
  if (dias < 0) throw new AppError('Data inicial deve ser anterior à final.', 422, 'INVALID_PERIOD');
  if (dias > MAX_DIAS) {
    throw new AppError(`O período máximo é de ${MAX_DIAS} dias.`, 422, 'PERIOD_TOO_LARGE');
  }
}

@injectable()
export class VendasUnicosService {
  constructor(@inject(VendasUnicosRepository) private repository: VendasUnicosRepository) {}

  async listar(loja: Loja, q: VendasUnicos.ProdutosUnicosQuery): Promise<VendasUnicos.ProdutosUnicos> {
    validarPeriodo(q.inicio, q.fim);
    const busca = q.busca?.trim() || undefined;

    const [totais, semIdErp, produtos] = await Promise.all([
      this.repository.totais(loja, q.inicio, q.fim, busca),
      this.repository.linhasSemIdErp(loja, q.inicio, q.fim),
      this.repository.listar(loja, q.inicio, q.fim, {
        ordenar: q.ordenar,
        busca,
        limite: q.porPagina,
        offset: (q.pagina - 1) * q.porPagina,
      }),
    ]);

    return {
      loja,
      periodo: { inicio: q.inicio, fim: q.fim },
      total: totais.total,
      pagina: q.pagina,
      porPagina: q.porPagina,
      totalQuantidade: totais.quantidade,
      totalFaturamento: totais.faturamento,
      linhasSemIdErp: semIdErp,
      produtos,
    };
  }

  /** Período INTEIRO, sem paginação — é o que o botão de exportar precisa. */
  async todos(loja: Loja, q: VendasUnicos.ProdutosUnicosCsvQuery): Promise<VendasUnicos.ProdutoUnico[]> {
    validarPeriodo(q.inicio, q.fim);
    return this.repository.listar(loja, q.inicio, q.fim, {
      ordenar: q.ordenar,
      busca: q.busca?.trim() || undefined,
      limite: null,
      offset: 0,
    });
  }
}

const brl = (v: number) => v.toFixed(2).replace('.', ',');
const qtd = (v: number) => v.toFixed(3).replace('.', ',');

/**
 * CSV que o Excel em português abre sem estragar nada:
 *  - separador `;` (o Excel pt-BR não usa vírgula, que aqui é decimal);
 *  - BOM UTF-8, senão acento vira caractere quebrado;
 *  - código entre aspas com `=` na frente para o Excel NÃO comer o zero à
 *    esquerda — sem isso `00145` vira `145` e deixa de casar com o cadastro.
 */
export function montarCsv(produtos: VendasUnicos.ProdutoUnico[]): string {
  const escapar = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const codigoTexto = (c: string) => (c === '' ? '""' : `="${c.replace(/"/g, '""')}"`);

  const linhas = [
    ['CODIGO', 'PRODUTO', 'QUANTIDADE', 'FATURAMENTO', 'DIAS_COM_VENDA',
      'PRIMEIRA_VENDA', 'ULTIMA_VENDA', 'NOMES_DIFERENTES'].join(';'),
    ...produtos.map((p) => [
      codigoTexto(p.codigo),
      escapar(p.produto),
      qtd(p.quantidade),
      brl(p.faturamento),
      String(p.diasComVenda),
      p.primeiraVenda,
      p.ultimaVenda,
      String(p.nomesDiferentes),
    ].join(';')),
  ];
  return `﻿${linhas.join('\r\n')}\r\n`;
}
