'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
function adapter(rpc){
  const window={BEACH_APP_CONFIG:{supabaseUrl:'https://qa.supabase.co',supabasePublishableKey:'sb_publishable_qa'},supabase:{createClient:()=>({rpc})}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../db.js'),'utf8'),{window,URL,console});
  return window.BeachDB;
}
test('reset adapter requires a safe revision and calls only the dedicated atomic RPC',async()=>{
  const calls=[],expected={id:'tournament-1',public_read:false,state:{matches:[]}};
  const api=adapter(async(name,args)=>{calls.push({name,args});return {data:[expected],error:null};});
  for(const revision of [null,undefined,-1,1.5,'2'])await assert.rejects(api.resetTournamentBracket('tournament-1',revision),/revision_conflict/);
  assert.equal(calls.length,0);
  assert.equal(await api.resetTournamentBracket('tournament-1',2),expected);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)),[{name:'reset_tournament_bracket',args:{p_tournament_id:'tournament-1',p_expected_revision:2}}]);
});
test('missing reset migration is explicit and never falls back to unlocked client saves',async()=>{
  const calls=[];
  const api=adapter(async(name)=>{calls.push(name);return {data:null,error:{code:'PGRST202',message:'Could not find public.reset_tournament_bracket'}};});
  await assert.rejects(api.resetTournamentBracket('tournament-1',1),/reset_bracket_migration_required/);
  assert.deepEqual(calls,['reset_tournament_bracket']);
});
