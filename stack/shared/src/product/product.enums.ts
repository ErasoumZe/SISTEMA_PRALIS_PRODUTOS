import { z } from 'zod/v4';

/**
 * Enums do domínio — valores reais extraídos das abas de referência da planilha
 * (ver ../docs/06-tabelas-de-apoio.md).
 */

export const statusProduto = z.enum(['ativo', 'inativo']);
export const tipoProduto = z.enum(['revenda', 'transformacao']); // exclusivos
export const loja = z.enum(['TNP', 'LI', 'HORA']);          // loja do usuário
export const catalogo = z.enum(['BASE', 'TNP', 'LI', 'HORA']); // catálogo do produto (BASE = geral)
export const userRole = z.enum(['admin', 'user']);

export const medidaBase = z.enum(['UN', 'KG', 'G', 'LT', 'ML']);   // MEDIDASCAD
export const medidaCompra = z.enum(['UN', 'KG', 'LT']);            // MEDIDAS1
export const embalagem = z.enum(['UN', 'KG', 'LT', 'MIL', 'FD', 'PCT', 'CX', 'POTE', 'EMB', 'SACO', 'BAND']); // MEDIDAS2
export const unidadeTransformacao = z.enum(['UN', 'G', 'ML']);     // MEDIDAS3
export const precisao = z.enum(['EXATOS', 'APROXIMADOS']);
export const cDe = z.enum(['C/', 'DE']);

export const tipoPromocao = z.enum(['valor', 'desconto']);

export type StatusProduto = z.infer<typeof statusProduto>;
export type TipoProduto = z.infer<typeof tipoProduto>;
export type Loja = z.infer<typeof loja>;
export type Catalogo = z.infer<typeof catalogo>;
export type UserRole = z.infer<typeof userRole>;
export type MedidaBase = z.infer<typeof medidaBase>;
export type MedidaCompra = z.infer<typeof medidaCompra>;
export type Embalagem = z.infer<typeof embalagem>;
export type UnidadeTransformacao = z.infer<typeof unidadeTransformacao>;
export type Precisao = z.infer<typeof precisao>;
export type CDe = z.infer<typeof cDe>;
export type TipoPromocao = z.infer<typeof tipoPromocao>;
