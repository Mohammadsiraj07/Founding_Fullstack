import { InferenceLogSchema, compactConversationPreview, truncatePreview, type InferenceLog, type Provider } from '@llm/shared';

export type TokenUsage = {
  promptTokenCount?: number;
  completionTokenCount?: number;
  totalTokenCount?: number;
};

export type LoggedInferenceInput = {
  ingestUrl: string;
  conversationId: string;
  messageId: string;
  sessionId?: string | undefined;
  provider: string;
  model: string;
  inputMessages: Array<{ role: string; content: string }>;
  signal?: AbortSignal | undefined;
  metadata?: Record<string, unknown> | undefined;
  redacted?: boolean | undefined;
  run: (context: { signal?: AbortSignal | undefined }) => Promise<{ text: string; usage?: TokenUsage }>;
};

async function postInferenceLog(ingestUrl: string, payload: InferenceLog): Promise<void> {
  try {
    await fetch(`${ingestUrl.replace(/\/$/, '')}/ingest/logs`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
  } catch {
    // Logging must never block the chat path.
  }
}

export async function withInferenceLogging(input: LoggedInferenceInput): Promise<{ text: string; usage?: TokenUsage }> {
  const startedAt = new Date();
  try {
    const result = await input.run(input.signal ? { signal: input.signal } : {});
    const finishedAt = new Date();
    const payload = InferenceLogSchema.parse({
      conversationId: input.conversationId,
      messageId: input.messageId,
      sessionId: input.sessionId,
      provider: input.provider,
      model: input.model,
      status: 'success',
      latencyMs: finishedAt.getTime() - startedAt.getTime(),
      requestStartedAt: startedAt.toISOString(),
      requestFinishedAt: finishedAt.toISOString(),
      promptTokenCount: result.usage?.promptTokenCount,
      completionTokenCount: result.usage?.completionTokenCount,
      totalTokenCount: result.usage?.totalTokenCount,
      inputPreview: compactConversationPreview(input.inputMessages),
      outputPreview: truncatePreview(result.text, 400),
      metadata: input.metadata ?? {},
      redacted: input.redacted ?? false
    });

    void postInferenceLog(input.ingestUrl, payload);
    return result;
  } catch (error) {
    const finishedAt = new Date();
    const aborted = error instanceof DOMException && error.name === 'AbortError';
    const payload = InferenceLogSchema.parse({
      conversationId: input.conversationId,
      messageId: input.messageId,
      sessionId: input.sessionId,
      provider: input.provider,
      model: input.model,
      status: aborted ? 'cancelled' : 'error',
      latencyMs: finishedAt.getTime() - startedAt.getTime(),
      requestStartedAt: startedAt.toISOString(),
      requestFinishedAt: finishedAt.toISOString(),
      inputPreview: compactConversationPreview(input.inputMessages),
      outputPreview: '',
      errorMessage: error instanceof Error ? error.message : 'Unknown inference failure',
      metadata: input.metadata ?? {},
      redacted: input.redacted ?? false
    });

    void postInferenceLog(input.ingestUrl, payload);
    throw error;
  }
}