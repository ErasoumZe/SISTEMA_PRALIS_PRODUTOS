import { pgTable, text, timestamp, boolean } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';

export const users = pgTable('users', {
  id: text('id').primaryKey().$defaultFn(() => uuidv7()),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  loja: text('loja'), // 'TNP' | 'LI' | 'HORA' — null para admin (sem loja; casa = BASE)
  role: text('role').notNull().default('user'), // 'admin' | 'user'
  emailVerified: boolean('email_verified').notNull().default(false),
  verificationCode: text('verification_code'),
  verificationExpiresAt: timestamp('verification_expires_at', { withTimezone: true }),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
