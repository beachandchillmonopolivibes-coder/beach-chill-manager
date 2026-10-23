'use strict';
// Runs the application's real event and persistence code in an isolated VM.
// Only painting, scrolling and browser startup are replaced by small adapters.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const storageKey = 'beach-volley-manager-v6:persistence-qa';
const setupIds = new Set(['tournamentNameInput', 'courtsInput', 'slotMinutesInput', 'eventDateInput', 'dayStartInput', 'dayEndInput', 'drawCodeInput']);
const inputIds = new Set([...setupIds, 'teamSearch', 'onlineTournamentName', 'onlineTournamentSlug', 'adminTournamentKey', 'newAdminUsername']);
const json = value => JSON.parse(JSON.stringify(value));

class Storage {
  constructor(values = new Map()) { this.values = values; }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

class Element {
  constructor(document, { id = '', tag = 'div', classes = '', parent = null } = {}) {
    this.document = document; this.id = id; this.tagName = tag.toUpperCase();
    this.parentElement = parent; this.selectionStart = 0; this.selectionEnd = 0; this.selectionDirection = 'none';
    this.className = classes; this.dataset = {}; this.value = ''; this.textContent = '';
    this.disabled = false; this.readOnly = false; this.checked = false; this.options = [];
    this.listeners = new Map(); this.children = new Map(); this.attributes = new Map();
    const classesSet = new Set(classes.split(/\s+/).filter(Boolean));
    this.classList = {
      add: name => classesSet.add(name), remove: name => classesSet.delete(name),
      contains: name => classesSet.has(name),
      toggle: (name, force) => { const yes = force ?? !classesSet.has(name); yes ? classesSet.add(name) : classesSet.delete(name); return yes; },
    };
    this.style = { setProperty() {} };
  }
  addEventListener(type, listener) { const list = this.listeners.get(type) || []; list.push(listener); this.listeners.set(type, list); }
  removeEventListener() {}
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  querySelector(selector) {
    if (!this.children.has(selector)) {
      const field = /(?:^|\s)\.(?:team-name-input|seed-input|a[123]|b[123]|court-input)$/.test(selector);
      this.children.set(selector, new Element(this.document, { tag: field ? 'input' : selector === '.manual-group-select' ? 'select' : 'div', classes: selector.replace(/^\./, ''), parent: this }));
    }
    return this.children.get(selector);
  }
  querySelectorAll(selector) {
    if (this.id === 'teamRows' && /^tr/.test(selector)) return this.document.rows;
    return [...this.children.values()].filter(child => child.matches(selector));
  }
  closest(selector) {
    if (selector === '#setup' && setupIds.has(this.id)) return this.document.getElementById('setup');
    let candidate = this;
    while (candidate) { if (candidate.matches(selector)) return candidate; candidate = candidate.parentElement; }
    return null;
  }
  matches(selector) {
    if (selector.includes(',')) return selector.split(',').some(part => this.matches(part.trim()));
    if (selector.startsWith('#')) return selector.slice(1) === this.id;
    if (selector.startsWith('.')) return this.className.split(/\s+/).includes(selector.slice(1));
    if (selector.includes('data-team-index')) return this.dataset.teamIndex !== undefined;
    if (/input|select|textarea/.test(selector)) return ['INPUT', 'SELECT', 'TEXTAREA'].includes(this.tagName) && !this.disabled && !this.readOnly;
    return selector.toUpperCase() === this.tagName;
  }
  focus() { this.document.activeElement = this; }
  blur() { this.document.activeElement = null; }
  setSelectionRange(start, end, direction = 'none') { this.selectionStart = start; this.selectionEnd = end; this.selectionDirection = direction; }
  contains(element) { let candidate = element; while (candidate) { if (candidate === this) return true; candidate = candidate.parentElement; } return false; }
  scrollIntoView() {}
  appendChild() {}
  getBoundingClientRect() { return { x: 0, y: 0, top: 0, bottom: 48, left: 0, right: 300, width: 300, height: 48 }; }
  async fire(type) {
    const event = { type, target: this, preventDefault() {}, stopImmediatePropagation() {} };
    for (const listener of this.document.listeners.get(type) || []) listener(event);
    for (const listener of this.listeners.get(type) || []) await listener(event);
  }
  set innerHTML(html) {
    this.html = html;
    if (this.id !== 'teamRows') return;
    const decode = text => text.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    this.document.rows = Array.from(html.matchAll(/<tr data-team-index="(\d+)">[\s\S]*?<input class="team-name-input"[\s\S]*?value="([^"]*)"/g), match => {
      const row = new Element(this.document, { tag: 'tr', parent: this }); row.dataset.teamIndex = match[1];
      row.querySelector('.team-name-input').value = decode(match[2]);
      return row;
    });
  }
  get innerHTML() { return this.html || ''; }
}

