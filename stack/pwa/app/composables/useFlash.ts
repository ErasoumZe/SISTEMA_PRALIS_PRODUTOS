export type FlashTipo = 'success' | 'warning' | 'error';

export interface FlashMessage {
  texto: string;
  tipo: FlashTipo;
}

/**
 * Aviso que sobrevive a UMA navegação (salvar produto -> volta para a lista).
 * Quem exibe é responsável por limpar.
 */
export const useFlash = () => useState<FlashMessage | null>('flash', () => null);
