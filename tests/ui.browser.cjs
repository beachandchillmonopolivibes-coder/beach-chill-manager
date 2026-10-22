'use strict';
// Esegue un browser vero: npm install && npx playwright install chromium && npm run test:browser.
// Tutte le richieste esterne sono bloccate: nessun progetto Supabase viene contattato.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
let playwright;
try { playwright = require('playwright'); }
catch (error) {
  if (!process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES) throw error;
  playwright = require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright'));
}
const root = path.resolve(__dirname, '..');
const sandbox = { window: { crypto: webcrypto, structuredClone } };
vm.runInNewContext(fs.readFileSync(path.join(root, 'engine.js'), 'utf8'), sandbox);
const Engine = sandbox.window.BeachEngine;
let browser, server, base;
const key = 'beach-volley-manager-v6:qa-tournament';
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

before(async () => {
  server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await playwright.chromium.launch({ headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, args: ['--no-sandbox', '--disable-dev-shm-usage'] } : {}) });
});
after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});

function stateWithTeams(start = false) {
  const state = Engine.createDefaultState();
  state.settings.format = Engine.FORMATS.SINGLE_ELIMINATION;
  state.settings.tournamentName = 'QA Beach Tournament';
  for (let i = 0; i < 4; i++) { state.teams[i].name = `Coppia ${i + 1}`; state.teams[i].seed = i + 1; }
  if (start) Engine.generateTournament(state, { drawCode: 'QA-2026' });
  return JSON.parse(JSON.stringify(state));
}
async function newPage({ state, mobile = false, unavailable = false, conflict = false, connection = null } = {}) {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  page.setDefaultTimeout(7000);
  page.qaErrors = [];
  page.on('pageerror', error => { page.qaErrors.push(error.message); process.stderr.write('Browser error: ' + error.message + '\n'); });
  await page.route('**/*', route => {
    if (!route.request().url().startsWith(base + '/')) return route.abort();
    if (/\/config\.js(?:\?|$)/.test(route.request().url())) return route.fulfill({ contentType: 'text/javascript', body: 'window.BEACH_APP_CONFIG={supabaseUrl:"",supabasePublishableKey:"",defaultTournamentSlug:"qa-tournament"};' });
    if (connection && /\/db\.js(?:\?|$)/.test(route.request().url())) return route.fulfill({ contentType:'text/javascript',body:`
      window.__mockSession=${JSON.stringify(connection.signedIn ? {user:{id:'qa-admin-id',email:'admin@admin.beachvolley.app'}} : null)};
      window.__mockRow=${JSON.stringify(connection.existing ? {id:'qa-tournament-id',slug:'qa-tournament',name:'QA Beach Tournament',public_read:true,state:stateWithTeams(false),revision:1,owner_id:'qa-admin-id',updated_at:'2026-10-22T10:00:00Z'} : null)};
      window.__createdTournament=null; window.__saveCalls=0;
      window.BeachDB={isConfigured:()=>true,init:()=>null,getSession:async()=>window.__mockSession,onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),getMyRole:async()=>window.__mockSession?'owner':null,listTournamentAdmins:async()=>[],sessionUsername:()=>window.__mockSession?'admin':'',loadTournamentBySlug:async()=>structuredClone(window.__mockRow),subscribeToTournament(){},unsubscribe(){},saveTournamentState:async(id,state,revision)=>{window.__saveCalls+=1;window.__mockRow.state=structuredClone(state);window.__mockRow.revision+=1;return structuredClone(window.__mockRow);},createTournament:async(name,slug,state)=>{window.__createdTournament={name,slug,state:structuredClone(state)};window.__mockRow={id:'qa-created-id',slug,name,public_read:true,state:structuredClone(state),revision:0,owner_id:'qa-admin-id',updated_at:'2026-10-22T10:00:00Z'};return structuredClone(window.__mockRow);}};
    ` });
    if (conflict && /\/db\.js(?:\?|$)/.test(route.request().url())) return route.fulfill({ contentType: 'text/javascript', body: `
      window.__initialRow=${JSON.stringify({id:'qa-tournament-id',slug:'qa-tournament',name:'QA Beach Tournament',public_read:true,state:stateWithTeams(true),revision:1,owner_id:'qa-admin-id',updated_at:'2026-10-22T10:00:00Z'})};
      window.__row=JSON.parse(sessionStorage.getItem('qa-server-row')||'null')||window.__initialRow;
      window.BeachDB={isConfigured:()=>true,init:()=>null,getSession:async()=>({user:{id:'qa-admin-id',email:'admin@admin.beachvolley.app'}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),getMyRole:async()=> 'owner',listTournamentAdmins:async()=>[],sessionUsername:()=> 'admin',loadTournamentBySlug:async()=>structuredClone(window.__row),subscribeToTournament(){},unsubscribe(){},saveTournamentState:async(id,state,revision)=>{sessionStorage.setItem('qa-save-count',String(Number(sessionStorage.getItem('qa-save-count')||0)+1));window.__row.revision=2;window.__row.state.teams[1].name='Nome remoto';sessionStorage.setItem('qa-server-row',JSON.stringify(window.__row));throw new Error('revision_conflict');}};
    ` });
    if (unavailable && /\/db\.js(?:\?|$)/.test(route.request().url())) return route.fulfill({ contentType: 'text/javascript', body: `window.BeachDB={isConfigured:()=>true,init:()=>null,getSession:async()=>null,onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),loadTournamentBySlug:async()=>null,sessionUsername:()=>'',unsubscribe(){},subscribeToTournament(){}};` });
    return route.continue();
  });
  if (state) await page.addInitScript(({ key, state }) => { if (!sessionStorage.getItem('qa-initialized')) { localStorage.setItem(key, JSON.stringify(state)); sessionStorage.setItem('qa-initialized','1'); } }, { key, state });
  return { context, page };
}
async function currentState(page) { return page.evaluate(key => JSON.parse(localStorage.getItem(key)), key); }
async function expectNoErrors(page) { assert.deepEqual(page.qaErrors, []); }
async function settle(page) { await page.waitForTimeout(200); }
async function capture(page, name) {
  if (!process.env.QA_SCREENSHOT_DIR) return;
  fs.mkdirSync(process.env.QA_SCREENSHOT_DIR, {recursive:true});
  await page.screenshot({path:path.join(process.env.QA_SCREENSHOT_DIR,name+'.png'),fullPage:true});
}