function harness({ storage = new Storage(), configured = false, row = null, save, create, reset, confirm = true, role = 'owner', userId = 'admin-1', backend = 'https://qa.supabase.co' } = {}) {
  const elements = new Map(), timers = new Map(); let timerId = 0;
  const document = {
    readyState: 'loading', activeElement: null, visibilityState: 'visible', rows: [], listeners: new Map(),
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new Element(document, { id, tag: inputIds.has(id) ? 'input' : 'div', parent: id === 'teamRows' || id === 'teamSearch' ? document.getElementById('teams') : null }));
      return elements.get(id);
    },
    querySelectorAll(selector) { return selector === '#teamRows tr' ? document.rows : []; },
    querySelector() { return null; },
    addEventListener(type, listener) { const list = document.listeners.get(type) || []; list.push(listener); document.listeners.set(type, list); },
  };
  document.body = new Element(document); document.documentElement = new Element(document);
  document.documentElement.dataset.theme = 'light';
  const template = document.getElementById('matchTemplate');
  template.content = { cloneNode() { const fragment = new Element(document); fragment.children.set('.match-card', new Element(document, { classes: 'match-card' })); return fragment; } };
  const location = { href: 'https://example.invalid/?t=persistence-qa', search: '?t=persistence-qa', protocol: 'https:' };
  const server = { row: row ? json(row) : null, calls: [], creates: [], resets: [], visibilityChanges: [] };
  const confirmations = [];
  const DB = {
    isConfigured: () => configured, init() {},
    getSession: async () => configured ? { user: { id: userId, email: 'qa@admin.beachvolley.app' } } : null,
    onAuthStateChange() {}, sessionUsername: () => 'qa',
    getMyRole: async () => role, listTournamentAdmins: async () => [],
    loadTournamentBySlug: async () => server.row ? json(server.row) : null,
    subscribeToTournament() {}, unsubscribe() {},
    async createTournament(name, slug, state) {
      const call = { name, slug, state: json(state) }; server.creates.push(call);
      if (create) return create(call, server);
      server.row = { id: 'tournament-1', name, slug, state: json(call.state), revision: 0, public_read: false, owner_id: userId };
      return json(server.row);
    },
    async saveTournamentState(id, state, revision) {
      const call = { id, state: json(state), revision }; server.calls.push(call);
      if (save) return save(call, server);
      if (revision !== server.row.revision) throw new Error('revision_conflict');
      server.row = { ...server.row, state: json(state), revision: revision + 1 };
      return json(server.row);
    },
    async resetTournamentBracket(id, revision) {
      const call = { id, revision }; server.resets.push(call);
      if (reset) return reset(call, server);
      if (role !== 'owner') throw new Error('owner_required');
      if (revision !== server.row.revision) throw new Error('revision_conflict');
      const cleared = json(server.row.state);
      window.BeachEngine.resetTournament(cleared, { allowStarted: true });
      server.row = { ...server.row, state: cleared, revision: revision + 1, public_read: false };
      return json(server.row);
    },
    async setPublicRead(id, publicRead) {
      server.visibilityChanges.push({ id, publicRead });
      if (role !== 'owner') throw new Error('owner_required');
      server.row = { ...server.row, public_read: publicRead, revision: server.row.revision + 1 };
      return json(server.row);
    },
  };
  const windowListeners = new Map();
  const window = { crypto: webcrypto, structuredClone, BEACH_APP_CONFIG: { defaultTournamentSlug: 'persistence-qa', supabaseUrl: backend }, BeachDB: DB, location,
    __testConfirm: confirm, __testConfirmations: confirmations,
    addEventListener(type, listener) { const list = windowListeners.get(type) || []; list.push(listener); windowListeners.set(type, list); },
    scrollY: 0, innerHeight: 900, matchMedia: () => ({ matches: false }), scrollTo() {} };
  const context = vm.createContext({ window, document, localStorage: storage, sessionStorage: new Storage(), location, navigator: {}, history: { replaceState() {} },
    URL, URLSearchParams, structuredClone, crypto: webcrypto, Date, Promise, console: { warn() {}, error() {}, log() {} },
    setTimeout(fn, delay = 0) { const id = ++timerId; timers.set(id, { fn, delay }); return id; }, clearTimeout(id) { timers.delete(id); }, setInterval() {}, requestAnimationFrame() {} });
  vm.runInContext(fs.readFileSync(path.join(root, 'engine.js'), 'utf8'), context);
  const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const boot = source.lastIndexOf("\n  if (document.readyState");
  assert.ok(boot > 0, 'application startup boundary must exist');
  const adapter = `
    const originalBindEvents = bindEvents;
    initializeTheme = stabilizeMobileViewport = bindEvents = rememberCurrentScroll = captureBackgroundUiState = restoreSavedScroll = restoreScrollValue = restoreUiControls = () => {};
    hydrateUiState = () => ({});
    updateAccessUI = renderHeader = renderDashboard = renderSetup = renderMatches = renderLive = updateOnlinePanel = () => {};
    const originalRenderAll = renderAll;
    let testPaintCount = 0;
    renderAll = (...args) => { testPaintCount += 1; return originalRenderAll(...args); };
    confirmAction = async (...args) => {
      window.__testConfirmations.push(args);
      return typeof window.__testConfirm === 'function' ? window.__testConfirm(...args) : window.__testConfirm;
    };
    window.__app = {
      start: bootstrap, bindEvents: originalBindEvents, renderTeamRows, renderMatchCard,
      flushOnlineSave, loadOnlineTournament, saveLocalState, noteLocalEdit, createOnlineTournament, hasUnsavedLocalChanges,
      mergeRosterState, tryApplyRosterUpdate, handleRealtimeUpdate,
      resetTournament, togglePublicRead,
      canResetBracket: typeof canResetBracket === 'function' ? canResetBracket : undefined,
      readLastResetBackup: typeof readLastResetBackup === 'function' ? readLastResetBackup : undefined,
      tab: value => value ? (activeTab = value) : activeTab,
      pending: () => pendingRealtimeRow,
      paints: () => testPaintCount,
      state: () => state, online: () => online, drafts: () => scoreDrafts,
      setupForm: () => typeof setupDraftForm === 'undefined' ? null : setupDraftForm,
      replaceState: value => { state = Engine.normalizeState(value); },
      connect: value => { online.session = {user:{id:'admin-1'}}; online.tournament=value; online.revision=value.revision; online.role='owner'; online.accessReady=true; online.authReady=true; },
    };
  })();`;
  vm.runInContext(source.slice(0, boot) + adapter, context);
  const api = window.__app;
  return { api, Engine: window.BeachEngine, document, elements, storage, server, timers, confirmations,
    async fireWindow(type) { for (const listener of windowListeners.get(type) || []) await listener({ type }); },
    stored: () => JSON.parse(storage.getItem(storageKey)),
    draft: () => JSON.parse(storage.getItem(storageKey + ':draft')),
  };
}

function tournament(Engine, started = true) {
  const state = Engine.createDefaultState(); state.settings.format = Engine.FORMATS.SINGLE_ELIMINATION;
  for (let i = 0; i < 4; i++) state.teams[i].name = `Coppia ${i + 1}`;
  if (started) Engine.generateTournament(state, { drawCode: 'SAVE-QA' });
  return state;
}
function rowFor(state, revision = 1) { return { id: 'tournament-1', slug: 'persistence-qa', state: json(state), revision, public_read: true, owner_id: 'admin-1' }; }

test('a started team name is retained on immediate reload while the field still has focus', async () => {
  const app = harness(); app.api.replaceState(tournament(app.Engine)); app.api.saveLocalState(); app.api.renderTeamRows();
  const name = app.document.rows[0].querySelector('.team-name-input'); name.focus();
  name.value = 'Nome corretto'; await name.fire('input');
  const reopened = harness({ storage: app.storage });
  assert.equal(reopened.api.state().teams[0].name, 'Nome corretto', 'valid input must be durable before blur/change');
});

