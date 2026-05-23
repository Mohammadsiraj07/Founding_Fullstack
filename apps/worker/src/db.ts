import { Pool } from 'pg';
import { toIso, type InferenceLog } from '@llm/shared';
import { env } from './env.js';

export const pool = new Pool({ connectionString: env.DATABASE_URL });

type DbMessageIdRow = {
  id: string;
};

export async function insertInferenceLog(input: InferenceLog): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `insert into inference_logs (
        conversation_id,
        message_id,
        session_id,
        provider,
        model,
        status,
        latency_ms,
        request_started_at,
        request_finished_at,
        prompt_token_count,
        completion_token_count,
        total_token_count,
        input_preview,
        output_preview,
        error_message,
        metadata,
        redaction_summary,
        redacted
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     returning id`,
    [
      input.conversationId,
      input.messageId,
      input.sessionId ?? null,
      input.provider,
      input.model,
      input.status,
      input.latencyMs,
      input.requestStartedAt,
      input.requestFinishedAt,
      input.promptTokenCount ?? null,
      input.completionTokenCount ?? null,
      input.totalTokenCount ?? null,
      input.inputPreview,
      input.outputPreview,
      input.errorMessage ?? null,
      JSON.stringify(input.metadata ?? {}),
      JSON.stringify(input.redactionSummary),
      input.redacted
    ]
  );

  return result.rows[0]!.id;
}

export async function linkMessageToLog(messageId: string, inferenceLogId: string): Promise<void> {
  await pool.query(`update messages set inference_log_id = $2 where id = $1`, [messageId, inferenceLogId]);
}

export async function touchConversation(conversationId: string, updatedAt: Date = new Date()): Promise<void> {
  await pool.query(`update conversations set updated_at = $2 where id = $1`, [conversationId, toIso(updatedAt)]);
}