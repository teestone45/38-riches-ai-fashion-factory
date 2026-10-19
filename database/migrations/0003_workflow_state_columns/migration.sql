alter table workflow_runs
  add column if not exists plan_summary text not null default '';

alter table factory_tasks
  add column if not exists needs_live_research boolean not null default false;