test('an incomplete or duplicate name cannot erase an entrant after the tournament starts', async () => {
  const app = harness(); app.api.replaceState(tournament(app.Engine)); app.api.saveLocalState(); app.api.renderTeamRows();
  const name = app.document.rows[0].querySelector('.team-name-input');
  name.value = ''; await name.fire('input'); await name.fire('change');
  assert.equal(app.api.state().teams[0].name, 'Coppia 1');
  name.value = 'Coppia 2'; await name.fire('input'); await name.fire('change');
  assert.equal(app.api.state().teams[0].name, 'Coppia 1');
  assert.equal(app.stored().teams[0].name, 'Coppia 1');
});

test('numeric setup edits are retained before leaving the input', async () => {
  const app = harness(); app.api.replaceState(tournament(app.Engine, false)); app.api.saveLocalState(); app.api.bindEvents();
  const courts = app.document.getElementById('courtsInput'); courts.focus(); courts.value = '3'; await courts.fire('input');
  const reopened = harness({ storage: app.storage });
  assert.equal(reopened.api.state().settings.courts, 3);
});

test('a durable local edit is clean without sending a network save', async () => {
  const app = harness(); app.api.replaceState(tournament(app.Engine, false));
  app.api.state().settings.courts = 3; app.api.noteLocalEdit({ wholeState: true });
  assert.equal(app.stored().settings.courts, 3);
  assert.equal(app.api.hasUnsavedLocalChanges(), false, 'successful local persistence acknowledges the edit');
  assert.equal(app.server.calls.length, 0, 'local mode does not require a backend');
  assert.match(app.document.getElementById('saveStatusText').textContent, /questo dispositivo/);
});

test('storage quota failure remains dirty and visibly unsaved until durable retry succeeds', () => {
  const storage = new Storage(); const app = harness({ storage });
  app.api.replaceState(tournament(app.Engine, false)); assert.equal(app.api.saveLocalState(), true);
  const durableWrite = storage.setItem.bind(storage);
  storage.setItem = () => { throw new Error('QuotaExceededError'); };
  app.api.state().settings.courts = 3; app.api.noteLocalEdit({ wholeState: true });
  assert.equal(app.api.hasUnsavedLocalChanges(), true, 'failed persistence cannot acknowledge an edit');
  assert.equal(app.api.saveLocalState(), false);
  assert.match(app.document.getElementById('saveStatusText').textContent, /non riuscito/);
  assert.doesNotMatch(app.document.getElementById('saveStatusText').textContent, /Tutte le modifiche sono salvate/);
  assert.equal(app.document.getElementById('saveStatusBar').classList.contains('save-error'), true);
  assert.equal(app.stored().settings.courts, 5, 'a failed write leaves the previous durable state intact');
  storage.setItem = durableWrite;
  assert.equal(app.api.saveLocalState(), true);
  assert.equal(app.api.hasUnsavedLocalChanges(), false);
  assert.equal(app.document.getElementById('saveStatusBar').classList.contains('save-error'), false);
  assert.doesNotMatch(app.document.getElementById('saveStatusText').textContent, /non riuscito/);
  const reopened = harness({ storage });
  assert.equal(reopened.api.state().settings.courts, 3, 'retry is verified by a fresh application instance');
});

test('a failed online save recovers the pending local draft after reload', async () => {
  const initial = harness(); const original = tournament(initial.Engine);
  const app = harness({ configured: true, row: rowFor(original), save: async () => { throw new Error('offline'); } });
  await app.api.start();
  app.api.state().teams[0].name = 'Modifica offline'; app.api.noteLocalEdit({ teamIndex: 0 });
  await app.api.flushOnlineSave();
  assert.equal(app.draft().pending, true);
  const reopened = harness({ configured: true, row: rowFor(original), storage: app.storage }); await reopened.api.start();
  assert.equal(reopened.api.state().teams[0].name, 'Modifica offline');
  await reopened.api.flushOnlineSave();
  assert.equal(reopened.server.row.state.teams[0].name, 'Modifica offline');
  assert.equal(reopened.draft().pending, false);
});

test('a later local edit remains pending when an earlier network save completes', async () => {
  const initial = harness(); const original = tournament(initial.Engine);
  let finish;
  const app = harness({ configured: true, row: rowFor(original), save: async (call, server) => {
    if (server.calls.length === 1) await new Promise(resolve => { finish = resolve; });
    assert.equal(call.revision, server.row.revision);
    server.row = { ...server.row, state: json(call.state), revision: call.revision + 1 }; return json(server.row);
  } });
  await app.api.start();
  app.api.state().teams[0].name = 'Prima modifica'; app.api.noteLocalEdit({ teamIndex: 0 });
  const first = app.api.flushOnlineSave();
  app.api.state().teams[0].name = 'Ultima modifica'; app.api.noteLocalEdit({ teamIndex: 0 });
  finish(); await first;
  assert.equal(app.draft().pending, true, 'an earlier response cannot mark the later edit saved');
  await app.api.flushOnlineSave();
  assert.equal(app.server.row.state.teams[0].name, 'Ultima modifica');
  assert.deepEqual(app.server.calls.map(call => call.revision), [1, 2]);
  assert.equal(app.draft().pending, false);
});

test('a configured project retains the uncreated tournament and its creation form on reload', async () => {
  const app = harness({ configured: true }); await app.api.start(); app.api.bindEvents();
  app.api.replaceState(tournament(app.Engine, false)); app.api.noteLocalEdit({ wholeState: true });
  const name = app.document.getElementById('onlineTournamentName'); name.value = 'Evento da creare'; await name.fire('input');
  const slug = app.document.getElementById('onlineTournamentSlug'); slug.value = 'evento-sulla-spiaggia'; await slug.fire('input');
  await app.api.loadOnlineTournament({ quiet: true });
  assert.equal(app.api.state().teams[0].name, 'Coppia 1', 'a missing remote row must not reset prepared entrants');
  const reopened = harness({ configured: true, storage: app.storage }); await reopened.api.start();
  assert.equal(reopened.api.state().teams[0].name, 'Coppia 1');
  assert.equal(reopened.api.setupForm()?.name, 'Evento da creare');
  assert.equal(reopened.api.setupForm()?.slug, 'evento-sulla-spiaggia');
  assert.equal(reopened.server.creates.length, 0, 'recovering a draft cannot create a remote tournament');
});

test('an uncreated tournament draft is isolated from other admins and backend projects', async () => {
  const app = harness({ configured: true }); await app.api.start();
  app.api.replaceState(tournament(app.Engine, false)); app.api.noteLocalEdit({ wholeState: true });
  for (const options of [{ userId: 'admin-2' }, { backend: 'https://other.supabase.co' }]) {
    const other = harness({ configured: true, storage: app.storage, ...options }); await other.api.start();
    assert.equal(other.api.state().teams.filter(item => item.name.trim()).length, 0, 'another scope must start blank');
  }
});

