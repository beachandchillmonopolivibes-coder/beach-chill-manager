const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load(overrides = {}, client = {}) {
  const window = {
    BEACH_APP_CONFIG: {supabaseUrl:'https://example.supabase.co',supabasePublishableKey:'sb_publishable_test123', ...overrides},
    atob: s => Buffer.from(s, 'base64').toString('binary'),
    supabase: {createClient: () => client},
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../db.js'),'utf8'), {window, URL, Promise});
  return window.BeachDB;
}

test('config accepts publishable/legacy anon keys and refuses secrets or malformed endpoints', () => {
  assert.equal(load().isConfigured(), true);
  const jwt = role => `e30.${Buffer.from(JSON.stringify({role})).toString('base64url')}.sig`;
  assert.equal(load({supabasePublishableKey:jwt('anon')}).isConfigured(), true);
  for (const key of ['sb_secret_hidden',jwt('service_role'),'YOUR_SUPABASE_KEY','random-value',''])
    assert.equal(load({supabasePublishableKey:key}).isConfigured(), false, key);
  for (const url of ['http://remote.supabase.co','https://example.supabase.co/rest/v1','https://user:pass@example.supabase.co','https://YOUR_PROJECT.supabase.co'])
    assert.equal(load({supabaseUrl:url}).isConfigured(), false, url);
  assert.equal(load({supabaseUrl:'http://127.0.0.1:54321'}).isConfigured(), true);
});

test('admin username is normalized and uses the same domain as SQL RPCs', () => {
  const db = load({adminEmailDomain:'wrong.invalid'});
  assert.equal(db.usernameToEmail(' Paolo.Sorino '),'paolo.sorino@admin.beachvolley.app');
  for (const value of ['', 'ab', 'user@example.com', 'nome utente', 'UPPERCASE!'])
    assert.throws(() => db.normalizeUsername(value), /invalid_username/);
});

test('save requires an explicit safe expected revision before any network call', async () => {
  let calls=0;
  const db = load({}, {rpc: async (_name,args) => {calls++; return {data:{revision:args.p_expected_revision+1},error:null};}});
  for (const revision of [null,undefined,-1,1.5,'0',Number.MAX_SAFE_INTEGER+1])
    await assert.rejects(db.saveTournamentState('id',{},revision), /revision_conflict/);
  await assert.rejects(db.saveTournamentState('id',null,0), /invalid_tournament_state/);
  assert.equal(calls,0);
  assert.equal((await db.saveTournamentState('id',{},0)).revision,1);
  assert.equal(calls,1);
});

test('RPC errors propagate; sign-in preserves password characters', async () => {
  let credentials;
  const db = load({}, {
    auth:{signInWithPassword: async value => {credentials=value;return {data:{session:{user:{id:'1'}}},error:null};}},
    rpc: async () => ({data:null,error:new Error('not_allowed')}),
  });
  await db.signInAdmin('Paolo','  secret  ');
  assert.equal(credentials.email,'paolo@admin.beachvolley.app');
  assert.equal(credentials.password,'  secret  ');
  await assert.rejects(db.saveTournamentState('id',{},0), /not_allowed/);
});

test('late realtime messages/statuses from an unsubscribed tournament are ignored', async () => {
  const channels=[];
  const client={channel: () => {
    const entry={on: (_type,_filter,callback) => {entry.message=callback;return entry;},subscribe: callback => {entry.status=callback;return entry;}};
    channels.push(entry);return entry;
  },removeChannel: async () => {throw new Error('simulated closed socket');}};
  const db=load({},client), events=[], statuses=[];
  db.subscribeToTournament('first',row=>events.push(row),status=>statuses.push(status));
  db.subscribeToTournament('second',row=>events.push(row),status=>statuses.push(status));
  channels[0].message({new:'stale'});channels[0].status('SUBSCRIBED');
  channels[1].message({new:'current'});channels[1].status('SUBSCRIBED');
  assert.deepEqual(events,['current']);assert.deepEqual(statuses,['SUBSCRIBED']);
  db.unsubscribe();channels[1].message({new:'stale again'});
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(events,['current']);
});
