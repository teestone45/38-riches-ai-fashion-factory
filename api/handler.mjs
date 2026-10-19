import { db } from "./lib/database.mjs";
import { createCEOPlan, createTaskDeliverable, createSession, constantTimeEqual, RESEARCH_BLOCKED_REASON, RESEARCH_DEPARTMENT, validateObjective, validateRoster, verifySession } from "./lib/core.mjs";

const env = (key) => process.env[key] || "";
const json = (value, status = 200) => Response.json(value, { status, headers: { "cache-control": "no-store" } });
const failure = (error, fallback = "The factory could not complete that request.") => { const known=Number.isInteger(error?.status)&&Boolean(error?.code);return json({ error: known?(error.message||fallback):fallback, code: known?error.code:"internal_error" }, known?error.status:500); };
const company = async () => { const rows = await db.sql`SELECT id FROM factory_company WHERE singleton = true LIMIT 1`; if (!rows.length) throw Object.assign(new Error("Factory database is not initialized. Run npm run db:migrate."),{status:503,code:"database_not_initialized"}); return rows[0].id; };
const settings = async (companyId) => { const rows = await db.sql`SELECT * FROM factory_settings WHERE company_id = ${companyId} LIMIT 1`; return rows[0]; };
const rates = () => { const input=Number(env("OPENAI_INPUT_USD_PER_MILLION")),output=Number(env("OPENAI_OUTPUT_USD_PER_MILLION"));return env("OPENAI_INPUT_USD_PER_MILLION")&&env("OPENAI_OUTPUT_USD_PER_MILLION")&&Number.isFinite(input)&&Number.isFinite(output)&&input>0&&output>0?{input,output}:null; };
const webSearchRate = () => { const rate=Number(env("OPENAI_WEB_SEARCH_USD_PER_CALL"));return env("OPENAI_WEB_SEARCH_USD_PER_CALL")&&Number.isFinite(rate)&&rate>0?rate:null; };
const aiConfigured = () => Boolean(env("OPENAI_API_KEY")&&env("OPENAI_MODEL")&&rates());
const researchConfigured = () => aiConfigured()&&webSearchRate()!==null;
const usageCost = (usage) => { const price=rates();return usage&&price?(usage.inputTokens*price.input+usage.outputTokens*price.output)/1_000_000+(usage.searchCalls||0)*(webSearchRate()||0):0; };
async function reserveBudget(companySettings, operation, maxInputChars, taskId=null) {
  const price=rates();if(!aiConfigured()||!price)throw Object.assign(new Error("Set the OpenAI key, model, and per-million-token prices before enabling paid model calls."),{status:503,code:"provider_not_configured"});
  const maxInputTokens=Math.ceil(maxInputChars/2)+512,searchEstimate=operation==="research_task"?(webSearchRate()||0)*5:0,estimate=(maxInputTokens*price.input+2500*price.output)/1_000_000+searchEstimate;
  const limit=Number(companySettings.daily_spending_limit);if(limit<=0)throw Object.assign(new Error("Set a positive daily spending limit before starting a paid OpenAI task."),{status:409,code:"spending_limit_not_set"});
  const client=await db.pool.connect();
  try {
    await client.query("BEGIN");await client.query("SELECT pg_advisory_xact_lock(384238, 1)");
    const {rows}=await client.query("SELECT COALESCE(sum(cost_usd),0)::numeric AS total FROM factory_api_usage WHERE created_at >= date_trunc('day',now())");
    if(Number(rows[0].total)+estimate>limit){await client.query("ROLLBACK");throw Object.assign(new Error("The conservative maximum cost for this call would exceed the daily spending limit."),{status:429,code:"spending_limit_exceeded"});}
    const inserted=await client.query("INSERT INTO factory_api_usage(model,operation,task_id,cost_usd,status) VALUES($1,$2,$3,$4,'reserved') RETURNING id",[env("OPENAI_MODEL"),operation,taskId,estimate]);
    await client.query("COMMIT");return {id:inserted.rows[0].id,estimate};
  } catch(error) { try{await client.query("ROLLBACK")}catch{} throw error; }
  finally {client.release();}
}
async function settleBudget(reservation,usage,status="complete",workflowId=null) {
  if(!reservation)return;const cost=status==="complete"?usageCost(usage):reservation.estimate;
  await db.sql`UPDATE factory_api_usage SET cost_usd=${cost},input_tokens=${usage?.inputTokens||0},output_tokens=${usage?.outputTokens||0},status=${status},workflow_id=${workflowId} WHERE id=${reservation.id}`;
}
const audit = async (event, type, id, details = {}) => { await db.sql`INSERT INTO factory_audit_log(event_type, entity_type, entity_id, details) VALUES(${event}, ${type}, ${id || null}, ${JSON.stringify(details)}::jsonb)`; };
const authSecret = () => env("FACTORY_SESSION_SECRET");
function isAuthorized(request) { const secret = authSecret(); if (!secret) return false; const header = request.headers.get("authorization") || ""; return header.startsWith("Bearer ") && verifySession(header.slice(7), secret); }
async function readBody(request) { const length = Number(request.headers.get("content-length") || 0); if (length > 128_000) throw Object.assign(new Error("Request is too large."), { status: 413, code: "payload_too_large" }); try { return await request.json(); } catch { throw Object.assign(new Error("Send valid JSON."), { status: 400, code: "invalid_json" }); } }

