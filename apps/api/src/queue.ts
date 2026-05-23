import { Queue } from 'bullmq';
import { env } from './env.js';

export const inferenceLogQueueName = 'inference-logs';

export const inferenceLogQueue = new Queue(inferenceLogQueueName, {
  connection: {
    url: env.REDIS_URL
  }
});

export async function enqueueInferenceLog(payload: unknown): Promise<void> {
  await inferenceLogQueue.add('ingest', payload, {
    attempts: 3,
    removeOnComplete: true,
    removeOnFail: false
  });
}