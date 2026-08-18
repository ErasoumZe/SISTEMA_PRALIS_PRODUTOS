import { container, instanceCachingFactory, type InjectionToken } from 'tsyringe';
import { GoogleSheetsClient, type SheetsGateway } from './google-sheets.client';

/**
 * Token de injeção do gateway do Sheets. Os testes constroem o serviço
 * passando um duplo diretamente; a aplicação resolve o cliente real por aqui.
 */
export const SHEETS_GATEWAY: InjectionToken<SheetsGateway> = Symbol('SheetsGateway');

container.register<SheetsGateway>(SHEETS_GATEWAY, {
  useFactory: instanceCachingFactory(() => new GoogleSheetsClient()),
});