async function getState(companyId) {
  const [setting, agents, tasks, deps, outputs, workflows, activity] = await Promise.all([
    settings(companyId),
    db.sql`SELECT a.agent_code, a.name, a.title, a.department, a.role_description, a.status, a.avatar_color,
      count(t.id)::int AS tasks_completed FROM factory_agents a LEFT JOIN factory_tasks t ON t.agent_id=a.id AND t.status='complete'
      WHERE a.company_id=${companyId} GROUP BY a.id ORDER BY CASE WHEN a.title='Chief Executive Officer' THEN 0 ELSE 1 END, a.title`,
    db.sql`SELECT t.id, t.workflow_id, w.title AS workflow_name, w.objective, w.plan_summary, w.planner,
      a.agent_code, t.title, t.description, t.status, t.blocked_reason, t.needs_live_research, t.attempt_count, t.created_at
      FROM factory_tasks t JOIN workflow_runs w ON w.id=t.workflow_id JOIN factory_agents a ON a.id=t.agent_id
      WHERE t.company_id=${companyId} ORDER BY t.created_at DESC`,
    db.sql`SELECT d.task_id, d.depends_on_task_id FROM factory_task_dependencies d JOIN factory_tasks t ON t.id=d.task_id WHERE t.company_id=${companyId}`,
    db.sql`SELECT o.* FROM factory_task_outputs o JOIN factory_tasks t ON t.id=o.task_id WHERE t.company_id=${companyId} ORDER BY o.revision DESC`,
    db.sql`SELECT id, title, objective, planner, status, created_at FROM workflow_runs WHERE company_id=${companyId} ORDER BY created_at DESC LIMIT 50`,
    db.sql`SELECT event_type, entity_type, entity_id, details, created_at FROM factory_audit_log ORDER BY created_at DESC LIMIT 20`
  ]);
  const depsByTask = new Map(); for (const d of deps) { const key = String(d.task_id); depsByTask.set(key, [...(depsByTask.get(key) || []), String(d.depends_on_task_id)]); }
  const outputsByTask = new Map(); for (const o of outputs) { const key = String(o.task_id); if (!outputsByTask.has(key)) outputsByTask.set(key, []); outputsByTask.get(key).push({ id:o.id, revision:o.revision, title:o.title, summary:o.summary, content:o.content, assumptions:o.assumptions, evidence:o.evidence, reviewStatus:o.review_status, reviewerNote:o.reviewer_note, createdAt:o.created_at }); }
  return {
    agents: agents.map(a => ({ id:a.agent_code, name:a.name, title:a.title, department:a.department, role:a.role_description, status:a.status, tasksCompleted:a.tasks_completed, qualityScore:null, color:a.avatar_color })),
    tasks: tasks.map(t => ({ id:String(t.id), workflowId:String(t.workflow_id), workflowName:t.workflow_name, objective:t.objective, planSummary:t.plan_summary, planner:t.planner, agentId:t.agent_code, title:t.title, description:t.description, status:t.status, blockedReason:t.blocked_reason, needsLiveResearch:t.needs_live_research, attemptCount:t.attempt_count, createdAt:t.created_at, dependsOn:depsByTask.get(String(t.id))||[], outputs:outputsByTask.get(String(t.id))||[] })),
    workflows:workflows.map(w=>({id:String(w.id),title:w.title,objective:w.objective,planner:w.planner,status:w.status,createdAt:w.created_at})),
    settings:{paused:setting.paused,dailyTaskLimit:setting.daily_task_limit,spendingLimit:Number(setting.daily_spending_limit),approvalRequired:setting.require_approval},
    activity:activity.map(a=>({message:a.event_type.replaceAll("_"," "),detail:`${a.entity_type}${a.entity_id?` · ${a.entity_id}`:""} · ${new Date(a.created_at).toLocaleString()}`})),
    providers:{openAI:aiConfigured(),aiBudgetAvailable:aiConfigured()&&Number(setting.daily_spending_limit)>0,research:researchConfigured(),images:false},
    needsSetup:agents.length===0
  };
}