for (const mobile of [false, true]) {
  test(`Squadre: iscrizioni e impostazioni bloccate dopo l'avvio, nomi modificabili (${mobile ? 'mobile' : 'desktop'})`, async () => {
    const { context, page } = await newPage({ state: stateWithTeams(true), mobile });
    try {
      await page.goto(`${base}/?t=qa-tournament&open=teams`);
      await page.locator('#teams.view.active').waitFor();
      const input = page.locator('#teamRows .team-name-input').first();
      assert.equal(await input.isEnabled(), true, 'il nome resta modificabile dopo avvio');
      await input.fill('Coppia rinominata');
      await input.blur();
      await settle(page);
      assert.equal((await currentState(page)).teams[0].name, 'Coppia rinominata');
      assert.equal(await page.locator('#teamRows .seed-input').first().isDisabled(), true);
      if (mobile) {
        const nameBox=await input.boundingBox(), seedBox=await page.locator('#teamRows .seed-input').first().boundingBox();
        assert.ok(nameBox.y+nameBox.height <= seedBox.y+1 || seedBox.y+seedBox.height <= nameBox.y+1 || nameBox.x+nameBox.width <= seedBox.x+1 || seedBox.x+seedBox.width <= nameBox.x+1, 'nome e TS non si sovrappongono su smartphone');
      }
      assert.equal(await page.locator('#teamRows .team-name-input').count(), 4, 'non si possono iscrivere altre coppie');
      await input.fill(''); await input.blur(); await settle(page);
      assert.equal((await currentState(page)).teams[0].name, 'Coppia rinominata', 'non si può rimuovere una coppia dopo avvio');
      assert.equal(await page.locator('#clearTeamsBtn').isDisabled(), true);
      assert.equal(await page.locator('#clearTeamsBtn').isVisible(), false);
      assert.equal(await page.locator('#loadDefaultsBtn').isVisible(), false);
      assert.equal(await page.locator('#clearBulkBtn').isVisible(), false);
      await capture(page,mobile?'qa-teams-mobile-final':'qa-teams-desktop-final');
      await page.locator('[data-tab=setup]').click();
      assert.equal(await page.locator('#courtsInput').isDisabled(), true);
      assert.equal(await page.locator('#generateBtn').isDisabled(), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), true, 'nessuno scorrimento orizzontale della pagina');
      await expectNoErrors(page);
    } finally { await context.close(); }
  });
}

