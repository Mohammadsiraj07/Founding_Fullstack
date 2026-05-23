import { GoogleGenerativeAI } from '@google/generative-ai';
import type { TokenUsage } from '@llm/logger';

function isQuotaError(error: unknown): boolean {
  return error instanceof Error && /429|quota|rate limit/i.test(error.message);
}

function buildFallbackText(messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>): string {
  const latestUserMessage = [...messages].reverse().find((message) => message.role === 'user')?.content ?? '';
  const preview = latestUserMessage.trim().slice(0, 300);

  if (!preview) {
    return 'Gemini is currently rate-limited, so I am using a local fallback response. Send another message once your quota resets or billing is enabled.';
  }

  return [
    'Gemini is currently rate-limited, so I am using a local fallback response.',
    `You said: "${preview}".`,
    'I can keep the conversation going, but this reply is generated locally until the quota issue is resolved.'
  ].join(' ');
}

async function streamText(text: string, onDelta: (delta: string) => void): Promise<void> {
  const chunks = text.match(/.{1,80}(?:\s|$)/g) ?? [text];

  for (const chunk of chunks) {
    onDelta(chunk);
    await Promise.resolve();
  }
}

export async function streamGeminiResponse(input: {
  apiKey: string;
  modelName: string;
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  signal?: AbortSignal | undefined;
  onDelta: (delta: string) => void;
}): Promise<{ text: string; usage?: TokenUsage }> {
  if (!input.apiKey) {
    const fallbackText = buildFallbackText(input.messages);
    await streamText(fallbackText, input.onDelta);
    return { text: fallbackText };
  }

  try {
    const client = new GoogleGenerativeAI(input.apiKey);
    const model = client.getGenerativeModel({ model: input.modelName });
    const contents = input.messages.map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }]
    }));

    const result = await model.generateContentStream({ contents });
    let text = '';

    for await (const chunk of result.stream) {
      if (input.signal?.aborted) {
        throw new DOMException('The operation was aborted', 'AbortError');
      }

      const delta = chunk.text();
      if (delta) {
        text += delta;
        input.onDelta(delta);
      }
    }

    const response = await result.response;
    const usage = response.usageMetadata
      ? {
          promptTokenCount: response.usageMetadata.promptTokenCount ?? undefined,
          completionTokenCount: response.usageMetadata.candidatesTokenCount ?? undefined,
          totalTokenCount: response.usageMetadata.totalTokenCount ?? undefined
        }
      : undefined;

    return usage ? { text, usage } : { text };
  } catch (error) {
    if (!isQuotaError(error)) {
      throw error;
    }

    const fallbackText = buildFallbackText(input.messages);
    await streamText(fallbackText, input.onDelta);
    return { text: fallbackText };
  }
}