async function seed(body, companyId) {
  const existing = await db.sql`SELECT count(*)::int AS count FROM factory_agents WHERE company_id=${companyId}`;
  if (existing[0].count === 32) return json({ ok:true, seeded:false });
  const issue = validateRoster(body.agents); if (issue) throw Object.assign(new Error(issue), { status:400, code:"invalid_roster" });
  const departmentNames = [...new Set(body.agents.map(a=>a.department))];
  for (const name of departmentNames) await db.sql`INSERT INTO factory_departments(company_id,name) VALUES(${companyId},${name}) ON CONFLICT(company_id,name) DO NOTHING`;
  for (const a of body.agents) await db.sql`INSERT INTO factory_agents(agent_code,company_id,name,title,department,role_description,avatar_color)
    VALUES(${a.id},${companyId},${a.name.trim()},${a.title},${a.department},${a.role},${a.color||"#38445e"}) ON CONFLICT(agent_code) DO UPDATE SET
    name=excluded.name,title=excluded.title,department=excluded.department,role_description=excluded.role_description,avatar_color=excluded.avatar_color`;
  await audit("agent_roster_initialized","company",companyId,{agents:body.agents.length});
  return json({ok:true,seeded:true});
}

async function createWorkflow(body, companyId) {
  const objective = typeof body.objective === "string" ? body.objective.trim() : "";
  const invalid = validateObjective(objective); if (invalid) throw Object.assign(new Error(invalid), { status:400, code:"invalid_objective" });
  const prefs = await settings(companyId); if (prefs.paused) throw Object.assign(new Error("Workflow planning is paused by the owner."), { status:409, code:"workflows_paused" });
  const count = await db.sql`SELECT count(*)::int AS n FROM factory_tasks WHERE company_id=${companyId} AND created_at >= date_trunc('day',now())`;
  if (count[0].n + 8 > prefs.daily_task_limit) throw Object.assign(new Error("Daily task limit reached. Raise the limit in company settings to continue."), { status:429, code:"daily_limit_reached" });
  const useAI=aiConfigured()&&Number(prefs.daily_spending_limit)>0;
  let reservation=null,plan;
  if(useAI){reservation=await reserveBudget(prefs,"workflow_plan",objective.length+7000);try{plan=await createCEOPlan({objective,apiKey:env("OPENAI_API_KEY"),model:env("OPENAI_MODEL")});}catch(error){await settleBudget(reservation,null,"failed");throw error;}}
  else plan=await createCEOPlan({objective,apiKey:"",model:""});
  const runRows = await db.sql`INSERT INTO workflow_runs(company_id,objective,title,planner,plan_summary) VALUES(${companyId},${objective},${objective.slice(0,120)},${plan.planner},${plan.summary}) RETURNING id`;
  const runId = runRows[0].id, codeRows = await db.sql`SELECT id,agent_code,title,department FROM factory_agents WHERE company_id=${companyId}`;
  const byTitle = new Map(codeRows.map(a=>[a.title,a])); const ids=[];
  for (let i=0;i<plan.tasks.length;i++) {
    const step=plan.tasks[i], agent=byTitle.get(step.agentTitle); if (!agent) throw Object.assign(new Error(`Agent role ${step.agentTitle} is not configured.`),{status:409,code:"agent_role_missing"});
    const research=step.needsLiveResearch||agent.department===RESEARCH_DEPARTMENT;
    const blockedReason=research&&!researchConfigured()?RESEARCH_BLOCKED_REASON:null;
    const status=blockedReason?"blocked":"queued";
    const rows=await db.sql`INSERT INTO factory_tasks(company_id,workflow_id,agent_id,title,description,status,blocked_reason,needs_live_research)
      VALUES(${companyId},${runId},${agent.id},${step.title},${step.description},${status},${blockedReason},${research}) RETURNING id`;
    ids.push(rows[0].id);
    for (const dependencyIndex of step.dependencies) await db.sql`INSERT INTO factory_task_dependencies(task_id,depends_on_task_id) VALUES(${rows[0].id},${ids[dependencyIndex]}) ON CONFLICT DO NOTHING`;
  }
  await audit("workflow_created","workflow",runId,{planner:plan.planner,tasks:ids.length,objective});
  if(plan.planner==="openai_responses"){await settleBudget(reservation,plan.usage,"complete",runId);await audit("ceo_plan_generated","workflow",runId,{model:env("OPENAI_MODEL"),costUsd:usageCost(plan.usage)});}
  return json({ok:true,workflowId:String(runId),planner:plan.planner,summary:plan.summary,taskCount:ids.length});
}

