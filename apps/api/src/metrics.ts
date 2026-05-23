import client from 'prom-client';

client.collectDefaultMetrics();

export const inferenceLatency = new client.Histogram({
  name: 'llm_inference_latency_ms',
  help: 'Latency of LLM requests in milliseconds',
  labelNames: ['provider', 'model', 'status'],
  buckets: [50, 100, 200, 400, 800, 1200, 2000, 4000, 8000]
});

export const inferenceRequests = new client.Counter({
  name: 'llm_inference_requests_total',
  help: 'Total number of inference requests',
  labelNames: ['provider', 'model', 'status']
});

export const inferenceTokens = new client.Counter({
  name: 'llm_inference_tokens_total',
  help: 'Total tokens observed in inference responses',
  labelNames: ['provider', 'model', 'kind']
});

export const ingestRequests = new client.Counter({
  name: 'llm_ingest_requests_total',
  help: 'Total ingestion requests received',
  labelNames: ['status']
});

export const ingestQueueLatency = new client.Histogram({
  name: 'llm_ingest_enqueue_latency_ms',
  help: 'Time spent accepting and queueing inference logs',
  buckets: [1, 5, 10, 25, 50, 100, 250, 500]
});

export async function metricsText(): Promise<string> {
  return client.register.metrics();
}