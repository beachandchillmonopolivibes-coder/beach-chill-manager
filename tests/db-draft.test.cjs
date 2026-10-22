const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function adapter(rpc) {
  const window = {
    BEACH_APP_CONFIG:{supabaseUrl:'https://example.supabase.co',supabasePublishableKey:'sb_publishable_testing'},
    supabase:{createClient:()=>({rpc})},
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../db.js'),'utf8'), {window,URL,console});
  return window.BeachDB;
}

test('the browser adapter creates only a private draft RPC and normalizes its identifiers',async()=>{
  const calls=[];
  const expected={id:'draft-1',public_read:false};
  const db=adapter(async(name,args)=>{calls.push({name,args});return {data:[expected],error:null};});
  const state={teams:[]};
  assert.equal(await db.createTournament(' Nome ',' TORNEO-PRIVATO ',state),expected);
  assert.equal(calls.length,1);
  assert.equal(calls[0].name,'create_tournament_draft');
  assert.equal(calls[0].args.p_name,'Nome');
  assert.equal(calls[0].args.p_slug,'torneo-privato');
  assert.equal(calls[0].args.p_state,state);
});

test('an old backend reports the migration prerequisite without falling back to public creation',async()=>{
  const calls=[];
  const db=adapter(async(name)=>{calls.push(name);return {data:null,error:{code:'PGRST202',message:'Could not find public.create_tournament_draft in the schema cache'}};});
  await assert.rejects(db.createTournament('Nome','torneo-privato',{}),/shared_draft_migration_required/);
  assert.deepEqual(calls,['create_tournament_draft']);
});
