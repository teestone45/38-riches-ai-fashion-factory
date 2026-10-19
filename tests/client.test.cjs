const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

test('authenticated app starts at owner sign-in and calls only the public health endpoint',async()=>{
  const els={app:{innerHTML:''},crumb:{textContent:''},'approval-count':{textContent:''},'logout-button':{style:{}},'connection-status':{innerHTML:''},nav:{appendChild(){}}};
  const buttons=['overview','workforce','workflows','approvals'].map(page=>({dataset:{page},classList:{toggle(){}},addEventListener(){}}));
  const document={querySelector(key){const id=key.replace(/^#/,'');return els[id]||(els[id]={value:'',innerHTML:'',textContent:'',style:{},classList:{add(){},remove(){}}})},querySelectorAll(){return buttons},createElement(){return {dataset:{},classList:{add(){}},appendChild(){}}},body:{appendChild(){}}};
  const sessions=new Map(),calls=[];
  const sessionStorage={getItem:k=>sessions.get(k)||null,setItem:(k,v)=>sessions.set(k,v),removeItem:k=>sessions.delete(k)};
  const fetch=async url=>{calls.push(url);return Response.json({ok:true,database:true,ownerAuth:false,openAI:false});};
  const context={document,localStorage:{getItem(){return null},setItem(){},removeItem(){}},sessionStorage,fetch,Response,URL,console,Math,Date,JSON,Set,Map,setTimeout:()=>1,clearTimeout(){}};
  vm.createContext(context);vm.runInContext(fs.readFileSync(__dirname+'/../public/app.js','utf8'),context);vm.runInContext(fs.readFileSync(__dirname+'/../public/backend-ui.js','utf8'),context);
  await vm.runInContext('boot()',context);
  assert.match(els.app.innerHTML,/Sign in to your factory/);assert.match(els.app.innerHTML,/FACTORY_OWNER_PASSWORD/);
  const citationHtml=vm.runInContext('renderEvidence(["Trend report — https://example.com/trends"])',context);
  assert.match(citationHtml,/<a href="https:\/\/example\.com\/trends"/);
  assert.match(citationHtml,/rel="noopener noreferrer"/);
  const researchWorkflow=vm.runInContext(`state.workflows=[{id:'workflow-1',title:'Research brief',planner:'openai_responses',createdAt:Date.now(),status:'active',objective:'Research current trends'}];state.tasks=[{id:'task-1',workflowId:'workflow-1',status:'blocked',needsLiveResearch:true,blockedReason:'Research configuration required',title:'Research current trends',description:'Find current signals',agentId:'agent-2',dependsOn:[],outputs:[{title:'Trend brief',revision:1,reviewStatus:'awaiting_approval',summary:'Sourced signals',content:'Draft',assumptions:[],evidence:['Trend report — https://example.com/trends']}]}];state.providers={openAI:true,aiBudgetAvailable:true,research:true};workflows()`,context);
  assert.match(researchWorkflow,/Run agent task/);
  assert.match(researchWorkflow,/<a href="https:\/\/example\.com\/trends"/);
  const unconfiguredResearch=vm.runInContext(`state.providers.research=false;state.tasks[0].status='queued';workflows()`,context);
  assert.match(unconfiguredResearch,/disabled onclick="runAgentTask/);
  assert.match(unconfiguredResearch,/Research setup required/);
  assert.deepEqual([...calls],['/api/health','/api/health']);
});

test('failed state load after login clears the session and shows the API error',async()=>{
  const els={app:{innerHTML:''},crumb:{textContent:''},'approval-count':{textContent:''},'logout-button':{style:{}},'connection-status':{innerHTML:''},nav:{appendChild(){}}};
  const buttons=['overview','workforce','workflows','approvals'].map(page=>({dataset:{page},classList:{toggle(){}},addEventListener(){}}));
  const document={querySelector(key){const id=key.replace(/^#/,'');return els[id]||(els[id]={value:'',innerHTML:'',textContent:'',style:{},classList:{add(){},remove(){}}})},querySelectorAll(){return buttons},createElement(){return {dataset:{},classList:{add(){}},appendChild(){}}},body:{appendChild(){}}};
  const sessions=new Map(),calls=[];
  const sessionStorage={getItem:k=>sessions.get(k)||null,setItem:(k,v)=>sessions.set(k,v),removeItem:k=>sessions.delete(k)};
  const fetch=async(url,options={})=>{calls.push(url);if(url==='/api/health')return Response.json({ok:true,database:true,ownerAuth:true});if(url==='/api/auth/login')return Response.json({token:'test-session'});if(url==='/api/state')return Response.json({error:'Database schema is missing workflow state columns.',code:'internal_error'},{status:500});throw new Error('Unexpected request');};
  const context={document,localStorage:{getItem(){return null},setItem(){},removeItem(){}},sessionStorage,fetch,Response,URL,console,Math,Date,JSON,Set,Map,setTimeout:()=>1,clearTimeout(){}};
  vm.createContext(context);vm.runInContext(fs.readFileSync(__dirname+'/../public/app.js','utf8'),context);vm.runInContext(fs.readFileSync(__dirname+'/../public/backend-ui.js','utf8'),context);
  await vm.runInContext('boot()',context);
  document.querySelector('#owner-password').value='owner password';
  await vm.runInContext('loginOwner()',context);
  assert.equal(sessionStorage.getItem('factory_owner_session'),null);
  assert.match(els.app.innerHTML,/Database schema is missing workflow state columns/);
  assert.doesNotMatch(els.app.innerHTML,/Loading the owner workspace/);
  assert.deepEqual(calls,['/api/health','/api/health','/api/auth/login','/api/state']);
});
