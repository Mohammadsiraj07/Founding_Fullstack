import { z } from 'zod';

export const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  WORKER_PORT: z.coerce.number().int().positive().default(3002)
});

export const env = EnvSchema.parse(process.env);