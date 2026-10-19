# Architecture

## Runtime

The UI is static HTML, CSS and JavaScript in `public/`. Vercel routes `/api/*` to the Node.js function in `api/[...route].mjs`, which adapts requests to the shared API handler. The `pg` connection pool accesses PostgreSQL using the server-only `DATABASE_URL`. Schema migrations are in `database/migrations/` and run with `npm run db:migrate`.

Owner authentication uses a server configured password and HMAC signed session token. The token expires after eight hours. The browser never receives the signing secret, OpenAI key, database credentials or full prompt usage logs. Every mutating route checks authorization and validates inputs server-side.

## Workflow execution

The CEO planner uses a deterministic rule-based plan without API cost. When OpenAI, model pricing and a positive owner spending cap are configured, the planner can use the Responses API and strict JSON schema. Non-research task runs create versioned drafts that wait for owner review. Dependency completion gates task execution. Pause and daily limits are checked on the server.

Research tasks use the OpenAI Responses API web-search tool when the OpenAI key, model-specific token prices, a positive owner spending cap, and `OPENAI_WEB_SEARCH_USD_PER_CALL` are configured. Research-required status is persisted per task, including tasks assigned to non-research roles. The server saves only HTTPS URL citations returned by OpenAI, displays them as links, and refuses to save research drafts without citations. If web search is not fully configured, research tasks remain blocked. Publishing, advertising spend, manufacturing orders, commerce operations and destructive actions are not integrated.

## Local development and deployment

`vercel dev` serves the site and API locally. Apply migrations with `npm run db:migrate` against the configured `DATABASE_URL`. Production deployment uses GitHub continuous deployment through Vercel and requires a PostgreSQL provider plus server-side environment variables for the database URL, owner password and session secret. OpenAI variables are optional until paid AI work is enabled; web-search price configuration is additionally required for research.

## Operational boundaries

The current app is a single-owner factory dashboard. It does not provide team accounts, public registration, image generation, job queues, external publishing or production commerce integrations. API calls use response token limits and an owner-configured daily cost cap; research reservations include a conservative allowance of five web-search calls, and actual token and search-call usage is recorded afterward. A local demo can run rule-based planning and persistence without OpenAI credentials.
