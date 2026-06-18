import { defineConfig } from 'drizzle-kit';
import { env } from '../config/env';

export default defineConfig({
  schema: './src/modules/**/*.table.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: env.DATABASE_URL,
  },
  verbose: true,
  strict: true,
});
