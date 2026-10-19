alter table factory_tasks
  add column if not exists needs_live_research boolean not null default false;

update factory_tasks t
set needs_live_research = true
from factory_agents a
where t.agent_id = a.id
  and (
    a.department = 'Market Research'
    or t.blocked_reason = 'Live research is not configured. This task will not invent current findings or customer data.'
  );
