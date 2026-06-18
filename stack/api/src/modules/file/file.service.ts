import { injectable } from 'tsyringe';
import { cloudinary, cloudinaryConfigured } from '@/config/cloudinary';
import { AppError } from '@/config/api.replies';

@injectable()
export class FileService {
  /** Envia uma imagem (buffer) ao Cloudinary e devolve a URL segura. */
  async uploadImage(buffer: Buffer): Promise<string> {
    if (!cloudinaryConfigured()) {
      throw new AppError(
        'Upload de imagem não configurado. Defina CLOUDINARY_CLOUD_NAME / API_KEY / API_SECRET no .env.',
        503,
        'CLOUDINARY_NOT_CONFIGURED',
      );
    }

    return new Promise<string>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: 'pralis/produtos', resource_type: 'image' },
        (err, result) => {
          if (err || !result) return reject(new AppError('Falha ao enviar a imagem.', 502, 'UPLOAD_FAILED'));
          resolve(result.secure_url);
        },
      );
      stream.end(buffer);
    });
  }
}