test('an edit made while a tournament is being created is saved after the creation snapshot', async () => {
  let finish;
  const app = harness({ configured: true, create: async (call, server) => {
    await new Promise(resolve => { finish = resolve; });
    server.row = { id: 'tournament-1', name: call.name, slug: call.slug, state: json(call.state), revision: 0, public_read: true, owner_id: 'admin-1' };
    return json(server.row);
  } });
  await app.api.start(); app.api.replaceState(tournament(app.Engine, false)); app.api.noteLocalEdit({ wholeState: true });
  app.document.getElementById('onlineTournamentName').value = 'Evento QA';
  app.document.getElementById('onlineTournamentSlug').value = 'persistence-qa';
  const creating = app.api.createOnlineTournament();
  assert.equal(typeof finish, 'function', 'the real create action must have reached the database adapter');
  app.api.state().teams[0].name = 'Correzione durante creazione'; app.api.noteLocalEdit({ teamIndex: 0 });
  finish(); await creating;
  assert.equal(app.server.creates[0].state.teams[0].name, 'Coppia 1', 'the first request represents the earlier state');
  await app.api.flushOnlineSave();
  assert.equal(app.server.row.state.teams[0].name, 'Correzione durante creazione', 'a creation response cannot silently acknowledge a later edit');
  assert.equal(app.draft().pending, false);
});

test('a failed remote creation retains entrants, settings and the candidate creation form on reload', async () => {
  const app = harness({ configured: true, create: async () => { throw new Error('network unavailable'); } });
  await app.api.start(); app.api.bindEvents();
  app.api.replaceState(tournament(app.Engine, false)); app.api.state().settings.courts = 3;
  app.api.noteLocalEdit({ wholeState: true });
  const name = app.document.getElementById('onlineTournamentName'); name.value = 'Evento non pubblicato'; await name.fire('input');
  const slug = app.document.getElementById('onlineTournamentSlug'); slug.value = 'prova-errore-creazione'; await slug.fire('input');
  await app.api.createOnlineTournament();
  assert.equal(app.server.creates.length, 1);
  assert.equal(app.api.online().tournament, null);
  assert.equal(app.api.online().creating, false);
  const reopened = harness({ configured: true, storage: app.storage }); await reopened.api.start();
  assert.equal(reopened.api.state().teams[0].name, 'Coppia 1');
  assert.equal(reopened.api.state().settings.courts, 3);
  assert.equal(reopened.api.state().settings.tournamentName, 'Evento non pubblicato');
  assert.equal(reopened.api.setupForm()?.name, 'Evento non pubblicato');
  assert.equal(reopened.api.setupForm()?.slug, 'prova-errore-creazione');
  assert.equal(reopened.server.creates.length, 0, 'recovery never silently retries a remote creation');
});

// A small clock step fires the real autosave callbacks without a wall-clock wait.
async function runAutosaveTimers(app) {
  for (let step = 0; step < 3; step++) {
    const due = [...app.timers].filter(([, timer]) => timer.delay <= 900);
    if (!due.length) break;
    for (const [id, timer] of due) {
      if (!app.timers.has(id)) continue;
      app.timers.delete(id);
      await timer.fn();
    }
  }
}

function privateRow(state, revision = 1) { return { ...rowFor(state, revision), public_read: false }; }

test('the first entered team automatically creates a private shared draft and subsequent teams autosave', async () => {
  const first = harness({ configured: true }); await first.api.start(); first.api.tab('teams');
  first.document.getElementById('onlineTournamentName').value = 'Bozza tra admin';
  first.document.getElementById('onlineTournamentSlug').value = 'persistence-qa';
  first.api.renderTeamRows();
  const input = first.document.rows[0].querySelector('.team-name-input'); input.focus(); input.value = 'Squadra Alfa';
  await input.fire('input'); await runAutosaveTimers(first);
  assert.equal(first.server.creates.length, 1, 'typing triggers creation without a manual create or publish command');
  assert.equal(first.server.row.public_read, false, 'the draft is private from its creation');
  assert.equal(first.server.row.state.teams[0].name, 'Squadra Alfa');
  assert.equal(first.api.tab(), 'teams', 'background creation does not navigate away from entry');
  assert.equal(first.document.activeElement, input, 'background creation keeps the current input focused');

  const other = harness({ configured: true, row: first.server.row, userId: 'admin-2' }); await other.api.start(); other.api.tab('teams'); other.api.renderTeamRows();
  const search = other.document.getElementById('teamSearch'); search.focus();
  const next = first.document.rows[1].querySelector('.team-name-input'); next.focus(); next.value = 'Squadra Beta';
  await next.fire('input'); await runAutosaveTimers(first);
  assert.equal(first.server.row.state.teams[1].name, 'Squadra Beta');
  other.api.handleRealtimeUpdate(json(first.server.row));
  assert.equal(other.api.state().teams[1].name, 'Squadra Beta', 'another authorized admin receives the private draft before publication');
  assert.equal(other.document.rows[1].querySelector('.team-name-input').value, 'Squadra Beta');
  assert.equal(other.document.activeElement, search, 'a focused search field cannot block the update');
  assert.equal(other.api.online().tournament.public_read, false, 'sync never enables the public view');
});

test('a roster update patches other rows while preserving a focused name and its caret', async () => {
  const initial = harness(); const original = tournament(initial.Engine, false);
  const app = harness({ configured: true, row: privateRow(original) }); await app.api.start(); app.api.tab('teams'); app.api.renderTeamRows();
  const focused = app.document.rows[0].querySelector('.team-name-input'); focused.focus(); focused.setSelectionRange(2, 5, 'forward');
  const remote = privateRow(original, 2); remote.state.teams[1].name = 'Inserita dall’altro admin';
  app.api.handleRealtimeUpdate(remote);
  assert.equal(app.api.state().teams[1].name, 'Inserita dall’altro admin');
  assert.equal(app.document.rows[1].querySelector('.team-name-input').value, 'Inserita dall’altro admin', 'actual displayed row receives the update without blur');
  assert.equal(app.document.activeElement, focused);
  assert.equal(app.document.rows[0].querySelector('.team-name-input'), focused, 'the active input node is retained');
  assert.equal(focused.selectionStart, 2); assert.equal(focused.selectionEnd, 5);
});

