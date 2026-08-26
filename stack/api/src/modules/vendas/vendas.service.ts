import { inject, injectable } from 'tsyringe';
import { AppError } from '@/config/api.replies';
import { VendasRepository } from './vendas.repository';
import {
  fechamentoCaixaInputSchema,
  vendaProdutoInputSchema,
  type ImportarVendasBody,
  type ImportarVendasResult,
} from './vendas.schemas';

@injectable()
export class VendasService {
  constructor(@inject(VendasRepository) private repository: VendasRepository) {}

  async importar(input: ImportarVendasBody): Promise<ImportarVendasResult> {
    const schema = input.tipo === 'venda_produto_dia' ? vendaProdutoInputSchema : fechamentoCaixaInputSchema;
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

    return input.tipo === 'venda_produto_dia'
      ? this.repository.importarVendas(parsed as never[])
      : this.repository.importarFechamentos(parsed as never[]);
  }
}

