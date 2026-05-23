import client from 'prom-client';

client.collectDefaultMetrics();

export const jobsProcessed = new client.Counter({
  name: 'llm_worker_jobs_processed_total',
  help: 'Total ingestion jobs processed by the worker',
  labelNames: ['status']
});

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

export const jobLatency = new client.Histogram({
  name: 'llm_worker_job_duration_ms',
  help: 'How long worker jobs take to process',
  buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000]
});

export const redactedRecords = new client.Counter({
  name: 'llm_worker_redacted_records_total',
  help: 'Total records where PII redaction was applied'
});

export const workerErrors = new client.Counter({
  name: 'llm_worker_errors_total',
  help: 'Total worker failures'
});

export async function metricsText(): Promise<string> {
  return client.register.metrics();
}