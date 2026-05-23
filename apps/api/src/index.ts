import cors from 'cors';
import express from 'express';
import { withInferenceLogging } from '@llm/logger';
import { ChatRequestSchema, ConversationCreateSchema, InferenceLogSchema, truncatePreview } from '@llm/shared';
import {
  appendMessage,
  createConversation,
  getConversation,
  getRecentMessages,
  listConversations,
  listMessages,
  updateConversationStatus,
  updateConversationTitle
} from './db.js';
import { env } from './env.js';
import { ingestQueueLatency, ingestRequests, metricsText } from './metrics.js';
import { enqueueInferenceLog } from './queue.js';
import { streamGroqResponse } from './providers/groq.js';
import { streamGeminiResponse } from './providers/gemini.js';
import { generateConversationTitle } from '@llm/shared';

const app = express();
const activeGenerations = new Map<string, AbortController>();

app.disable('x-powered-by');
app.use(cors({ origin: ['http://localhost:5173'] }));
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'llm-inference-logger-api' });
});

app.get('/metrics', async (_req, res) => {
  res.setHeader('content-type', 'text/plain; version=0.0.4');
  res.send(await metricsText());
});

app.get('/conversations', async (_req, res, next) => {
  try {
    res.json(await listConversations());
  } catch (error) {
    next(error);
  }
});

app.post('/conversations', async (req, res, next) => {
  try {
    const payload = ConversationCreateSchema.parse(req.body ?? {});
    const conversation = await createConversation(payload);
    res.status(201).json(conversation);
  } catch (error) {
    next(error);
  }
});

app.get('/conversations/:conversationId', async (req, res, next) => {
  try {
    const conversation = await getConversation(req.params.conversationId);
    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }
    res.json(conversation);
  } catch (error) {
    next(error);
  }
});

app.get('/conversations/:conversationId/messages', async (req, res, next) => {
  try {
    res.json(await listMessages(req.params.conversationId));
  } catch (error) {
    next(error);
  }
});

app.post('/conversations/:conversationId/cancel', async (req, res, next) => {
  try {
    activeGenerations.get(req.params.conversationId)?.abort();
    activeGenerations.delete(req.params.conversationId);
    await updateConversationStatus(req.params.conversationId, 'cancelled');
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post('/ingest/logs', async (req, res, next) => {
  const acceptedAt = Date.now();
  try {
    const payload = InferenceLogSchema.parse(req.body ?? {});
    await enqueueInferenceLog(payload);
    ingestRequests.inc({ status: 'accepted' });
    ingestQueueLatency.observe(Date.now() - acceptedAt);
    res.status(202).json({ ok: true });
  } catch (error) {
    ingestRequests.inc({ status: 'rejected' });
    next(error);
  }
});

app.post('/chat', async (req, res, next) => {
  const controller = new AbortController();
  res.setHeader('content-type', 'text/event-stream; charset=utf-8');
  res.setHeader('cache-control', 'no-cache, no-transform');
  res.setHeader('connection', 'keep-alive');
  res.flushHeaders();

  const writeEvent = (event: string, data: unknown) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const payload = ChatRequestSchema.parse(req.body ?? {});
    const isNewConversation = !payload.conversationId;
    const conversationTitle = generateConversationTitle(payload.message);
    const conversationId =
      payload.conversationId ?? (await createConversation({ ...(payload.sessionId ? { sessionId: payload.sessionId } : {}), title: conversationTitle })).id;
    activeGenerations.set(conversationId, controller);

    if (!isNewConversation) {
      const existingConversation = await getConversation(conversationId);
      if (existingConversation && !existingConversation.title) {
        await updateConversationTitle(conversationId, conversationTitle);
      }
    }

    const userMessage = await appendMessage({
      conversationId,
      role: 'user',
      content: payload.message
    });

    const recentMessages = await getRecentMessages(conversationId, payload.contextSize);
    const inputMessages = recentMessages.length > 0 ? recentMessages : [{ role: 'user' as const, content: payload.message }];

    writeEvent('meta', {
      conversationId,
      messageId: userMessage.id,
      sessionId: payload.sessionId ?? null
    });

    const result = await withInferenceLogging({
      ingestUrl: env.INGEST_URL,
      conversationId,
      messageId: userMessage.id,
      ...(payload.sessionId ? { sessionId: payload.sessionId } : {}),
      provider: payload.provider,
      model: payload.model ?? env.DEFAULT_MODEL,
      inputMessages,
      signal: controller.signal,
      run: async ({ signal }) =>
        payload.provider === 'groq'
          ? streamGroqResponse({
              apiKey: env.GROQ_API_KEY,
              modelName: payload.model ?? 'llama-3.1-8b-instant',
              messages: inputMessages,
              ...(signal ? { signal } : {}),
              onDelta: (delta) => writeEvent('delta', { conversationId, delta })
            })
          : streamGeminiResponse({
              apiKey: env.GEMINI_API_KEY,
              modelName: payload.model ?? env.DEFAULT_MODEL,
              messages: inputMessages,
              ...(signal ? { signal } : {}),
              onDelta: (delta) => writeEvent('delta', { conversationId, delta })
            })
    });

    const assistantMessage = await appendMessage({
      conversationId,
      role: 'assistant',
      content: result.text
    });

    writeEvent('done', {
      conversationId,
      messageId: assistantMessage.id,
      text: truncatePreview(result.text, 400)
    });
    res.end();
    activeGenerations.delete(conversationId);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      writeEvent('cancelled', { ok: true });
      res.end();
      return;
    }

    writeEvent('error', { message: error instanceof Error ? error.message : 'Unknown error' });
    res.end();
    next(error);
  }
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : 'Unexpected server error';
  res.status(400).json({ error: message });
});

app.listen(env.API_PORT, () => {
  console.log(`API listening on http://localhost:${env.API_PORT}`);
});