create extension if not exists pgcrypto;

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  title text,
  session_id text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  inference_log_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_messages_conversation_created_at on messages (conversation_id, created_at desc);

create table if not exists inference_logs (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  message_id uuid not null references messages(id) on delete cascade,
  session_id text,
  provider text not null,
  model text not null,
  status text not null check (status in ('success', 'error', 'cancelled')),
  latency_ms integer not null,
  request_started_at timestamptz not null,
  request_finished_at timestamptz not null,
  prompt_token_count integer,
  completion_token_count integer,
  total_token_count integer,
  input_preview text not null,
  output_preview text not null default '',
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  redaction_summary jsonb not null default '{"redacted": false, "rules": []}'::jsonb,
  redacted boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_inference_logs_created_at on inference_logs (created_at desc);
create index if not exists idx_inference_logs_conversation_created_at on inference_logs (conversation_id, created_at desc);