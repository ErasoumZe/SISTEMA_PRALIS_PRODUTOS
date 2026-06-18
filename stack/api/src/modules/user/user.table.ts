import { pgTable, text, timestamp, boolean } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';

export const users = pgTable('users', {
  id: text('id').primaryKey().$defaultFn(() => uuidv7()),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
