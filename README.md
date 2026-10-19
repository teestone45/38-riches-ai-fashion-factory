# 38 RICHES AI Fashion Factory

This is an owner-controlled Vercel app with a serverless API and PostgreSQL database. Agents, workflows, dependencies, deliverable revisions, review decisions, settings and audit events are stored server-side. The CEO creates a saved rule-based plan without API credits; when OpenAI is configured, it creates a validated plan through the Responses API. Model and web-search research tasks run server-side and await owner review with clickable source citations.

## Run locally

Requires Node.js 20.12.2 or newer, Vercel CLI, and a PostgreSQL database. Connect the GitHub repository to Vercel or install the CLI with `npm install --global vercel`.

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env` and set `DATABASE_URL`, an owner password (16+ characters), and a session secret (32+ characters). The Vercel Neon integration injects `DATABASE_URL`; the app also accepts `STORAGE_URL` for integrations using that variable name.
3. Run `npm run db:migrate` to create the database schema.
4. Run `npm run dev`; Vercel Dev serves the static site and API routes.
5. Open the local URL printed by Vercel and sign in with `FACTORY_OWNER_PASSWORD`.
6. To enable model work, set `OPENAI_API_KEY`, an `OPENAI_MODEL` available to your API project, and that model's input/output USD-per-million-token rates in `.env`. Set a positive daily spending limit in Settings, restart Vercel Dev, create a workflow and run a task.
7. To enable live research, also set `OPENAI_WEB_SEARCH_USD_PER_CALL` to the current price for your OpenAI project's web search calls. The app reserves a conservative search allowance before research and records actual search-call charges with token usage.

Generate strong local secrets with this PowerShell command:

    node -e "const c=require('crypto');console.log('FACTORY_OWNER_PASSWORD='+c.randomBytes(24).toString('base64url'));console.log('FACTORY_SESSION_SECRET='+c.randomBytes(32).toString('base64url'))"

Never commit .env. OpenAI keys are read only by the server function and are not returned to the browser.

## Working features

- 32 unique named profiles: the CEO plus all 31 numbered specialist roles.
- Owner password login with signed, expiring session tokens.
- Postgres storage for profiles, workflows, task dependencies, outputs, revisions, reviews, owner limits and audit events.
- Objective planning with role assignments and dependency links. The rule planner works without AI credits; configured OpenAI provides schema-validated planning.
- Server-side model and OpenAI web-search execution, cited research drafts, versioning, owner approve/reject/revision actions and dependency gates.
- Pause control, daily task limit and spending limit settings.
- Research tasks stay blocked unless OpenAI, model token pricing and web-search pricing are configured. Publishing, ad spend, manufacturing and live commerce actions are not connected.

## Deploy to Vercel

1. Push the project to GitHub and import that repository in Vercel.
2. Neon is connected through Vercel Marketplace and provides `DATABASE_URL` to the project. The app and migration script also accept `STORAGE_URL` for integrations using that variable name.
3. Add `FACTORY_OWNER_PASSWORD` and `FACTORY_SESSION_SECRET`. Add the OpenAI key, model, token prices, and web-search price only if enabling paid AI features. Keep all values server-side; do not commit `.env`.
4. After linking the project and setting its production environment variables, run `vercel env pull .env.production.local --environment=production`, then `npm run db:migrate` to apply schema migrations. The pulled file is gitignored; never commit it. Redeploy after the migration succeeds.

Vercel serves static files from `public/` and routes `/api/*` through the catch-all serverless function in `api/`.

See docs/architecture.md, docs/workflows.md, docs/agent-roles.md and docs/api.md.