test('Punteggi: bozza esplicita, salvataggio, fase successiva e correzione di una fase precedente', async () => {
  const { context, page } = await newPage({ state: stateWithTeams(true) });
  try {
    await page.goto(`${base}/?t=qa-tournament&open=matches`);
    await page.locator('#matches.view.active').waitFor();
    await page.locator('#statusFilter').selectOption('all');
    const matches = (await currentState(page)).matches;
    const firstId = matches[0].id;
    for (const match of matches.filter(match => !match.bye)) {
      const card = page.locator(`.match-card[data-match-id="${match.id}"]`);
      await card.locator('.a1').fill('15'); await card.locator('.b1').fill('8');
      await card.locator('.a2').fill('15'); await card.locator('.b2').fill('7');
      assert.equal((await currentState(page)).matches.find(item => item.id === match.id).winnerId, null, 'la bozza non cambia il risultato salvato');
      await card.locator('.save-match').click();
      await settle(page);
      assert.ok((await currentState(page)).matches.find(item => item.id === match.id).winnerId);
    }
    await page.locator('#advanceBtn').click();
    await settle(page);
    assert.ok((await currentState(page)).matches.some(match => match.stage > 0));
    await page.locator('#statusFilter').selectOption('all');
    await page.locator('#phaseFilter').selectOption('all');
    const card = page.locator(`.match-card[data-match-id="${firstId}"]`);
    assert.equal(await card.locator('.a1').isEnabled(), true, 'punteggi modificabili nelle fasi precedenti');
    await card.locator('.a1').fill('8'); await card.locator('.b1').fill('15');
    await card.locator('.a2').fill('7'); await card.locator('.b2').fill('15');
    const beforeCorrection=JSON.stringify(await currentState(page));
    await card.locator('.save-match').click();
    await page.locator('#confirmDialog[open]').waitFor();
    await page.locator('#confirmCancel').click();
    await settle(page);
    assert.equal(JSON.stringify(await currentState(page)),beforeCorrection,'annullare la correzione conserva punteggi e fasi già generate');
    await card.locator('.save-match').click();
    await page.locator('#confirmDialog[open]').waitFor();
    await page.locator('#confirmAccept').click();
    await settle(page);
    const updated = await currentState(page);
    assert.ok(updated.matches.every(match => match.stage === 0), 'le fasi dipendenti vengono invalidate');
    assert.equal(updated.matches.find(match => match.id === firstId).winnerId, matches[0].bId);
    assert.ok(updated.metadata.startedAt, 'il blocco iscrizioni resta attivo dopo la correzione');
    await page.locator('#advanceBtn').click(); await settle(page);
    const beforeEscape=JSON.stringify(await currentState(page));
    const repeated=page.locator(`.match-card[data-match-id="${firstId}"]`);
    await repeated.locator('.a1').fill('15'); await repeated.locator('.b1').fill('8');
    await repeated.locator('.a2').fill('15'); await repeated.locator('.b2').fill('7');
    await repeated.locator('.save-match').click();
    await page.locator('#confirmDialog[open]').waitFor();
    await page.keyboard.press('Escape'); await settle(page);
    assert.equal(await page.locator('#confirmDialog[open]').count(),0);
    assert.equal(JSON.stringify(await currentState(page)),beforeEscape,'Escape annulla anche dopo una precedente conferma accettata');
    await expectNoErrors(page);
  } finally { await context.close(); }
});