test('disjoint team fields merge against their common server revision without losing either admin', () => {
  const app = harness(); const base = tournament(app.Engine, false); const local = json(base); const remote = json(base);
  local.teams[0].name = 'Alfa locale'; local.teams[0].updatedAt = '2026-10-22T10:00:00Z';
  remote.teams[1].name = 'Beta remota'; remote.teams[1].seed = 2; remote.metadata.updatedAt = '2026-10-22T10:01:00Z';
  const merged = app.api.mergeRosterState(base, local, remote);
  assert.ok(merged);
  assert.equal(merged.teams[0].name, 'Alfa locale'); assert.equal(merged.teams[1].name, 'Beta remota'); assert.equal(merged.teams[1].seed, 2);
  assert.equal(base.teams[0].name, 'Coppia 1', 'the shared baseline remains immutable');
  remote.teams[0].name = 'Alfa diversa';
  assert.equal(app.api.mergeRosterState(base, local, remote), null, 'different concurrent values for the same field require explicit resolution');
});

test('a stale autosave retries safe disjoint roster changes using the latest revision', async () => {
  const initial = harness(); const original = tournament(initial.Engine, false);
  const app = harness({ configured: true, row: privateRow(original) }); await app.api.start(); app.api.tab('teams'); app.api.renderTeamRows();
  const input = app.document.rows[0].querySelector('.team-name-input'); input.focus(); input.value = 'Nome locale'; await input.fire('input');
  app.server.row.state.teams[1].name = 'Nome già salvato dall’amico'; app.server.row.revision += 1;
  await app.api.flushOnlineSave();
  assert.equal(app.api.online().savePaused, false);
  assert.equal(app.api.hasUnsavedLocalChanges(), false);
  assert.equal(app.server.row.state.teams[0].name, 'Nome locale');
  assert.equal(app.server.row.state.teams[1].name, 'Nome già salvato dall’amico');
  assert.deepEqual(app.server.calls.map(call => call.revision), [1, 2], 'a retry must use the new server revision');
});

test('a conflict on the same team field keeps both the remote value and the recoverable local draft', async () => {
  const initial = harness(); const original = tournament(initial.Engine, false);
  const app = harness({ configured: true, row: privateRow(original) }); await app.api.start();
  app.api.state().teams[0].name = 'Valore locale'; app.api.noteLocalEdit({ teamIndex: 0 });
  app.server.row.state.teams[0].name = 'Valore dell’amico'; app.server.row.revision += 1;
  await app.api.flushOnlineSave();
  assert.equal(app.api.online().savePaused, true);
  assert.equal(app.api.hasUnsavedLocalChanges(), true);
  assert.equal(app.api.state().teams[0].name, 'Valore locale');
  assert.equal(app.draft().state.teams[0].name, 'Valore locale');
  assert.equal(app.draft().pending, true);
  assert.equal(app.server.row.state.teams[0].name, 'Valore dell’amico', 'no last-writer overwrite is allowed');
});

test('realtime events from another tournament cannot replace this private draft', async () => {
  const initial = harness(); const original = tournament(initial.Engine, false);
  const app = harness({ configured: true, row: privateRow(original) }); await app.api.start(); app.api.tab('teams');
  const otherTournament = privateRow(original, 99); otherTournament.id = 'another-tournament'; otherTournament.slug = 'another-key'; otherTournament.state.teams[0].name = 'Torneo sbagliato';
  app.api.handleRealtimeUpdate(otherTournament);
  assert.equal(app.api.state().teams[0].name, 'Coppia 1');
  assert.equal(app.api.online().tournament.id, 'tournament-1');
});

test('incoming setup or tournament-start changes are deferred while a team is being edited', async () => {
  const initial = harness(); const original = tournament(initial.Engine, false);
  const app = harness({ configured: true, row: privateRow(original) }); await app.api.start(); app.api.tab('teams'); app.api.renderTeamRows();
  const focused = app.document.rows[0].querySelector('.team-name-input'); focused.focus();
  const remote = privateRow(original, 2); app.Engine.generateTournament(remote.state, { drawCode: 'OTHER-ADMIN' });
  assert.equal(app.api.mergeRosterState(original, original, remote.state), null, 'starting a tournament is never a roster-only merge');
  app.api.handleRealtimeUpdate(remote);
  assert.equal(app.api.state().matches.length, 0, 'the active editor is protected from a structural refresh');
  assert.equal(app.api.pending()?.revision, 2, 'the structural update remains pending for a safe refresh');
  const changedSetup = json(original); changedSetup.settings.courts = 3;
  assert.equal(app.api.mergeRosterState(original, original, changedSetup), null, 'configuration changes require the normal full-state refresh');
});

test('a missed realtime event is recovered by polling even while the roster editor has focus', async () => {
  const initial = harness(); const original = tournament(initial.Engine, false);
  const app = harness({ configured: true, row: privateRow(original) }); await app.api.start(); app.api.tab('teams'); app.api.renderTeamRows();
  const focused = app.document.rows[0].querySelector('.team-name-input'); focused.focus(); focused.setSelectionRange(1, 3);
  app.server.row.state.teams[1].name = 'Aggiornamento recuperato'; app.server.row.revision += 1;
  await app.api.loadOnlineTournament({ quiet: true });
  assert.equal(app.api.state().teams[1].name, 'Aggiornamento recuperato');
  assert.equal(app.document.rows[1].querySelector('.team-name-input').value, 'Aggiornamento recuperato');
  assert.equal(app.document.activeElement, focused);
  assert.equal(focused.selectionStart, 1); assert.equal(focused.selectionEnd, 3);
});

test('incoming disjoint roster edits keep an unsaved focused local name and subsequently save both', async () => {
  const initial = harness(); const original = tournament(initial.Engine, false);
  const app = harness({ configured: true, row: privateRow(original) }); await app.api.start(); app.api.tab('teams'); app.api.renderTeamRows();
  const focused = app.document.rows[0].querySelector('.team-name-input'); focused.focus(); focused.value = 'Locale in scrittura'; await focused.fire('input'); focused.setSelectionRange(4, 4);
  app.server.row.state.teams[1].name = 'Remoto disgiunto'; app.server.row.revision += 1;
  app.api.handleRealtimeUpdate(json(app.server.row));
  assert.equal(app.api.state().teams[1].name, 'Remoto disgiunto', 'independent remote names are visible before the local save');
  assert.equal(app.api.state().teams[0].name, 'Locale in scrittura');
  assert.equal(app.document.activeElement, focused); assert.equal(focused.value, 'Locale in scrittura'); assert.equal(focused.selectionStart, 4);
  assert.equal(app.api.hasUnsavedLocalChanges(), true, 'accepting a remote row cannot acknowledge the local name');
  await app.api.flushOnlineSave();
  assert.equal(app.server.row.state.teams[0].name, 'Locale in scrittura');
  assert.equal(app.server.row.state.teams[1].name, 'Remoto disgiunto');
  assert.equal(app.api.hasUnsavedLocalChanges(), false);
});

