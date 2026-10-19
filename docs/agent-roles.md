# Agent roster

Agent names are generated at first workspace initialization by selecting distinct first and last names from local lists. The resulting profiles persist in PostgreSQL. Names are professional display names, not verified identities. Avatars use initials and a generated color, so no personal photos are implied.

The app seeds a CEO and the 31 numbered specialist roles in `public/app.js`. Each profile includes department, role, status, task count and task history seam. Role descriptions and capability boundaries are visible in the workforce profile dialog. Research-designated tasks may use OpenAI web search when configured; other external tool access and quality metrics are not provided.
