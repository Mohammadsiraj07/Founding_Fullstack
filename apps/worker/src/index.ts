import express from 'express';
import { Worker } from 'bullmq';
import { InferenceLogSchema, redactInferenceLogPayload } from '@llm/shared';
import { env } from './env.js';
import { insertInferenceLog, linkMessageToLog, touchConversation } from './db.js';
import { inferenceLatency, inferenceRequests, inferenceTokens, jobLatency, jobsProcessed, metricsText, redactedRecords, workerErrors } from './metrics.js';

const app = express();

app.disable('x-powered-by');

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'llm-inference-logger-worker' });
});

app.get('/metrics', async (_req, res) => {
  res.setHeader('content-type', 'text/plain; version=0.0.4');
  res.send(await metricsText());
});

app.listen(env.WORKER_PORT, () => {
  console.log(`Worker metrics listening on http://localhost:${env.WORKER_PORT}`);
});

const worker = new Worker(
  'inference-logs',
  async (job) => {
    const startedAt = Date.now();
    try {
      const validated = InferenceLogSchema.parse(job.data);
      const redacted = redactInferenceLogPayload(validated);
      const inferenceLogId = await insertInferenceLog(redacted);
      await linkMessageToLog(redacted.messageId, inferenceLogId);
      await touchConversation(redacted.conversationId);

      inferenceLatency.observe({ provider: redacted.provider, model: redacted.model, status: redacted.status }, redacted.latencyMs);
      inferenceRequests.inc({ provider: redacted.provider, model: redacted.model, status: redacted.status });

      if (typeof redacted.promptTokenCount === 'number') {
        inferenceTokens.inc({ provider: redacted.provider, model: redacted.model, kind: 'prompt' }, redacted.promptTokenCount);
      }
      if (typeof redacted.completionTokenCount === 'number') {
        inferenceTokens.inc({ provider: redacted.provider, model: redacted.model, kind: 'completion' }, redacted.completionTokenCount);
      }
      if (typeof redacted.totalTokenCount === 'number') {
        inferenceTokens.inc({ provider: redacted.provider, model: redacted.model, kind: 'total' }, redacted.totalTokenCount);
      }

      if (redacted.redacted) {
        redactedRecords.inc();
      }

      jobsProcessed.inc({ status: redacted.status });
      jobLatency.observe(Date.now() - startedAt);
      return { inferenceLogId };
    } catch (error) {
      workerErrors.inc();
      throw error;
    }
  },
  {
    connection: {
      url: env.REDIS_URL
    }
  }
);

void worker.waitUntilReady();