# API reference

All API routes are served by the Vercel Node.js function at `/api/*`. Except `/api/health` and `/api/auth/login`, requests require an `Authorization` bearer token. Responses are JSON; session tokens expire after eight hours and are held in browser session storage.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Report database, owner-auth, OpenAI and live-research readiness. |
| POST | `/api/auth/login` | Verify the configured owner password and issue a signed session. |
| GET | `/api/state` | Read settings, agents, workflows, tasks, outputs, reviews and activity. |
| POST | `/api/setup` | Initialize the 32-person roster on first sign-in. |
| POST | `/api/workflows` | Validate an objective, create a plan and persist task dependencies. |
| POST | `/api/tasks/:id/run` | Run an eligible task through OpenAI; research tasks use web search and require source citations. |
| POST | `/api/tasks/:id/review` | Approve, reject or request a revision of the current draft. |
| PATCH | `/api/settings` | Update pause, daily task, daily spend and approval settings. |

The owner password, signing secret and `DATABASE_URL` are read only by the function. Model requests use the Responses API with strict JSON schema output. Calls require an OpenAI key, model name, token prices and a positive daily spending cap. Research also requires `OPENAI_WEB_SEARCH_USD_PER_CALL`. The server reserves model cost plus an allowance for five search calls, then stores measured token and search usage afterward. Research outputs include only HTTPS URL citations returned by the API; research output without citations is rejected.

Research tasks remain blocked until OpenAI web search and its price are configured. This build does not connect publishing, ads, manufacturing, inventory or commerce actions. Those actions cannot be performed by the current API.