test('reload before the first autosave resumes creation of the locally preserved private draft', async () => {
  const first = harness({ configured: true }); await first.api.start(); first.api.tab('teams'); first.api.renderTeamRows();
  const name = first.document.rows[0].querySelector('.team-name-input'); name.focus(); name.value = 'Inserita prima del refresh'; await name.fire('input');
  assert.equal(first.server.creates.length, 0, 'the refresh happens before the debounce callback');
  const reopened = harness({ configured: true, storage: first.storage }); await reopened.api.start();
  assert.equal(reopened.api.state().teams[0].name, 'Inserita prima del refresh');
  await runAutosaveTimers(reopened);
  assert.equal(reopened.server.creates.length, 1, 'recovery schedules creation without requiring another edit');
  assert.equal(reopened.server.row.public_read, false);
  assert.equal(reopened.server.row.state.teams[0].name, 'Inserita prima del refresh');
});

test('reconnection automatically retries a failed first private-draft creation', async () => {
  const app = harness({ configured: true, create: async (call, server) => {
    if (server.creates.length === 1) throw new Error('network offline');
    server.row = { ...privateRow(call.state, 0), name: call.name, slug: call.slug };
    return json(server.row);
  } });
  await app.api.start(); app.api.bindEvents(); app.api.tab('teams'); app.api.renderTeamRows();
  const name = app.document.rows[0].querySelector('.team-name-input'); name.value = 'Squadra scritta offline'; await name.fire('input');
  await runAutosaveTimers(app);
  assert.equal(app.server.creates.length, 1); assert.equal(app.api.online().tournament, null);
  assert.equal(app.api.state().teams[0].name, 'Squadra scritta offline');
  await app.fireWindow('online'); await runAutosaveTimers(app);
  assert.equal(app.server.creates.length, 2, 'network recovery retries creation without another keystroke or manual save');
  assert.equal(app.server.row.public_read, false);
  assert.equal(app.server.row.state.teams[0].name, 'Squadra scritta offline');
  assert.equal(app.api.online().tournament.id, 'tournament-1');
});

test('an authenticated empty page discovers a newly accessible private draft while search retains focus', async () => {
  const app = harness({ configured: true }); await app.api.start(); app.api.tab('teams'); app.api.renderTeamRows();
  assert.equal(app.api.online().tournament, null);
  const search = app.document.getElementById('teamSearch'); search.focus(); search.value = 'Squadra';
  const publishedPrivately = app.Engine.createDefaultState(); publishedPrivately.teams[0].name = 'Squadra dell’amico';
  app.server.row = privateRow(publishedPrivately, 0);
  await app.api.loadOnlineTournament({ quiet: true });
  assert.equal(app.api.online().tournament.id, 'tournament-1', 'the next poll discovers access granted by the owner');
  assert.equal(app.api.online().tournament.public_read, false);
  assert.equal(app.api.state().teams[0].name, 'Squadra dell’amico');
  assert.equal(app.document.activeElement, search); assert.equal(search.value, 'Squadra');
});

test('an empty server poll does not repaint or reset a focused local pre-creation draft', async () => {
  const app = harness({ configured: true }); await app.api.start(); app.api.tab('teams'); app.api.renderTeamRows();
  const name = app.document.rows[0].querySelector('.team-name-input'); name.focus(); name.value = 'Nome ancora in inserimento'; await name.fire('input'); name.setSelectionRange(5, 12);
  const paintCount = app.api.paints();
  await app.api.loadOnlineTournament({ quiet: true });
  assert.equal(app.api.state().teams[0].name, 'Nome ancora in inserimento');
  assert.equal(app.document.activeElement, name); assert.equal(app.document.rows[0].querySelector('.team-name-input'), name);
  assert.equal(name.value, 'Nome ancora in inserimento'); assert.equal(name.selectionStart, 5); assert.equal(name.selectionEnd, 12);
  assert.equal(app.api.paints(), paintCount, 'an unchanged missing remote row cannot rebuild the local editor');
});

test('a self realtime event received before save acknowledgement is cleared once that revision is saved', async () => {
  const initial = harness(); const original = tournament(initial.Engine, false);
  const app = harness({ configured: true, row: privateRow(original), save: async (call, server) => {
    server.row = { ...server.row, state: json(call.state), revision: call.revision + 1 };
    app.api.handleRealtimeUpdate(json(server.row));
    assert.equal(app.api.pending()?.revision, server.row.revision, 'the save response has not acknowledged this event yet');
    return json(server.row);
  } });
  await app.api.start(); app.api.tab('teams'); app.api.renderTeamRows();
  const name = app.document.rows[0].querySelector('.team-name-input'); name.focus(); name.value = 'Nome sincronizzato'; await name.fire('input');
  await app.api.flushOnlineSave();
  assert.equal(app.api.pending(), null, 'an already acknowledged self event cannot leave the update notice pending');
  assert.equal(app.api.hasUnsavedLocalChanges(), false);
  assert.equal(app.api.state().teams[0].name, 'Nome sincronizzato');
  assert.equal(app.document.activeElement, name, 'pending cleanup works while the editor still has focus');
});

test('a pristine focused name accepts the other admin’s correction while retaining its node and caret', async () => {
  const initial = harness(); const original = tournament(initial.Engine, false);
  const app = harness({ configured: true, row: privateRow(original) }); await app.api.start(); app.api.tab('teams'); app.api.renderTeamRows();
  const name = app.document.rows[0].querySelector('.team-name-input'); name.focus(); name.setSelectionRange(2, 5);
  const remote = privateRow(original, 2); remote.state.teams[0].name = 'Nome corretto dal collega';
  app.api.handleRealtimeUpdate(remote);
  assert.equal(app.api.state().teams[0].name, 'Nome corretto dal collega');
  assert.equal(name.value, 'Nome corretto dal collega', 'leaving the cursor in an untouched field cannot indefinitely hide a remote correction');
  assert.equal(app.document.activeElement, name); assert.equal(app.document.rows[0].querySelector('.team-name-input'), name);
  assert.equal(name.selectionStart, 2); assert.equal(name.selectionEnd, 5);
  assert.equal(app.api.pending(), null); assert.equal(app.api.hasUnsavedLocalChanges(), false);
});