test('Vista Live pubblica: controlli editor nascosti e nessun errore JavaScript', async () => {
  const { context, page } = await newPage({ state: stateWithTeams(true), mobile: true });
  try {
    await page.goto(`${base}/?t=qa-tournament&live=1`);
    await page.locator('#live.view.active').waitFor();
    assert.equal(await page.locator('[data-tab=teams]').isVisible(), false);
    assert.equal(await page.locator('[data-tab=matches]').isVisible(), false);
    await expectNoErrors(page);
  } finally { await context.close(); }
});

test('Torneo remoto non accessibile: i dati locali precedenti non sono mostrati', async () => {
  const state = stateWithTeams(true); state.teams[0].name = 'PRIVATE-TEAM-SHOULD-NOT-APPEAR';
  const { context, page } = await newPage({ state, unavailable: true });
  try {
    await page.goto(`${base}/?t=qa-tournament&live=1`);
    await settle(page);
    assert.equal((await page.locator('body').innerText()).includes('PRIVATE-TEAM-SHOULD-NOT-APPEAR'), false);
    await expectNoErrors(page);
  } finally { await context.close(); }
});

test('Avvio da mobile: importa coppie, configura la formula e conferma il blocco iscrizioni', async () => {
  const { context, page } = await newPage({ mobile: true });
  try {
    await page.goto(`${base}/?t=qa-tournament&open=teams`);
    await page.locator('#bulkImportPanel summary').click();
    await page.locator('#bulkTeamsInput').fill('1 Alice - Bruno\n2 Carla - Diego\n3 Eva - Fabio\n4 Gaia - Hugo');
    await page.locator('#bulkPreviewBtn').click();
    assert.match(await page.locator('#bulkPreviewCount').innerText(), /4 coppie/);
    await page.locator('#bulkApplyBtn').click();
    await settle(page);
    assert.equal((await currentState(page)).teams.filter(item => item.name.trim()).length, 4);
    await page.locator('[data-tab=setup]').click();
    await page.locator('[data-format=single_elimination]').click();
    await page.locator('#generateBtn').click();
    await page.locator('#confirmDialog[open]').waitFor();
    assert.equal((await currentState(page)).matches.length, 0, 'la conferma precede il sorteggio definitivo');
    await page.locator('#confirmAccept').click();
    await page.locator('#matches.view.active').waitFor();
    assert.equal((await currentState(page)).matches.length, 2);
    assert.ok((await currentState(page)).metadata.startedAt);
    await expectNoErrors(page);
  } finally { await context.close(); }
});

