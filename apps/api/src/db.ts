import { Pool, type PoolClient } from 'pg';
import { generateConversationTitle, toIso, type ChatMessage, type Conversation, type InferenceLog } from '@llm/shared';
import { env } from './env.js';

export const pool = new Pool({ connectionString: env.DATABASE_URL });

type DbConversationRow = {
  id: string;
  title: string | null;
  session_id: string | null;
  status: string;
  created_at: Date;
  updated_at: Date;
  cancelled_at: Date | null;
  last_message_preview?: string | null;
  first_user_message?: string | null;
};

type DbMessageRow = {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  inference_log_id: string | null;
  created_at: Date;
};

export async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export function mapConversation(row: DbConversationRow): Conversation {
  return {
    id: row.id,
    title: row.title ?? (row.first_user_message ? generateConversationTitle(row.first_user_message) : null),
    sessionId: row.session_id,
    status: row.status as Conversation['status'],
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    cancelledAt: row.cancelled_at ? toIso(row.cancelled_at) : undefined,
    lastMessagePreview: row.last_message_preview ?? undefined
  };
}

export function mapMessage(row: DbMessageRow): ChatMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    inferenceLogId: row.inference_log_id,
    createdAt: toIso(row.created_at)
  };
}

export async function createConversation(input: { title?: string | undefined; sessionId?: string | undefined } = {}): Promise<Conversation> {
  const result = await pool.query<DbConversationRow>(
    `insert into conversations (title, session_id)
     values ($1, $2)
     returning id, title, session_id, status, created_at, updated_at, cancelled_at`,
    [input.title ?? null, input.sessionId ?? null]
  );
  return mapConversation(result.rows[0]!);
}

export async function listConversations(): Promise<Conversation[]> {
  const result = await pool.query<DbConversationRow>(
    `select c.id,
            c.title,
            c.session_id,
            c.status,
            c.created_at,
            c.updated_at,
            c.cancelled_at,
            (
              select left(m.content, 140)
              from messages m
              where m.conversation_id = c.id
              order by m.created_at desc
              limit 1
            ) as last_message_preview,
            (
              select m.content
              from messages m
              where m.conversation_id = c.id and m.role = 'user'
              order by m.created_at asc
              limit 1
            ) as first_user_message
     from conversations c
     order by c.updated_at desc, c.created_at desc`
  );
  return result.rows.map(mapConversation);
}

export async function getConversation(conversationId: string): Promise<Conversation | null> {
  const result = await pool.query<DbConversationRow>(
    `select c.id,
            c.title,
            c.session_id,
            c.status,
            c.created_at,
            c.updated_at,
            c.cancelled_at,
            (
              select left(m.content, 140)
              from messages m
              where m.conversation_id = c.id
              order by m.created_at desc
              limit 1
            ) as last_message_preview,
            (
              select m.content
              from messages m
              where m.conversation_id = c.id and m.role = 'user'
              order by m.created_at asc
              limit 1
            ) as first_user_message
     from conversations c
     where c.id = $1`,
    [conversationId]
  );
  return result.rows[0] ? mapConversation(result.rows[0]) : null;
}

export async function listMessages(conversationId: string): Promise<ChatMessage[]> {
  const result = await pool.query<DbMessageRow>(
    `select id, conversation_id, role, content, inference_log_id, created_at
     from messages
     where conversation_id = $1
     order by created_at asc`,
    [conversationId]
  );
  return result.rows.map(mapMessage);
}

export async function getRecentMessages(conversationId: string, limit: number): Promise<Array<{ role: 'user' | 'assistant' | 'system'; content: string }>> {
  const result = await pool.query<Pick<DbMessageRow, 'role' | 'content'>>(
    `select role, content
     from messages
     where conversation_id = $1
     order by created_at desc
     limit $2`,
    [conversationId, limit]
  );
  const recentMessages = [...result.rows];
  recentMessages.reverse();
  return recentMessages.map((row: Pick<DbMessageRow, 'role' | 'content'>) => ({ role: row.role, content: row.content }));
}

export async function appendMessage(input: {
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  inferenceLogId?: string | null;
}): Promise<ChatMessage> {
  const result = await pool.query<DbMessageRow>(
    `insert into messages (conversation_id, role, content, inference_log_id)
     values ($1, $2, $3, $4)
     returning id, conversation_id, role, content, inference_log_id, created_at`,
    [input.conversationId, input.role, input.content, input.inferenceLogId ?? null]
  );

  await pool.query(`update conversations set updated_at = now(), status = 'active' where id = $1`, [input.conversationId]);
  return mapMessage(result.rows[0]!);
}

export async function updateConversationStatus(conversationId: string, status: Conversation['status']): Promise<void> {
  await pool.query(
    `update conversations
     set status = $2,
         cancelled_at = case when $2 = 'cancelled' then now() else cancelled_at end,
         updated_at = now()
     where id = $1`,
    [conversationId, status]
  );
}

export async function updateConversationTitle(conversationId: string, title: string): Promise<void> {
  await pool.query(`update conversations set title = $2, updated_at = now() where id = $1 and (title is null or title = '')`, [conversationId, title]);
}

export async function attachInferenceLog(input: InferenceLog & { redacted?: boolean }): Promise<InferenceLog & { id: string }> {
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
      JSON.stringify(input.redactionSummary ?? { redacted: false, rules: [] }),
      input.redacted ?? false
    ]
  );

  return { ...input, id: result.rows[0]!.id };
}

export async function updateMessageInferenceLink(messageId: string, inferenceLogId: string): Promise<void> {
  await pool.query(`update messages set inference_log_id = $2 where id = $1`, [messageId, inferenceLogId]);
}