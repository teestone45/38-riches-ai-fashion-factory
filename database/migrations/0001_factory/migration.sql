create table if not exists factory_company (
  id uuid primary key default gen_random_uuid(), singleton boolean not null default true unique check (singleton),
  name text not null default '38 RICHES AI FASHION FACTORY', brand text not null default '38 RICHES',
  created_at timestamptz not null default now()
);
insert into factory_company(singleton) values(true) on conflict(singleton) do nothing;

create table if not exists factory_settings (
  company_id uuid primary key references factory_company(id) on delete cascade,
  paused boolean not null default false, daily_task_limit integer not null default 20 check(daily_task_limit between 1 and 500),
  daily_spending_limit numeric(12,2) not null default 0 check(daily_spending_limit >= 0),
  require_approval boolean not null default true, updated_at timestamptz not null default now()
);
insert into factory_settings(company_id) select id from factory_company where singleton on conflict(company_id) do nothing;

create table if not exists factory_departments (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references factory_company(id) on delete cascade,
  name text not null, description text not null default '', enabled boolean not null default true,
  unique(company_id,name), unique(id,company_id)
);
create table if not exists factory_agents (
  id uuid primary key default gen_random_uuid(), agent_code text not null unique,
  company_id uuid not null references factory_company(id) on delete cascade,
  name text not null, title text not null, department text not null, role_description text not null, avatar_color text not null default '#38445e',
  status text not null default 'idle' check(status in ('idle','working','awaiting_approval','error','disabled')),
  created_at timestamptz not null default now(), unique(company_id,title)
);
create table if not exists workflow_runs (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references factory_company(id) on delete cascade,
  objective text not null, title text not null, planner text not null check(planner in ('rule_planner','openai_responses')),
  status text not null default 'active' check(status in ('active','awaiting_approval','complete','failed','paused')),
  created_at timestamptz not null default now()
);
create index if not exists workflow_runs_created_idx on workflow_runs(created_at desc);
create table if not exists factory_tasks (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references factory_company(id) on delete cascade,
  workflow_id uuid not null references workflow_runs(id) on delete cascade,
  agent_id uuid not null references factory_agents(id), title text not null, description text not null,
  status text not null default 'queued' check(status in ('queued','working','blocked','awaiting_approval','complete','failed')),
  blocked_reason text, attempt_count integer not null default 0, started_at timestamptz, finished_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists factory_tasks_workflow_idx on factory_tasks(workflow_id,created_at);
create index if not exists factory_tasks_status_idx on factory_tasks(status,created_at desc);
create table if not exists factory_task_dependencies (
  task_id uuid not null references factory_tasks(id) on delete cascade,
  depends_on_task_id uuid not null references factory_tasks(id) on delete cascade,
  primary key(task_id,depends_on_task_id), check(task_id <> depends_on_task_id)
);
create table if not exists factory_task_outputs (
  id uuid primary key default gen_random_uuid(), task_id uuid not null references factory_tasks(id) on delete cascade,
  revision integer not null, title text not null, summary text not null, content text not null,
  assumptions jsonb not null default '[]', evidence jsonb not null default '[]',
  review_status text not null default 'awaiting_approval' check(review_status in ('draft','awaiting_approval','approved','rejected','revision_requested')),
  reviewer_note text, created_at timestamptz not null default now(), unique(task_id,revision)
);
create table if not exists factory_audit_log (
  id bigint generated always as identity primary key, event_type text not null, entity_type text not null,
  entity_id text, details jsonb not null default '{}', created_at timestamptz not null default now()
);
create index if not exists factory_audit_created_idx on factory_audit_log(created_at desc);
create table if not exists factory_api_usage (
  id uuid primary key default gen_random_uuid(), model text not null, operation text not null,
  task_id uuid references factory_tasks(id) on delete set null,
  workflow_id uuid references workflow_runs(id) on delete set null,
  input_tokens integer not null default 0, output_tokens integer not null default 0,
  cost_usd numeric(12,8) not null, status text not null check(status in ('reserved','complete','failed')),
  created_at timestamptz not null default now()
);
create index if not exists factory_api_usage_daily_idx on factory_api_usage(created_at desc);
create table if not exists factory_products (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references factory_company(id) on delete cascade,
  name text not null, category text not null, stage text not null default 'concept', specification jsonb not null default '{}', created_at timestamptz not null default now()
);
create table if not exists factory_campaigns (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references factory_company(id) on delete cascade,
  name text not null, status text not null default 'draft', budget numeric(12,2) not null default 0 check(budget >= 0),
  brief jsonb not null default '{}', created_at timestamptz not null default now()
);