test('an incomplete focused seed keeps its raw draft when the other admin changes the same seed', async () => {
  const initial = harness(); const original = tournament(initial.Engine, false); original.teams[0].seed = 5;
  const app = harness({ configured: true, row: privateRow(original) }); await app.api.start(); app.api.tab('teams'); app.api.renderTeamRows();
  const seed = app.document.rows[0].querySelector('.seed-input'); seed.value = '5'; seed.focus(); seed.value = '-';
  const remote = privateRow(original, 2); remote.state.teams[0].seed = 2;
  app.api.handleRealtimeUpdate(remote);
  assert.equal(app.api.state().teams[0].seed, 5, 'a partial numeric edit remains separate from committed shared state');
  assert.equal(seed.value, '-', 'a remote change must not overwrite an incomplete local input');
  assert.equal(app.document.activeElement, seed); assert.equal(app.document.rows[0].querySelector('.seed-input'), seed);
  assert.equal(app.api.pending()?.revision, 2, 'the incoming change remains queued until the editor can reconcile it');
});

function rosterIdentity(state) { return json(state.teams.map(({ id, name, seed, manualGroup }) => ({ id, name, seed, manualGroup }))); }

function assertClearedBracket(state, before) {
  assert.equal(state.matches.length, 0); assert.equal(state.groups.length, 0);
  assert.equal(state.qualifiers.length, 0); assert.equal(state.silverQualifiers.length, 0);
  assert.equal(state.championId, null); assert.equal(state.silverChampionId, null);
  assert.equal(Boolean(state.metadata.startedAt), false, 'the reset returns an editable draft');
  assert.deepEqual(rosterIdentity(state), rosterIdentity(before), 'all original entrants and seed assignments are preserved');
  for (const field of ['tournamentName', 'format', 'courts', 'slotMinutes', 'eventDate', 'dayStart', 'dayEnd']) assert.deepEqual(state.settings[field], before.settings[field], `user configuration ${field} is retained`);
  assert.equal(state.settings.draw.code, null, 'the discarded draw is no longer presented as current');
}

test('the owner deletes a published bracket through its dedicated RPC and keeps a complete pre-reset backup', async () => {
  const initial = harness(); const original = tournament(initial.Engine); const published = rowFor(original, 7);
  const app = harness({ configured: true, row: published }); await app.api.start();
  const before = json(app.api.state());
  assert.equal(app.api.canResetBracket(), true);
  await app.api.resetTournament();
  assert.deepEqual(app.server.resets, [{ id: 'tournament-1', revision: 7 }]);
  assert.equal(app.server.calls.length, 0, 'resetting a started bracket cannot use the normal state-save route');
  assertClearedBracket(app.api.state(), before);
  assert.equal(app.api.online().tournament.public_read, false, 'the cleared event is private until explicitly published again');
  assert.equal(app.api.online().tournament.id, published.id); assert.equal(app.api.online().role, 'owner');
  const backup = app.api.readLastResetBackup();
  assert.deepEqual(json(backup.state), before, 'the backup retains every match and result from before deletion');
  assert.equal(backup.revision, 7); assert.equal(backup.publicRead, true); assert.equal(backup.userId, 'admin-1');
  assert.equal(app.api.canResetBracket(), false, 'there is no bracket left to delete');
});

test('cancelling bracket deletion leaves the published tournament and its existing matches untouched', async () => {
  const initial = harness(); const original = tournament(initial.Engine);
  const app = harness({ configured: true, row: rowFor(original), confirm: false }); await app.api.start();
  const before = json(app.api.state());
  await app.api.resetTournament();
  assert.equal(app.confirmations.length, 1); assert.equal(app.server.resets.length, 0); assert.equal(app.server.calls.length, 0);
  assert.deepEqual(json(app.api.state()), before); assert.equal(app.api.online().tournament.public_read, true);
  assert.equal(app.api.readLastResetBackup(), null, 'an aborted operation does not create a reset backup');
});

test('an edit made while deletion confirmation is open prevents the stale reset request', async () => {
  const initial = harness(); const original = tournament(initial.Engine); let confirmDeletion;
  const app = harness({ configured: true, row: rowFor(original), confirm: () => new Promise(resolve => { confirmDeletion = resolve; }) }); await app.api.start();
  const deleting = app.api.resetTournament();
  assert.equal(typeof confirmDeletion, 'function');
  app.api.state().teams[0].name = 'Nome modificato durante la conferma'; app.api.noteLocalEdit({ teamIndex: 0 });
  confirmDeletion(true); await deleting;
  assert.equal(app.server.resets.length, 0, 'the user must review the changed tournament before confirming again');
  assert.equal(app.api.state().teams[0].name, 'Nome modificato durante la conferma');
  assert.ok(app.api.state().matches.length); assert.equal(app.api.readLastResetBackup(), null);
});

test('a reset revision conflict leaves the old bracket in place and its backup available', async () => {
  const initial = harness(); const original = tournament(initial.Engine);
  const app = harness({ configured: true, row: rowFor(original), reset: async () => { throw new Error('revision_conflict'); } }); await app.api.start();
  const before = json(app.api.state());
  await app.api.resetTournament();
  assert.equal(app.server.resets.length, 1); assert.equal(app.server.calls.length, 0);
  assert.deepEqual(json(app.api.state()), before, 'an unsuccessful server operation cannot clear the editor');
  assert.deepEqual(json(app.api.readLastResetBackup().state), before);
  assert.equal(app.api.online().tournament.public_read, true);
  assert.equal(app.api.online().resetting, false); assert.equal(app.api.online().saving, false); assert.equal(app.document.getElementById('mainContent').inert, false);
});

test('an ordinary editor cannot delete a published bracket even by calling the action directly', async () => {
  const initial = harness(); const original = tournament(initial.Engine);
  const app = harness({ configured: true, row: rowFor(original), role: 'editor', userId: 'admin-2' }); await app.api.start();
  const before = json(app.api.state());
  assert.equal(app.api.canResetBracket(), false);
  await app.api.resetTournament();
  assert.equal(app.confirmations.length, 0); assert.equal(app.server.resets.length, 0);
  assert.deepEqual(json(app.api.state()), before); assert.equal(app.api.readLastResetBackup(), null);
});

