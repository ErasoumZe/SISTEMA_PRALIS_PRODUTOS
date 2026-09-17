import { container, instanceCachingFactory, type InjectionToken } from 'tsyringe';
import { GoogleDriveClient, type DriveGateway } from './creare-drive.client';

/**
 * Token de injeção do gateway do Drive. Os testes constroem o serviço passando
 * um dublê diretamente; a aplicação resolve o cliente real por aqui.
 */
export const DRIVE_GATEWAY: InjectionToken<DriveGateway> = Symbol('DriveGateway');

container.register<DriveGateway>(DRIVE_GATEWAY, {
  useFactory: instanceCachingFactory(() => new GoogleDriveClient()),
});

export type { DriveGateway };
