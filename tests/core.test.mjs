import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, verifySession, validateObjective, validateRoster, ROLE_TITLES, fallbackPlan, validatePlan, openAIJson, createCEOPlan, createTaskDeliverable } from '../api/lib/core.mjs';

test('owner sessions are signed and expire',()=>{
  const now=1700000000000,session=createSession('password','secret',now);
  assert.equal(verifySession(session.token,'secret',now+10),true);
  assert.equal(verifySession(session.token,'wrong',now+10),false);
  assert.equal(verifySession(session.token,'secret',session.expiresAt+1),false);
});

test('objective validation rejects empty and oversized inputs',()=>{
  assert.match(validateObjective('  '),/at least 8/);
  assert.match(validateObjective('short'),/at least 8/);
  assert.equal(validateObjective('Develop a capsule collection'),null);
  assert.match(validateObjective('x'.repeat(1501)),/1500/);
});

test('first-run roster must include every exact CEO and specialist title',()=>{
  const agents=ROLE_TITLES.map((title,i)=>({id:'agent-'+(i+1),title,name:'Professional Name '+i,department:'Department',role:'Role description'}));
  assert.equal(validateRoster(agents),null);
  assert.match(validateRoster(agents.slice(1)),/CEO and 31 specialist/);
  agents[3].title='Unknown role';
  assert.match(validateRoster(agents),/every numbered factory role/);
});

test('rule planner makes an 8-step, dependency-ordered saved plan and labels research work',()=>{
  const plan=validatePlan(fallbackPlan('Design a fall collection'));
  assert.equal(plan.planner,'rule_planner');assert.equal(plan.tasks.length,8);
  assert.deepEqual(plan.tasks.map((x,i)=>x.dependencies.length?x.dependencies[0]:null),[null,0,1,2,3,4,5,6]);
  assert.equal(plan.tasks.filter(x=>x.needsLiveResearch).length,3);
});

test('OpenAI structured response adapter uses the Responses API and parses schema output',async()=>{
  let seen;
  const value={summary:'Plan saved',tasks:[]};
  const result=await openAIJson({apiKey:'sk-test',model:'test-model',system:'System',user:'User',schemaName:'test_shape',schema:{type:'object'},fetchImpl:async(url,init)=>{seen={url,init,body:JSON.parse(init.body)};return new Response(JSON.stringify({output:[{content:[{type:'output_text',text:JSON.stringify(value)}]}]}),{status:200,headers:{'content-type':'application/json'}})}});
  assert.equal(seen.url,'https://api.openai.com/v1/responses');assert.equal(seen.init.headers.authorization,'Bearer sk-test');
  assert.equal(seen.body.text.format.name,'test_shape');assert.deepEqual(result.data,value);assert.equal(seen.body.max_output_tokens,2500);
});

test('CEO planning validates model task assignments before returning them',async()=>{
  const plan={summary:'Objective decomposition',tasks:[{title:'Create original concepts',agentTitle:'Head Fashion Designer',description:'Draft concepts from the owner objective.',dependencies:[],needsLiveResearch:false}]};
  const result=await createCEOPlan({objective:'Develop new shirt concepts',apiKey:'test',model:'test-model',fetchImpl:async()=>new Response(JSON.stringify({output:[{content:[{type:'output_text',text:JSON.stringify(plan)}]}]}),{status:200})});
  assert.equal(result.planner,'openai_responses');assert.equal(result.tasks[0].agentTitle,'Head Fashion Designer');
  await assert.rejects(()=>createCEOPlan({objective:'Develop new shirt concepts',apiKey:'test',model:'test-model',fetchImpl:async()=>new Response(JSON.stringify({output:[{content:[{type:'output_text',text:'{"summary":"bad","tasks":[{"title":"hack","agentTitle":"Unknown","description":"Bad role","dependencies":[],"needsLiveResearch":false}]}'}]}]}),{status:200})}),/unknown role/);
});

test('research deliverables require OpenAI search citations and non-research evidence is not invented',async()=>{
  const result={title:'Concepts',summary:'Draft concepts',content:'A',assumptions:[],evidence:['invented citation']};
  const draft=await createTaskDeliverable({task:{title:'Write a concept',description:'Create one concept'},agent:{title:'Head Fashion Designer',department:'Fashion Design',role:'Develop original concepts'},objective:'New tees',apiKey:'k',model:'m',fetchImpl:async()=>new Response(JSON.stringify({output:[{content:[{type:'output_text',text:JSON.stringify(result)}]}]}),{status:200})});
  assert.deepEqual(draft.deliverable.evidence,[]);
});

test('research requests enable web search and persist only HTTPS citations returned by the API',async()=>{
  const result={title:'Trend brief',summary:'Recent sourced signals',content:'Several examples.',assumptions:[],evidence:['invented citation']};
  let requestBody;
  const draft=await createTaskDeliverable({
    task:{title:'Research current streetwear trends',description:'Find and summarize current signals.'},
    agent:{title:'Fashion Trend Researcher',department:'Market Research',role:'Find trends'},
    objective:'Research current streetwear trends',
    needsLiveResearch:true,apiKey:'k',model:'m',
    fetchImpl:async(_url,init)=>{
      requestBody=JSON.parse(init.body);
      return new Response(JSON.stringify({
        output:[
          {type:'web_search_call',action:{type:'search',query:'streetwear trends'}},
          {type:'message',content:[{type:'output_text',text:JSON.stringify(result),annotations:[
            {type:'url_citation',url:'https://example.com/trends',title:'Trend report'},
            {type:'url_citation',url:'http://insecure.example/report',title:'Unsecure report'},
            {type:'url_citation',url:'https://example.com/trends',title:'Duplicate report'}
          ]}]}
        ],
        usage:{input_tokens:300,output_tokens:100}
      }),{status:200});
    }
  });
  assert.deepEqual(requestBody.tools,[{type:'web_search',search_context_size:'low'}]);
  assert.equal(requestBody.tool_choice,'required');
  assert.deepEqual(draft.deliverable.evidence,['Trend report — https://example.com/trends']);
  assert.equal(draft.usage.searchCalls,1);
  await assert.rejects(()=>createTaskDeliverable({
    task:{title:'Research current streetwear trends',description:'Find current signals.'},
    agent:{title:'Fashion Trend Researcher',department:'Market Research',role:'Find trends'},
    objective:'Research current streetwear trends',needsLiveResearch:true,apiKey:'k',model:'m',
    fetchImpl:async()=>new Response(JSON.stringify({output:[
      {type:'web_search_call',action:{type:'search',query:'streetwear trends'}},
      {type:'message',content:[{type:'output_text',text:JSON.stringify(result),annotations:[]}]}
    ]}),{status:200})
  }),/did not include verifiable source citations/);
});
