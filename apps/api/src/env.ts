import { z } from 'zod';

export const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  GEMINI_API_KEY: z.string().optional().default(''),
  GROQ_API_KEY: z.string().optional().default(''),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  API_PORT: z.coerce.number().int().positive().default(3001),
  INGEST_URL: z.string().url().default('http://localhost:3001'),
  DEFAULT_MODEL: z.string().default('gemini-2.0-flash')
});

export const env = EnvSchema.parse(process.env);