import { z } from 'zod';

export const ProviderSchema = z.enum(['groq', 'gemini', 'claude', 'openai', 'deepseek', 'grok']);
export const InferenceStatusSchema = z.enum(['success', 'error', 'cancelled']);
export const MessageRoleSchema = z.enum(['user', 'assistant', 'system']);
export const ConversationStatusSchema = z.enum(['active', 'cancelled', 'archived']);

export const RedactionSummarySchema = z.object({
  redacted: z.boolean().default(false),
  rules: z.array(z.string()).default([])
});

export const ChatMessageSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  role: MessageRoleSchema,
  content: z.string(),
  inferenceLogId: z.string().uuid().nullable().optional(),
  createdAt: z.string().datetime()
});

export const ConversationSchema = z.object({
  id: z.string().uuid(),
  title: z.string().nullable(),
  sessionId: z.string().nullable(),
  status: ConversationStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  cancelledAt: z.string().datetime().nullable().optional(),
  lastMessagePreview: z.string().optional()
});

export const ChatRequestSchema = z.object({
  conversationId: z.string().uuid().optional(),
  sessionId: z.string().min(1).max(200).optional(),
  message: z.string().min(1).max(12000),
  provider: ProviderSchema.default('groq'),
  model: z.string().min(1).default('gemini-2.0-flash'),
  contextSize: z.number().int().min(1).max(20).default(8)
});

export const ConversationCreateSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  sessionId: z.string().min(1).max(200).optional()
});

export const InferenceLogSchema = z.object({
  conversationId: z.string().uuid(),
  messageId: z.string().uuid(),
  sessionId: z.string().min(1).max(200).optional(),
  provider: ProviderSchema.or(z.string().min(1)),
  model: z.string().min(1),
  status: InferenceStatusSchema,
  latencyMs: z.number().int().nonnegative(),
  requestStartedAt: z.string().datetime(),
  requestFinishedAt: z.string().datetime(),
  promptTokenCount: z.number().int().nonnegative().optional(),
  completionTokenCount: z.number().int().nonnegative().optional(),
  totalTokenCount: z.number().int().nonnegative().optional(),
  inputPreview: z.string().max(4096),
  outputPreview: z.string().max(4096).default(''),
  errorMessage: z.string().max(4000).optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  redacted: z.boolean().default(false),
  redactionSummary: RedactionSummarySchema.default({ redacted: false, rules: [] })
});

export type Provider = z.infer<typeof ProviderSchema>;
export type Conversation = z.infer<typeof ConversationSchema>;
export type ConversationCreateInput = z.infer<typeof ConversationCreateSchema>;
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type ChatRequest = z.infer<typeof ChatRequestSchema>;
export type InferenceLog = z.infer<typeof InferenceLogSchema>;
export type RedactionSummary = z.infer<typeof RedactionSummarySchema>;

export function truncatePreview(value: string, maxLength = 240): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function compactConversationPreview(messages: Array<{ role: string; content: string }>): string {
  return truncatePreview(
    messages
      .map((message) => `${message.role}: ${message.content}`)
      .join('\n'),
    400
  );
}

export function generateConversationTitle(message: string, maxWords = 6): string {
  const cleaned = message.trim().replace(/\s+/g, ' ');
  if (!cleaned) {
    return 'Untitled conversation';
  }

  const firstSentence = cleaned.split(/[.?!]/)[0] ?? cleaned;
  const normalized = firstSentence
    .replace(/^(how do i|how can i|how to|what is|what are|why is|why are|can you|could you|would you|please help me|please|help me|i need to|i need|i want to|i want)\b\s*/i, '')
    .replace(/^(the|a|an)\b\s*/i, '')
    .replace(/[,:;\-]+$/g, '')
    .trim();

  const words = normalized.split(' ').filter(Boolean);
  const title = words.slice(0, maxWords).join(' ');
  if (!title) {
    return 'Untitled conversation';
  }

  const compactTitle = title.length > 60 ? `${title.slice(0, 57).replace(/\s+\S*$/, '').trim()}...` : title;
  return compactTitle.charAt(0).toUpperCase() + compactTitle.slice(1);
}

export function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function redactText(value: string): { value: string; redacted: boolean; rules: string[] } {
  const appliedRules = new Set<string>();

  let next = value;
  const replacements: Array<[RegExp, string, string]> = [
    [/\b([a-zA-Z0-9._%+-]+)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/g, '[redacted-email]', 'email'],
    [/\b\d{3}-\d{2}-\d{4}\b/g, '[redacted-ssn]', 'ssn'],
    [/\b(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b/g, '[redacted-phone]', 'phone'],
    [/\b(?:\d[ -]*?){13,16}\b/g, '[redacted-card]', 'credit-card']
  ];

  for (const [pattern, replacement, rule] of replacements) {
    if (pattern.test(next)) {
      appliedRules.add(rule);
      next = next.replace(pattern, replacement);
    }
  }

  return { value: next, redacted: appliedRules.size > 0, rules: Array.from(appliedRules) };
}

function redactRecord(value: unknown): { value: unknown; redacted: boolean; rules: string[] } {
  if (value == null) {
    return { value, redacted: false, rules: [] };
  }

  if (typeof value === 'string') {
    return redactText(value);
  }

  if (Array.isArray(value)) {
    const redactedItems = value.map((item) => redactRecord(item));
    return {
      value: redactedItems.map((item) => item.value),
      redacted: redactedItems.some((item) => item.redacted),
      rules: Array.from(new Set(redactedItems.flatMap((item) => item.rules)))
    };
  }

  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    let redacted = false;
    const rules = new Set<string>();

    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (/password|secret|token|key|api[-_]?key/i.test(key) && typeof entry === 'string') {
        result[key] = '[redacted-secret]';
        redacted = true;
        rules.add('sensitive-key');
        continue;
      }

      const redactedEntry = redactRecord(entry);
      result[key] = redactedEntry.value;
      redacted ||= redactedEntry.redacted;
      redactedEntry.rules.forEach((rule) => rules.add(rule));
    }

    return { value: result, redacted, rules: Array.from(rules) };
  }

  return { value, redacted: false, rules: [] };
}

export function redactInferenceLogPayload(input: InferenceLog): InferenceLog {
  const inputPreview = redactText(input.inputPreview);
  const outputPreview = redactText(input.outputPreview);
  const errorMessage = input.errorMessage ? redactText(input.errorMessage) : { value: undefined, redacted: false, rules: [] };
  const metadata = redactRecord(input.metadata);

  const redacted = input.redacted || inputPreview.redacted || outputPreview.redacted || errorMessage.redacted || metadata.redacted;
  const rules = Array.from(new Set([
    ...(input.redactionSummary?.rules ?? []),
    ...inputPreview.rules,
    ...outputPreview.rules,
    ...errorMessage.rules,
    ...metadata.rules
  ]));

  return {
    ...input,
    inputPreview: inputPreview.value,
    outputPreview: outputPreview.value,
    errorMessage: errorMessage.value,
    metadata: metadata.value as Record<string, unknown>,
    redacted,
    redactionSummary: { redacted, rules }
  };
}