import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { users } from '@/modules/user/user.table';

const SESSION_DURATION_IN_DAYS = 7;

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey().$defaultFn(() => uuidv7()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true })
    .notNull()
    .default(sql.raw(`now() + interval '${SESSION_DURATION_IN_DAYS} days'`)),
});