test('Due admin: conflitto senza sovrascrittura, bozza recuperata dopo reload e scelta esplicita della versione online', async () => {
  const { context, page } = await newPage({ conflict: true });
  try {
    await page.goto(`${base}/?t=qa-tournament&open=teams`);
    await page.locator('#teams.view.active').waitFor();
    const input = page.locator('#teamRows .team-name-input').first();
    await input.fill('La mia bozza'); await input.blur();
    await page.locator('#conflictPanel:not(.hidden)').waitFor();
    assert.equal(await page.evaluate(() => Number(sessionStorage.getItem('qa-save-count'))), 1, 'nessun retry automatico che sovrascrive il lavoro altrui');
    assert.equal(await page.locator('#retrySaveBtn').isVisible(), false);
    assert.equal((await currentState(page)).teams[0].name, 'La mia bozza');
    let draft = await page.evaluate(key => JSON.parse(localStorage.getItem(key + ':draft')), key);
    assert.equal(draft.pending, true); assert.equal(draft.baseRevision, 1);
    await page.reload();
    await page.locator('#conflictPanel:not(.hidden)').waitFor();
    await page.locator('[data-tab=teams]').click();
    assert.equal(await page.locator('#teamRows .team-name-input').first().inputValue(), 'La mia bozza');
    draft = await page.evaluate(key => JSON.parse(localStorage.getItem(key + ':draft')), key);
    assert.equal(draft.baseRevision, 1, 'reload conserva la revisione di origine della bozza');
    await page.locator('#reloadRemoteBtn').click();
    await page.locator('#confirmDialog[open]').waitFor();
    await page.locator('#confirmAccept').click();
    await page.locator('#conflictPanel.hidden').waitFor({ state: 'attached' });
    await settle(page);
    assert.equal((await currentState(page)).teams[0].name, 'Coppia 1');
    assert.equal((await currentState(page)).teams[1].name, 'Nome remoto');
    await expectNoErrors(page);
  } finally { await context.close(); }
});

test('Tema e punteggi da smartphone: switch funzionante con puntatore e tastiera, layout senza overflow', async () => {
  const { context, page } = await newPage({ state: stateWithTeams(true), mobile: true });
  try {
    await page.goto(`${base}/?t=qa-tournament&open=matches`);
    await page.locator('#matches.view.active').waitFor();
    await page.locator('.theme-toggle').click();
    await page.waitForTimeout(400);
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), true);
    await capture(page,'qa-matches-mobile-dark-final');
    await page.locator('#themeToggle').focus();
    await page.keyboard.press('Space');
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
    await expectNoErrors(page);
  } finally { await context.close(); }
});

test('Import Excel: mantiene entrambi i giocatori, ignora intestazioni e rifiuta più di 24 coppie senza perdere dati', async () => {
  const state=stateWithTeams(false); state.teams.forEach(team=>{team.name='';team.seed=null;});
  const { context, page }=await newPage({state,mobile:true});
  try {
    await page.goto(`${base}/?t=qa-tournament&open=teams`);
    await page.locator('#bulkImportPanel summary').click();
    await page.locator('#bulkTeamsInput').fill('Giocatore 1\tGiocatore 2\nAlice\tBruno\nCarla\tDiego');
    await page.locator('#bulkPreviewBtn').click();
    assert.match(await page.locator('#bulkPreviewCount').innerText(),/2 coppie/);
    await page.locator('#bulkApplyBtn').click();
    await settle(page);
    const names=(await currentState(page)).teams.filter(team=>team.name.trim()).map(team=>team.name);
    assert.equal(names.length,2); assert.match(names[0],/Alice.*Bruno/); assert.match(names[1],/Carla.*Diego/);
    const before=JSON.stringify(await currentState(page));
    const tooMany=Array.from({length:25},(_,i)=>`Coppia ${i+1} - Giocatore ${i+1}`).join('\n');
    await page.locator('#bulkTeamsInput').fill(tooMany);
    await page.locator('#bulkPreviewBtn').click();
    if(await page.locator('#bulkApplyBtn').isEnabled()) await page.locator('#bulkApplyBtn').click();
    await settle(page);
    assert.equal(JSON.stringify(await currentState(page)),before,'un elenco troppo lungo non tronca né sostituisce gli iscritti');
    assert.equal(await page.locator('#confirmDialog[open]').count(),0,'un import non valido non propone la sostituzione');
    await page.locator('#bulkTeamsInput').fill('Alice - Bruno\nAlice - Bruno');
    await page.locator('#bulkPreviewBtn').click();
    if(await page.locator('#bulkApplyBtn').isEnabled()) await page.locator('#bulkApplyBtn').click();
    await settle(page);
    assert.equal(JSON.stringify(await currentState(page)),before,'i duplicati non vengono eliminati silenziosamente');
    await expectNoErrors(page);
  } finally {await context.close();}
});

