'use strict';
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {PGlite}=require('@electric-sql/pglite');
const root=path.join(__dirname,'..');
const window={crypto:require('node:crypto').webcrypto,structuredClone,BEACH_APP_CONFIG:{}};
vm.runInNewContext(fs.readFileSync(path.join(root,'engine.js'),'utf8'),{window,console,Date,Math,Uint32Array});
const E=window.BeachEngine;
const copy=value=>JSON.parse(JSON.stringify(value));
const users={owner:'11111111-1111-4111-8111-111111111111',editor:'22222222-2222-4222-8222-222222222222',other:'33333333-3333-4333-8333-333333333333'};
let db,slug=0;
before(async()=>{
  db=new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,created_at timestamptz DEFAULT now());
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO anon,authenticated;
    CREATE PUBLICATION supabase_realtime;`);
  await db.exec(fs.readFileSync(path.join(root,'schema.sql'),'utf8'));
  // Execute the exact compact delivery file, not a reconstructed test version.
  await db.exec(fs.readFileSync(path.join(root,'MIGRATION_RESET_BRACKET_V13_3.sql'),'utf8'));
  for(const [name,id] of Object.entries(users))await db.query('INSERT INTO auth.users(id,email) VALUES($1,$2)',[id,`${name}@admin.beachvolley.app`]);
});
after(async()=>{if(db)await db.close();});
async function as(role,user,sql,args=[]){
  await db.exec(`SET ROLE ${role}`);
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[user||'']);
  try{return await db.query(sql,args);}finally{await db.exec('RESET ROLE');await db.query("SELECT set_config('request.jwt.claim.sub','',false)");}
}
function started(){
  const state=E.createDefaultState();
  state.teams.forEach((team,i)=>{team.name=i<8?`Coppia ${i+1}`:'';team.seed=i<4?i+1:null;team.manualGroup=i<8?i%2+1:null;});
  Object.assign(state.settings,{format:E.FORMATS.GROUPS_PLAYOFF,courts:2,eventDate:'2026-10-22'});
  Object.assign(state.settings.formatOptions,{groupCount:2,groupAssignmentMode:'manual',playoffSize:4,protectGroupWinners:false});
  E.generateTournament(state,{drawCode:'RESET-TEST'});
  E.updateMatchScores(state,state.matches[0].id,[{a:'21',b:'10'},{a:'',b:''},{a:'',b:''}]);
  return copy(state);
}
async function create(state=started()){
  const row=(await as('authenticated',users.owner,'SELECT * FROM public.create_tournament_draft($1,$2,$3::jsonb)',['Reset test',`reset-test-${++slug}`,JSON.stringify(state)])).rows[0];
  await as('authenticated',users.owner,'SELECT public.add_tournament_admin($1,$2)',[row.id,'editor']);
  return (await as('authenticated',users.owner,'SELECT * FROM public.set_tournament_public_read($1,true)',[row.id])).rows[0];
}
async function reset(row,user=users.owner,revision=row.revision){
  return (await as('authenticated',user,'SELECT * FROM public.reset_tournament_bracket($1,$2)',[row.id,revision])).rows[0];
}
async function save(row,state,revision=row.revision){
  return (await as('authenticated',users.owner,'SELECT * FROM public.save_tournament_state($1,$2::jsonb,$3)',[row.id,JSON.stringify(state),revision])).rows[0];
}
async function actual(row){return(await as('authenticated',users.owner,'SELECT * FROM public.tournaments WHERE id=$1',[row.id])).rows[0];}

test('owner atomically removes a published started bracket and keeps the event, entrants, settings and admins',async()=>{
  const row=await create();
  assert.equal(row.public_read,true);
  assert.ok(row.state.metadata.startedAt);
  assert.ok(row.state.matches.some(m=>m.winnerId));
  const members=(await db.query('SELECT user_id,role FROM public.tournament_members WHERE tournament_id=$1 ORDER BY user_id',[row.id])).rows;
  const result=await reset(row);
  for(const field of ['id','slug','name','owner_id','created_at'])assert.deepEqual(result[field],row[field],field);
  assert.equal(Number(result.revision),Number(row.revision)+1);
  assert.equal(result.public_read,false);
  for(const field of ['matches','groups','qualifiers','silverQualifiers'])assert.deepEqual(result.state[field],[]);
  for(const field of ['championId','silverChampionId','postseasonPlan'])assert.equal(result.state[field],null);
  assert.equal(result.state.stage,-1);
  assert.equal(result.state.finalResetPlayed,false);
  assert.equal(result.state.metadata.startedAt,null);
  assert.deepEqual(result.state.metadata.scheduleWarnings,[]);
  const expectedSettings=copy(row.state.settings);
  Object.assign(expectedSettings.draw,{code:null,generatedAt:null});
  Object.assign(expectedSettings.byePolicy,{cursor:0,lastTeamId:null,history:[]});
  assert.deepEqual(result.state.settings,expectedSettings);
  result.state.teams.forEach((team,i)=>{
    const old=row.state.teams[i];
    for(const field of ['id','name','seed','manualGroup'])assert.deepEqual(team[field],old[field],field);
    assert.equal(team.groupId,null);
    for(const field of ['losses','byes','initialByes','fairByes','technicalByes'])assert.equal(team[field],0);
    assert.equal(team.out,false);
  });
  assert.deepEqual((await db.query('SELECT user_id,role FROM public.tournament_members WHERE tournament_id=$1 ORDER BY user_id',[row.id])).rows,members);
  const editor=(await as('authenticated',users.editor,'SELECT * FROM public.tournaments WHERE id=$1',[row.id])).rows[0];
  assert.deepEqual(editor.state,result.state);
  assert.equal((await as('anon',null,'SELECT id FROM public.tournaments WHERE id=$1',[row.id])).rows.length,0);
  assert.equal(Number((await db.query('SELECT count(*) AS n FROM private.bracket_reset_context')).rows[0].n),0);
});

test('reset rejects anonymous users, nonowners and missing or stale confirmation revisions without changing anything',async()=>{
  const row=await create();
  await assert.rejects(as('anon',null,'SELECT * FROM public.reset_tournament_bracket($1,$2)',[row.id,row.revision]),/permission denied/);
  for(const user of [users.editor,users.other,null])await assert.rejects(reset(row,user),/owner_required/);
  for(const revision of [null,-1,Number(row.revision)-1])await assert.rejects(reset(row,users.owner,revision),/revision_conflict/);
  const edited=copy(row.state);edited.teams[0].name='Updated by another admin';
  const latest=(await as('authenticated',users.editor,'SELECT * FROM public.save_tournament_state($1,$2::jsonb,$3)',[row.id,JSON.stringify(edited),row.revision])).rows[0];
  await assert.rejects(reset(row),/revision_conflict/);
  assert.deepEqual(await actual(row),latest);
});

test('ordinary saves and client flags cannot use the special reset exception',async()=>{
  const row=await create();
  const resetLike=copy(row.state);
  Object.assign(resetLike,{matches:[],groups:[],stage:-1,qualifiers:[],silverQualifiers:[],championId:null,silverChampionId:null,postseasonPlan:null});
  resetLike.metadata.startedAt=null;
  await as('authenticated',users.owner,"SELECT set_config('beach.allow_bracket_reset','true',false)");
  await assert.rejects(save(row,resetLike),/tournament_structure_locked/);
  for(const user of [users.owner,users.editor]){
    await assert.rejects(as('authenticated',user,'SELECT * FROM private.bracket_reset_context'),/permission denied/);
    await assert.rejects(as('authenticated',user,'INSERT INTO private.bracket_reset_context VALUES($1,txid_current(),$2,$3,$4::jsonb)',[row.id,user,row.revision,JSON.stringify(resetLike)]),/permission denied/);
  }
  assert.deepEqual(await actual(row),row);
});

test('the reset draft can be configured and regenerated while its subsequent started bracket stays protected',async()=>{
  let row=await reset(await create());
  const draft=E.normalizeState(row.state);
  assert.equal(E.validateStateSnapshot(draft),'');
  draft.settings.courts=4;
  E.generateTournament(draft,{drawCode:'AFTER-RESET'});
  row=await save(row,draft);
  assert.ok(row.state.metadata.startedAt);
  assert.ok(row.state.matches.length>0);
  assert.equal(row.public_read,false);
  const invalid=copy(row.state);invalid.matches=[];invalid.metadata.startedAt=null;
  await assert.rejects(save(row,invalid),/tournament_structure_locked/);
});

test('reset migration upgrades the old guard repeatedly without mutating tournaments or their public state',async()=>{
  const row=await create();
  // Emulate the old guard that was installed in existing version-13.2 projects.
  await db.exec(fs.readFileSync(path.join(root,'MIGRATION_PRO_V11.sql'),'utf8'));
  await db.exec('DROP FUNCTION public.reset_tournament_bracket(uuid,bigint); DROP TABLE private.bracket_reset_context;');
  const migration=fs.readFileSync(path.join(root,'MIGRATION_RESET_BRACKET_V13_3.sql'),'utf8');
  await db.exec(migration);
  await db.exec(migration);
  assert.deepEqual(await actual(row),row);
  const cleared=await reset(row);
  assert.equal(cleared.state.matches.length,0);
  assert.equal(cleared.public_read,false);
});

test('the single Supabase update installs both RPCs on an old v11 backend and reruns without changing existing data',async()=>{
  const published=await create();
  let hidden=await create();
  hidden=(await as('authenticated',users.owner,'SELECT * FROM public.set_tournament_public_read($1,false)',[hidden.id])).rows[0];
  const members=(await db.query('SELECT tournament_id,user_id,role FROM public.tournament_members ORDER BY tournament_id,user_id')).rows;
  await db.exec(fs.readFileSync(path.join(root,'MIGRATION_PRO_V11.sql'),'utf8'));
  await db.exec('DROP FUNCTION public.create_tournament_draft(text,text,jsonb); DROP FUNCTION public.reset_tournament_bracket(uuid,bigint); DROP TABLE private.bracket_reset_context;');
  const source=fs.readFileSync(path.join(root,'00_AGGIORNAMENTO_SUPABASE.sql'),'utf8');
  for(let attempt=0;attempt<2;attempt++){
    const result=(await db.exec(source)).at(-1).rows[0];
    assert.equal(result.esito,'AGGIORNAMENTO_COMPLETATO');
    assert.equal(result.bozza_privata,'create_tournament_draft(text,text,jsonb)');
    assert.equal(result.elimina_tabellone,'reset_tournament_bracket(uuid,bigint)');
    for(const original of [published,hidden])assert.deepEqual(await actual(original),original);
    assert.deepEqual((await db.query('SELECT tournament_id,user_id,role FROM public.tournament_members ORDER BY tournament_id,user_id')).rows,members);
  }
  const privateDraft=(await as('authenticated',users.owner,'SELECT * FROM public.create_tournament_draft($1,$2,$3::jsonb)',
    ['Unified update',`unified-update-${++slug}`,JSON.stringify(E.createDefaultState())])).rows[0];
  assert.equal(privateDraft.public_read,false);
  assert.equal((await as('anon',null,'SELECT id FROM public.tournaments WHERE id=$1',[privateDraft.id])).rows.length,0);
  await assert.rejects(reset(published,users.editor),/owner_required/);
  const resetLike=copy(published.state);resetLike.matches=[];
  await assert.rejects(save(published,resetLike),/tournament_structure_locked/);
  const cleared=await reset(published);
  assert.equal(cleared.public_read,false);
  assert.equal(cleared.state.matches.length,0);
});

test('SQL delivery files are complete compact scripts with named body delimiters and final verification',()=>{
  for(const [name,maxLines,check] of [
    ['MIGRATION_RESET_BRACKET_V13_3.sql',85,'RESET_INSTALLATO'],
    ['00_AGGIORNAMENTO_SUPABASE.sql',94,'AGGIORNAMENTO_COMPLETATO'],
  ]){
    const source=fs.readFileSync(path.join(root,name),'utf8');
    assert.ok(source.trimEnd().split('\n').length<=maxLines,name);
    assert.ok(source.startsWith('-- INIZIO FILE COMPLETO: '+name));
    assert.ok(source.trimEnd().endsWith('-- FINE FILE COMPLETO: '+name));
    assert.ok(!source.includes('$$'),'function bodies use named delimiters');
    for(const delimiter of ['$guard_reset$','$reset_bracket$'])assert.equal(source.split(delimiter).length-1,2,delimiter);
    if(name.startsWith('00_'))assert.equal(source.split('$shared_draft$').length-1,2);
    assert.ok(source.indexOf(check)>source.lastIndexOf('commit;'));
  }
});

test('published started results can be cleared with the real engine through the ordinary guarded CAS save in every format',async()=>{
  const cases=[
    {format:E.FORMATS.SINGLE_ELIMINATION,count:7},
    {format:E.FORMATS.DOUBLE_ELIMINATION,count:7},
    {format:E.FORMATS.ROUND_ROBIN_FINAL4,count:5},
    {format:E.FORMATS.GROUPS_PLAYOFF,count:8,options:{groupCount:2,playoffSize:6,protectGroupWinners:true,silverEnabled:true,silverSize:'all'}},
  ];
  const scoreSets=match=>{
    const target=match.rule==='single_15'||match.rule==='best_of_3_15'?15:21;
    const sets=[{a:String(target),b:'10'},{a:'',b:''},{a:'',b:''}];
    if(match.rule.startsWith('best_of_3'))sets[1]={a:String(target),b:'10'};
    return sets;
  };
  const initialLayout=state=>state.matches.filter(m=>m.stage===0).map(m=>Object.fromEntries(
    Object.entries(m).filter(([key])=>!['sets','winnerId','loserId','updatedAt'].includes(key))
  ));
  for(const config of cases){
    let state=E.createDefaultState();
    state.teams.forEach((team,index)=>{team.name=index<config.count?`Score reset ${index+1}`:'';team.seed=index<Math.min(4,config.count)?index+1:null;});
    Object.assign(state.settings,{format:config.format,courts:12,slotMinutes:20,dayEnd:'23:59'});
    Object.assign(state.settings.formatOptions,config.options||{});
    E.generateTournament(state,{drawCode:'SCORE-RESET-SQL'});
    let row=await create(state);
    state=E.normalizeState(row.state);
    for(const match of [...state.matches])if(!match.bye&&!match.winnerId)E.updateMatchScores(state,match.id,scoreSets(match));
    row=await save(row,state);
    E.generateNextStage(state);
    assert.ok(state.matches.some(m=>m.stage>0),config.format+' has a later stage to remove');
    const later=state.matches.find(m=>m.stage>0&&!m.bye);
    if(later)E.updateMatchScores(state,later.id,scoreSets(later));
    row=await save(row,state);
    const before=row;
    const draw=copy(state.settings.draw),groups=copy(state.groups),layout=copy(initialLayout(state));
    const startedAt=state.metadata.startedAt;
    assert.ok(layout.filter(m=>!m.bye).every(m=>m.court&&m.startTime),config.format+' has an actual initial schedule');

    const candidate=E.normalizeState(copy(row.state));
    E.resetScores(candidate,{allowStarted:true});
    assert.equal(candidate.metadata.startedAt,startedAt);
    assert.deepEqual(copy(candidate.settings.draw),draw);
    assert.deepEqual(copy(candidate.groups),groups);
    assert.deepEqual(copy(initialLayout(candidate)),layout);
    assert.ok(candidate.matches.every(m=>m.stage===0));
    assert.ok(candidate.matches.every(m=>m.sets.every(set=>set.a===''&&set.b==='')));
    assert.ok(candidate.matches.filter(m=>!m.bye).every(m=>m.winnerId===null&&m.loserId===null));
    assert.ok(candidate.teams.every(team=>team.losses===0&&!team.out));
    assert.deepEqual(copy(candidate.qualifiers),[]);
    assert.deepEqual(copy(candidate.silverQualifiers),[]);
    assert.equal(candidate.postseasonPlan,null);
    assert.equal(candidate.championId,null);
    assert.equal(candidate.silverChampionId,null);
    row=await save(row,candidate);
    assert.equal(row.public_read,true,'score reset preserves the already published view');
    assert.equal(Number(row.revision),Number(before.revision)+1);
    assert.deepEqual(row.state.matches,copy(candidate.matches));
    const seen=(await as('anon',null,'SELECT state FROM public.tournaments WHERE id=$1',[row.id])).rows[0];
    assert.deepEqual(seen.state.matches,row.state.matches,'public readers see cleared results on the same bracket');

    const stale=copy(before.state);stale.teams[0].name='Stale admin';
    await assert.rejects(save(before,stale),/revision_conflict/);
    assert.deepEqual(await actual(row),row);
    const resumed=E.normalizeState(copy(row.state));
    const first=resumed.matches.find(m=>!m.bye);
    E.updateMatchScores(resumed,first.id,scoreSets(first));
    row=await save(row,resumed);
    assert.equal(row.state.matches.find(m=>m.id===first.id).winnerId,first.aId,'new scores can be entered normally');
    assert.equal(row.public_read,true);
    assert.deepEqual(initialLayout(row.state),layout);
  }
});
