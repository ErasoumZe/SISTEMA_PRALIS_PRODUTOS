import { z } from 'zod/v4';

/**
 * Erro de aplicação com status HTTP — capturado pelo error handler global.
 * (mesmo conceito do AppError da Cicluz)
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details: unknown;

  constructor(message: string, statusCode = 400, code = 'APP_ERROR', details: unknown = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

/** Envelope padrão de resposta da API. */
export interface ApiResponse<T> {
  message: string;
  data: T;
  details: unknown;
}

export const apiResponseSchema = <T extends z.ZodType>(dataSchema: T) =>
  z.object({
    message: z.string(),
    data: dataSchema,
    details: z.any(),
  });


export function buildResponse<T>(data: T, message = 'Success', details: unknown = null): ApiResponse<T> {
  return { message, data, details };
}
