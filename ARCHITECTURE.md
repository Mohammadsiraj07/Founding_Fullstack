# Architecture Overview

This document summarizes the architecture, dataflow, schema decisions, security notes, and deployment options for the LLM Inference Logger project.

## High-level components

- **Web UI (`apps/web`)**: React + Vite chat client. Sends chat requests to the API, consumes SSE streaming responses, and displays formatted assistant output. Short conversation context is kept in the browser and sent with requests.
- **API (`apps/api`)**: Express + TypeScript. Receives chat requests, invokes provider adapters (Gemini / Groq), streams assistant deltas back to the client via SSE, stores messages, and enqueues inference log payloads to Redis/BullMQ ingestion queue.
- **Worker (`apps/worker`)**: BullMQ worker that consumes `inference-logs` jobs, validates payloads (Zod), applies deterministic PII redaction, writes `inference_logs` rows to Postgres, and increments Prometheus metrics.
- **Database (`db/schema.sql`)**: Postgres stores `conversations`, `messages`, and `inference_logs`. `inference_logs.redaction_summary` is a `jsonb` field persisting scrub results.
- **Queue / Broker**: Redis + BullMQ provide durable job enqueueing for ingestion; helps decouple chat latency from persistence work.
- **Providers**: Provider adapters live under `apps/api/src/providers/` and implement streaming semantics and provider-specific metadata capturing.
- **Observability**: `prom-client` exposes `/metrics` in API and worker; Prometheus scrapes metrics and Grafana dashboards are provisioned under `infra/monitoring/grafana`.

## Dataflow (step-by-step)

1. User types a message in the Web UI; the client posts to `POST /chat` on the API with a short context (N most-recent messages by design).
2. API writes the user message to `messages` and calls the provider adapter (e.g. Gemini or Groq) wrapped with `withInferenceLogging` (packages/logger).
3. The provider streams partial assistant output; API forwards deltas to the client via SSE and accumulates the output preview.
4. Meanwhile, the API constructs an `InferenceLog` payload (model, provider, timings, token counts, previews, status, conversation/session id, any provider metadata) and quickly enqueues it into BullMQ (`inference-logs` queue) and returns to the client — minimizing chat latency.
5. The Worker consumes the enqueued job, validates with Zod schemas (`packages/shared`), applies deterministic regex-based PII redaction (`redactInferenceLogPayload`), and persists a final row in `inference_logs` (including `redaction_summary` JSONB) and links to `messages` by id when applicable.
6. Prometheus scrapes the API and worker `/metrics` endpoints for dashboards and alerting.

## Schema & Validation

- Schemas are defined using Zod in `packages/shared`. Key schemas:
  - `ChatRequestSchema` — shape of requests from the UI.
  - `InferenceLogSchema` — canonical ingestion payload for logs.
  - `RedactionSummarySchema` — structure for redaction results persisted with each log.
- `jsonb` is used for flexible provider metadata so the schema can evolve without DB migrations for every provider-specific field.

## PII Redaction

- Deterministic, regex-based redaction is applied in the worker to ensure consistent removal of detected patterns before long-term persistence.
- A `redaction_summary` field records what was redacted (counts and categories) to allow audit and debugging without storing original plaintext.
- Tradeoff: deterministic regex is fast and explainable but misses contextual PII that an NLP NER model would capture.

## Metrics & Observability

- The API and Worker expose Prometheus metrics via `prom-client`:
  - `llm_inference_requests_total` — requests received
  - `llm_inference_latency_ms` — timing histogram for LLM calls
  - `llm_ingest_jobs_total` — jobs enqueued and processed by the worker
  - `llm_worker_job_duration_ms` — worker processing durations
- Grafana dashboards are provisioned in `infra/monitoring/grafana` and include panels for latency, throughput, errors, and worker queue length.

## Deployment

- **Local / Development**: `docker compose up --build` boots a `deps` bootstrap service (installs npm into shared `node_modules`), API, Web, Worker, Postgres, Redis, Prometheus, and Grafana.
- **Production / K8s**: `k8s/` contains manifests for each component. Recommended next steps before production:
  - Add image build & push automation (CI) and update manifests to use registry images.
  - Swap `.env` secrets for Kubernetes `Secrets` or a secret manager.
  - Add horizontal autoscaling for the Worker and API with resource limits and liveness/readiness probes.

## Security & Secrets

- Keep provider API keys and database credentials outside the repo. Use `.env` (local) and secrets stores in CI/K8s for production.
- Rotate keys immediately if accidentally committed. Consider running `git-filter-repo`/BFG if secrets were previously pushed.

## Tradeoffs & Rationale

- Queue-based ingestion ensures user-facing latency is dominated by the streaming response rather than durable persistence.
- Regex-based redaction is intentionally simple for determinism and performance; consider adding NER-based redaction/audit later.
- SSE streaming is simpler than WebSockets for one-way assistant output and works well with proxying and autoscaling.

## Next Improvements

- Add CI to build and push Docker images then update `k8s/` manifests automatically.
- Add per-user auth, RBAC, and multi-tenant isolation for production workloads.
- Expand PII detection to include ML/NLP NER models and provide a redaction review UI.

Files of interest:
- `apps/api/src/index.ts` — API entry and streaming logic
- `apps/api/src/providers/*` — provider adapters
- `packages/shared/src/index.ts` — Zod schemas and redaction helpers
- `apps/worker/src/index.ts` — ingestion consumer and DB persistence
- `db/schema.sql` — Postgres schema