async function runTask(taskId, companyId) {
  const rows=await db.sql`SELECT t.id,t.workflow_id,t.title,t.description,t.status,t.blocked_reason,t.needs_live_research,w.objective,
    a.id AS agent_db_id,a.agent_code,a.title AS agent_title,a.department,a.role_description
    FROM factory_tasks t JOIN workflow_runs w ON w.id=t.workflow_id JOIN factory_agents a ON a.id=t.agent_id
    WHERE t.id=${taskId} AND t.company_id=${companyId} LIMIT 1`;
  if(!rows.length) throw Object.assign(new Error("Task not found."),{status:404,code:"task_not_found"});
  const task=rows[0],prefs=await settings(companyId);
  if(prefs.paused) throw Object.assign(new Error("Workflows are paused. Resume before starting another task."),{status:409,code:"workflows_paused"});
  const needsLiveResearch=task.needs_live_research||task.department===RESEARCH_DEPARTMENT;
  if(needsLiveResearch&&!researchConfigured()) throw Object.assign(new Error("Set OPENAI_WEB_SEARCH_USD_PER_CALL and configure OpenAI model pricing before starting a research task."),{status:503,code:"research_not_configured"});
  if(!aiConfigured()) throw Object.assign(new Error("Configure the OpenAI key, model and per-million-token prices to run agent tasks."),{status:503,code:"provider_not_configured"});
  const reenabledResearch=task.status==="blocked"&&needsLiveResearch&&task.blocked_reason===RESEARCH_BLOCKED_REASON&&researchConfigured();
  if(!["queued","failed"].includes(task.status)&&!reenabledResearch) throw Object.assign(new Error(`This task cannot run while its status is ${task.status}.`),{status:409,code:"invalid_task_state"});
  const blockers=await db.sql`SELECT d.depends_on_task_id,t.status FROM factory_task_dependencies d JOIN factory_tasks t ON t.id=d.depends_on_task_id WHERE d.task_id=${taskId} AND t.status <> 'complete'`;
  if(blockers.length) throw Object.assign(new Error("Approve the previous task output before running this dependent task."),{status:409,code:"dependencies_incomplete"});
  const reservation=await reserveBudget(prefs,needsLiveResearch?"research_task":"agent_task",task.objective.length+task.title.length+task.description.length+9000,taskId);
  await db.sql`UPDATE factory_tasks SET status='working',blocked_reason=null,attempt_count=attempt_count+1,started_at=now() WHERE id=${taskId}`;
  await db.sql`UPDATE factory_agents SET status='working' WHERE id=${task.agent_db_id}`;
  await audit("task_started","task",taskId,{agent:task.agent_title});
  try {
    const previous=await db.sql`SELECT reviewer_note FROM factory_task_outputs WHERE task_id=${taskId} ORDER BY revision DESC LIMIT 1`;
    const result=await createTaskDeliverable({task,agent:{title:task.agent_title,department:task.department,role:task.role_description},objective:task.objective,revisionNote:previous[0]?.reviewer_note||"",needsLiveResearch,apiKey:env("OPENAI_API_KEY"),model:env("OPENAI_MODEL")});
    const deliverable=result.deliverable;
    const revs=await db.sql`SELECT coalesce(max(revision),0)::int AS n FROM factory_task_outputs WHERE task_id=${taskId}`;
    await db.sql`INSERT INTO factory_task_outputs(task_id,revision,title,summary,content,assumptions,evidence,review_status)
      VALUES(${taskId},${revs[0].n+1},${deliverable.title},${deliverable.summary},${deliverable.content},${JSON.stringify(deliverable.assumptions)}::jsonb,${JSON.stringify(deliverable.evidence)}::jsonb,'awaiting_approval')`;
    await db.sql`UPDATE factory_tasks SET status='awaiting_approval',finished_at=now() WHERE id=${taskId}`;
    await db.sql`UPDATE factory_agents SET status='awaiting_approval' WHERE id=${task.agent_db_id}`;
    await settleBudget(reservation,result.usage,"complete",task.workflow_id);
    await audit("task_output_created","task",taskId,{agent:task.agent_title,revision:revs[0].n+1});
    return json({ok:true,status:"awaiting_approval",title:deliverable.title,summary:deliverable.summary});
  } catch(error) {
    await settleBudget(reservation,null,"failed",task.workflow_id);
    await db.sql`UPDATE factory_tasks SET status='failed',blocked_reason=${error.message.slice(0,500)},finished_at=now() WHERE id=${taskId}`;
    await db.sql`UPDATE factory_agents SET status='idle' WHERE id=${task.agent_db_id}`;
    await audit("task_failed","task",taskId,{code:error.code||"provider_error",message:error.message.slice(0,300)});
    throw error;
  }
}

