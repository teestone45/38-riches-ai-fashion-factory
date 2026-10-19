const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

function boot(){
  const storage=new Map(),els={app:{innerHTML:''},crumb:{textContent:''},'approval-count':{textContent:''},toast:{textContent:'',classList:{add(){},remove(){}}},nav:{appendChild(){}}};
  const navButtons=['overview','workforce','workflows','approvals'].map(page=>({dataset:{page},classList:{toggle(){ }},addEventListener(){}}));
  const document={querySelector(key){const id=key.replace(/^#/,'');return els[id]||(els[id]={value:'',innerHTML:'',textContent:'',style:{},classList:{add(){},remove(){}}})},querySelectorAll(){return navButtons},createElement(){return {dataset:{},classList:{add(){}},appendChild(){}}},body:{appendChild(){}}};
  const localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
  const context={document,localStorage,console,Math,Date,JSON,Set,Map,confirm:()=>true,setTimeout:()=>1,clearTimeout(){}};
  vm.createContext(context);vm.runInContext(fs.readFileSync(__dirname+'/../public/app.js','utf8'),context);
  return {context,storage,els};
}

test('initializes CEO plus 31 unique specialist profiles from the full roster',()=>{
  const {context,storage}=boot();
  const result=vm.runInContext('({count:state.agents.length,unique:new Set(state.agents.map(a=>a.name)).size,ceo:state.agents[0].title,html:document.querySelector("#app").innerHTML})',context);
  assert.equal(result.count,32);assert.equal(result.unique,32);assert.equal(result.ceo,'Chief Executive Officer');
  assert.match(result.html,/Good (morning|afternoon|evening), Tee\./);assert.ok(storage.has('38riches.factory.v1'));
});

test('objective creates a blocked eight-step plan with a dependency chain',()=>{
  const {context}=boot();context.document.querySelector('#objective-input').value='Build a summer capsule collection';context.createWorkflow();
  const result=vm.runInContext('({tasks:state.tasks,html:document.querySelector("#app").innerHTML})',context);
  assert.equal(result.tasks.length,8);assert.ok(result.tasks.every(t=>t.status==='blocked'));
  assert.equal(result.tasks.filter(t=>t.dependsOn.length===0).length,1);
  assert.equal(result.tasks.reduce((n,t)=>n+t.dependsOn.length,0),7);
  assert.match(result.html,/No research or creative deliverable has been executed/);
});

test('pause control prevents creating a new workflow',()=>{
  const {context}=boot();context.togglePause();context.document.querySelector('#objective-input').value='Create a collection';context.createWorkflow();
  assert.equal(vm.runInContext('state.tasks.length',context),0);
  assert.equal(vm.runInContext('state.settings.paused',context),true);
});