test('Backup incoerente: un riferimento a una coppia inesistente viene rifiutato senza bloccare le iscrizioni correnti', async () => {
  const {context,page}=await newPage({state:stateWithTeams(false)});
  try {
    await page.goto(`${base}/?t=qa-tournament&open=more`);
    await page.locator('#more.view.active').waitFor();
    const before=JSON.stringify(await currentState(page));
    const invalid=stateWithTeams(true);
    invalid.matches[0].aId='missing-participant-id';
    await page.locator('#importInput').setInputFiles({name:'backup-incoerente.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(invalid))});
    await settle(page);
    assert.equal(await page.locator('#confirmDialog[open]').count(),0,'la validazione precede la richiesta di sostituzione del backup');
    assert.match(await page.locator('#toast').innerText(),/non valido|non validi/i);
    assert.equal(JSON.stringify(await currentState(page)),before,'il backup rifiutato non modifica il torneo corrente');
    assert.equal((await currentState(page)).matches.length,0);
    assert.equal(Boolean((await currentState(page)).metadata.startedAt),false,'un backup incoerente non avvia né blocca il torneo');
    await page.locator('[data-tab=teams]').click();
    assert.equal(await page.locator('#clearTeamsBtn').isEnabled(),true);
    await expectNoErrors(page);
  } finally {await context.close();}
});

test('Connessione: solo la modalità dimostrativa senza configurazione mostra Locale', async () => {
  const {context,page}=await newPage();
  try {
    await page.goto(`${base}/?t=qa-tournament`);
    await settle(page);
    assert.equal((await page.locator('#connectionStatus span:last-child').innerText()).trim(),'Locale');
    await expectNoErrors(page);
  } finally {await context.close();}
});

test('Connessione: Supabase configurato senza sessione e senza torneo mostra Login richiesto', async () => {
  const {context,page}=await newPage({connection:{signedIn:false,existing:false}});
  try {
    await page.goto(`${base}/?t=qa-tournament`);
    await page.waitForFunction(()=>document.querySelector('#connectionStatus span:last-child')?.textContent.trim()==='Login richiesto');
    await page.locator('#adminLoginPanel').waitFor({state:'visible'});
    await page.waitForTimeout(500);
    assert.equal(await page.locator('#adminLoginPanel').isVisible(),true);
    assert.equal((await page.locator('#connectionStatus span:last-child').innerText()).trim(),'Login richiesto');
    await expectNoErrors(page);
  } finally {await context.close();}
});

test('Connessione: sessione valida senza torneo invita a crearlo e dopo la creazione mostra Online', async () => {
  const {context,page}=await newPage({connection:{signedIn:true,existing:false}});
  try {
    await page.goto(`${base}/?t=qa-tournament&open=more`);
    await page.waitForFunction(()=>document.querySelector('#connectionStatus span:last-child')?.textContent.trim()==='Crea o apri torneo');
    assert.equal(await page.locator('#tournamentCreatePanel').isVisible(),true);
    await page.locator('#onlineTournamentName').fill('Nuovo Beach Tournament');
    await page.locator('#onlineTournamentSlug').fill('qa-created');
    await page.locator('#createOnlineBtn').click();
    await page.waitForFunction(()=>document.querySelector('#connectionStatus span:last-child')?.textContent.trim()==='Online');
    assert.equal((await page.locator('#connectionStatus span:last-child').innerText()).trim(),'Online');
    assert.equal(new URL(page.url()).searchParams.get('t'),'qa-created');
    assert.deepEqual(await page.evaluate(()=>({name:window.__createdTournament?.name,slug:window.__createdTournament?.slug})),{name:'Nuovo Beach Tournament',slug:'qa-created'});
    await expectNoErrors(page);
  } finally {await context.close();}
});

test('Connessione: un torneo esistente caricato da Supabase mostra Online', async () => {
  const {context,page}=await newPage({connection:{signedIn:true,existing:true}});
  try {
    await page.goto(`${base}/?t=qa-tournament`);
    await page.waitForFunction(()=>document.querySelector('#connectionStatus span:last-child')?.textContent.trim()==='Online');
    assert.equal((await page.locator('#connectionStatus span:last-child').innerText()).trim(),'Online');
    assert.equal(await page.locator('#appTitle').innerText(),'QA Beach Tournament');
    await expectNoErrors(page);
  } finally {await context.close();}
});

for (const onlineMode of [false,true]) {
  test(`Svuota esempio: cancella testo, anteprima e opzioni senza modificare gli iscritti (${onlineMode?'online simulato':'locale'})`,async()=>{
    const {context,page}=await newPage(onlineMode?{connection:{signedIn:true,existing:true}}:{state:stateWithTeams(false)});
    try {
      await page.goto(`${base}/?t=qa-tournament&open=teams`);
      await page.locator('#teams.view.active').waitFor();
      const before=JSON.stringify(await currentState(page));
      const remoteBefore=onlineMode?await page.evaluate(()=>JSON.stringify(window.__mockRow)):null;
      await page.locator('#loadDefaultsBtn').click();
      await page.locator('#bulkTeamsInput').waitFor({state:'visible'});
      assert.match(await page.locator('#bulkTeamsInput').inputValue(),/Giocatore A/);
      assert.match(await page.locator('#bulkPreviewCount').innerText(),/12 coppie/);
      await page.locator('#bulkUseNumbersAsSeeds').check();
      await page.locator('#clearBulkBtn').click();
      assert.equal(await page.locator('#bulkTeamsInput').inputValue(),'');
      assert.equal(await page.locator('#bulkUseNumbersAsSeeds').isChecked(),false);
      assert.match(await page.locator('#bulkPreviewCount').innerText(),/0 coppie/);
      assert.equal(await page.locator('#bulkPreviewList article').count(),0);
      assert.equal(await page.locator('#bulkApplyBtn').isDisabled(),true);
      assert.equal(await page.locator('#confirmDialog[open]').count(),0,'svuotare la bozza non richiede una conferma sugli iscritti');
      await page.waitForTimeout(1100);
      assert.equal(JSON.stringify(await currentState(page)),before,'gli iscritti effettivi non cambiano');
      if(onlineMode){assert.equal(await page.evaluate(()=>window.__saveCalls),0,'nessuna richiesta di salvataggio per il testo di esempio');assert.equal(await page.evaluate(()=>JSON.stringify(window.__mockRow)),remoteBefore);}
      await expectNoErrors(page);
    } finally {await context.close();}
  });
}

test('Svuota squadre: richiede conferma, Annulla conserva le coppie e Conferma rimuove gli iscritti',async()=>{
  const {context,page}=await newPage({state:stateWithTeams(false)});
  try {
    await page.goto(`${base}/?t=qa-tournament&open=teams`);
    await page.locator('#teams.view.active').waitFor();
    const before=JSON.stringify(await currentState(page));
    assert.match(await page.locator('#clearTeamsBtn').innerText(),/Svuota squadre/);
    await page.locator('#clearTeamsBtn').click();
    await page.locator('#confirmDialog[open]').waitFor();
    await page.locator('#confirmCancel').click();await settle(page);
    assert.equal(JSON.stringify(await currentState(page)),before);
    await page.locator('#clearTeamsBtn').click();
    await page.locator('#confirmDialog[open]').waitFor();
    await page.locator('#confirmAccept').click();await settle(page);
    const cleared=await currentState(page);
    assert.ok(cleared.teams.every(team=>!team.name.trim()&&team.seed===null&&team.manualGroup===null));
    assert.match(await page.locator('#teamCountBadge').innerText(),/0 \/ 24/);
    assert.equal(cleared.matches.length,0);
    await expectNoErrors(page);
  } finally {await context.close();}
});