async function reviewTask(taskId, body, companyId) {
  const action=body.decision, note=typeof body.note==="string"?body.note.slice(0,1000):"";
  if(!["approve","revise","reject"].includes(action)) throw Object.assign(new Error("Choose approve, revise or reject."),{status:400,code:"invalid_decision"});
  const rows=await db.sql`SELECT id,agent_id,status FROM factory_tasks WHERE id=${taskId} AND company_id=${companyId} LIMIT 1`;
  if(!rows.length) throw Object.assign(new Error("Task not found."),{status:404,code:"task_not_found"});
  const task=rows[0]; if(task.status!=="awaiting_approval") throw Object.assign(new Error("This task has no output awaiting review."),{status:409,code:"not_awaiting_review"});
  const output=await db.sql`SELECT id FROM factory_task_outputs WHERE task_id=${taskId} AND review_status='awaiting_approval' ORDER BY revision DESC LIMIT 1`;
  if(!output.length) throw new Error("Reviewable output record is missing.");
  const outputStatus=action==="approve"?"approved":action==="revise"?"revision_requested":"rejected";
  await db.sql`UPDATE factory_task_outputs SET review_status=${outputStatus},reviewer_note=${note} WHERE id=${output[0].id}`;
  const taskStatus=action==="approve"?"complete":action==="revise"?"queued":"failed";
  await db.sql`UPDATE factory_tasks SET status=${taskStatus},blocked_reason=${action==="reject"?note||"Owner rejected this output.":null} WHERE id=${taskId}`;
  await db.sql`UPDATE factory_agents SET status='idle' WHERE id=${task.agent_id}`;
  await audit(({approve:"output_approved",revise:"output_revision_requested",reject:"output_rejected"})[action],"task",taskId,{note});
  return json({ok:true,status:taskStatus});
}

