# Workflow behavior

1. The owner signs in; on first use, the browser provides the generated roster and the server validates and stores the CEO plus all 31 numbered roles in PostgreSQL.
2. The owner submits an objective. The server validates length, pause state and the daily task limit.
3. The CEO creates an eight-step plan. Without OpenAI configuration, a deterministic rule planner assigns roles and a dependency chain. With configured OpenAI and a positive daily spending cap, the Responses API returns a schema-validated plan and token usage is recorded.
4. Research-required tasks are marked in the database. When OpenAI model pricing, the web-search price, and the owner spending cap are configured, these tasks can use OpenAI web search; otherwise they remain blocked. Research drafts must include HTTPS citations returned by the search-enabled Responses API.
5. Eligible tasks run through OpenAI when configured. The resulting draft and any source citations are saved as an output revision and wait for owner review.
6. The owner can approve, reject or request a revision. Dependent tasks become eligible only after prerequisite tasks are approved/completed. The audit log records changes.

The owner can pause new workflows and control daily task and spending limits in Settings. No model call is made without configured per-token rates, a positive daily budget and a conservative pre-call reservation. Research calls also require `OPENAI_WEB_SEARCH_USD_PER_CALL`; the reservation includes five estimated search calls and actual returned search calls are billed to usage records. External publication, ad spend, manufacturing and live commerce actions are not connected.
