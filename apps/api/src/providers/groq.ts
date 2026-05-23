import type { TokenUsage } from '@llm/logger';

function buildGroqMessages(messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>): Array<{ role: 'user' | 'assistant' | 'system'; content: string }> {
  return messages.map((message) => ({
    role: message.role,
    content: message.content
  }));
}

async function readGroqSse(response: Response, onDelta: (delta: string) => void, signal?: AbortSignal | undefined): Promise<string> {
  if (!response.body) {
    throw new Error('Groq response did not include a body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';

  while (true) {
    if (signal?.aborted) {
      throw new DOMException('The operation was aborted', 'AbortError');
    }

    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    let splitIndex = buffer.indexOf('\n\n');

    while (splitIndex !== -1) {
      const chunk = buffer.slice(0, splitIndex).trim();
      buffer = buffer.slice(splitIndex + 2);

      const dataLine = chunk.split('\n').find((line) => line.startsWith('data: '));
      if (dataLine) {
        const payload = dataLine.slice('data: '.length).trim();
        if (payload === '[DONE]') {
          return text;
        }

        const parsed = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const delta = parsed.choices?.[0]?.delta?.content ?? '';
        if (delta) {
          text += delta;
          onDelta(delta);
        }
      }

      splitIndex = buffer.indexOf('\n\n');
    }
  }

  return text;
}

export async function streamGroqResponse(input: {
  apiKey: string;
  modelName: string;
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  signal?: AbortSignal | undefined;
  onDelta: (delta: string) => void;
}): Promise<{ text: string; usage?: TokenUsage }> {
  if (!input.apiKey) {
    throw new Error('GROQ_API_KEY is required');
  }

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${input.apiKey}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: input.modelName,
      messages: buildGroqMessages(input.messages),
      stream: true
    }),
    ...(input.signal ? { signal: input.signal } : {})
  });

  if (!response.ok) {
    const message = await response.text().catch(() => 'Unknown Groq error');
    throw new Error(`Groq request failed (${response.status}): ${message}`);
  }

  const text = await readGroqSse(response, input.onDelta, input.signal);
  return { text };
}