test('a failed protective backup prevents bracket deletion from reaching the server', async () => {
  const initial = harness(); const original = tournament(initial.Engine); const storage = new Storage();
  const app = harness({ configured: true, row: rowFor(original), storage }); await app.api.start();
  const before = json(app.api.state()); const persist = storage.setItem.bind(storage);
  storage.setItem = (key, value) => { if (key.includes(':reset-backup:')) throw new Error('QuotaExceededError'); persist(key, value); };
  await app.api.resetTournament();
  assert.equal(app.server.resets.length, 0, 'the destructive RPC is not sent without a durable backup');
  assert.deepEqual(json(app.api.state()), before); assert.equal(app.api.online().tournament.public_read, true);
  assert.match(app.document.getElementById('toast').textContent, /Backup non riuscito/);
  assert.equal(app.api.readLastResetBackup(), null);
});

test('local deletion can reset a started tournament while preserving its roster and recoverable backup', async () => {
  const app = harness(); app.api.replaceState(tournament(app.Engine)); app.api.saveLocalState();
  const before = json(app.api.state());
  assert.equal(app.api.canResetBracket(), true);
  await app.api.resetTournament();
  assertClearedBracket(app.api.state(), before);
  assert.equal(app.server.resets.length, 0); assert.equal(app.server.calls.length, 0);
  assert.deepEqual(json(app.api.readLastResetBackup().state), before);
  const reopened = harness({ storage: app.storage });
  assertClearedBracket(reopened.api.state(), before);
  assert.deepEqual(json(reopened.api.readLastResetBackup().state), before, 'the backup remains available after reloading the cleared local event');
});

test('pending valid edits are saved before deletion and the reset uses the acknowledged revision', async () => {
  const initial = harness(); const original = tournament(initial.Engine);
  const app = harness({ configured: true, row: rowFor(original, 3) }); await app.api.start();
  app.api.state().teams[0].name = 'Nome corretto da conservare'; app.api.noteLocalEdit({ teamIndex: 0 });
  await app.api.resetTournament();
  assert.equal(app.server.calls.length, 1, 'the pending name is committed before deletion confirmation');
  assert.deepEqual(app.server.resets, [{ id: 'tournament-1', revision: 4 }]);
  assert.equal(app.api.state().teams[0].name, 'Nome corretto da conservare');
  assert.equal(app.api.readLastResetBackup().state.teams[0].name, 'Nome corretto da conservare');
  assert.equal(app.api.hasUnsavedLocalChanges(), false);
});

test('an in-flight bracket reset freezes editing and rejects duplicate deletion requests', async () => {
  const initial = harness(); const original = tournament(initial.Engine); let releaseReset, notifyEntered;
  const entered = new Promise(resolve => { notifyEntered = resolve; });
  const app = harness({ configured: true, row: rowFor(original), reset: (call, server) => new Promise(resolve => {
    releaseReset = () => {
      const cleared = json(server.row.state); app.Engine.resetTournament(cleared, { allowStarted: true });
      server.row = { ...server.row, state: cleared, public_read: false, revision: call.revision + 1 }; resolve(json(server.row));
    };
    notifyEntered();
  }) });
  await app.api.start(); const pending = app.api.resetTournament(); await entered;
  assert.equal(app.api.online().resetting, true); assert.equal(app.api.online().saving, true);
  assert.equal(app.document.getElementById('mainContent').inert, true); assert.equal(app.api.canResetBracket(), false);
  assert.ok(app.api.state().matches.length, 'the bracket is displayed until the server confirms deletion');
  await app.api.resetTournament();
  assert.equal(app.server.resets.length, 1, 'double activation cannot send a second destructive request');
  assert.equal(app.confirmations.length, 1);
  releaseReset(); await pending;
  assert.equal(app.api.online().resetting, false); assert.equal(app.api.online().saving, false); assert.equal(app.document.getElementById('mainContent').inert, false);
  assertClearedBracket(app.api.state(), original);
});

test('a reset response from the previous account cannot restore its tournament after an account change', async () => {
  const initial = harness(); const original = tournament(initial.Engine); let releaseReset, notifyEntered;
  const entered = new Promise(resolve => { notifyEntered = resolve; });
  const app = harness({ configured: true, row: rowFor(original), reset: (call, server) => {
    const previousAccountRow = json(server.row);
    return new Promise(resolve => {
      releaseReset = () => {
        app.Engine.resetTournament(previousAccountRow.state, { allowStarted: true });
        previousAccountRow.public_read = false; previousAccountRow.revision = call.revision + 1;
        resolve(previousAccountRow);
      };
      notifyEntered();
    });
  } });
  await app.api.start(); const pending = app.api.resetTournament(); await entered;
  assert.equal(app.api.online().resetting, true);
  app.api.online().session = { user: { id: 'admin-2', email: 'other@admin.beachvolley.app' } };
  app.api.online().tournament = null; app.api.online().revision = null; app.api.online().role = null; app.api.online().accessReady = false;
  app.api.replaceState(app.Engine.createDefaultState());
  app.server.row = null; // RLS exposes no tournament to the new account.
  releaseReset(); await pending;
  assert.equal(app.api.online().session.user.id, 'admin-2', 'the response cannot replace the current session');
  assert.equal(app.api.online().tournament, null); assert.equal(app.api.online().revision, null);
  assert.equal(app.api.state().teams.filter(team => team.name.trim()).length, 0, 'entrants from the previous account remain inaccessible');
  assert.equal(app.api.state().matches.length, 0);
  assert.equal(app.api.online().resetting, false); assert.equal(app.api.online().saving, false);
  assert.equal(app.document.getElementById('mainContent').inert, false);
  assert.equal(app.api.readLastResetBackup(), null, 'the previous owner’s backup is not exposed to the new account');
});

test('publishing and unpublishing the Live view re-enables the owner’s bracket deletion button after each save', async () => {
  const initial = harness(); const original = tournament(initial.Engine);
  const app = harness({ configured: true, row: privateRow(original) }); await app.api.start();
  const button = app.document.getElementById('resetTournamentBtn'); const toggle = app.document.getElementById('publicReadToggle');
  assert.equal(app.api.canResetBracket(), true); assert.equal(button.disabled, false);
  for (const requested of [true, false]) {
    toggle.checked = requested;
    await app.api.togglePublicRead({ target: toggle });
    assert.equal(app.api.online().tournament.public_read, requested);
    assert.equal(app.api.online().saving, false); assert.equal(toggle.disabled, false);
    assert.equal(app.api.canResetBracket(), true);
    assert.equal(button.disabled, false, 'the UI cannot retain the disabled state painted while the visibility save was in flight');
    assert.ok(app.api.state().matches.length, 'changing visibility does not clear the bracket');
  }
  assert.deepEqual(app.server.visibilityChanges.map(call => call.publicRead), [true, false]);
  assert.equal(app.server.resets.length, 0);
});
