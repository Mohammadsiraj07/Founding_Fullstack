# LLM Inference Logger

This repository is a lightweight inference logging and ingestion system for an LLM chatbot.

## What’s included

- React + TypeScript chat UI with multi-turn conversation state, resume, and cancel controls
- Express + TypeScript backend with streamed Gemini responses over SSE
- Shared schema validation and PII redaction helpers
- Logger wrapper that captures model, provider, latency, token counts, timestamps, status, IDs, and previews
- Queue-based ingestion with Redis + BullMQ and a worker that validates, redacts, and persists logs
- PostgreSQL schema for conversations, messages, and inference logs
- Prometheus + Grafana dashboards for latency, throughput, and worker errors
- Kubernetes manifests for self-hosted deployment

## Quick start

1. Copy `.env.example` to `.env` and set `GEMINI_API_KEY`.
2. Install dependencies:
	```bash
	npm install
	```
	3. Start the full local stack (one command):
		```bash
		docker compose up --build
		```

	Note: the compose file includes a `deps` bootstrap service that runs `npm install` into a shared `node_modules` volume before the app services start. That means `docker compose up --build` acts as a single command to bring up the whole stack without baking `node_modules` into images. If you prefer to manage dependencies locally, run `npm install` yourself and skip the `deps` service.
4. Open the app at `http://localhost:5173`.

Local services exposed by compose:
- API: `http://localhost:3001`
- Web UI: `http://localhost:5173`
- Worker metrics: `http://localhost:3002/metrics`
- Prometheus: `http://localhost:9090`
- Grafana: `http://localhost:3000` (`admin` / `admin`)

If you prefer running services directly:
```bash
npm run dev
```

Security note: `.env` is listed in `.gitignore` and this repo includes a `.env.example` with placeholders. Do not commit real API keys or secrets; rotate any keys accidentally committed.

## Architecture notes

- The frontend sends chat requests to the API, then consumes SSE events to render assistant output incrementally.
- The API stores user/assistant messages, keeps context short, and forwards structured inference logs to the ingestion endpoint.
- The ingestion endpoint validates payloads, enqueues jobs, and returns quickly so chat latency stays low.
- The worker validates again, applies deterministic PII redaction, and writes the final record to PostgreSQL.
- Prometheus scrapes API and worker metrics; Grafana reads those metrics through a provisioned datasource.

## Schema decisions

- `conversations` stores lifecycle state, session linkage, and UI-friendly summary fields.
- `messages` stores the durable chat transcript and can link to an inference log row.
- `inference_logs` stores operational metadata, previews, token counts, timing, and redaction summary data.
- `jsonb` is used for flexible metadata so provider-specific fields can evolve without frequent schema changes.

## Tradeoffs

- SSE keeps streaming simple for one-way assistant output; websockets would be heavier than needed here.
- PII redaction is regex-based for determinism and low overhead; it is not a full NLP entity recognizer.
- The queue adds durability and backpressure at the cost of one more moving part in local dev.
- The implementation is provider-neutral at the logging layer, even though Gemini is the first adapter.

## Deployment notes

- Local orchestration is defined in [docker-compose.yml](docker-compose.yml).
- Kubernetes manifests live in [k8s/](k8s/); apply them with `kubectl apply -k k8s` after building and publishing images.
- The example secret manifest in [k8s/secret.example.yaml](k8s/secret.example.yaml) is a template only; replace it before deploying.

## What I’d improve next

- Add stronger PII detection and a redaction audit table
- Add auth and per-user isolation
- Add multi-provider adapters and provider selection UI
- Add image build/push automation for Kubernetes deployments