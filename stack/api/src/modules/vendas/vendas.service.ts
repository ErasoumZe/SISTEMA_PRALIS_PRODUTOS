import { inject, injectable } from 'tsyringe';
import { AppError } from '@/config/api.replies';
import { VendasRepository } from './vendas.repository';
import {
  fechamentoCaixaInputSchema,
  vendaCreareInputSchema,
  vendaItemPdvInputSchema,
  vendaProdutoInputSchema,
  type ImportarVendasBody,
  type ImportarVendasResult,
} from './vendas.schemas';

@injectable()
export class VendasService {
  constructor(@inject(VendasRepository) private repository: VendasRepository) {}

  async importar(input: ImportarVendasBody): Promise<ImportarVendasResult> {
    const schema = input.tipo === 'venda_produto_dia' ? vendaProdutoInputSchema
      : input.tipo === 'fechamento_caixa_dia' ? fechamentoCaixaInputSchema
        : input.tipo === 'venda_creare' ? vendaCreareInputSchema : vendaItemPdvInputSchema;
    const parsed: unknown[] = [];
    const invalid: Array<{ linha: number; erros: string[] }> = [];

    input.linhas.forEach((line, index) => {
      const result = schema.safeParse(line);
      if (result.success) parsed.push(result.data);
      else invalid.push({ linha: index + 1, erros: result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`) });
    });

    if (invalid.length) {
      throw new AppError(
        `Lote recusado: ${invalid.length} linha(s) inválida(s).`,
        422,
        'SALES_BATCH_INVALID',
        { linhas: invalid },
      );
    }

    if (input.tipo === 'venda_produto_dia') return this.repository.importarVendas(parsed as never[]);
    if (input.tipo === 'fechamento_caixa_dia') return this.repository.importarFechamentos(parsed as never[]);
    if (input.tipo === 'venda_creare') return this.repository.importarCuponsCreare(parsed as never[]);
    return this.repository.importarItensPdv(parsed as never[]);
  }
}
