const {test,before,after} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {PGlite} = require('@electric-sql/pglite');

// Embedded PostgreSQL executes the actual production SQL. Only the Supabase
// auth.uid() JWT context, auth.users and API roles are stubbed locally.
let db;
const users={owner:'11111111-1111-4111-8111-111111111111',editor:'22222222-2222-4222-8222-222222222222',other:'33333333-3333-4333-8333-333333333333'};
const window={crypto:require('node:crypto').webcrypto,structuredClone,BEACH_APP_CONFIG:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../engine.js'),'utf8'),{window,console,Date,Math,Uint32Array});
const Engine=window.BeachEngine;
const clone=value=>JSON.parse(JSON.stringify(value));
let slugIndex=0;

before(async()=>{
  db=new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,created_at timestamptz DEFAULT now());
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO anon,authenticated;
    CREATE PUBLICATION supabase_realtime;`);
  await db.exec(fs.readFileSync(path.join(__dirname,'../schema.sql'),'utf8'));
  for(const [name,id] of Object.entries(users)) await db.query('INSERT INTO auth.users(id,email) VALUES($1,$2)',[id,`${name}@admin.beachvolley.app`]);
});
after(async()=>{if(db)await db.close();});

async function as(role,user,sql,args=[]){
  await db.exec(`SET ROLE ${role}`);
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[user||'']);
  try{return await db.query(sql,args);}finally{await db.exec('RESET ROLE');await db.query("SELECT set_config('request.jwt.claim.sub','',false)");}
}
function draft(){
  const state=clone(Engine.createDefaultState());
  state.teams.forEach((team,index)=>{team.name=index<4?`Coppia ${index+1}`:'';team.seed=null;});
  state.settings.format=Engine.FORMATS.SINGLE_ELIMINATION;
  return state;
}
async function create(state=draft()){
  const rows=await as('authenticated',users.owner,'SELECT * FROM public.create_tournament($1,$2,$3::jsonb)',['Test',`test-torneo-${++slugIndex}`,JSON.stringify(state)]);
  return rows.rows[0];
}
async function createDraft(state=draft()){
  return (await as('authenticated',users.owner,'SELECT * FROM public.create_tournament_draft($1,$2,$3::jsonb)',
    ['Bozza privata',`draft-torneo-${++slugIndex}`,JSON.stringify(state)])).rows[0];
}
async function save(row,state,user=users.owner,revision=row.revision){
  return (await as('authenticated',user,'SELECT * FROM public.save_tournament_state($1,$2::jsonb,$3)',[row.id,JSON.stringify(state),revision])).rows[0];
}
function startedState(){const state=draft();Engine.generateTournament(state,{drawCode:'TEST123'});return state;}

test('schema and upgrade migration can be applied again without deleting existing tournaments',async()=>{
  const row=await create();
  await db.exec(fs.readFileSync(path.join(__dirname,'../MIGRATION_PRO_V11.sql'),'utf8'));
  const {rows}=await as('authenticated',users.owner,'SELECT id FROM public.tournaments WHERE id=$1',[row.id]);
  assert.equal(rows[0].id,row.id);
});

test('RLS: public read is explicit, anonymous writes and non-member saves are denied',async()=>{
  const row=await create();
  assert.equal((await as('anon',null,'SELECT id FROM public.tournaments WHERE id=$1',[row.id])).rows.length,1);
  await assert.rejects(as('anon',null,'UPDATE public.tournaments SET name=$1 WHERE id=$2',['hacked',row.id]),/permission denied/);
  await assert.rejects(as('authenticated',users.owner,'UPDATE public.tournaments SET state=$1::jsonb WHERE id=$2',['{}',row.id]),/permission denied/);
  await assert.rejects(save(row,row.state,users.other),/not_allowed/);
  await assert.rejects(as('anon',null,'SELECT * FROM public.save_tournament_state($1,$2::jsonb,0)',[row.id,JSON.stringify(row.state)]),/permission denied/);
  const hidden=(await as('authenticated',users.owner,'SELECT * FROM public.set_tournament_public_read($1,false)',[row.id])).rows[0];
  assert.equal(Number(hidden.revision),Number(row.revision)+1);
  assert.equal((await as('anon',null,'SELECT id FROM public.tournaments WHERE id=$1',[row.id])).rows.length,0);
  assert.equal((await as('authenticated',users.other,'SELECT id FROM public.tournaments WHERE id=$1',[row.id])).rows.length,0);
  assert.equal((await as('authenticated',users.owner,'SELECT id FROM public.tournaments WHERE id=$1',[row.id])).rows.length,1);
});

test('shared drafts are private at creation and synchronize only among tournament admins',async()=>{
  const row=await createDraft();
  assert.equal(row.public_read,false);
  assert.equal(Number(row.revision),0);
  assert.equal((await as('authenticated',users.owner,'SELECT public.get_my_tournament_role($1) AS role',[row.id])).rows[0].role,'owner');
  assert.equal((await as('anon',null,'SELECT id FROM public.tournaments WHERE id=$1',[row.id])).rows.length,0);
  assert.equal((await as('authenticated',users.other,'SELECT id FROM public.tournaments WHERE id=$1',[row.id])).rows.length,0);
  await assert.rejects(as('anon',null,'SELECT * FROM public.create_tournament_draft($1,$2,$3::jsonb)',
    ['Anon','anon-private-draft',JSON.stringify(draft())]),/permission denied/);
  await assert.rejects(as('authenticated',null,'SELECT * FROM public.create_tournament_draft($1,$2,$3::jsonb)',
    ['Missing auth','missing-auth-private',JSON.stringify(draft())]),/authentication_required/);
  await as('authenticated',users.owner,'SELECT public.add_tournament_admin($1,$2)',[row.id,'editor']);
  const changed=clone(row.state);changed.teams[5].name='Inserita dal secondo admin';
  const saved=await save(row,changed,users.editor);
  const seen=(await as('authenticated',users.owner,'SELECT * FROM public.tournaments WHERE id=$1',[row.id])).rows[0];
  assert.equal(seen.state.teams[5].name,'Inserita dal secondo admin');
  assert.equal(seen.public_read,false);
  assert.equal(Number(seen.revision),1);
  assert.equal((await as('anon',null,'SELECT id FROM public.tournaments WHERE id=$1',[row.id])).rows.length,0);
  await assert.rejects(as('authenticated',users.editor,'SELECT * FROM public.set_tournament_public_read($1,true)',[row.id]),/owner_required/);
  const published=(await as('authenticated',users.owner,'SELECT * FROM public.set_tournament_public_read($1,true)',[row.id])).rows[0];
  assert.equal(published.public_read,true);
  assert.equal((await as('anon',null,'SELECT state FROM public.tournaments WHERE id=$1',[row.id])).rows[0].state.teams[5].name,saved.state.teams[5].name);
});

test('private draft creation validates inputs atomically and protects an existing slug',async()=>{
  const countBefore=Number((await db.query('SELECT count(*) AS n FROM public.tournaments')).rows[0].n);
  for(const args of [
    ['','empty-name-draft',JSON.stringify(draft())],
    ['Name','!',JSON.stringify(draft())],
    ['Name',null,JSON.stringify(draft())],
    ['Name','invalid-state-draft','{}'],
    ['Name','null-state-draft','null'],
  ]) await assert.rejects(as('authenticated',users.owner,'SELECT * FROM public.create_tournament_draft($1,$2,$3::jsonb)',args),/name_required|invalid_slug|invalid_tournament_state/);
  assert.equal(Number((await db.query('SELECT count(*) AS n FROM public.tournaments')).rows[0].n),countBefore);
  const row=await createDraft();
  await assert.rejects(as('authenticated',users.other,'SELECT * FROM public.create_tournament_draft($1,$2,$3::jsonb)',
    ['Other',row.slug,JSON.stringify(draft())]),/slug_already_exists/);
  assert.equal((await as('authenticated',users.owner,'SELECT * FROM public.tournaments WHERE id=$1',[row.id])).rows[0].owner_id,users.owner);
});

test('shared-draft migration is rerunnable and preserves existing public and private tournaments',async()=>{
  const published=await create();
  const hidden=await createDraft();
  const source=fs.readFileSync(path.join(__dirname,'../MIGRATION_SHARED_DRAFT_V13_2.sql'),'utf8');
  // Emulate the pre-13.2 API before testing installation and repeatability.
  await db.exec('DROP FUNCTION public.create_tournament_draft(text,text,jsonb); ALTER TABLE public.tournaments ALTER COLUMN public_read SET DEFAULT true;');
  await db.exec(source);
  await db.exec(source);
  for(const original of [published,hidden]){
    const actual=(await as('authenticated',users.owner,'SELECT * FROM public.tournaments WHERE id=$1',[original.id])).rows[0];
    assert.equal(actual.public_read,original.public_read);
    assert.equal(Number(actual.revision),Number(original.revision));
    assert.deepEqual(actual.state,original.state);
  }
  assert.equal((await createDraft()).public_read,false);
});

test('only owners may grant/revoke existing admin accounts; owner cannot be removed',async()=>{
  const row=await create();
  await assert.rejects(as('authenticated',users.other,'SELECT public.add_tournament_admin($1,$2)',[row.id,'editor']),/owner_required/);
  await as('authenticated',users.owner,'SELECT public.add_tournament_admin($1,$2)',[row.id,'EDITOR']);
  assert.equal((await as('authenticated',users.editor,'SELECT public.get_my_tournament_role($1) AS role',[row.id])).rows[0].role,'editor');
  await save(row,row.state,users.editor);
  await assert.rejects(as('authenticated',users.editor,'SELECT public.add_tournament_admin($1,$2)',[row.id,'other']),/owner_required/);
  await assert.rejects(as('authenticated',users.owner,'SELECT public.add_tournament_admin($1,$2)',[row.id,'unknown']),/admin_not_found/);
  await assert.rejects(as('authenticated',users.owner,'SELECT public.remove_tournament_admin($1,$2)',[row.id,'owner']),/cannot_remove_owner/);
  await as('authenticated',users.owner,'SELECT public.remove_tournament_admin($1,$2)',[row.id,'editor']);
  await assert.rejects(save(row,row.state,users.editor),/not_allowed/);
});

test('optimistic revision rejects stale or NULL saves instead of overwriting another admin',async()=>{
  const row=await create();
  const a=clone(row.state);a.teams[0].name='Admin A';
  const saved=await save(row,a);
  const b=clone(row.state);b.teams[1].name='Admin B';
  await assert.rejects(save(row,b),/revision_conflict/);
  await assert.rejects(save(row,b,users.owner,null),/revision_conflict/);
  assert.equal(saved.state.teams[0].name,'Admin A');
  assert.equal((await as('authenticated',users.owner,'SELECT state FROM public.tournaments WHERE id=$1',[row.id])).rows[0].state.teams[1].name,'Coppia 2');
});

test('started roster/configuration/draw cannot be changed even through direct RPC calls',async()=>{
  const row=await create(startedState());
  assert.ok(row.state.metadata.startedAt);
  const mutations=[
    s=>{s.teams[0].seed=9;},
    s=>{s.teams[0].id='changed-id';},
    s=>{[s.teams[0],s.teams[1]]=[s.teams[1],s.teams[0]];},
    s=>{s.teams[4].name='Late entry';},
    s=>{s.teams[0].name=' ';},
    s=>{s.settings.courts=7;},
    s=>{s.groups.push({id:'fake',name:'Fake',teamIds:[]});},
    s=>{s.matches=[];},
    s=>{delete s.metadata.startedAt;},
    s=>{s.matches[0].court='Campo 12';},
    s=>{s.matches[0].aId=s.matches[0].bId;},
  ];
  for(const mutate of mutations){const changed=clone(row.state);mutate(changed);await assert.rejects(save(row,changed),/locked|invalid_match_team/,mutate.toString());}
});

test('names, results and score-derived progression remain writable after start',async()=>{
  let row=await create(startedState());
  let state=Engine.normalizeState(row.state);
  state.teams[0].name='Nome corretto';
  for(const match of state.matches){
    if(match.bye)continue;
    match.sets=[{a:'15',b:'10'},{a:'15',b:'10'},{a:'',b:''}];
    Engine.recomputeTeams(state);
  }
  row=await save(row,state);
  state=Engine.normalizeState(row.state);
  Engine.generateNextStage(state);
  row=await save(row,state);
  assert.ok(row.state.matches.some(match=>match.stage>0));
  state=Engine.normalizeState(row.state);
  const first=state.matches.find(match=>match.stage===0&&!match.bye);
  Engine.updateMatchScores(state,first.id,[{a:'10',b:'15'},{a:'10',b:'15'},{a:'',b:''}]);
  row=await save(row,state);
  assert.equal(row.state.teams[0].name,'Nome corretto');
  assert.equal(row.state.matches.find(match=>match.id===first.id).winnerId,first.bId);
  assert.equal(row.state.matches.filter(match=>match.stage>0).length,0);
});

test('invalid IDs, impossible references, malformed scores and oversized state are rejected',async()=>{
  const row=await create();
  for(const mutate of [
    s=>{s.teams[1].id=s.teams[0].id;},
    s=>{s.teams[0].name='x'.repeat(121);},
    s=>{s.teams[0].id=null;},
    s=>{s.metadata.huge='x'.repeat(1048576);},
  ]){const state=clone(row.state);mutate(state);await assert.rejects(save(row,state),/invalid_|duplicate_team_id/);}
  const started=await create(startedState());
  for(const score of ['-1','1.5','1000','NaN']){
    const state=clone(started.state);state.matches.find(match=>!match.bye).sets[0].a=score;
    await assert.rejects(save(started,state),/invalid_match_score/);
  }
});

test('all formats can finish and save every round under the production database lock',async()=>{
  const cases=[
    {format:Engine.FORMATS.SINGLE_ELIMINATION,count:7},
    {format:Engine.FORMATS.DOUBLE_ELIMINATION,count:7},
    {format:Engine.FORMATS.ROUND_ROBIN_FINAL4,count:5},
    {format:Engine.FORMATS.GROUPS_PLAYOFF,count:8,options:{groupCount:2,playoffSize:6,protectGroupWinners:true,silverEnabled:true,silverSize:'all'}},
  ];
  for(const config of cases){
    let state=draft();
    state.teams.forEach((team,index)=>{team.name=index<config.count?`Squadra ${index+1}`:'';team.seed=index<Math.min(4,config.count)?index+1:null;});
    state.settings.format=config.format;
    state.settings.courts=12;state.settings.slotMinutes=20;state.settings.dayEnd='23:59';
    Object.assign(state.settings.formatOptions,config.options||{});
    state=Engine.normalizeState(state);
    Engine.generateTournament(state,{drawCode:'ALLFORMATS'});
    let row=await create(state);
    for(let iteration=0;iteration<30&&!Engine.tournamentComplete(state);iteration++){
      for(const match of [...state.matches]){
        if(match.bye||match.winnerId)continue;
        const target=match.rule==='single_15'||match.rule==='best_of_3_15'?15:21;
        const sets=[{a:String(target),b:'10'},{a:'',b:''},{a:'',b:''}];
        if(match.rule.startsWith('best_of_3'))sets[1]={a:String(target),b:'10'};
        Engine.updateMatchScores(state,match.id,sets);
      }
      row=await save(row,state);
      if(!Engine.tournamentComplete(state)){
        Engine.generateNextStage(state);
        row=await save(row,state);
      }
    }
    assert.equal(Engine.tournamentComplete(state),true,config.format);
    assert.ok(row.state.championId,config.format);
    if(config.options?.silverEnabled)assert.ok(row.state.silverChampionId,'Silver champion');
  }
});

test('legacy owner transfer preserves a started tournament and removes the old owner write access',async()=>{
  const row=await create(startedState());
  const source=fs.readFileSync(path.join(__dirname,'../TRASFERISCI_PROPRIETARIO_ESEMPIO.sql'),'utf8');
  await assert.rejects(db.exec(source),/Compila v_username e v_slug/);
  const sql=source
    .replace("v_username text := 'INSERISCI_USERNAME';","v_username text := 'editor';")
    .replace("v_slug text := 'INSERISCI_CHIAVE_TORNEO';",`v_slug text := '${row.slug}';`);
  await db.exec(sql);
  const transferred=(await as('authenticated',users.editor,'SELECT * FROM public.tournaments WHERE id=$1',[row.id])).rows[0];
  assert.equal(transferred.owner_id,users.editor);
  assert.deepEqual(transferred.state,row.state);
  await assert.rejects(save(transferred,transferred.state,users.owner),/not_allowed/);
  await save(transferred,transferred.state,users.editor);
});