export default async (request) => {
  const url=new URL(request.url),path=url.pathname;
  try {
    if(request.method==="GET"&&path==="/api/health") {
      let database=false;try{await db.sql`SELECT 1 AS ok`;database=true}catch{}
      return json({ok:true,database,ownerAuth:env("FACTORY_OWNER_PASSWORD").length>=16&&authSecret().length>=32,openAI:aiConfigured(),liveResearch:researchConfigured()});
    }
    if(request.method==="POST"&&path==="/api/auth/login") {
      const password=env("FACTORY_OWNER_PASSWORD"),secret=authSecret();
      if(password.length<16||secret.length<32) return json({error:"Owner access is not configured securely. Use a password of at least 16 characters and a session secret of at least 32 characters.",code:"owner_auth_not_configured"},503);
      const body=await readBody(request);if(!constantTimeEqual(body.password,password)) return json({error:"Incorrect owner password."},401);
      const session=createSession(password,secret);return json({token:session.token,expiresAt:session.expiresAt});
    }
    if(!isAuthorized(request)) return json({error:"Sign in as the factory owner to continue.",code:"unauthorized"},401);
    const companyId=await company();
    if(request.method==="GET"&&path==="/api/state") return json(await getState(companyId));
    if(request.method==="POST"&&path==="/api/setup") return await seed(await readBody(request),companyId);
    if(request.method==="POST"&&path==="/api/workflows") return await createWorkflow(await readBody(request),companyId);
    if(request.method==="PATCH"&&path==="/api/settings") {
      const body=await readBody(request),daily=Math.trunc(Number(body.dailyTaskLimit)),spend=Number(body.spendingLimit);
      if(!Number.isInteger(daily)||daily<1||daily>500||!Number.isFinite(spend)||spend<0||spend>10000000) throw Object.assign(new Error("Enter a daily task limit from 1–500 and a non-negative spending limit."),{status:400,code:"invalid_settings"});
      if(typeof body.paused==="boolean") await db.sql`UPDATE factory_settings SET paused=${body.paused},daily_task_limit=${daily},daily_spending_limit=${spend},updated_at=now() WHERE company_id=${companyId}`;
      else await db.sql`UPDATE factory_settings SET daily_task_limit=${daily},daily_spending_limit=${spend},updated_at=now() WHERE company_id=${companyId}`;
      await audit("owner_settings_updated","company",companyId,{dailyTaskLimit:daily,spendingLimit:spend,paused:body.paused});return json({ok:true});
    }
    const runMatch=path.match(/^\/api\/tasks\/([0-9a-f-]{36})\/run$/i);
    if(request.method==="POST"&&runMatch) return await runTask(runMatch[1],companyId);
    const reviewMatch=path.match(/^\/api\/tasks\/([0-9a-f-]{36})\/review$/i);
    if(request.method==="POST"&&reviewMatch) return await reviewTask(reviewMatch[1],await readBody(request),companyId);
    return json({error:"API route not found."},404);
  } catch(error) { console.error("Factory API error",error.code||"internal_error",error.message);return failure(error); }
};

export const config = { path: "/api/*", rateLimit: { action:"rate_limit", aggregateBy:"ip", windowSize:60, windowLimit:40 } };
