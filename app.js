(function () {
  'use strict';

  const Engine = window.BeachEngine;
  const DB = window.BeachDB;
  const CONFIG = window.BEACH_APP_CONFIG || {};
  const LOCAL_PREFIX = 'beach-volley-manager-v6';
  const LEGACY_KEYS = ['beach-volley-state-v5', 'beach-volley-state-v4', 'beach-volley-state-v3'];
  const UI_STATE_PREFIX = 'beach-volley-ui-v10-7-tab-resume';
  const VALID_TABS = new Set(['dashboard', 'setup', 'teams', 'matches', 'live', 'more']);
  const VIEW_LABELS = {
    dashboard: 'Panoramica',
    setup: 'Configura torneo',
    teams: 'Squadre partecipanti',
    matches: 'Gestione partite',
    live: 'Risultati live',
    more: 'Accesso & Live',
  };
  const VALID_LIVE_VIEWS = new Set(['overview', 'standings', 'bracket']);

  let state = loadLocalState();
  let activeTab = 'dashboard';
  let activeLiveView = 'overview';
  let uiScrollPositions = {};
  let uiRestoreToken = 0;
  let scrollSaveTimer = null;
  let hydratedUiState = null;
  let backgroundUiSnapshot = null;
  let resumeTimer = null;
  let resumeInProgress = false;
  let scrollRestoreInProgress = false;
  let suppressScrollCaptureUntil = 0;
  let suppressFocusAutoScrollUntil = 0;
  let lastExplicitFocusIntentAt = 0;
  let lastVisibleScrollPositions = {};
  let suppressAutoNavigationUntil = 0;
  let toastTimer = null;
  let saveTimer = null;
  let deferredInstallPrompt = null;

  // Editing guard: prevents Realtime/focus refreshes from replacing values while an admin is typing.
  let localEditVersion = 0;
  let lastSavedEditVersion = 0;
  let pendingRealtimeRow = null;
  let pendingRemoteRefresh = false;
  let manualBoardRenderTimer = null;
  let dirtyWholeState = false;
  const scoreDrafts = new Map();
  let setupDraftForm = { name: null, slug: null };
  let localPersistenceError = false;
  let sharedDraftRequested = false;
  let draftCreationFailed = false;
  let remoteConflict = null;
  let onlineRequest = 0;
  let loginInProgress = false;
  let draftBaseRevision = null;
  const dirtyTeamIndexes = new Set();
  const dirtyMatchIds = new Set();

  const online = {
    configured: Boolean(DB?.isConfigured?.()),
    authReady: false,
    session: null,
    tournament: null,
    role: null,
    revision: null,
    saving: false,
    creating: false,
    resetting: false,
    admins: [],
    accessReady: false,
    roleCheckedAt: 0,
    savePaused: false,
  };

  const $ = (id) => document.getElementById(id);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  function urlParams() {
    return new URLSearchParams(window.location.search);
  }

  function normalizeTournamentKey(value) {
    const normalized = String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50);
    return normalized;
  }

  function tournamentSlug() {
    return normalizeTournamentKey(urlParams().get('t') || CONFIG.defaultTournamentSlug || 'beach-chill-torneo');
  }

  function setTournamentKeyInUrl(value) {
    const key = normalizeTournamentKey(value);
    if (!key) throw new Error('invalid_slug');
    const url = new URL(window.location.href);
    url.searchParams.set('t', key);
    url.searchParams.delete('live');
    history.replaceState({}, '', url);
    return key;
  }

  function generateTournamentKey() {
    const base = normalizeTournamentKey(
      $('onlineTournamentName')?.value
      || state.settings.tournamentName
      || 'beach-chill-torneo'
    ) || 'beach-chill-torneo';
    const random = Math.random().toString(36).slice(2, 7);
    return `${base.slice(0, 44)}-${random}`;
  }

  function timeToMinutes(value) {
    const match = /^(\d{2}):(\d{2})$/.exec(String(value || ''));
    return match && Number(match[1]) < 24 && Number(match[2]) < 60 ? Number(match[1]) * 60 + Number(match[2]) : null;
  }

  function singleDayCapacity() {
    const start = timeToMinutes(state.settings.dayStart);
    const end = timeToMinutes(state.settings.dayEnd);
    if (start == null || end == null || end <= start) return null;
    const slotsPerCourt = Math.floor((end - start) / Math.max(20, Number(state.settings.slotMinutes) || 45));
    return {
      minutes: end - start,
      slotsPerCourt,
      totalSlots: slotsPerCourt * Math.max(1, Number(state.settings.courts) || 1),
    };
  }

  function localKey() {
    return `${LOCAL_PREFIX}:${tournamentSlug()}`;
  }

  function isPublicView() {
    return urlParams().get('live') === '1';
  }


  function uiStateKey() {
    return `${UI_STATE_PREFIX}:${tournamentSlug()}:${isPublicView() ? 'public' : 'admin'}`;
  }

  function readUiState() {
    try {
      const raw = sessionStorage.getItem(uiStateKey()) || localStorage.getItem(uiStateKey());
      return raw ? JSON.parse(raw) : {};
    } catch (error) {
      console.warn('Stato interfaccia non leggibile:', error);
      return {};
    }
  }

  function writeUiState(extra = {}) {
    try {
      const payload = {
        activeTab,
        activeLiveView,
        scrollPositions: uiScrollPositions,
        phaseFilter: $('phaseFilter')?.value || hydratedUiState?.phaseFilter || 'all',
        statusFilter: $('statusFilter')?.value || hydratedUiState?.statusFilter || 'open',
        matchSearch: $('matchSearch')?.value || hydratedUiState?.matchSearch || '',
        updatedAt: Date.now(),
        ...extra,
      };
      const serialized = JSON.stringify(payload);
      sessionStorage.setItem(uiStateKey(), serialized);
      localStorage.setItem(uiStateKey(), serialized);
      hydratedUiState = payload;
    } catch (error) {
      console.warn('Stato interfaccia non salvabile:', error);
    }
  }

  function hydrateUiState() {
    const saved = readUiState();
    hydratedUiState = saved;
    if (VALID_TABS.has(saved.activeTab)) activeTab = saved.activeTab;
    if (VALID_LIVE_VIEWS.has(saved.activeLiveView)) activeLiveView = saved.activeLiveView;
    if (saved.scrollPositions && typeof saved.scrollPositions === 'object') {
      uiScrollPositions = Object.fromEntries(
        Object.entries(saved.scrollPositions)
          .filter(([key, value]) => VALID_TABS.has(key) && Number.isFinite(Number(value)))
          .map(([key, value]) => [key, Math.max(0, Number(value))]),
      );
    }
    return saved;
  }

  function currentScrollTop() {
    return Math.max(0, Math.round(
      Number(window.scrollY)
      || Number(document.scrollingElement?.scrollTop)
      || Number(document.documentElement?.scrollTop)
      || Number(document.body?.scrollTop)
      || 0
    ));
  }

  function rememberCurrentScroll({ force = false, value = null } = {}) {
    if (!VALID_TABS.has(activeTab)) return;
    if (!force && (
      resumeInProgress
      || scrollRestoreInProgress
      || Date.now() < suppressScrollCaptureUntil
      || document.visibilityState === 'hidden'
    )) return;
    const position = Math.max(0, Number(value == null ? currentScrollTop() : value) || 0);
    uiScrollPositions[activeTab] = position;
    lastVisibleScrollPositions[activeTab] = position;
    writeUiState();
  }

  function restoreScrollValue(tabId, value) {
    const target = Math.max(0, Number(value) || 0);
    const token = ++uiRestoreToken;
    scrollRestoreInProgress = true;
    suppressScrollCaptureUntil = Date.now() + 950;
    suppressFocusAutoScrollUntil = Math.max(suppressFocusAutoScrollUntil, Date.now() + 1200);
    uiScrollPositions[tabId] = target;
    lastVisibleScrollPositions[tabId] = target;

    const restore = () => {
      if (token !== uiRestoreToken || activeTab !== tabId) return;
      window.scrollTo({ top: target, left: 0, behavior: 'auto' });
    };

    requestAnimationFrame(() => requestAnimationFrame(restore));
    setTimeout(restore, 90);
    setTimeout(restore, 260);
    setTimeout(() => {
      if (token !== uiRestoreToken || activeTab !== tabId) return;
      restore();
      scrollRestoreInProgress = false;
      suppressScrollCaptureUntil = Date.now() + 180;
      uiScrollPositions[tabId] = target;
      lastVisibleScrollPositions[tabId] = target;
      writeUiState();
    }, 560);
  }

  function restoreSavedScroll(tabId = activeTab, fallback = null) {
    const stored = Number(uiScrollPositions[tabId]);
    const target = Number.isFinite(stored)
      ? Math.max(0, stored)
      : Math.max(0, Number(fallback) || 0);
    restoreScrollValue(tabId, target);
  }

  function restoreUiControls() {
    const saved = hydratedUiState || readUiState();
    const phase = $('phaseFilter');
    const status = $('statusFilter');
    const search = $('matchSearch');
    if (phase && [...phase.options].some((option) => option.value === saved.phaseFilter)) phase.value = saved.phaseFilter;
    if (status && [...status.options].some((option) => option.value === saved.statusFilter)) status.value = saved.statusFilter;
    if (search && typeof saved.matchSearch === 'string') search.value = saved.matchSearch;
  }

  function updateTabInUrl(tabId) {
    if (isPublicView() || !VALID_TABS.has(tabId)) return;
    const url = new URL(window.location.href);
    url.searchParams.set('open', tabId);
    history.replaceState(history.state, '', url);
  }

  async function preserveUiAround(callback) {
    const tabBefore = activeTab;
    const scrollBefore = Math.max(0, Math.round(window.scrollY || 0));
    rememberCurrentScroll();
    try {
      return await callback();
    } finally {
      if (activeTab === tabBefore) restoreSavedScroll(tabBefore, scrollBefore);
    }
  }

  function captureBackgroundUiState() {
    if (!VALID_TABS.has(activeTab)) return;
    const now = Date.now();
    const current = currentScrollTop();
    const stable = Number(lastVisibleScrollPositions[activeTab]);
    const saved = Number(uiScrollPositions[activeTab]);
    const recentSnapshot = backgroundUiSnapshot
      && backgroundUiSnapshot.activeTab === activeTab
      && now - Number(backgroundUiSnapshot.capturedAt || 0) < 1200
      ? backgroundUiSnapshot
      : null;

    // On Safari/iOS a second blur/visibility event may report scrollTop=0 after the
    // page has already been suspended. Keep the last visible value instead.
    let scroll = current;
    if (recentSnapshot) scroll = Number(recentSnapshot.scroll) || scroll;
    else if (current === 0 && Number.isFinite(stable) && stable > 0) scroll = stable;
    else if (current === 0 && Number.isFinite(saved) && saved > 0) scroll = saved;

    scroll = Math.max(0, Number(scroll) || 0);
    uiScrollPositions[activeTab] = scroll;
    lastVisibleScrollPositions[activeTab] = scroll;
    writeUiState();

    backgroundUiSnapshot = {
      activeTab,
      activeLiveView,
      scroll,
      capturedAt: now,
    };
    try {
      sessionStorage.setItem(`${uiStateKey()}:resume`, JSON.stringify(backgroundUiSnapshot));
      localStorage.setItem(`${uiStateKey()}:resume`, JSON.stringify(backgroundUiSnapshot));
    } catch (error) {
      console.warn('Snapshot di ripresa non salvabile:', error);
    }

    // Do not let Safari restore a previously focused input and auto-scroll it into view.
    const focused = document.activeElement;
    if (focused?.matches?.('input, select, textarea, [contenteditable="true"]')) {
      suppressFocusAutoScrollUntil = now + 1800;
      setTimeout(() => {
        try { focused.blur(); } catch (_) {}
      }, 0);
    }
  }

  function readBackgroundUiState() {
    if (backgroundUiSnapshot && VALID_TABS.has(backgroundUiSnapshot.activeTab)) {
      return backgroundUiSnapshot;
    }
    try {
      const raw = sessionStorage.getItem(`${uiStateKey()}:resume`)
        || localStorage.getItem(`${uiStateKey()}:resume`);
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && VALID_TABS.has(parsed.activeTab)) return parsed;
    } catch (error) {
      console.warn('Snapshot di ripresa non leggibile:', error);
    }
    const saved = readUiState();
    return {
      activeTab: VALID_TABS.has(saved.activeTab) ? saved.activeTab : activeTab,
      activeLiveView: VALID_LIVE_VIEWS.has(saved.activeLiveView) ? saved.activeLiveView : activeLiveView,
      scroll: Number(saved.scrollPositions?.[saved.activeTab] || 0),
      capturedAt: Number(saved.updatedAt || Date.now()),
    };
  }

  function restoreBackgroundUiState(snapshot, { updateUrl = true } = {}) {
    if (!snapshot) return;
    const desiredTab = isPublicView()
      ? 'live'
      : online.configured && online.authReady && !online.session
        ? 'more'
        : (VALID_TABS.has(snapshot.activeTab) ? snapshot.activeTab : activeTab);
    if (VALID_LIVE_VIEWS.has(snapshot.activeLiveView)) activeLiveView = snapshot.activeLiveView;
    const target = Math.max(0, Number(snapshot.scroll) || 0);
    uiScrollPositions[desiredTab] = target;
    lastVisibleScrollPositions[desiredTab] = target;
    suppressFocusAutoScrollUntil = Date.now() + 1200;
    suppressScrollCaptureUntil = Date.now() + 900;

    if (activeTab !== desiredTab) {
      switchTab(desiredTab, { restore: false, updateUrl, persist: true });
    } else {
      if (desiredTab === 'live') switchLiveView(activeLiveView, { persist: false });
      writeUiState({ activeTab: desiredTab, activeLiveView });
      if (updateUrl) updateTabInUrl(desiredTab);
    }
    restoreScrollValue(desiredTab, target);
  }

  async function resumeFromBackground() {
    if (resumeInProgress) return;
    resumeInProgress = true;
    const snapshot = readBackgroundUiState();
    suppressAutoNavigationUntil = Date.now() + 2500;
    try {
      // Restore first, before any asynchronous session/database work can repaint the UI.
      restoreBackgroundUiState(snapshot);
      if (online.configured && online.session && !isEditableControl() && !hasUnsavedLocalChanges()) {
        await preserveUiAround(() => loadOnlineTournament({ quiet: true }));
      }
      // Auth refresh and Realtime callbacks may finish after the first restore.
      restoreBackgroundUiState(snapshot);
      setTimeout(() => restoreBackgroundUiState(snapshot), 80);
      setTimeout(() => restoreBackgroundUiState(snapshot), 320);
    } finally {
      resumeInProgress = false;
    }
  }

  function scheduleResumeFromBackground(delay = 60) {
    clearTimeout(resumeTimer);
    resumeTimer = setTimeout(resumeFromBackground, delay);
  }

  function loadLocalState() {
    if (DB?.isConfigured?.()) return Engine.createDefaultState();
    try {
      const direct = localStorage.getItem(localKey());
      if (direct) return Engine.normalizeState(JSON.parse(direct));
      // Legacy keys belong only to the default local tournament.
      if (urlParams().has('t')) return Engine.createDefaultState();
      for (const key of LEGACY_KEYS) {
        const value = localStorage.getItem(key);
        if (value) return Engine.normalizeState(JSON.parse(value));
      }
    } catch (error) {
      console.warn('Backup locale non leggibile:', error);
    }
    return Engine.createDefaultState();
  }

  function setupDraftKey() {
    return `${LOCAL_PREFIX}:setup:${encodeURIComponent(CONFIG.supabaseUrl || 'configured')}:${tournamentSlug()}:${online.session?.user?.id || ''}`;
  }

  function readSetupDraft() {
    if (!online.configured || !online.session || isPublicView()) return null;
    try {
      const draft = JSON.parse(localStorage.getItem(setupDraftKey()) || 'null');
      if (draft?.userId !== online.session.user.id || draft?.slug !== tournamentSlug() || !draft.state) return null;
      return { state: Engine.normalizeState(draft.state), form: draft.form || {} };
    } catch (_) { return null; }
  }

  function renderSaveStatus() {
    const bar = $('saveStatusBar');
    if (!bar) return;
    bar.classList.toggle('hidden', !canEdit());
    const button = $('saveNowBtn');
    if ($('rosterSyncNotice')) $('rosterSyncNotice').textContent = online.configured
      ? 'Ogni inserimento viene condiviso automaticamente con gli admin autorizzati. Usate la stessa chiave torneo. La pubblicazione Live è separata.'
      : 'Modalità locale: le squadre restano su questo dispositivo. Per collaborare da più PC occorre attivare il collegamento online.';
    let message;
    if (localPersistenceError && online.tournament && !hasUnsavedLocalChanges()) message = 'Salvato online. La copia locale non è disponibile su questo dispositivo.';
    else if (localPersistenceError) message = 'Salvataggio sul dispositivo non riuscito: esporta un backup prima di chiudere.';
    else if (online.resetting) message = 'Eliminazione del tabellone in corso… Il backup è conservato su questo dispositivo.';
    else if (online.creating) message = 'Creazione della bozza condivisa… La vista giocatori resta disattivata.';
    else if (scoreDrafts.size) message = `${scoreDrafts.size} ${scoreDrafts.size === 1 ? 'punteggio in bozza' : 'punteggi in bozza'}: conferma ogni gara con “Salva punteggio”.`;
    else if (online.savePaused) message = 'Sincronizzazione sospesa: risolvi il conflitto indicato sotto.';
    else if (online.saving) message = 'Salvataggio online in corso…';
    else if (hasUnsavedLocalChanges() && online.tournament) message = 'Modifiche salvate sul dispositivo, da sincronizzare online.';
    else if (pendingRealtimeRow || pendingRemoteRefresh) message = 'Aggiornamento ricevuto: termina il campo attivo per caricare le modifiche in attesa.';
    else if (online.tournament) message = online.tournament.public_read
      ? 'Salvato e condiviso con gli admin. Vista giocatori attiva.'
      : 'Bozza salvata e condivisa con gli admin. Vista giocatori disattivata.';
    else if (draftCreationFailed) message = 'Bozza salvata sul dispositivo. Condivisione non riuscita: premi “Salva modifiche” per riprovare.';
    else if (sharedDraftRequested) message = 'Bozza salvata sul dispositivo. Preparazione della condivisione con gli admin…';
    else if (online.configured) message = 'La prima squadra crea una bozza condivisa riservata agli admin.';
    else message = 'Salvataggio automatico su questo dispositivo.';
    $('saveStatusText').textContent = message;
    bar.classList.toggle('save-error', localPersistenceError || online.savePaused || draftCreationFailed);
    bar.classList.toggle('save-pending', Boolean(sharedDraftRequested && !online.tournament || scoreDrafts.size || online.saving || online.creating || hasUnsavedLocalChanges()));
    if (button) button.disabled = online.saving || online.creating || online.resetting || Boolean(scoreDrafts.size);
    if ($('resetTournamentBtn')) $('resetTournamentBtn').disabled = !canResetBracket();
  }

  function saveLocalState() {
    try {
      if (online.configured && !canEdit()) return false;
      if (online.configured && online.session && !online.tournament) {
        localStorage.setItem(setupDraftKey(), JSON.stringify({state,form:setupDraftForm,userId:online.session.user.id,slug:tournamentSlug(),savedAt:new Date().toISOString()}));
      } else {
        localStorage.setItem(localKey(), JSON.stringify(state));
        if (online.tournament && online.session) localStorage.setItem(`${localKey()}:draft`, JSON.stringify({state, baseRevision:draftBaseRevision ?? online.revision,tournamentId:online.tournament.id,userId:online.session.user?.id,pending:hasUnsavedLocalChanges(),savedAt:new Date().toISOString()}));
      }
      localPersistenceError = false;
      if (!online.tournament && !online.creating) clearDirtyTracking(localEditVersion);
      renderSaveStatus();
      return true;
    } catch (error) {
      localPersistenceError = true;
      console.warn('Salvataggio locale non disponibile:', error);
      renderSaveStatus();
      return false;
    }
  }


function cloneValue(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function isEditableControl(element = document.activeElement) {
  return Boolean(
    element
    && element.matches?.('input:not([disabled]):not([readonly]), select:not([disabled]), textarea:not([disabled]):not([readonly])')
  );
}

function hasUnsavedLocalChanges() {
  return localEditVersion > lastSavedEditVersion;
}

function noteLocalEdit({ teamIndex = null, matchId = null, wholeState = false, delay = 600 } = {}) {
  onlineRequest += 1; // A pending refresh must not replace a newer local edit.
  if (!hasUnsavedLocalChanges()) draftBaseRevision = online.revision;
  localEditVersion += 1;
  if (Number.isInteger(teamIndex) && teamIndex >= 0) dirtyTeamIndexes.add(teamIndex);
  if (matchId) dirtyMatchIds.add(String(matchId));
  if (wholeState) dirtyWholeState = true;
  if ((Number.isInteger(teamIndex) || wholeState && Engine.activeTeams(state).length) && online.configured && online.session && !online.tournament) {
    sharedDraftRequested = true;
    draftCreationFailed = false;
  }
  state.metadata.updatedAt = new Date().toISOString();
  const stored = saveLocalState();
  if (online.tournament) setConnectionStatus(stored ? 'Bozza salvata…' : 'Da sincronizzare…', stored ? '' : 'error');
  scheduleOnlineSave(delay);
}

function clearDirtyTracking(savedVersion) {
  if (localEditVersion !== savedVersion) return;
  lastSavedEditVersion = savedVersion;
  draftBaseRevision = null;
  dirtyWholeState = false;
  dirtyTeamIndexes.clear();
  dirtyMatchIds.clear();
}

function sameValue(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.prototype.hasOwnProperty.call(b, key) && sameValue(a[key], b[key]));
}

// Merge only roster edits. Settings, draw and match changes retain the explicit conflict flow.
function mergeRosterState(baseValue, localValue, remoteValue) {
  if (!baseValue || !localValue || !remoteValue) return null;
  const base = Engine.normalizeState(cloneValue(baseValue));
  const local = Engine.normalizeState(cloneValue(localValue));
  const remote = Engine.normalizeState(cloneValue(remoteValue));
  const withoutRoster = (value) => {
    const copy = cloneValue(value);
    delete copy.teams;
    if (copy.metadata) delete copy.metadata.updatedAt;
    return copy;
  };
  if (!sameValue(withoutRoster(base), withoutRoster(local)) || !sameValue(withoutRoster(base), withoutRoster(remote))) return null;
  if (base.teams.length !== local.teams.length || base.teams.length !== remote.teams.length) return null;
  const merged = cloneValue(remote);
  const fields = ['name', 'seed', 'manualGroup'];
  for (let index = 0; index < base.teams.length; index += 1) {
    const before = base.teams[index], mine = local.teams[index], theirs = remote.teams[index];
    if (before.id !== mine.id || before.id !== theirs.id) return null;
    const fixedFields = (item) => Object.fromEntries(Object.entries(item).filter(([key]) => !fields.includes(key) && key !== 'updatedAt'));
    if (!sameValue(fixedFields(before), fixedFields(mine)) || !sameValue(fixedFields(before), fixedFields(theirs))) return null;
    let localChange = false;
    for (const field of fields) {
      const changed = !sameValue(mine[field], before[field]);
      if (changed && !sameValue(theirs[field], before[field]) && !sameValue(mine[field], theirs[field])) return null;
      if (changed) { merged.teams[index][field] = mine[field]; localChange = true; }
    }
    if (localChange) merged.teams[index].updatedAt = mine.updatedAt;
  }
  if (Engine.validateStateSnapshot(merged)) return null;
  merged.metadata.updatedAt = local.metadata.updatedAt;
  return merged;
}

function paintSharedRoster(previousState = null) {
  const focused = document.activeElement;
  if (activeTab === 'teams' && focused?.closest?.('#teamRows')) {
    // Keep the actual input node so its focus, caret and incomplete values survive.
    $$('#teamRows tr').forEach((row) => {
      const item = state.teams[Number(row.dataset.teamIndex)];
      if (!item) return;
      const index = Number(row.dataset.teamIndex);
      const fields = [['.team-name-input', 'name', item.name], ['.seed-input', 'seed', item.seed ?? ''], ['.manual-group-select', 'manualGroup', item.manualGroup || '']];
      fields.forEach(([selector, field, value]) => {
        const input = row.querySelector(selector);
        if (!input || String(input.value) === String(value)) return;
        if (input === focused) {
          if (!previousState || String(input.value) !== String(previousState.teams[index]?.[field] ?? '')) return;
          const start = input.selectionStart, end = input.selectionEnd;
          input.value = value;
          if (Number.isInteger(start) && Number.isInteger(end)) input.setSelectionRange?.(Math.min(start, String(value).length), Math.min(end, String(value).length));
        } else input.value = value;
      });
      updateRowStatus(row, item);
    });
    $('teamCountBadge').textContent = `${Engine.activeTeams(state).length} / 24 coppie`;
  } else renderTeamRows();
  renderHeader(); renderDashboard(); renderLive();
  updateOnlinePanel(); renderSaveStatus();
}

function tryApplyRosterUpdate(row) {
  if (!row || !online.tournament || row.id !== online.tournament.id || row.slug !== tournamentSlug()) return false;
  if (Number(row.revision) <= Number(online.revision ?? -1)) {
    if (pendingRealtimeRow && Number(pendingRealtimeRow.revision) <= Number(online.revision ?? -1)) pendingRealtimeRow = null;
    renderSaveStatus();
    return true;
  }
  if (online.saving || online.savePaused || scoreDrafts.size || dirtyWholeState || dirtyMatchIds.size) return false;
  if (isEditableControl() && activeTab !== 'teams') return false;
  const merged = mergeRosterState(online.tournament.state, state, row.state);
  if (!merged) return false;
  const focused = document.activeElement;
  const focusedRow = focused?.closest?.('tr[data-team-index]');
  if (focusedRow) {
    const index = Number(focusedRow.dataset.teamIndex);
    const field = focused.classList.contains('team-name-input') ? 'name'
      : focused.classList.contains('seed-input') ? 'seed'
      : focused.classList.contains('manual-group-select') ? 'manualGroup' : null;
    if (field && String(merged.teams[index]?.[field] ?? '') !== String(state.teams[index]?.[field] ?? '')
      && String(focused.value) !== String(state.teams[index]?.[field] ?? '')) return false;
  }
  const pending = hasUnsavedLocalChanges();
  const previousState = state;
  online.tournament = row; online.revision = Number(row.revision);
  state = merged;
  if (pending) draftBaseRevision = online.revision;
  else clearDirtyTracking(localEditVersion);
  pendingRealtimeRow = null; pendingRemoteRefresh = false;
  saveLocalState();
  paintSharedRoster(previousState);
  setConnectionStatus(pending ? 'Sincronizzazione…' : 'Aggiornato', 'online');
  if (pending) scheduleOnlineSave(0);
  return true;
}

function applyRealtimeRow(row) {
  if (!row || row.id !== online.tournament?.id || row.slug !== tournamentSlug() || Number(row.revision) <= Number(online.revision ?? -1)) return;
  online.tournament = row;
  online.revision = Number(row.revision);
  state = Engine.normalizeState(row.state);
  saveLocalState();
  lastSavedEditVersion = localEditVersion;
  dirtyWholeState = false;
  dirtyTeamIndexes.clear();
  dirtyMatchIds.clear();
  setConnectionStatus('Aggiornato', 'online');
  const currentTab = activeTab;
  const currentScroll = Math.max(0, Math.round(window.scrollY || 0));
  rememberCurrentScroll();
  renderAll();
  if (activeTab === currentTab) restoreSavedScroll(currentTab, currentScroll);
  showToast('Torneo aggiornato da un altro dispositivo.', 'success');
}

function applyPendingRealtimeIfSafe() {
  if (!pendingRealtimeRow || online.saving) return;
  if (tryApplyRosterUpdate(pendingRealtimeRow)) return;
  if (isEditableControl() || scoreDrafts.size || hasUnsavedLocalChanges()) return;
  const row = pendingRealtimeRow;
  pendingRealtimeRow = null;
  if (Number(row.revision) > Number(online.revision ?? -1)) applyRealtimeRow(row);
}

async function refreshOnlineIfSafe() {
  if (!online.configured || !online.session) return;
  if (scoreDrafts.size || online.saving) {
    pendingRemoteRefresh = true;
    return;
  }
  pendingRemoteRefresh = false;
  await preserveUiAround(() => loadOnlineTournament({ quiet: true }));
}

function scheduleManualBoardRender() {
  clearTimeout(manualBoardRenderTimer);
  manualBoardRenderTimer = setTimeout(() => renderManualGroupBoard(), 180);
}

  function tournamentStarted() {
    return Boolean(state.metadata?.startedAt || state.matches.length);
  }

  function ensureRosterEditable() {
    if (!ensureEditable()) return false;
    if (!tournamentStarted()) return true;
    showToast('Torneo avviato: sono modificabili solo i nomi e i punteggi.', 'error');
    return false;
  }

  function showUnavailable(message) {
    const element = $('unavailableNotice');
    element.textContent = message;
    element.classList.toggle('hidden', !message);
    document.body.classList.toggle('tournament-unavailable', Boolean(message && online.configured));
  }

  function showSaveProblem(message, conflict) {
    $('conflictMessage').textContent = message;
    $('conflictPanel').classList.remove('hidden');
    $('retrySaveBtn').classList.toggle('hidden', conflict);
    setConnectionStatus(conflict ? 'Conflitto da risolvere' : 'Non sincronizzato', 'error');
  }

  function hideSaveProblem() {
    $('conflictPanel').classList.add('hidden');
  }

  function readPendingDraft(row) {
    if (isPublicView() || !online.role || !online.session) return null;
    try {
      const draft = JSON.parse(localStorage.getItem(`${localKey()}:draft`) || 'null');
      return draft?.pending && draft.tournamentId === row.id && draft.userId === online.session.user?.id ? draft : null;
    } catch (_) { return null; }
  }

  async function discardDraftAndReload() {
    if (!online.tournament || online.saving) return;
    const accepted = await confirmAction('Caricare la versione online?', 'La bozza locale verrà sostituita. Puoi prima scaricarla con “Scarica la mia bozza”.', 'Carica versione online');
    if (!accepted) return;
    try {
      const latest = await DB.loadTournamentBySlug(tournamentSlug());
      if (!latest) throw new Error('Torneo non disponibile. Verifica i permessi.');
      scoreDrafts.clear();
      clearDirtyTracking(localEditVersion);
      online.savePaused = false; remoteConflict = null;
      try { localStorage.removeItem(`${localKey()}:draft`); } catch (_) {}
      pendingRealtimeRow = null;
      await loadOnlineTournament({force:true});
      hideSaveProblem();
      showToast('Versione online caricata.', 'success');
    } catch (error) { showToast(humanizeError(error), 'error'); }
  }

  function canEdit() {
    if (isPublicView()) return false;
    if (online.configured && (!online.session || !online.accessReady)) return false;
    if (!online.tournament) return Boolean(online.session) || !online.configured;
    return ['owner', 'editor'].includes(online.role);
  }

  function isOwner() {
    return online.role === 'owner';
  }

  function canResetBracket() {
    return canEdit() && (!online.tournament || isOwner()) && Boolean(state.matches.length)
      && !online.saving && !online.creating && !online.resetting;
  }

  function resetBackupKey() {
    return `${localKey()}:reset-backup:${encodeURIComponent(CONFIG.supabaseUrl || 'locale')}:${online.session?.user?.id || 'local'}`;
  }

  function readLastResetBackup() {
    if (!canEdit() || online.tournament && !isOwner()) return null;
    try {
      const backup = JSON.parse(localStorage.getItem(resetBackupKey()) || 'null');
      if (!backup?.state || backup.slug !== tournamentSlug() || backup.userId !== (online.session?.user?.id || 'local')) return null;
      return Engine.validateStateSnapshot(backup.state) ? null : backup;
    } catch (_) { return null; }
  }

  function downloadResetBackup() {
    const backup = readLastResetBackup();
    if (!backup) { showToast('Nessun backup disponibile su questo dispositivo.', 'error'); return; }
    const blob = new Blob([JSON.stringify(backup.state, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${slugify(backup.state.settings.tournamentName)}-prima-eliminazione-${backup.savedAt.slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  function showToast(message, type = 'info') {
    const toast = $('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.className = `toast show ${type}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.className = 'toast'; }, 3200);
  }

  function setConnectionStatus(text, mode = '') {
    const element = $('connectionStatus');
    if (!element) return;
    element.className = `connection-chip ${mode}`.trim();
    const label = element.querySelector('span:last-child');
    if (label) label.textContent = text;
    renderSaveStatus();
  }

  function preferredTheme() {
    let stored; try { stored = localStorage.getItem('beach-volley-theme'); } catch (_) {}
    if (stored === 'dark' || stored === 'light') return stored;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function applyTheme(theme, persist = true) {
    const selected = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = selected;
    const toggle = $('themeToggle');
    if (toggle) toggle.checked = selected === 'dark';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', selected === 'dark' ? '#09131a' : '#ff6b35');
    if (persist) { try { localStorage.setItem('beach-volley-theme', selected); } catch (_) {} }
  }

  function initializeTheme() {
    applyTheme(document.documentElement.dataset.theme || preferredTheme(), false);
  }

  function stabilizeMobileViewport() {
    const updateViewport = () => {
      const viewport = window.visualViewport;
      const height = Math.round(viewport?.height || window.innerHeight || document.documentElement.clientHeight);
      document.documentElement.style.setProperty('--app-height', `${height}px`);
      const keyboardOpen = Boolean(viewport && window.innerHeight - viewport.height > 180);
      document.body.classList.toggle('keyboard-open', keyboardOpen);
    };

    updateViewport();
    window.addEventListener('resize', updateViewport, { passive: true });
    window.addEventListener('orientationchange', () => setTimeout(updateViewport, 180), { passive: true });
    window.visualViewport?.addEventListener('resize', updateViewport, { passive: true });
    window.visualViewport?.addEventListener('scroll', updateViewport, { passive: true });

    const noteExplicitFocusIntent = (event) => {
      if (event.target?.closest?.('input, select, textarea, [contenteditable="true"]')) {
        lastExplicitFocusIntentAt = Date.now();
        if (scrollRestoreInProgress) {
          uiRestoreToken += 1;
          scrollRestoreInProgress = false;
          suppressScrollCaptureUntil = 0;
        }
      }
    };
    document.addEventListener('pointerdown', noteExplicitFocusIntent, true);
    document.addEventListener('touchstart', noteExplicitFocusIntent, { capture: true, passive: true });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Tab' || event.key === 'Enter') noteExplicitFocusIntent(event);
    }, true);

    document.addEventListener('focusin', (event) => {
      if (!event.target.matches('input, select, textarea')) return;
      if (
        resumeInProgress
        || document.visibilityState !== 'visible'
        || Date.now() < suppressFocusAutoScrollUntil
        || Date.now() - lastExplicitFocusIntentAt > 1200
      ) return;

      const target = event.target;
      setTimeout(() => {
        if (document.activeElement !== target || resumeInProgress) return;
        const viewportHeight = window.visualViewport?.height || window.innerHeight || 0;
        const rect = target.getBoundingClientRect();
        const safeTop = 78;
        const safeBottom = Math.max(safeTop + 80, viewportHeight - 24);
        if (rect.top >= safeTop && rect.bottom <= safeBottom) return;
        target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
      }, 180);
    });
  }

  function markChanged({ render = true, immediate = false } = {}) {
    noteLocalEdit({ wholeState: true, delay: immediate ? 0 : 700 });
    if (render) renderAll();
  }

  function scheduleOnlineSave(delay = 700) {
    if (!canEdit() || online.savePaused || online.resetting) return;
    if (!online.tournament) {
      if (!sharedDraftRequested || draftCreationFailed || online.creating || !online.configured || !online.session) return;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => createOnlineTournament({ background: true }), delay);
      return;
    }
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushOnlineSave, delay);
  }


async function flushOnlineSave() {
  if (!online.tournament || !canEdit() || online.saving || online.resetting || online.savePaused || !hasUnsavedLocalChanges()) return;
  online.saving = true;
  setConnectionStatus('Salvataggio…');
  let saveVersion = localEditVersion;
  let snapshot = cloneValue(state);
  const savingId = online.tournament.id;
  const savingUser = online.session?.user?.id;
  const savingSlug = tournamentSlug();
  try {
    let row;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        row = await DB.saveTournamentState(savingId, snapshot, online.revision);
        break;
      } catch (error) {
        if (!String(error.message || '').includes('revision_conflict')) throw error;
        const latest = await DB.loadTournamentBySlug(savingSlug);
        if (online.tournament?.id !== savingId || online.session?.user?.id !== savingUser || tournamentSlug() !== savingSlug) return;
        const merged = latest?.id === savingId && !dirtyWholeState && !dirtyMatchIds.size && !scoreDrafts.size
          ? mergeRosterState(online.tournament.state, state, latest.state) : null;
        if (!merged || attempt === 2) {
          online.savePaused = true;
          remoteConflict = latest;
          showSaveProblem('Un altro admin ha modificato gli stessi dati o la struttura del torneo. La tua bozza è conservata: scaricala, carica la versione condivisa e riapplica le modifiche necessarie.', true);
          return;
        }
        online.tournament = latest; online.revision = Number(latest.revision);
        state = merged; draftBaseRevision = online.revision;
        snapshot = cloneValue(state); saveVersion = localEditVersion;
        saveLocalState(); paintSharedRoster();
      }
    }

    if (online.tournament?.id !== savingId || online.session?.user?.id !== savingUser) return;
    online.tournament = row;
    online.revision = Number(row.revision);
    clearDirtyTracking(saveVersion);
    if (hasUnsavedLocalChanges()) draftBaseRevision = Number(row.revision);
    saveLocalState();
    hideSaveProblem();
    setConnectionStatus(hasUnsavedLocalChanges() ? 'Nuove modifiche…' : 'Sincronizzato', 'online');
    updateOnlinePanel();
    if (hasUnsavedLocalChanges()) scheduleOnlineSave(350);
  } catch (error) {
    console.error(error);
    setConnectionStatus('Errore salvataggio', 'error');
    showToast(humanizeError(error), 'error');
    showSaveProblem('Le modifiche restano in questo browser e non sono ancora online. Controlla la connessione e riprova.', false);
  } finally {
    online.saving = false;
    renderSaveStatus();
    if (!hasUnsavedLocalChanges()) {
      applyPendingRealtimeIfSafe();
      if (pendingRemoteRefresh && !isEditableControl()) refreshOnlineIfSafe();
    }
  }
}

function humanizeError(error) {
    const raw = String(error?.message || error || 'Errore imprevisto');
    const normalized = raw.toLowerCase();
    const dictionary = [
      ['authentication_required', 'Accedi prima come amministratore.'],
      ['shared_draft_migration_required', 'Per attivare le bozze condivise esegui MIGRATION_SHARED_DRAFT_V13_2.sql nel SQL Editor di Supabase, poi premi Salva modifiche. La bozza resta salvata sul dispositivo.'],
      ['reset_bracket_migration_required', 'Per eliminare il tabellone pubblicato esegui MIGRATION_RESET_BRACKET_V13_3.sql nel SQL Editor di Supabase, poi riprova. Il tabellone è ancora presente.'],
      ['not_allowed', 'Non hai i permessi per questa operazione.'],
      ['owner_required', 'Questa operazione è riservata al proprietario del torneo.'],
      ['slug_already_exists', 'Questo indirizzo è già utilizzato.'],
      ['invalid_slug', 'La chiave torneo può contenere solo lettere minuscole, numeri e trattini.'],
      ['invalid_username', 'Il nome utente deve avere 3–32 caratteri e può contenere lettere minuscole, numeri, punto, trattino e underscore.'],
      ['password_required', 'Inserisci la password.'],
      ['admin_not_found', 'Account amministratore non trovato. Crealo prima in Supabase Authentication → Users.'],
      ['cannot_remove_owner', 'Il proprietario del torneo non può essere rimosso.'],
      ['invalid login credentials', 'Nome utente o password non corretti.'],
      ['invalid_credentials', 'Nome utente o password non corretti.'],
      ['email not confirmed', 'Account non attivato: in Supabase abilita Auto Confirm User per questo amministratore.'],
      ['email_not_confirmed', 'Account non attivato: in Supabase abilita Auto Confirm User per questo amministratore.'],
      ['tournament_structure_locked', 'Torneo avviato: puoi modificare soltanto nomi e punteggi.'],
      ['tournament_roster_locked', 'Le iscrizioni sono bloccate. Puoi correggere soltanto i nomi.'],
      ['tournament_draw_locked', 'Il sorteggio è bloccato perché il torneo è avviato.'],
      ['invalid_tournament_state', 'Dati o backup del torneo non validi.'],
      ['invalid_team', 'Controlla nomi e identificativi delle squadre.'],
      ['invalid_match', 'Controlla dati e punteggi delle partite.'],
      ['duplicate_', 'Sono presenti identificativi duplicati.'],
      ['tournament_started', 'Torneo avviato: puoi modificare soltanto i nomi delle squadre e i punteggi.'],
      ['roster_locked', 'Le iscrizioni sono bloccate perché il torneo è avviato.'],
      ['invalid_state', 'Il backup o i dati del torneo non sono validi.'],
      ['revision_conflict', 'Il torneo è stato modificato da un altro organizzatore.'],
    ];
    const match = dictionary.find(([key]) => normalized.includes(key));
    return match ? match[1] : raw;
  }

  async function loadOnlineTournament({ quiet = false, force = false } = {}) {
    if (!online.configured) return false;
    if (online.creating || online.resetting) return false;
    if (!force && online.accessReady && (scoreDrafts.size || online.saving)) {
      pendingRemoteRefresh = true;
      return false;
    }
    const requestId = ++onlineRequest;
    const requestedSlug = tournamentSlug();
    const accessWasReady = online.accessReady;
    try {
      const row = await DB.loadTournamentBySlug(requestedSlug);
      if (requestId !== onlineRequest || requestedSlug !== tournamentSlug()) return false;
      if (!force && online.accessReady && online.tournament && row?.id === online.tournament.id) {
        if (online.session && Date.now() - online.roleCheckedAt > 30000) {
          const currentRole = await DB.getMyRole(row.id);
          if (requestId !== onlineRequest || requestedSlug !== tournamentSlug()) return false;
          online.roleCheckedAt = Date.now();
          if (currentRole !== online.role) {
            online.role = currentRole;
            online.admins = currentRole ? await DB.listTournamentAdmins(row.id) : [];
            updateAccessUI(); updateOnlinePanel(); renderSaveStatus();
          }
        }
        if (Number(row.revision) <= Number(online.revision ?? -1)) return true;
        handleRealtimeUpdate(row);
        return true;
      }
      if (!force && online.tournament && (isEditableControl() || hasUnsavedLocalChanges())) { pendingRemoteRefresh = true; return false; }
      online.accessReady = true;
      if (!row) {
        if (!force && accessWasReady && !online.tournament && online.session && !isPublicView()) {
          pendingRemoteRefresh = false;
          return false;
        }
        online.tournament = null;
        online.role = null;
        online.revision = null;
        online.admins = [];
        DB.unsubscribe();
        const savedSetup = readSetupDraft();
        state = savedSetup?.state || Engine.createDefaultState();
        setupDraftForm = { name: savedSetup?.form?.name ?? null, slug: savedSetup?.form?.slug ?? null };
        sharedDraftRequested = Boolean(savedSetup && Engine.activeTeams(state).length);
        clearDirtyTracking(localEditVersion);
        showUnavailable(isPublicView() || !online.session ? 'Torneo non disponibile: controlla la chiave e i permessi di accesso.' : 'Nessuna bozza condivisa accessibile con questa chiave. Se il torneo esiste già, chiedi al proprietario di aggiungere il tuo username agli admin. Per un nuovo evento, la prima squadra crea la bozza privata.');
        setConnectionStatus(isPublicView() ? 'Torneo non disponibile' : (online.session ? 'Nuova bozza privata' : 'Login richiesto'));
        renderAll();
        if (sharedDraftRequested) scheduleOnlineSave(600);
        return false;
      }
      const sessionId = online.session?.user?.id;
      const setupToRecover = !online.tournament ? readSetupDraft() : null;
      const role = online.session ? await DB.getMyRole(row.id) : null;
      const admins = role ? await DB.listTournamentAdmins(row.id) : [];
      if (requestId !== onlineRequest || requestedSlug !== tournamentSlug() || sessionId !== online.session?.user?.id) return false;
      online.tournament = row;
      online.revision = Number(row.revision);
      online.role = role;
      online.roleCheckedAt = Date.now();
      online.admins = admins;
      showUnavailable('');
      state = Engine.normalizeState(row.state);
      const restoredDraft = readPendingDraft(row);
      const unsharedDraft = !restoredDraft && setupToRecover && Engine.activeTeams(setupToRecover.state).length
        && (!sameValue(setupToRecover.state.teams, state.teams) || !sameValue(setupToRecover.state.settings, state.settings));
      if (restoredDraft || unsharedDraft) {
        state = Engine.normalizeState(restoredDraft ? restoredDraft.state : setupToRecover.state);
        draftBaseRevision = restoredDraft ? Number(restoredDraft.baseRevision) : -1;
        dirtyWholeState = true;
        localEditVersion += 1;
        if (unsharedDraft || Number(restoredDraft.baseRevision) !== Number(row.revision)) {
          remoteConflict = row; online.savePaused = true;
          showSaveProblem('È presente una bozza non sincronizzata e il torneo online è cambiato. Scarica la bozza prima di caricare la versione online.', true);
        } else {
          showToast('Bozza non sincronizzata recuperata.');
          scheduleOnlineSave(300);
        }
      }
      const migrationPending = Boolean(state.metadata?.migrationNeedsSave);
      const migrationNotice = state.metadata?.migrationNotice || '';
      if (migrationPending) {
        state.metadata.migrationNeedsSave = false;
        state.metadata.updatedAt = new Date().toISOString();
      }
      if (!restoredDraft && !unsharedDraft) {
        lastSavedEditVersion = localEditVersion;
        dirtyWholeState = false;
        dirtyTeamIndexes.clear();
        dirtyMatchIds.clear();
      }
      saveLocalState();
      pendingRemoteRefresh = false;
      DB.subscribeToTournament(row.id, handleRealtimeUpdate);
      sharedDraftRequested = false;
      setConnectionStatus(online.savePaused ? 'Conflitto da risolvere' : (restoredDraft ? 'Bozza recuperata…' : 'Online'), online.savePaused ? 'error' : 'online');
      renderAll();
      if (migrationPending && online.role) {
        dirtyWholeState = true;
        localEditVersion += 1;
        if (migrationNotice) showToast(migrationNotice, 'success');
        scheduleOnlineSave(80);
      }
      return true;
    } catch (error) {
      online.authReady = true;
      console.error(error);
      if (!online.tournament) { online.accessReady = false; state = Engine.createDefaultState(); renderAll(); }
      if (isPublicView()) showUnavailable('Risultati non disponibili. Riconnetti il dispositivo per verificare l’accesso al torneo.');
      setConnectionStatus('Offline', 'error');
      if (!quiet) showToast(humanizeError(error), 'error');
      return false;
    }
  }


function handleRealtimeUpdate(row) {
  if (!row || row.id !== online.tournament?.id || row.slug !== tournamentSlug() || Number(row.revision) <= Number(online.revision ?? -1)) return;
  if (tryApplyRosterUpdate(row)) return;
  if (online.saving || isEditableControl() || scoreDrafts.size || hasUnsavedLocalChanges()) {
    if (!pendingRealtimeRow || Number(row.revision) > Number(pendingRealtimeRow.revision || -1)) {
      pendingRealtimeRow = row;
    }
    setConnectionStatus(hasUnsavedLocalChanges() ? 'Bozza locale…' : 'Aggiornamento in attesa');
    return;
  }
  applyRealtimeRow(row);
}

async function initializeOnline() {
    if (!online.configured) {
      online.authReady = true;
      setConnectionStatus('Locale');
      renderAll();
      restoreSavedScroll(activeTab);
      return;
    }
    try {
      setConnectionStatus('Connessione…');
      DB.init();
      online.session = await DB.getSession();
      online.authReady = true;
      DB.onAuthStateChange((_event, session) => {
        // Leave Supabase's auth callback before making any authenticated requests.
        setTimeout(async () => {
          if (loginInProgress) return;
          if (_event === 'TOKEN_REFRESHED' && session?.user?.id === online.session?.user?.id) { online.session = session; return; }
          rememberCurrentScroll();
          online.authReady = true;
          const userChanged = online.session?.user?.id !== session?.user?.id;
          online.session = session;
          if (!session || userChanged) { online.role = null; online.admins = []; online.accessReady = false; }
          if (!session) { DB.unsubscribe(); state = Engine.createDefaultState(); clearDirtyTracking(localEditVersion); scoreDrafts.clear(); }
          await preserveUiAround(() => loadOnlineTournament({ quiet: true, force: !session }));
          if (!isPublicView() && !session) switchTab('more', { restore: true });
        }, 0);
      });
      await preserveUiAround(() => loadOnlineTournament({ quiet: true }));
      if (!isPublicView() && !online.session) switchTab('more', { restore: true });
      else restoreSavedScroll(activeTab);
    } catch (error) {
      online.authReady = true;
      console.error(error);
      setConnectionStatus('Offline', 'error');
      renderAll();
      restoreSavedScroll(activeTab);
    }
  }

  function switchTab(tabId, options = {}) {
    if (isPublicView()) tabId = 'live';
    else if (online.configured && online.authReady && !online.session) tabId = 'more';
    if (!$(tabId) || !VALID_TABS.has(tabId)) return;
    const { restore = true, updateUrl = true, persist = true } = options;
    if (activeTab && activeTab !== tabId) rememberCurrentScroll();
    activeTab = tabId;
    if ($('currentViewLabel')) $('currentViewLabel').textContent = VIEW_LABELS[tabId];
    $$('.view').forEach((view) => view.classList.toggle('active', view.id === tabId));
    $$('.nav-item').forEach((button) => {
      const selected = button.dataset.tab === tabId;
      button.classList.toggle('active', selected);
      if (selected) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    if (tabId === 'teams') renderTeamRows();
    if (tabId === 'matches') renderMatches();
    if (tabId === 'live') {
      renderLive();
      switchLiveView(activeLiveView, { persist: false });
    }
    if (tabId === 'more') updateOnlinePanel();
    if (persist) writeUiState({ activeTab, activeLiveView });
    if (updateUrl) updateTabInUrl(tabId);
    if (restore) restoreSavedScroll(tabId);
  }

  function ensureEditable() {
    if (online.resetting) { showToast('Attendi il completamento dell’eliminazione del tabellone.', 'error'); return false; }
    if (canEdit()) return true;
    showToast('Questa è una vista in sola lettura.', 'error');
    return false;
  }

  function renderAll() {
    const tabBefore = activeTab;
    const scrollBefore = Math.max(0, Math.round(window.scrollY || 0));
    updateAccessUI();
    renderHeader();
    renderDashboard();
    renderSetup();
    renderMatches();
    renderLive();
    updateOnlinePanel();
    renderSaveStatus();
    $('demoNotice').classList.toggle('hidden', online.configured);
    $('demoNotice').textContent = isPublicView() ? 'Anteprima locale · questi dati sono visibili solo in questo browser. Configura Supabase per un Live condiviso.' : 'Modalità locale · i dati restano in questo browser. Configura Supabase per condividere il torneo e abilitare gli admin.';
    restoreUiControls();
    if (activeTab === 'matches') renderMatches();
    if (activeTab === 'live') switchLiveView(activeLiveView, { persist: false });
    if (activeTab === tabBefore) restoreScrollValue(tabBefore, scrollBefore);
  }

  function updateAccessUI() {
    const publicMode = isPublicView();
    document.body.classList.toggle('public-mode', publicMode);
    $$('.editor-only').forEach((element) => element.classList.toggle('hidden', !canEdit()));
    $$('.owner-only').forEach((element) => element.classList.toggle('hidden', !isOwner()));
    $$('.hide-public').forEach((element) => element.classList.toggle('hidden', publicMode));
    const autoNavigationAllowed = Date.now() >= suppressAutoNavigationUntil;
    if (publicMode && activeTab !== 'live') switchTab('live');
    else if (autoNavigationAllowed && online.authReady && !canEdit() && ['setup', 'teams', 'matches'].includes(activeTab)) switchTab('live');
    const loginMode = online.configured && online.authReady && !publicMode && !online.session;
    document.body.classList.toggle('login-mode', loginMode);
    if (autoNavigationAllowed && loginMode && activeTab !== 'more') switchTab('more');
    const role = online.role === 'owner'
      ? 'Proprietario'
      : online.role === 'editor'
        ? 'Amministratore'
        : online.tournament
          ? 'Sola lettura'
          : !online.authReady && online.configured
            ? 'Connessione…'
            : loginMode
              ? 'Login richiesto'
              : 'Modalità locale';
    if ($('roleBadge')) $('roleBadge').textContent = role;
    if ($('onlineRole')) $('onlineRole').textContent = role;
  }

  function renderHeader() {
    const title = state.settings.tournamentName || 'Beach & Chill Monopoli Vibes';
    $('appTitle').textContent = title;
    $('formatBadge').textContent = state.matches.length ? Engine.formatLabel(state.settings.format) : 'Tournament Manager';
    if ($('publicTournamentName')) $('publicTournamentName').textContent = title;
  }

  function renderDashboard() {
    const active = Engine.activeTeams(state);
    const estimate = Engine.estimateMatches(state);
    const progress = Engine.tournamentProgress(state);
    const current = Engine.currentStageMatches(state);
    const pending = state.matches.filter((match) => Engine.matchStatus(match) === 'DA GIOCARE').length;
    const stageDone = state.matches.length && Engine.stageComplete(state);

    if ($('heroEventLabel')) {
      $('heroEventLabel').textContent = state.settings.eventDate
        ? new Date(`${state.settings.eventDate}T12:00:00`).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })
        : 'La tua giornata di beach volley';
    }
    $('heroFormat').textContent = Engine.formatLabel(state.settings.format);
    $('heroPhase').textContent = Engine.phaseLabel(state);
    $('progressValue').textContent = `${progress.percent}%`;
    $('progressRing').style.setProperty('--progress', `${progress.percent * 3.6}deg`);
    $('kpiTeams').textContent = active.length;
    $('kpiMatches').textContent = estimate.minimum ? (estimate.minimum === estimate.maximum ? estimate.minimum : `${estimate.minimum}–${estimate.maximum}`) : 0;
    $('kpiPending').textContent = pending;
    $('kpiCourts').textContent = state.settings.courts;

    const button = $('primaryActionBtn');
    if (!state.matches.length) {
      $('primaryActionTitle').textContent = active.length ? 'Pronti per la prima battuta?' : 'Il tuo torneo inizia qui.';
      $('primaryActionHint').textContent = active.length
        ? `${active.length} coppie in elenco. Completa la configurazione e porta il torneo in campo.`
        : 'Scegli la formula, aggiungi le coppie e dai il via alla tua giornata in campo.';
      button.textContent = 'Apri configurazione';
      button.dataset.action = 'setup';
    } else if (Engine.tournamentComplete(state)) {
      $('primaryActionTitle').textContent = 'Una giornata da ricordare.';
      $('primaryActionHint').textContent = state.silverChampionId
        ? `Gold: ${Engine.team(state, state.championId)?.name || '—'} · Silver: ${Engine.team(state, state.silverChampionId)?.name || '—'}.`
        : `Campione: ${Engine.team(state, state.championId)?.name || '—'}.`;
      button.textContent = 'Apri riepilogo Live';
      button.dataset.action = 'live';
    } else if (stageDone) {
      const playoffPending = state.settings.format === Engine.FORMATS.GROUPS_PLAYOFF
        && !state.matches.some((match) => ['K', 'S'].includes(match.bracket));
      $('primaryActionTitle').textContent = playoffPending ? 'Fase a gironi completata' : 'Turno completato';
      $('primaryActionHint').textContent = playoffPending
        ? `Le classifiche sono pronte. È il momento dei playoff${state.settings.formatOptions.silverEnabled ? ' Gold e Silver' : ' Gold'}.`
        : 'Tutti i risultati sono salvati. Puoi generare la fase successiva.';
      button.textContent = playoffPending ? (state.settings.formatOptions.silverEnabled ? 'Genera Gold + Silver' : 'Genera playoff Gold') : 'Genera fase successiva';
      button.dataset.action = 'advance';
    } else {
      $('primaryActionTitle').textContent = 'Il torneo entra nel vivo.';
      const readyCount = current.filter((match) => Engine.matchStatus(match) === 'DA GIOCARE').length;
      $('primaryActionHint').textContent = `${readyCount} ${readyCount === 1 ? 'partita da giocare' : 'partite da giocare'} in questa fase. Aggiorna i punteggi e segui ogni sfida.`;
      button.textContent = 'Gestisci partite';
      button.dataset.action = 'matches';
    }

    $('planTitle').textContent = Engine.formatLabel(state.settings.format);
    $('planDescription').textContent = Engine.formatSummary(state);
    const capacity = singleDayCapacity();
    const eventLabel = state.settings.eventDate
      ? new Date(`${state.settings.eventDate}T12:00:00`).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' })
      : 'Giornata unica';
    $('planMetrics').innerHTML = [
      ['Partite garantite', `${estimate.guaranteed} per coppia`],
      ['Partite complessive', estimate.minimum === estimate.maximum ? `${estimate.minimum}` : `${estimate.minimum}–${estimate.maximum}`],
      ['Data', eventLabel],
      ['Finestra gara', `${state.settings.dayStart}–${state.settings.dayEnd}`],
      ['Campi', `${state.settings.courts}`],
      ['Capacità teorica', capacity ? `${capacity.totalSlots} slot` : 'Da verificare'],
    ].map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('');

    renderNextMatches($('nextMatches'), 5, true);

    const champion = Engine.team(state, state.championId);
    const silverChampion = Engine.team(state, state.silverChampionId);
    $('championCard').classList.toggle('hidden', !champion);
    if (champion) $('championName').textContent = champion.name;
    $('silverChampionCard').classList.toggle('hidden', !silverChampion);
    if (silverChampion) $('silverChampionName').textContent = silverChampion.name;

    const hasGroups = state.groups.length > 0;
    $('groupPreviewCard').classList.toggle('hidden', !hasGroups);
    if (hasGroups) renderStandings($('dashboardStandings'), true);

    const showByes = state.settings.format === Engine.FORMATS.DOUBLE_ELIMINATION;
    $('byeCard').classList.toggle('hidden', !showByes);
    if (showByes) renderByeSummary();
  }

  function renderNextMatches(container, limit = 5, dashboard = false) {
    const stage = Engine.currentStage(state);
    const matches = state.matches
      .filter((match) => match.stage === stage && Engine.matchStatus(match) === 'DA GIOCARE')
      .sort((a, b) => a.order - b.order)
      .slice(0, limit);
    if (!matches.length) {
      const editableDashboard = dashboard && canEdit();
      const complete = Boolean(state.matches.length && Engine.tournamentComplete(state));
      const title = !state.matches.length
        ? (editableDashboard ? 'Il campo ti aspetta' : 'Il programma è in arrivo')
        : (complete ? 'Torneo concluso' : 'Nessuna partita pronta');
      const hint = !state.matches.length
        ? (editableDashboard ? 'Aggiungi le coppie e genera il torneo per vedere qui le prime sfide.' : 'L’organizzazione sta preparando le prime sfide.')
        : complete
          ? 'Consulta risultati, classifiche e tabellone nella vista Live.'
          : (editableDashboard ? 'Controlla i risultati del turno e genera la fase successiva.' : 'La prossima fase sarà pubblicata dall’organizzazione.');
      container.innerHTML = `<div class="empty-state"><svg class="empty-state-icon" viewBox="0 0 80 64" fill="none" aria-hidden="true"><path d="M12 24 50 16l20 23-39 13L12 24Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="m32 20 20 26M28 18v23m32-28v24M28 18l32-5v18l-32 10V18Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="m36 16 1 22m7-24 1 21m7-23 1 21m-25-9 32-8m-32 16 32-9" stroke="currentColor" stroke-width=".75" opacity=".45"/><circle cx="17" cy="12" r="5" stroke="currentColor" stroke-width="1.6"/><path d="M14 8c3 3 5 3 7 3M13 15c2-2 3-4 3-7" stroke="currentColor" stroke-width="1"/></svg><div><strong>${title}</strong><span>${hint}</span></div></div>`;
      return;
    }
    const actionable = dashboard && canEdit();
    container.innerHTML = matches.map((match) => {
      const a = Engine.team(state, match.aId)?.name || 'Da definire';
      const b = Engine.team(state, match.bId)?.name || 'Da definire';
      const location = [match.court, match.startTime].filter(Boolean).join(' · ') || 'Campo/orario da assegnare';
      return `<article class="next-match${actionable ? ' is-actionable' : ''}" data-match-id="${escapeAttr(match.id)}"${actionable ? ` role="button" tabindex="0" aria-label="${escapeAttr(`Gestisci ${match.id}: ${a} contro ${b}`)}"` : ''}><span class="code">${escapeHtml(match.id)}</span><div class="pair"><strong>${escapeHtml(a)}</strong><small>vs ${escapeHtml(b)}</small></div><span class="location">${escapeHtml(location)}</span></article>`;
    }).join('');
    if (actionable) {
      $$('.next-match', container).forEach((card) => {
        card.addEventListener('click', () => switchTab('matches'));
        card.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          switchTab('matches');
        });
      });
    }
  }

  function renderByeSummary() {
    const top = [1, 2, 3].map((rank) => Engine.activeTeams(state).find((item) => Number(item.seed) === rank));
    $('byeSummary').innerHTML = top.map((item, index) => `<article><span>TS${index + 1}${item ? ` · ${escapeHtml(item.name)}` : ''}</span><strong>${item?.byes || 0}</strong><small>bye ricevuti</small></article>`).join('');
    const priority = Engine.nextByePriority(state);
    $('nextByeLabel').textContent = priority ? `Prossima priorità: TS${priority.rank}` : 'Prossima priorità: automatica';
    const history = state.settings.byePolicy.history || [];
    $('byeHistory').innerHTML = history.length
      ? history.map((entry) => `<p><strong>${escapeHtml(Engine.team(state, entry.teamId)?.name || 'Coppia')}</strong> · ${escapeHtml(entry.reason || entry.kind)}</p>`).join('')
      : '<p>Nessun bye assegnato.</p>';
  }

  function renderSetup() {
    renderFormatSelector();
    renderTeamRows();
    renderManualGroupBoard();
    const locked = tournamentStarted();
    $('tournamentNameInput').value = state.settings.tournamentName;
    $('tournamentNameInput').disabled = locked;
    $('courtsInput').value = state.settings.courts;
    $('courtsInput').disabled = locked;
    $('slotMinutesInput').value = state.settings.slotMinutes;
    $('slotMinutesInput').disabled = locked;
    $('eventDateInput').value = state.settings.eventDate || '';
    $('eventDateInput').disabled = locked;
    $('dayStartInput').value = state.settings.dayStart || '08:45';
    $('dayStartInput').disabled = locked;
    $('dayEndInput').value = state.settings.dayEnd || '18:00';
    $('dayEndInput').disabled = locked;
    $('drawCodeInput').value = state.settings.draw.code || '';
    const manualDraw = state.settings.format === Engine.FORMATS.GROUPS_PLAYOFF
      && state.settings.formatOptions.groupAssignmentMode === 'manual';
    $('drawCodeInput').disabled = locked || manualDraw;
    $('drawCodeInput').placeholder = manualDraw ? 'Non necessario: gironi manuali' : 'Generato automaticamente';
    $('groupCountInput').value = state.settings.formatOptions.groupCount;
    $('playoffSizeInput').value = state.settings.formatOptions.playoffSize;
    $('protectGroupWinnersInput').checked = Boolean(state.settings.formatOptions.protectGroupWinners);
    updatePlayoffStructureHint();
    $('groupAssignmentModeInput').value = state.settings.formatOptions.groupAssignmentMode;
    $('silverEnabledInput').checked = Boolean(state.settings.formatOptions.silverEnabled);
    $('silverSizeInput').value = state.settings.formatOptions.silverSize;
    $('groupMatchRuleInput').value = state.settings.formatOptions.groupMatchRule;
    $('quarterMatchRuleInput').value = state.settings.formatOptions.quarterMatchRule;
    $('semifinalMatchRuleInput').value = state.settings.formatOptions.semifinalMatchRule;
    $('eliminationMatchRuleInput').value = state.settings.formatOptions.eliminationMatchRule;
    $('groupCountInput').disabled = locked;
    $('playoffSizeInput').disabled = locked;
    $('protectGroupWinnersInput').disabled = locked || Number(state.settings.formatOptions.groupCount) !== 2;
    $('groupAssignmentModeInput').disabled = locked;
    $('silverEnabledInput').disabled = locked;
    $('silverSizeInput').disabled = locked;
    $('groupMatchRuleInput').disabled = locked;
    $('quarterMatchRuleInput').disabled = locked;
    $('semifinalMatchRuleInput').disabled = locked;
    $('eliminationMatchRuleInput').disabled = locked;
    updateSetupDerived();
  }

  function renderFormatSelector() {
    const locked = tournamentStarted();
    $$('#formatSelector .format-card').forEach((card) => {
      card.classList.toggle('selected', card.dataset.format === state.settings.format);
      card.disabled = locked;
    });
    const groupBased = [Engine.FORMATS.GROUPS_PLAYOFF, Engine.FORMATS.ROUND_ROBIN_FINAL4].includes(state.settings.format);
    const knockoutBased = [Engine.FORMATS.DOUBLE_ELIMINATION, Engine.FORMATS.SINGLE_ELIMINATION].includes(state.settings.format);
    const groupsPlayoff = state.settings.format === Engine.FORMATS.GROUPS_PLAYOFF;
    const manualGroups = groupsPlayoff && state.settings.formatOptions.groupAssignmentMode === 'manual';
    $('groupOptions').classList.toggle('hidden', !groupsPlayoff);
    $('groupRuleOptions').classList.toggle('hidden', !groupBased);
    $('knockoutRuleOptions').classList.toggle('hidden', !knockoutBased);
    $('silverSizeField').classList.toggle('hidden', !groupsPlayoff || !state.settings.formatOptions.silverEnabled);
    $('manualGroupsPanel').classList.toggle('hidden', !manualGroups);
    $('manualGroupBoard')?.classList.toggle('hidden', !manualGroups);
    $('manualGroupHeader').classList.toggle('hidden', !manualGroups);
    document.body.classList.toggle('manual-groups-mode', manualGroups);
  }

  function updatePlayoffStructureHint() {
    const element = $('playoffStructureHint');
    if (!element) return;
    const size = Number(state.settings.formatOptions.playoffSize);
    const protectedWinners = Boolean(state.settings.formatOptions.protectGroupWinners)
      && Number(state.settings.formatOptions.groupCount) === 2;
    const protectedDescriptions = {
      4: '4 squadre · semifinali crossover: 1ª A–2ª B e 1ª B–2ª A.',
      6: '6 squadre · vincitrici dei gironi direttamente in semifinale; 2ª e 3ª ai quarti.',
      8: '8 squadre · vincitrici dei gironi direttamente in semifinale; 2ª ai quarti; 3ª e 4ª al preliminare.',
    };
    const standardDescriptions = {
      4: '4 squadre · semifinali e finale.',
      6: '6 squadre · attiva la protezione delle vincitrici dei gironi.',
      8: '8 squadre · tutte le qualificate partono dai quarti.',
    };
    element.textContent = (protectedWinners ? protectedDescriptions : standardDescriptions)[size] || '';
  }

  function manualGroupOptions(selected = null, includeUnassigned = true) {
    const count = Number(state.settings.formatOptions.groupCount);
    const options = [];
    if (includeUnassigned) options.push(`<option value=""${selected ? '' : ' selected'}>Non assegnata</option>`);
    for (let index = 1; index <= count; index += 1) {
      options.push(`<option value="${index}"${Number(selected) === index ? ' selected' : ''}>Girone ${String.fromCharCode(64 + index)}</option>`);
    }
    return options.join('');
  }

  function renderManualGroupBoard() {
    const board = $('manualGroupBoard');
    if (!board) return;
    const manual = state.settings.format === Engine.FORMATS.GROUPS_PLAYOFF
      && state.settings.formatOptions.groupAssignmentMode === 'manual';
    board.classList.toggle('hidden', !manual);
    if (!manual) {
      board.innerHTML = '';
      return;
    }

    const locked = tournamentStarted();
    const groupCount = Number(state.settings.formatOptions.groupCount);
    const active = Engine.activeTeams(state);
    const groups = Array.from({ length: groupCount }, (_, index) => ({
      number: index + 1,
      name: `Girone ${String.fromCharCode(65 + index)}`,
      teams: [],
    }));
    const unassigned = [];
    active.forEach((item) => {
      const groupNumber = Number(item.manualGroup);
      if (Number.isInteger(groupNumber) && groupNumber >= 1 && groupNumber <= groupCount) groups[groupNumber - 1].teams.push(item);
      else unassigned.push(item);
    });

    const teamChip = (item) => {
      const teamIndex = state.teams.findIndex((candidate) => candidate.id === item.id);
      const seed = item.seed ? `<span class="manual-team-seed">TS ${escapeHtml(item.seed)}</span>` : '';
      return `<article class="manual-team-chip" data-team-index="${teamIndex}" draggable="${locked ? 'false' : 'true'}">
        <span class="manual-team-grip" aria-hidden="true">⠿</span>
        <span class="manual-team-copy"><strong>${escapeHtml(item.name)}</strong>${seed}</span>
        <select class="manual-board-select" aria-label="Sposta ${escapeAttr(item.name)}" ${locked ? 'disabled' : ''}>${manualGroupOptions(item.manualGroup)}</select>
      </article>`;
    };

    const groupCards = groups.map((group) => {
      const warning = group.teams.length < 2 ? '<small class="manual-group-warning">Servono almeno 2 coppie</small>' : `<small>${group.teams.length} coppie</small>`;
      return `<section class="manual-group-card" data-group-number="${group.number}">
        <header><div><span>${group.name}</span>${warning}</div><strong>${group.teams.length}</strong></header>
        <div class="manual-group-dropzone" data-group-number="${group.number}">${group.teams.length ? group.teams.map(teamChip).join('') : '<p>Trascina qui una coppia</p>'}</div>
      </section>`;
    }).join('');

    board.innerHTML = `<section class="manual-group-card unassigned" data-group-number="0">
      <header><div><span>Da assegnare</span><small>${unassigned.length ? 'Completa la composizione' : 'Tutte assegnate'}</small></div><strong>${unassigned.length}</strong></header>
      <div class="manual-group-dropzone" data-group-number="0">${unassigned.length ? unassigned.map(teamChip).join('') : '<p>Nessuna coppia in attesa</p>'}</div>
    </section>${groupCards}`;

    if (locked) return;

    const moveTeam = (teamIndex, groupNumber) => {
      const item = state.teams[teamIndex];
      if (!item) return;
      item.manualGroup = groupNumber > 0 ? groupNumber : null;
      item.updatedAt = new Date().toISOString();
      noteLocalEdit({wholeState:true});
      renderAll();
    };

    $$('.manual-board-select', board).forEach((select) => {
      select.addEventListener('change', (event) => {
        const chip = event.target.closest('.manual-team-chip');
        moveTeam(Number(chip.dataset.teamIndex), Number(event.target.value || 0));
      });
    });

    $$('.manual-team-chip', board).forEach((chip) => {
      chip.addEventListener('dragstart', (event) => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', chip.dataset.teamIndex);
        chip.classList.add('dragging');
      });
      chip.addEventListener('dragend', () => chip.classList.remove('dragging'));
    });

    $$('.manual-group-dropzone', board).forEach((zone) => {
      zone.addEventListener('dragover', (event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        zone.classList.add('drag-over');
      });
      zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
      zone.addEventListener('drop', (event) => {
        event.preventDefault();
        zone.classList.remove('drag-over');
        moveTeam(Number(event.dataTransfer.getData('text/plain')), Number(zone.dataset.groupNumber || 0));
      });
    });
  }

  function renderTeamRows() {
    const body = $('teamRows');
    const locked = tournamentStarted();
    const editable = canEdit();
    const manualGroups = state.settings.format === Engine.FORMATS.GROUPS_PLAYOFF
      && state.settings.formatOptions.groupAssignmentMode === 'manual';
    const groupCount = Number(state.settings.formatOptions.groupCount);
    const options = '<option value="">—</option>' + Array.from({length:groupCount},(_,i)=>`<option value="${i+1}">Girone ${String.fromCharCode(65+i)}</option>`).join('');
    const query = ($('teamSearch')?.value || '').trim().toLocaleLowerCase('it');
    $('teamCountBadge').textContent = `${Engine.activeTeams(state).length} / 24 coppie`;
    $('rosterLockNotice').querySelector('p').textContent = locked
      ? 'Iscrizioni chiuse · puoi correggere i nomi in qualsiasi fase. Coppie, teste di serie e gironi restano quelli dell’avvio.'
      : 'Iscrizioni aperte · inserisci i nomi delle coppie. Per rimuovere una coppia svuota il nome; le righe vuote non partecipano.';
    $('bulkImportPanel').classList.toggle('hidden', locked || !editable);
    $('loadDefaultsBtn').disabled = locked || !editable;
    $('clearTeamsBtn').disabled = locked || !editable;
    if ($('clearBulkBtn')) $('clearBulkBtn').disabled = locked || !editable;
    $('loadDefaultsBtn').classList.toggle('hidden',locked || !editable);
    $('clearTeamsBtn').classList.toggle('hidden',locked || !editable);
    $('clearBulkBtn')?.classList.toggle('hidden',locked || !editable);
    body.innerHTML = state.teams.map((item,index) => {
      if ((locked && !item.name.trim()) || (query && !item.name.toLocaleLowerCase('it').includes(query))) return '';
      const status = item.name.trim() ? (item.seed ? `TS ${item.seed}` : 'Iscritta') : 'Disponibile';
      return `<tr data-team-index="${index}"><td>${index+1}</td><td><input class="team-name-input" aria-label="Nome coppia ${index+1}" maxlength="120" value="${escapeAttr(item.name)}" placeholder="Giocatore 1 – Giocatore 2" ${editable ? '' : 'disabled'} /></td><td><input class="seed-input" aria-label="Testa di serie coppia ${index+1}" type="number" min="1" max="24" inputmode="numeric" value="${item.seed ?? ''}" placeholder="—" ${locked || !editable ? 'disabled' : ''} /></td><td class="manual-group-column ${manualGroups ? '' : 'hidden'}"><select aria-label="Girone coppia ${index+1}" class="manual-group-select" ${locked || !editable ? 'disabled' : ''}>${options}</select></td><td><span class="row-status ${item.name.trim() ? '' : 'empty'}">${status}</span></td></tr>`;
    }).join('');
    $$('#teamRows tr').forEach((row) => {
      const index = Number(row.dataset.teamIndex);
      const name = row.querySelector('.team-name-input');
      const select = row.querySelector('.manual-group-select');
      select.value = state.teams[index].manualGroup || '';
      const updateName = (event) => {
        if (!ensureEditable()) return;
        const value = event.target.value;
        if (locked && (!value.trim() || state.teams.some((item,i)=>i!==index && item.name.trim().toLocaleLowerCase('it')===value.trim().toLocaleLowerCase('it')))) {
          if (event.type === 'change') {
            event.target.value = state.teams[index].name;
            showToast('Usa un nome non vuoto e diverso dalle altre coppie.', 'error');
          }
          return;
        }
        if (state.teams[index].name === value) return;
        state.teams[index].name = value;
        state.teams[index].updatedAt = new Date().toISOString();
        updateRowStatus(row,state.teams[index]);
        noteLocalEdit({teamIndex:index});
        $('teamCountBadge').textContent = `${Engine.activeTeams(state).length} / 24 coppie`;
        if (!locked) { scheduleManualBoardRender(); updateSetupDerived(); }
        renderHeader(); renderDashboard(); renderLive();
      };
      name.addEventListener('input',updateName);
      if (locked) name.addEventListener('change',updateName);
      name.addEventListener('change', () => {
        if (!canEdit()) return;
        if (online.tournament) flushOnlineSave();
        else scheduleOnlineSave(0);
      });
      row.querySelector('.seed-input').addEventListener('change',(event)=>{
        if (!ensureRosterEditable()) return;
        const value = event.target.value.trim();
        const seed = value === '' ? null : Number(value);
        if (seed !== null && (!Number.isInteger(seed) || seed<1 || seed>24)) {
          event.target.value = state.teams[index].seed ?? ''; showToast('TS: inserisci un intero da 1 a 24.', 'error'); return;
        }
        state.teams[index].seed=seed; state.teams[index].updatedAt=new Date().toISOString();
        updateRowStatus(row,state.teams[index]);noteLocalEdit({teamIndex:index,delay:0});updateSetupDerived();scheduleManualBoardRender();
      });
      select.addEventListener('change',(event)=>{
        if (!ensureRosterEditable()) return;
        state.teams[index].manualGroup = event.target.value ? Number(event.target.value) : null;
        state.teams[index].updatedAt=new Date().toISOString();noteLocalEdit({teamIndex:index,delay:0});updateSetupDerived();scheduleManualBoardRender();
      });
    });
  }

  function updateRowStatus(row, item) {
    const badge = row.querySelector('.row-status');
    const manualGroups = state.settings.format === Engine.FORMATS.GROUPS_PLAYOFF
      && state.settings.formatOptions.groupAssignmentMode === 'manual';
    const groupLabel = manualGroups && item.manualGroup
      ? ` · ${String.fromCharCode(64 + Number(item.manualGroup))}`
      : '';
    badge.textContent = item.name.trim() ? (item.seed ? `TS ${item.seed}${groupLabel}` : `Iscritta${groupLabel}`) : 'Vuota';
    badge.className = `row-status ${item.name.trim() ? '' : 'empty'}`;
  }


  function cleanBulkTeamName(value) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .replace(/\s+[-–—]\s+/g, ' - ')
      .replace(/^[•·*-]\s*/, '')
      .trim();
  }

  function groupLetterToNumber(letter) {
    if (!letter) return null;
    const value = String(letter).trim().toUpperCase();
    if (!/^[A-H]$/.test(value)) return null;
    const code = value.charCodeAt(0);
    if (Number.isNaN(code) || code < 65 || code > 72) return null;
    return code - 64;
  }

  function parseBulkTeams(text, { useNumbersAsSeeds = false } = {}) {
    const maxTeams = Number(state.settings.maxTeams || 24);
    const lines = String(text || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const parsed = [];
    parsed.issues = [];
    const seen = new Set();

    for (let rawLine of lines) {
      let line = rawLine
        .replace(/\u00a0/g, ' ')
        .replace(/[“”]/g, '"')
        .replace(/[’]/g, "'")
        .trim();

      if (!line) continue;

      let manualGroup = null;
      let groupMatch = line.match(/^\s*\[([A-H])\]\s*(.+)$/i);
      if (groupMatch) {
        manualGroup = groupLetterToNumber(groupMatch[1]);
        line = groupMatch[2].trim();
      }

      groupMatch = line.match(/^girone\s+([A-H])\s*[:\-]\s*(.+)$/i);
      if (groupMatch) {
        manualGroup = groupLetterToNumber(groupMatch[1]);
        line = groupMatch[2].trim();
      }

      groupMatch = line.match(/^(.+?)\s*\(([A-H])\)\s*$/i);
      if (groupMatch) {
        manualGroup = groupLetterToNumber(groupMatch[2]);
        line = groupMatch[1].trim();
      }

      let rank = null;
      let seed = null;

      const delimited = line.split(/\t|;/).map((part) => part.trim());
      if (delimited.length >= 2) {
        if (/^(?:#|n\.?|numero|posizione|nome(?:\s+(?:coppia|squadra))?|squadra|coppia|giocatore\s*1)$/i.test(delimited[0])
          && delimited.slice(1).some(value=>/^(?:ts|seed|girone|giocatore\s*2|nome(?:\s+(?:coppia|squadra))?)$/i.test(value))) continue;
        const cells = [...delimited];
        if (/^\d{1,3}$/.test(cells[0])) rank = Number(cells.shift());
        line = cells.shift() || '';
        // A two-column player list represents one pair, not a truncated first name.
        if (cells[0] && !/^\d{1,3}$/.test(cells[0])) line += ` - ${cells.shift()}`;
        else if (cells[0] === '') cells.shift();
        if (cells[0] && /^\d{1,3}$/.test(cells[0])) seed = Number(cells.shift());
        if (cells[0]) {
          const group = groupLetterToNumber(cells.shift());
          if (group) manualGroup = group;
          else parsed.issues.push(`Colonna non riconosciuta per “${line}”. Usa nome; TS; girone o giocatore 1; giocatore 2; TS; girone.`);
        }
        if (cells.some(Boolean)) parsed.issues.push(`Troppe colonne per “${line}”.`);
      }

      const numbered = line.match(/^\s*(?:#)?(\d{1,2})\s*[\).\-\u2013\u2014:]?\s+(.+)$/);
      if (numbered && numbered[2]) {
        rank = rank || Number(numbered[1]);
        line = numbered[2].trim();
      }

      const explicitSeed = line.match(/^(?:TS|testa\s*di\s*serie)\s*(\d{1,2})\s*[\).\-\u2013\u2014:]?\s+(.+)$/i);
      if (explicitSeed) {
        seed = Number(explicitSeed[1]);
        line = explicitSeed[2].trim();
      }

      line = cleanBulkTeamName(line);
      if (!line || /^[-–—]+$/.test(line)) continue;

      const key = line.toLowerCase();
      if (seen.has(key)) parsed.issues.push(`Nome duplicato: ${line}.`);
      seen.add(key);
      if (line.length > 120) parsed.issues.push(`Nome troppo lungo: massimo 120 caratteri.`);
      const finalSeed = seed !== null ? seed : (useNumbersAsSeeds && rank ? rank : null);
      if (finalSeed !== null && (finalSeed < 1 || finalSeed > maxTeams)) parsed.issues.push(`Testa di serie non valida per ${line}: usa 1–${maxTeams}.`);
      parsed.push({
        name: line,
        seed: finalSeed && finalSeed >= 1 && finalSeed <= maxTeams ? finalSeed : null,
        manualGroup,
      });


    }

    if (parsed.length > maxTeams) parsed.issues.push(`Hai inserito ${parsed.length} coppie: il massimo è ${maxTeams}. Nessuna coppia verrà scartata automaticamente.`);
    return parsed;
  }


  function placeholderPlayerCode(position) {
    let value = Math.max(1, Number(position) || 1);
    let code = '';
    while (value > 0) {
      value -= 1;
      code = String.fromCharCode(65 + (value % 26)) + code;
      value = Math.floor(value / 26);
    }
    return code;
  }

  function buildExampleTeamsTemplate(pairCount = 12) {
    const count = Math.max(2, Math.min(24, Number(pairCount) || 12));
    return Array.from({ length: count }, (_, index) => {
      const first = placeholderPlayerCode(index * 2 + 1);
      const second = placeholderPlayerCode(index * 2 + 2);
      return `${index + 1} Giocatore ${first} - Giocatore ${second}`;
    }).join('\n');
  }

  function loadExampleTeamsTemplate() {
    const textarea = $('bulkTeamsInput');
    const panel = $('bulkImportPanel');
    if (!textarea || !panel) {
      showToast('Area copia-incolla non disponibile. Ricarica la pagina.', 'error');
      return;
    }

    // Il pulsante deve sempre mostrare il template: questa operazione non modifica
    // le squadre salvate finché l'utente non preme esplicitamente “Carica squadre”.
    textarea.value = buildExampleTeamsTemplate(12);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    if ($('bulkUseNumbersAsSeeds')) $('bulkUseNumbersAsSeeds').checked = false;
    panel.open = true;
    panel.setAttribute('open', '');
    renderBulkPreview();

    requestAnimationFrame(() => {
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      textarea.focus({ preventScroll: true });
      textarea.setSelectionRange(0, 0);
    });

    const suffix = state.matches.length
      ? ' Il template è stato caricato, ma per sostituire le squadre devi prima eliminare il tabellone corrente o creare un nuovo torneo.'
      : '';
    showToast(`Template caricato: sostituisci i nomi e premi “Carica squadre”.${suffix}`, state.matches.length ? 'info' : 'success');
  }

  function clearBulkTeamsDraft() {
    clearTimeout(window.__bulkPreviewTimer);
    $('bulkTeamsInput').value = '';
    $('bulkUseNumbersAsSeeds').checked = false;
    renderBulkPreview();
    showToast('Box e anteprima svuotati.', 'success');
  }

  function renderBulkPreview() {
    const textarea = $('bulkTeamsInput');
    const list = $('bulkPreviewList');
    const count = $('bulkPreviewCount');
    if (!textarea || !list || !count) return [];
    const useNumbersAsSeeds = Boolean($('bulkUseNumbersAsSeeds')?.checked);
    const parsed = parseBulkTeams(textarea.value, { useNumbersAsSeeds });
    count.textContent = `${parsed.length} ${parsed.length === 1 ? 'coppia' : 'coppie'}`;
    $('bulkApplyBtn').disabled = !parsed.length || Boolean(parsed.issues.length) || tournamentStarted() || !canEdit();
    if (!parsed.length) {
      list.innerHTML = textarea.value.trim() ? '<p>Nessuna coppia riconosciuta.</p>' : '<p>Incolla un elenco o carica un esempio.</p>';
      return parsed;
    }
    list.innerHTML = (parsed.issues.length ? `<p class="invalid-score">${parsed.issues.slice(0,8).map(escapeHtml).join('<br>')}</p>` : '') + parsed.slice(0, 24).map((item, index) => {
      const tags = [
        item.seed ? `TS ${item.seed}` : '',
        item.manualGroup ? `Girone ${String.fromCharCode(64 + Number(item.manualGroup))}` : '',
      ].filter(Boolean).join(' · ');
      return `<article><span>${index + 1}</span><strong>${escapeHtml(item.name)}</strong>${tags ? `<small>${escapeHtml(tags)}</small>` : ''}</article>`;
    }).join('');
    return parsed;
  }

  async function applyBulkTeams() {
    if (!ensureRosterEditable()) return;
    if (state.matches.length) {
      showToast('Il tabellone è già stato generato. Per sostituire le squadre elimina prima il tabellone oppure crea un nuovo torneo.', 'error');
      return;
    }
    const parsed = renderBulkPreview();
    if (parsed.issues.length) { showToast(parsed.issues[0], 'error'); return; }
    if (!parsed.length) {
      showToast('Incolla almeno una coppia valida.', 'error');
      return;
    }
    const existing = Engine.activeTeams(state).length;
    const baseState = state;
    if (existing) {
      const confirmed = await confirmAction(
        'Sostituire l’elenco coppie?',
        `Verranno caricate ${parsed.length} coppie e l’elenco attuale verrà sovrascritto.`,
        'Carica elenco',
      );
      if (!confirmed) return;
    }
    if (state !== baseState || tournamentStarted()) { showToast('Il torneo è cambiato. Ricontrolla l’elenco prima di importare.', 'error'); return; }
    const now = new Date().toISOString();
    state.teams.forEach((team, index) => {
      const incoming = parsed[index];
      team.name = incoming?.name || '';
      team.seed = incoming?.seed || null;
      team.manualGroup = incoming?.manualGroup || null;
      team.groupId = null;
      team.losses = 0;
      team.byes = 0;
      team.initialByes = 0;
      team.fairByes = 0;
      team.technicalByes = 0;
      team.out = false;
      team.updatedAt = now;
    });
    $('bulkTeamsInput').value = '';
    renderBulkPreview();
    markChanged({ render: true, immediate: true });
    showToast(`${parsed.length} coppie caricate.`, 'success');
  }


  function updateSetupDerived() {
    const error = Engine.validateTeams(state);
    const estimate = Engine.estimateMatches(state);
    const activeCount = Engine.activeTeams(state).length;
    const slots = estimate.minimum ? Math.ceil(estimate.minimum / Math.max(1, state.settings.courts)) : 0;
    const capacity = singleDayCapacity();
    const maxMatches = Number(estimate.maximum || estimate.minimum || 0);
    const fitsDay = capacity ? maxMatches <= capacity.totalSlots : null;
    $('estimatedMatches').textContent = estimate.minimum ? (estimate.minimum === estimate.maximum ? estimate.minimum : `${estimate.minimum}–${estimate.maximum}`) : '—';
    $('guaranteedMatches').textContent = estimate.guaranteed || '—';
    $('estimatedSlots').textContent = slots ? `${slots} slot/campo` : '—';
    const baseRecommendation = recommendationText(state.settings.format, activeCount, estimate);
    const dayMessage = capacity
      ? fitsDay
        ? ` La capacità teorica della giornata è ${capacity.totalSlots} slot complessivi.`
        : ` Attenzione: la stima massima è ${maxMatches} partite, ma la finestra impostata offre ${capacity.totalSlots} slot teorici.`
      : ' Imposta un orario di fine successivo all’orario di inizio.';
    $('formatRecommendation').textContent = `${baseRecommendation}${dayMessage}`;

    const timeError = !capacity ? 'Controlla l’orario di inizio e fine della giornata.' : '';
    const validationError = error || timeError;
    const banner = $('setupValidation');
    banner.className = `validation-banner ${validationError ? 'invalid' : 'valid'}`;
    banner.querySelector('p').textContent = validationError || `${activeCount} coppie pronte. Configurazione valida per una giornata unica.`;
    $('generateBtn').disabled = tournamentStarted() || Boolean(validationError) || !canEdit();
    $('generateBtn').textContent = tournamentStarted() ? 'Torneo avviato' : 'Avvia torneo';
    $('stickyFormatLabel').textContent = Engine.formatLabel(state.settings.format);
    $('stickySummary').textContent = activeCount
      ? `${Engine.formatSummary(state)} · ${state.settings.dayStart}–${state.settings.dayEnd}`
      : 'Inserisci almeno due coppie';
  }

  function recommendationText(format, count, estimate) {
    if (!count) return 'Inserisci le coppie per ottenere una stima.';
    if (format === Engine.FORMATS.GROUPS_PLAYOFF) {
      const assignment = state.settings.formatOptions.groupAssignmentMode === 'manual'
        ? 'gironi composti manualmente'
        : 'sorteggio random protetto dalle teste di serie';
      const silver = state.settings.formatOptions.silverEnabled
        ? ` Silver attivo per ${state.settings.formatOptions.silverSize === 'all' ? 'tutte le non qualificate' : `le migliori ${state.settings.formatOptions.silverSize} non qualificate`}.`
        : '';
      const protection = state.settings.formatOptions.protectGroupWinners && Number(state.settings.formatOptions.groupCount) === 2
        ? ' Le vincitrici dei due gironi sono protette fino alle semifinali.'
        : '';
      return `Formula equilibrata: ${assignment}, ${Engine.matchRuleDefinition(state.settings.formatOptions.groupMatchRule).label.toLowerCase()} nei gironi, classifica sui punti e finale classica 21/21/15.${protection}${silver}`;
    }
    if (format === Engine.FORMATS.DOUBLE_ELIMINATION) return `Formula competitiva: ${Engine.matchRuleDefinition(state.settings.formatOptions.eliminationMatchRule).label.toLowerCase()} e eliminazione soltanto alla seconda sconfitta.`;
    if (format === Engine.FORMATS.SINGLE_ELIMINATION) return `Formula più rapida: ${Engine.matchRuleDefinition(state.settings.formatOptions.eliminationMatchRule).label.toLowerCase()}, ideale quando tempo, campi o budget sono limitati.`;
    return `Formula completa per pochi partecipanti: ${Engine.matchRuleDefinition(state.settings.formatOptions.groupMatchRule).label.toLowerCase()} nel girone e finale classica 21/21/15.`;
  }

  async function generateTournament() {
    if (!ensureRosterEditable()) return;
    const error = Engine.validateTeams(state);
    if (error) { showToast(error, 'error'); return; }
    try {
      const baseState = state;
      const nextState = cloneValue(state);
      Engine.generateTournament(nextState, { drawCode: $('drawCodeInput').value.trim() || undefined });
      const warnings = nextState.metadata?.scheduleWarnings || [];
      const confirmed = await confirmAction('Avviare il torneo?', `Confermi ${Engine.activeTeams(state).length} coppie? Dopo l’avvio potrai modificare solo nomi e punteggi.${warnings.length ? ` Attenzione: ${warnings.length} gare non hanno uno slot disponibile. Annulla e amplia orari o campi per completare il calendario.` : ''}`, 'Avvia torneo');
      if (!confirmed) return;
      if (state !== baseState || tournamentStarted()) { showToast('Il torneo è cambiato durante la conferma. Controlla i dati e riprova.', 'error'); return; }
      state = nextState;
      markChanged({ render: true, immediate: true });
      switchTab('matches');
      showToast(`Torneo generato: calendario automatico da ${state.settings.dayStart} su ${state.settings.courts} campi.`, 'success');
    } catch (error) {
      showToast(humanizeError(error), 'error');
    }
  }

  async function advanceTournament() {
    if (!ensureEditable()) return;
    if (scoreDrafts.size) { showToast('Salva tutti i punteggi modificati prima di avanzare.', 'error'); return; }
    try {
      Engine.generateNextStage(state);
      markChanged({ render: true, immediate: true });
      if (Engine.tournamentComplete(state)) {
        const silverText = state.silverChampionId ? ` · Silver: ${Engine.team(state, state.silverChampionId)?.name || '—'}` : '';
        showToast(`Torneo concluso: Gold ${Engine.team(state, state.championId)?.name || 'campione'}${silverText}.`, 'success');
        switchTab('live');
      } else {
        showToast('Fase successiva e relativi orari generati.', 'success');
        switchTab('matches');
      }
    } catch (error) {
      showToast(humanizeError(error), 'error');
    }
  }

  function renderMatches() {
    const list = $('matchesList');
    const stage = Engine.currentStage(state);
    const stageDone = state.matches.length && Engine.stageComplete(state);
    $('currentPhaseTitle').textContent = Engine.phaseLabel(state);
    $('advanceBtn').disabled = !canEdit() || !state.matches.length || !stageDone || Engine.tournamentComplete(state) || Boolean(scoreDrafts.size);
    $('advanceBtn').textContent = state.settings.format === Engine.FORMATS.GROUPS_PLAYOFF
      && !state.matches.some((match) => ['K', 'S'].includes(match.bracket)) ? 'Genera playoff Gold/Silver' : 'Fase successiva';

    const banner = $('stageStatus');
    if (!state.matches.length) {
      banner.className = 'stage-banner';
      banner.querySelector('p').textContent = 'Genera il torneo dalla pagina Configura.';
    } else if (Engine.tournamentComplete(state)) {
      banner.className = 'stage-banner complete';
      banner.querySelector('p').textContent = `Torneo concluso · ${Engine.team(state, state.championId)?.name || ''}`;
    } else if (stageDone) {
      banner.className = 'stage-banner complete';
      banner.querySelector('p').textContent = 'Turno completato. Genera la fase successiva.';
    } else {
      const open = state.matches.filter((match) => match.stage === stage && Engine.matchStatus(match) === 'DA GIOCARE').length;
      banner.className = 'stage-banner';
      const unplanned = state.matches.filter(match => !match.bye && (!match.court || !match.startTime)).length;
      banner.querySelector('p').textContent = `${open} partite da completare nel turno corrente.${unplanned ? ` ${unplanned} gare senza slot disponibile nella finestra configurata; l’orario va comunicato dall’organizzazione.` : ''}`;
    }

    updatePhaseFilter();
    const phase = $('phaseFilter').value;
    const status = $('statusFilter').value;
    const query = $('matchSearch').value.trim().toLocaleLowerCase('it');
    let matches = [...state.matches].sort((a, b) => a.stage - b.stage || a.order - b.order);
    if (phase !== 'all') matches = matches.filter((match) => String(match.stage) === phase);
    if (status === 'open') matches = matches.filter((match) => match.stage === stage && ['DA GIOCARE', 'BYE'].includes(Engine.matchStatus(match)));
    if (status === 'completed') matches = matches.filter((match) => ['CONCLUSA', 'BYE'].includes(Engine.matchStatus(match)));
    if (status === 'waiting') matches = matches.filter((match) => Engine.matchStatus(match) === 'IN ATTESA');
    if (query) matches = matches.filter((match) => {
      const text = [match.id, match.round, Engine.team(state, match.aId)?.name, Engine.team(state, match.bId)?.name].join(' ').toLocaleLowerCase('it');
      return text.includes(query);
    });

    if (!matches.length) {
      list.innerHTML = '<div class="empty-state"><div><strong>Nessuna partita con questi filtri</strong><span>Modifica fase, stato o ricerca.</span></div></div>';
      return;
    }
    list.innerHTML = '';
    matches.forEach((match) => list.appendChild(renderMatchCard(match, stage)));
  }

  function updatePhaseFilter() {
    const select = $('phaseFilter');
    const previous = select.value;
    const stages = [...new Set(state.matches.map((match) => match.stage))].sort((a, b) => a - b);
    select.innerHTML = '<option value="all">Tutte</option>' + stages.map((stage) => {
      const labels = [...new Set(state.matches.filter((item) => item.stage === stage).map((item) => item.round).filter(Boolean))];
      const label = labels.join(' / ') || `Turno ${stage + 1}`;
      return `<option value="${stage}">${escapeHtml(label)}</option>`;
    }).join('');
    select.value = [...select.options].some((option) => option.value === previous) ? previous : 'all';
  }

  function renderMatchCard(match, currentStage) {
    const template = $('matchTemplate').content.cloneNode(true);
    const card = template.querySelector('.match-card');
    card.dataset.matchId = match.id;
    card.classList.toggle('past-stage', match.stage < currentStage);
    card.classList.toggle('current-stage', match.stage === currentStage);
    const rule = Engine.matchRuleDefinition(match);
    card.classList.toggle('single-set', rule.bestOf === 1);
    card.classList.toggle('classic-final', match.rule === Engine.MATCH_RULES.BEST_OF_3_21_15);
    card.classList.toggle('gold-bracket', match.bracket === 'K');
    card.classList.toggle('silver-bracket', match.bracket === 'S');
    card.querySelector('.match-code').textContent = match.id;
    card.querySelector('.match-round').textContent = match.round || 'Partita';
    card.querySelector('.match-stage').textContent = `Fase ${match.stage + 1}`;
    card.querySelector('.team-a').textContent = Engine.team(state, match.aId)?.name || 'Da definire';
    card.querySelector('.team-b').textContent = Engine.team(state, match.bId)?.name || (match.bye ? 'BYE' : 'Da definire');
    card.querySelector('.pairing-reason').textContent = match.pairingReason || 'Accoppiamento previsto dal formato selezionato.';
    card.querySelector('.match-rule-label').textContent = rule.label;
    card.querySelector('.match-rule-note').textContent = rule.bestOf === 1
      ? `Set a ${rule.targets[0]} · vittoria con 2 punti di vantaggio`
      : `Set: ${rule.targets.join(' · ')} · servono 2 set vinti`;
    [1, 2, 3].forEach((number, index) => {
      const label = card.querySelector(`.set-label-${number}`);
      const target = rule.targets[index];
      label.textContent = target ? `S${number} · ${target}` : '';
      label.classList.toggle('rule-hidden', !target);
    });

    const status = Engine.matchStatus(match);
    const statusElement = card.querySelector('.match-status');
    statusElement.textContent = status;
    statusElement.classList.toggle('completed', status === 'CONCLUSA');
    statusElement.classList.toggle('waiting', status === 'IN ATTESA');
    statusElement.classList.toggle('bye', status === 'BYE');

    const editable = canEdit() && !match.bye && match.aId && match.bId;
    const court = card.querySelector('.court-input');
    court.value = [match.court,match.startTime].filter(Boolean).join(' · ') || 'Orario da definire';
    court.disabled = true;
    const currentDraft = scoreDrafts.get(match.id);
    const source = currentDraft?.sets || match.sets;
    const fields = ['a1','a2','a3','b1','b2','b3'];
    const saveButton = card.querySelector('.save-match');
    const draftStatus = card.querySelector('.score-draft-status');
    const discardButton = card.querySelector('.discard-match');
    discardButton.classList.toggle('hidden',!currentDraft || !editable);
    discardButton.addEventListener('click',()=>{scoreDrafts.delete(match.id);renderMatches();applyPendingRealtimeIfSafe();});
    saveButton.classList.toggle('hidden',!editable);
    saveButton.disabled = !currentDraft;
    if (currentDraft) draftStatus.textContent = 'Modifiche da salvare';
    fields.forEach((className,index)=>{
      const input=card.querySelector(`.${className}`), setIndex=index%3,side=index<3?'a':'b';
      const activeSet=setIndex<rule.targets.length;
      input.value=activeSet ? source[setIndex][side] : '';
      input.disabled=!editable || !activeSet;
      input.classList.toggle('rule-hidden',!activeSet);
      input.addEventListener('input',()=>{
        if(!editable) return;
        const draft=scoreDrafts.get(match.id) || {sets:cloneValue(match.sets)};
        draft.sets[setIndex][side]=input.value;
        scoreDrafts.set(match.id,draft);
        onlineRequest += 1;
        saveButton.disabled=false;
        discardButton.classList.remove('hidden');
        $('advanceBtn').disabled = true;
        draftStatus.textContent='Modifiche da salvare · premi Salva punteggio';
        draftStatus.classList.remove('invalid-score');
        renderSaveStatus();
      });
    });
    updateMatchCardResult(card,match);
    const saveScores=async (sets)=>{
      if(!ensureEditable()) return;
      const baseState=state, baseVersion=localEditVersion, baseRevision=online.revision;
      const preview=cloneValue(state);
      try {
        const result=Engine.updateMatchScores(preview,match.id,sets);
        const removed=result.removedMatchIds || [];
        if(removed.length) {
          const accepted=await confirmAction('Aggiornare questo risultato?', `La correzione modifica le qualificazioni. Verranno rimosse ${removed.length} gare delle fasi successive, inclusi eventuali risultati. Dopo il salvataggio potrai rigenerarle. Gli altri risultati della stessa fase rimangono.`, 'Salva e ricostruisci');
          if(!accepted) return;
        }
        if (!canEdit() || state!==baseState || localEditVersion!==baseVersion || online.revision!==baseRevision) { showToast('Il torneo è cambiato durante la conferma. Ricontrolla il risultato e riprova.', 'error'); return; }
        state=preview;
        scoreDrafts.delete(match.id);
        for(const id of removed) scoreDrafts.delete(id);
        markChanged({render:true,immediate:true});
        showToast(removed.length ? 'Risultato salvato. Rigenera le fasi successive.' : 'Punteggio salvato.', 'success');
      } catch(error) {
        draftStatus.textContent=humanizeError(error);draftStatus.classList.add('invalid-score');
        showToast(humanizeError(error),'error');
      }
    };
    saveButton.addEventListener('click',()=>saveScores(scoreDrafts.get(match.id)?.sets || match.sets));
    const clearButton=card.querySelector('.clear-match');
    clearButton.classList.toggle('hidden',!editable || !match.sets.some(set=>set.a!=='' || set.b!==''));
    clearButton.addEventListener('click',async ()=>{
      if(!editable) return;
      const accepted=await confirmAction('Cancellare il punteggio?', 'La gara tornerà da giocare. Se necessario verrà richiesta una seconda conferma per rimuovere le fasi dipendenti.', 'Cancella punteggio');
      if(accepted && ensureEditable()) await saveScores([{a:'',b:''},{a:'',b:''},{a:'',b:''}]);
    });
    return template;
  }

  function updateMatchCardResult(card, match) {
    const result = card.querySelector('.match-result');
    const winner = Engine.team(state, match.winnerId);
    if (match.bye) {
      result.textContent = `Passaggio automatico: ${winner?.name || 'coppia da definire'}`;
      result.classList.add('has-winner');
    } else if (winner) {
      result.textContent = `Vincente: ${winner.name}`;
      result.classList.add('has-winner');
    } else if (!match.aId || !match.bId) {
      result.textContent = 'In attesa degli incontri precedenti.';
      result.classList.remove('has-winner');
    } else {
      const rule = Engine.matchRuleDefinition(match);
      result.textContent = rule.bestOf === 1
        ? `Inserisci il punteggio del set a ${rule.targets[0]} (2 punti di vantaggio).`
        : `Inserisci due set vinti (${rule.targets.join(' · ')}).`;
      result.classList.remove('has-winner');
    }
  }

  function renderLive() {
    const title = state.settings.tournamentName || 'Beach & Chill Monopoli Vibes';
    $('liveTitle').textContent = `${title} · Live`;
    $('liveSubtitle').textContent = `${Engine.formatLabel(state.settings.format)} · ${Engine.phaseLabel(state)} · ${state.settings.dayStart}–${state.settings.dayEnd}`;
    if ($('publicTournamentName')) $('publicTournamentName').textContent = title;
    renderNextMatches($('liveNext'), 10, false);

    const completed = [...state.matches].filter((match) => match.winnerId && !match.bye).sort((a, b) => b.stage - a.stage || b.order - a.order).slice(0, 12);
    $('liveResults').innerHTML = completed.length ? completed.map((match) => {
      const winner = Engine.team(state, match.winnerId)?.name || '—';
      const loser = Engine.team(state, match.loserId)?.name || '—';
      const score = match.sets.filter((set) => set.a !== '' && set.b !== '').map((set) => `${set.a}-${set.b}`).join(', ');
      const rule = Engine.matchRuleDefinition(match);
      return `<article class="result-row"><strong>${escapeHtml(winner)} <small>su ${escapeHtml(loser)}</small></strong><span>${escapeHtml(match.id)} · ${escapeHtml(rule.shortLabel)} · ${escapeHtml(score)}</span></article>`;
    }).join('') : '<div class="empty-state"><div><strong>Nessun risultato</strong><span>I risultati compariranno qui in tempo reale.</span></div></div>';

    const goldChampion = Engine.team(state, state.championId);
    const silverChampion = Engine.team(state, state.silverChampionId);
    $('liveChampionsCard').classList.toggle('hidden', !goldChampion && !silverChampion);
    $('liveGoldChampion').textContent = goldChampion?.name || 'Da assegnare';
    $('liveSilverChampion').textContent = silverChampion?.name || (state.settings.formatOptions.silverEnabled ? 'Da assegnare' : 'Non previsto');

    renderStandings($('standingsContent'), false);
    renderBracket();
    $('whatsappText').value = buildWhatsAppText();
    switchLiveView(activeLiveView);
  }

  function renderStandings(container, compact) {
    if (!state.groups.length) {
      if (state.settings.format === Engine.FORMATS.DOUBLE_ELIMINATION) {
        const alive = Engine.activeTeams(state).filter((item) => !item.out).sort((a, b) => a.losses - b.losses || Engine.seedRank(a) - Engine.seedRank(b));
        container.innerHTML = `<article class="standing-card"><h3>Coppie ancora in gara</h3><table class="standing-table"><thead><tr><th>#</th><th>Coppia</th><th>Sconfitte</th><th>Bye</th></tr></thead><tbody>${alive.map((item, index) => `<tr><td>${index + 1}</td><td>${escapeHtml(item.name)}</td><td>${item.losses}</td><td>${item.byes}</td></tr>`).join('')}</tbody></table></article>`;
      } else {
        container.innerHTML = '<div class="empty-state"><div><strong>Nessuna classifica a gironi</strong><span>Questo formato utilizza un tabellone a eliminazione.</span></div></div>';
      }
      return;
    }
    const standings = Engine.getAllGroupStandings(state);
    const preview = Engine.getGroupQualificationPreview(state);
    const goldIds = new Set(state.qualifiers.length ? state.qualifiers.map((entry) => entry.teamId) : preview.goldIds);
    const silverIds = new Set(state.silverQualifiers.length ? state.silverQualifiers.map((entry) => entry.teamId) : preview.silverIds);
    const roundRobinFinalFour = state.settings.format === Engine.FORMATS.ROUND_ROBIN_FINAL4;
    container.innerHTML = standings.map(({ group, rows }) => `<article class="standing-card"><h3>${escapeHtml(group.name)}</h3><table class="standing-table points-standing"><thead><tr><th>#</th><th>Coppia</th><th title="Gare giocate">G</th><th title="Vittorie">V</th><th title="Punti fatti">PF</th><th title="Punti subiti">PS</th><th title="Differenza punti">Δ</th></tr></thead><tbody>${rows.map((row) => {
      const className = roundRobinFinalFour
        ? (row.rank <= 4 ? 'qualifier gold-qualifier' : '')
        : goldIds.has(row.teamId)
          ? 'qualifier gold-qualifier'
          : silverIds.has(row.teamId)
            ? 'silver-qualifier'
            : '';
      return `<tr class="${className}"><td>${row.rank}</td><td>${escapeHtml(row.team?.name || '—')}</td><td>${row.played}</td><td>${row.wins}</td><td>${row.pointsFor}</td><td>${row.pointsAgainst}</td><td>${signed(row.pointDiff)}</td></tr>`;
    }).join('')}</tbody></table><div class="standing-legend"><span class="gold-dot"></span> Gold${state.settings.formatOptions.silverEnabled && !roundRobinFinalFour ? '<span class="silver-dot"></span> Silver' : ''}</div><p class="standing-criteria">Ordine: vittorie · scontro diretto · differenza punti · quoziente punti · meno punti subiti.</p></article>`).join('');
    if (compact && standings.length > 2) {
      [...container.children].slice(2).forEach((element) => element.classList.add('hidden'));
    }
  }

  function renderBracket() {
    const board = $('bracketContent');
    if (!state.matches.length) {
      board.innerHTML = '<div class="empty-state"><div><strong>Tabellone non generato</strong><span>Il percorso apparirà dopo la configurazione.</span></div></div>';
      return;
    }
    const stages = [...new Set(state.matches.map((match) => match.stage))].sort((a, b) => a - b);
    board.innerHTML = stages.map((stage) => {
      const matches = state.matches.filter((match) => match.stage === stage).sort((a, b) => a.order - b.order);
      const title = [...new Set(matches.map((match) => match.round))].join(' · ');
      return `<section class="bracket-stage"><h3>${escapeHtml(title || `Fase ${stage + 1}`)}</h3>${matches.map((match) => { const rule = Engine.matchRuleDefinition(match); const bracketClass = match.bracket === 'S' ? 'silver' : match.bracket === 'K' ? 'gold' : ''; return `<article class="bracket-match ${bracketClass}"><header><span>${escapeHtml(match.id)} · ${escapeHtml(rule.shortLabel)}</span><span>${escapeHtml(Engine.matchStatus(match))}</span></header><strong>${escapeHtml(Engine.team(state, match.aId)?.name || 'TBD')}<br>vs<br>${escapeHtml(Engine.team(state, match.bId)?.name || (match.bye ? 'BYE' : 'TBD'))}</strong></article>`; }).join('')}</section>`;
    }).join('');
  }

  function switchLiveView(view, options = {}) {
    const selected = VALID_LIVE_VIEWS.has(view) ? view : 'overview';
    activeLiveView = selected;
    $$('[data-live-view]').forEach((button) => button.classList.toggle('active', button.dataset.liveView === selected));
    $('liveOverview').classList.toggle('active', selected === 'overview');
    $('liveStandings').classList.toggle('active', selected === 'standings');
    $('liveBracket').classList.toggle('active', selected === 'bracket');
    if (options.persist !== false) writeUiState({ activeTab, activeLiveView });
  }

  function buildWhatsAppText() {
    const stage = Engine.currentStage(state);
    const next = state.matches.filter((match) => match.stage === stage && Engine.matchStatus(match) === 'DA GIOCARE').sort((a, b) => a.order - b.order);
    const lines = [`🏐 *${state.settings.tournamentName}*`, `📍 ${Engine.phaseLabel(state)}`, ''];
    if (!next.length) lines.push('Nessuna partita pronta in questo momento.');
    next.forEach((match) => {
      const location = [match.court, match.startTime].filter(Boolean).join(' · ');
      lines.push(`*${match.id} · ${Engine.matchRuleDefinition(match).shortLabel}${location ? ` · ${location}` : ''}*`);
      lines.push(`${Engine.team(state, match.aId)?.name || 'TBD'} 🆚 ${Engine.team(state, match.bId)?.name || 'TBD'}`);
      lines.push('');
    });
    if (state.championId) lines.push(`🏆 Campione Gold: *${Engine.team(state, state.championId)?.name || ''}*`);
    if (state.silverChampionId) lines.push(`🥈 Campione Silver: *${Engine.team(state, state.silverChampionId)?.name || ''}*`);
    return lines.join('\n').trim();
  }

  function updateOnlinePanel() {
    const configured = online.configured;
    const username = DB?.sessionUsername?.(online.session) || '';
    const loginPanel = $('adminLoginPanel');
    const sessionPanel = $('adminSessionPanel');
    const createPanel = $('tournamentCreatePanel');
    const adminManagement = $('adminManagement');
    const key = online.tournament?.slug || tournamentSlug();

    $('onlineConfigNotice').classList.toggle('hidden', configured);
    loginPanel?.classList.toggle('hidden', Boolean(online.session));
    sessionPanel?.classList.toggle('hidden', !online.session);
    if ($('adminCurrentUser')) $('adminCurrentUser').textContent = username || 'Amministratore';
    if ($('authStatus')) {
      $('authStatus').textContent = online.session
        ? `Accesso effettuato come ${username || 'amministratore'}`
        : 'Inserisci chiave torneo, username e password.';
    }

    const loginKeyInput = $('adminTournamentKey');
    if (loginKeyInput && document.activeElement !== loginKeyInput) loginKeyInput.value = key;
    if (document.activeElement !== $('onlineTournamentName')) $('onlineTournamentName').value = !online.tournament && setupDraftForm.name !== null ? setupDraftForm.name : state.settings.tournamentName;
    if (document.activeElement !== $('onlineTournamentSlug')) $('onlineTournamentSlug').value = !online.tournament && setupDraftForm.slug !== null ? setupDraftForm.slug : key;
    if ($('publicTournamentKey')) $('publicTournamentKey').textContent = key;
    if ($('publicTournamentKeyField')) $('publicTournamentKeyField').value = key;

    $('remoteStatus').textContent = online.tournament
      ? `${online.tournament.public_read ? 'Vista giocatori attiva' : 'Bozza privata condivisa con gli admin'} · aggiornato ${new Date(online.tournament.updated_at).toLocaleString('it-IT')}`
      : online.session
        ? `Autenticato · nessun torneo trovato con la chiave “${key}”`
        : configured
          ? 'Accesso amministratore richiesto'
          : 'Supabase non configurato';

    createPanel?.classList.toggle('hidden', !configured || !online.session || !online.accessReady || Boolean(online.tournament));
    $('createOnlineBtn').disabled = !configured || !online.session || !online.accessReady || Boolean(online.tournament) || online.creating;
    $('onlineTournamentName').disabled = online.creating;
    $('onlineTournamentSlug').disabled = online.creating;
    $('generateTournamentKeyBtn').disabled = online.creating;
    $('sharePanel').classList.toggle('hidden', !online.tournament);
    adminManagement?.classList.toggle('hidden', !online.tournament || !isOwner());
    $('publicInfoBox')?.classList.toggle('hidden', !online.tournament);

    if (online.tournament) {
      $('publicReadToggle').checked = Boolean(online.tournament.public_read);
      $('publicLink').value = buildLink({ live: true });
      if ($('publicTournamentKey')) $('publicTournamentKey').textContent = online.tournament.slug || key;
      if ($('publicTournamentKeyField')) $('publicTournamentKeyField').value = online.tournament.slug || key;
      $('onlineRevision').textContent = online.revision;
      $('openPublicLinkBtn').disabled = !online.tournament.public_read;
      $('copyPublicLinkBtn').disabled = !online.tournament.public_read;
    } else {
      if ($('publicLink')) $('publicLink').value = '';
      if ($('openPublicLinkBtn')) $('openPublicLinkBtn').disabled = true;
      if ($('copyPublicLinkBtn')) $('copyPublicLinkBtn').disabled = true;
    }
    $('importInput').disabled = tournamentStarted() || !canEdit();
    $('resetScoresBtn').disabled = tournamentStarted() || !canEdit();
    $('resetTournamentBtn').disabled = !canResetBracket();
    if ($('resetBracketNotice')) $('resetBracketNotice').textContent = online.tournament && !isOwner()
      ? 'L’eliminazione del tabellone è riservata al proprietario del torneo.'
      : 'Puoi eliminare il tabellone anche dopo l’avvio e la pubblicazione. Le squadre restano iscritte; partite, gironi e risultati vengono rimossi. Il torneo torna in preparazione con Live disattivato.';
    $('downloadResetBackupBtn')?.classList.toggle('hidden', !readLastResetBackup());
    renderAdminList();
  }

  function renderAdminList() {
    const container = $('adminList');
    if (!container) return;
    if (!online.tournament || !online.session) {
      container.innerHTML = '<p class="empty-state compact">Accedi e apri un torneo online.</p>';
      return;
    }
    if (!online.admins.length) {
      container.innerHTML = '<p class="empty-state compact">Nessun amministratore caricato.</p>';
      return;
    }
    const current = DB.sessionUsername(online.session);
    container.innerHTML = online.admins.map((admin) => {
      const username = String(admin.username || 'admin');
      const roleLabel = admin.role === 'owner' ? 'Proprietario' : 'Amministratore';
      const currentLabel = username === current ? ' · tu' : '';
      const removable = isOwner() && admin.role !== 'owner' && username !== current;
      return `<article class="admin-item">
        <span class="admin-avatar" aria-hidden="true">${escapeHtml(username.slice(0, 1).toUpperCase())}</span>
        <span class="admin-copy"><strong>${escapeHtml(username)}</strong><small>${escapeHtml(roleLabel)}${currentLabel}</small></span>
        ${removable ? `<button class="text-button remove-admin" type="button" data-admin-username="${escapeAttr(username)}">Rimuovi</button>` : ''}
      </article>`;
    }).join('');
  }

  async function refreshAdminList({ quiet = false } = {}) {
    if (!online.tournament || !online.session || !online.role) {
      online.admins = [];
      renderAdminList();
      return;
    }
    try {
      online.admins = await DB.listTournamentAdmins(online.tournament.id);
      renderAdminList();
    } catch (error) {
      console.error(error);
      if (!quiet) showToast(humanizeError(error), 'error');
    }
  }

  function buildLink({ live }) {
    const url = new URL(window.location.href);
    url.searchParams.set('t', online.tournament?.slug || tournamentSlug());
    url.searchParams.delete('open');
    url.searchParams.delete('view');
    if (live) url.searchParams.set('live', '1');
    else url.searchParams.delete('live');
    return url.toString();
  }

  async function adminLogin() {
    if (!online.configured) { showToast('Configura prima Supabase.', 'error'); return; }
    const key = normalizeTournamentKey($('adminTournamentKey').value || tournamentSlug());
    const username = $('adminUsername').value.trim();
    const password = $('adminPassword').value;
    if (!key) { showToast('Inserisci una chiave torneo valida.', 'error'); return; }
    if (!username) { showToast('Inserisci lo username.', 'error'); return; }
    if (!password) { showToast('Inserisci la password.', 'error'); return; }
    try {
      loginInProgress = true;
      $('adminLoginBtn').disabled = true;
      if (online.saving || online.creating) throw new Error('Attendi il completamento del salvataggio.');
      if (key !== tournamentSlug()) {
        if (hasUnsavedLocalChanges() || scoreDrafts.size) { showToast('Esporta e risolvi la bozza prima di cambiare torneo.', 'error'); return; }
        clearTimeout(saveTimer); DB.unsubscribe(); onlineRequest += 1;
        online.tournament = null; online.revision = null; online.role = null; online.accessReady = false;
        remoteConflict = null; online.savePaused = false; scoreDrafts.clear();
        setTournamentKeyInUrl(key); state = Engine.createDefaultState();
      }
      setConnectionStatus('Accesso…');
      online.session = await DB.signInAdmin(username, password);
      $('adminPassword').value = '';
      await loadOnlineTournament({ quiet: true, force: true });
      renderAll();
      switchTab(online.tournament ? 'dashboard' : 'more');
      setConnectionStatus(online.tournament ? 'Online' : 'Autenticato', 'online');
      showToast(online.tournament ? 'Accesso effettuato. Torneo caricato.' : 'Accesso effettuato. Puoi creare il torneo con questa chiave.', 'success');
    } catch (error) {
      console.error(error);
      setConnectionStatus('Accesso non riuscito', 'error');
      showToast(humanizeError(error), 'error');
    } finally { loginInProgress = false; $('adminLoginBtn').disabled = false; }
  }

  async function createOnlineTournament({ background = false } = {}) {
    if (!online.session || !online.accessReady) { showToast('Accedi e attendi la connessione prima di creare un torneo.', 'error'); return; }
    if (online.creating || online.saving || hasUnsavedLocalChanges() && online.tournament) { showToast('Completa il salvataggio prima di creare un altro torneo.', 'error'); return; }
    const name = String(setupDraftForm.name ?? $('onlineTournamentName').value ?? state.settings.tournamentName).trim() || state.settings.tournamentName;
    const slug = normalizeTournamentKey(setupDraftForm.slug ?? $('onlineTournamentSlug').value) || tournamentSlug();
    if (!name || !slug) { showToast('Compila nome e chiave torneo.', 'error'); return; }
    const draftKey = setupDraftKey();
    const creatingUser = online.session.user.id;
    online.creating = true;
    sharedDraftRequested = true;
    draftCreationFailed = false;
    onlineRequest += 1;
    $('createOnlineBtn').disabled = true;
    updateOnlinePanel();
    try {
      state.settings.tournamentName = name;
      saveLocalState();
      const createVersion = localEditVersion;
      const snapshot = cloneValue(state);
      renderSaveStatus();
      const row = await DB.createTournament(name, slug, snapshot);
      if (online.session?.user?.id !== creatingUser) return;
      online.tournament = row;
      online.revision = Number(row.revision);
      online.role = 'owner'; online.accessReady = true;
      showUnavailable('');
      sharedDraftRequested = false;
      clearDirtyTracking(createVersion);
      setTournamentKeyInUrl(slug);
      setupDraftForm = { name: null, slug: null };
      saveLocalState();
      try { localStorage.removeItem(draftKey); } catch (_) {}
      if (hasUnsavedLocalChanges()) scheduleOnlineSave(0);
      DB.subscribeToTournament(row.id, handleRealtimeUpdate);
      await refreshAdminList({ quiet: true });
      if (background) { paintSharedRoster(); updateAccessUI(); }
      else { renderAll(); switchTab('dashboard'); }
      setConnectionStatus(hasUnsavedLocalChanges() ? 'Sincronizzazione…' : 'Online', 'online');
      showToast('Bozza condivisa creata. Aggiungi gli altri admin da Altro. La vista giocatori è disattivata.', 'success');
    } catch (error) {
      draftCreationFailed = true;
      showToast(humanizeError(error), 'error');
    }
    finally { online.creating = false; updateOnlinePanel(); renderSaveStatus(); }
  }

  async function addAdministrator() {
    if (!isOwner() || !online.tournament) return;
    const username = $('newAdminUsername').value.trim();
    if (!username) { showToast('Inserisci lo username da aggiungere.', 'error'); return; }
    try {
      const added = await DB.addTournamentAdmin(online.tournament.id, username);
      $('newAdminUsername').value = '';
      await refreshAdminList();
      showToast(`Amministratore ${added || username.toLowerCase()} aggiunto.`, 'success');
    } catch (error) { showToast(humanizeError(error), 'error'); }
  }

  async function removeAdministrator(username) {
    if (!isOwner() || !online.tournament) return;
    const confirmed = await confirmAction(
      'Rimuovere questo amministratore?',
      `${username} non potrà più modificare il torneo.`,
      'Rimuovi',
    );
    if (!confirmed) return;
    try {
      await DB.removeTournamentAdmin(online.tournament.id, username);
      await refreshAdminList();
      showToast(`Amministratore ${username} rimosso.`, 'success');
    } catch (error) { showToast(humanizeError(error), 'error'); }
  }

  async function togglePublicRead(event) {
    if (!isOwner() || !online.tournament) return;
    const previous=Boolean(online.tournament.public_read), requested=event.target.checked;
    if (online.saving || scoreDrafts.size) { event.target.checked=previous; showToast('Completa i salvataggi prima di cambiare la vista Live.', 'error'); return; }
    if (hasUnsavedLocalChanges()) await flushOnlineSave();
    if (hasUnsavedLocalChanges()) { event.target.checked=previous; showToast('Risolvi le modifiche in sospeso prima di cambiare la vista Live.', 'error'); return; }
    const editVersion=localEditVersion;
    onlineRequest += 1;
    online.saving=true; event.target.disabled=true;
    try {
      const row=await DB.setPublicRead(online.tournament.id,requested);
      if (localEditVersion!==editVersion) {
        online.savePaused=true; remoteConflict=row;
        showSaveProblem('La visibilità è stata aggiornata mentre modificavi il torneo. La bozza è conservata: carica la versione online e riapplica le modifiche.',true);
      } else {
        online.tournament=row; online.revision=Number(row.revision);
        state=Engine.normalizeState(row.state);saveLocalState();renderAll();
        showToast(requested ? 'Vista giocatori attiva.' : 'Vista giocatori disattivata.','success');
      }
    } catch(error) {event.target.checked=previous;showToast(humanizeError(error),'error');}
    finally { online.saving=false;event.target.disabled=false; updateOnlinePanel(); renderSaveStatus(); }
  }

  function exportBackup() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${slugify(state.settings.tournamentName)}-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  async function importBackup(file) {
    if (!file || !ensureRosterEditable()) return;
    if (file.size > 5 * 1024 * 1024) { showToast('Backup troppo grande (massimo 5 MB).', 'error'); return; }
    try {
      const raw = JSON.parse(await file.text());
      if (!raw || !Array.isArray(raw.teams) || raw.teams.length > 24 || raw.teams.length < 2 || !raw.settings || !Array.isArray(raw.matches) || raw.matches.length > 1000 || raw.teams.some(item=>!item || typeof item.name!=='string' || item.name.length>120 || typeof item.id!=='string') || new Set(raw.teams.map(item=>item.id)).size!==raw.teams.length) throw new Error('invalid_state');
      const validationError = Engine.validateStateSnapshot(raw);
      if (validationError) { showToast(validationError, 'error'); return; }
      const imported = Engine.normalizeState(raw);
      const baseState = state;
      const confirmed = await confirmAction('Importare il backup?', 'Lo stato corrente verrà sostituito integralmente.', 'Importa');
      if (!confirmed) return;
      if (state !== baseState || tournamentStarted()) { showToast('Il torneo è cambiato. Importazione annullata.', 'error'); return; }
      state = imported;
      markChanged({ render: true, immediate: true });
      showToast('Backup importato.', 'success');
    } catch (error) { showToast('File di backup non valido.', 'error'); }
  }

  async function resetScores() {
    if (!ensureRosterEditable() || !state.matches.length) return;
    const confirmed = await confirmAction('Azzerare tutti i risultati?', 'Il sorteggio o la fase iniziale resteranno; turni successivi, punteggi, campi e orari verranno rimossi.', 'Azzera risultati');
    if (!confirmed) return;
    Engine.resetScores(state);
    markChanged({ render: true, immediate: true });
    showToast('Risultati azzerati.', 'success');
  }

  async function resetTournament() {
    if (!canResetBracket()) { showToast(online.tournament && !isOwner() ? 'Solo il proprietario può eliminare il tabellone.' : 'Attendi il completamento dei salvataggi e verifica che esista un tabellone.', 'error'); return; }
    if (scoreDrafts.size) { showToast('Salva o annulla i punteggi in bozza prima di eliminare il tabellone.', 'error'); return; }
    if (hasUnsavedLocalChanges() && online.tournament) await flushOnlineSave();
    if (hasUnsavedLocalChanges() || online.savePaused || !canResetBracket()) { showToast('Completa o risolvi le modifiche in sospeso prima di eliminare il tabellone.', 'error'); return; }
    const targetId = online.tournament?.id || null;
    const targetSlug = tournamentSlug();
    const expectedUser = online.session?.user?.id || null;
    const expectedRevision = online.revision;
    const expectedVersion = localEditVersion;
    const originalState = state;
    const confirmed = await confirmAction('Eliminare il tabellone?', 'Verranno eliminate tutte le partite, i risultati e i gironi. Le squadre, le impostazioni e gli accessi admin resteranno. Il Live sarà disattivato. Prima di procedere viene conservato un backup su questo dispositivo.', 'Elimina tabellone');
    if (!confirmed) return;
    if (state !== originalState || targetId !== (online.tournament?.id || null) || targetSlug !== tournamentSlug() || expectedUser !== (online.session?.user?.id || null)
      || expectedRevision !== online.revision || expectedVersion !== localEditVersion || !canResetBracket()) {
      showToast('Il torneo è cambiato durante la conferma. Riapri l’eliminazione per controllare i dati aggiornati.', 'error');
      return;
    }
    try {
      localStorage.setItem(resetBackupKey(), JSON.stringify({state:cloneValue(state),slug:targetSlug,tournamentId:targetId,revision:expectedRevision,publicRead:Boolean(online.tournament?.public_read),userId:online.session?.user?.id || 'local',savedAt:new Date().toISOString()}));
    } catch (_) {
      showToast('Backup non riuscito: esporta una copia e libera spazio nel browser prima di riprovare. Il tabellone è ancora presente.', 'error');
      return;
    }
    clearTimeout(saveTimer);
    onlineRequest += 1;
    online.resetting = true;
    online.saving = true;
    $('mainContent').inert = true;
    setConnectionStatus('Eliminazione…');
    renderSaveStatus();
    try {
      if (targetId) {
        const row = await DB.resetTournamentBracket(targetId, expectedRevision);
        if (expectedUser !== (online.session?.user?.id || null) || targetId !== online.tournament?.id || targetSlug !== tournamentSlug()) return;
        online.tournament = row; online.revision = Number(row.revision);
        state = Engine.normalizeState(row.state);
      } else {
        state = cloneValue(state);
        Engine.resetTournament(state, { allowStarted: true });
      }
      scoreDrafts.clear(); clearDirtyTracking(localEditVersion);
      pendingRealtimeRow = null; pendingRemoteRefresh = false;
      online.savePaused = false; remoteConflict = null;
      online.resetting = false; online.saving = false;
      saveLocalState(); hideSaveProblem();
      renderAll(); switchTab('setup');
      setConnectionStatus(targetId ? 'Bozza privata' : 'Locale', targetId ? 'online' : '');
      showToast('Tabellone eliminato. Squadre conservate; puoi generare un nuovo calendario. Backup disponibile in Altro.', 'success');
    } catch (error) {
      if (expectedUser !== (online.session?.user?.id || null) || targetSlug !== tournamentSlug()) return;
      setConnectionStatus('Eliminazione non completata', 'error');
      showToast(String(error?.message || '').includes('revision_conflict')
        ? 'Un altro admin ha aggiornato il torneo. Il tabellone è ancora presente: carica la versione aggiornata e riprova.' : humanizeError(error), 'error');
    } finally {
      online.resetting = false; online.saving = false;
      $('mainContent').inert = false;
      if (expectedUser !== (online.session?.user?.id || null) || targetSlug !== tournamentSlug()) {
        await loadOnlineTournament({ quiet: true, force: true });
      } else {
        updateOnlinePanel(); renderSaveStatus();
        applyPendingRealtimeIfSafe();
      }
    }
  }

  function confirmAction(title, body, acceptLabel = 'Conferma') {
    const dialog = $('confirmDialog');
    $('confirmTitle').textContent = title;
    $('confirmBody').textContent = body;
    $('confirmAccept').textContent = acceptLabel;
    dialog.returnValue = 'cancel';
    if (typeof dialog.showModal !== 'function') return Promise.resolve(window.confirm(`${title}\n\n${body}`));
    return new Promise((resolve) => {
      const onClose = () => resolve(dialog.returnValue === 'confirm');
      dialog.addEventListener('close', onClose, { once: true });
      dialog.showModal();
    });
  }

  async function copyText(text, message) {
    try {
      await navigator.clipboard.writeText(text);
      showToast(message, 'success');
    } catch (_) {
      const textarea = document.createElement('textarea');
      textarea.value = text; document.body.appendChild(textarea); textarea.select(); document.execCommand('copy'); textarea.remove();
      showToast(message, 'success');
    }
  }

  function signed(value) {
    const number = Number(value || 0);
    return number > 0 ? `+${number}` : String(number);
  }

  function slugify(value) {
    return String(value || 'torneo').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'torneo';
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
  }

  function bindEvents() {
    $$('.nav-item').forEach((button) => button.addEventListener('click', () => switchTab(button.dataset.tab)));
    $$('.quick-tab').forEach((button) => button.addEventListener('click', () => switchTab(button.dataset.targetTab)));
    $('openLiveBtn').addEventListener('click', () => switchTab('live'));
    $('openOnlineBtn').addEventListener('click', () => switchTab('more'));
    $('themeToggle').addEventListener('change', (event) => applyTheme(event.target.checked ? 'dark' : 'light'));

    $('teamSearch').addEventListener('input',renderTeamRows);
    $('exportConflictBtn').addEventListener('click',exportBackup);
    $('reloadRemoteBtn').addEventListener('click',discardDraftAndReload);
    $('retrySaveBtn').addEventListener('click',()=>flushOnlineSave());
    $('saveNowBtn')?.addEventListener('click', async () => {
      if (!ensureEditable()) return;
      if (isEditableControl()) document.activeElement.blur();
      const stored = saveLocalState();
      if (!online.tournament && online.configured && online.session) await createOnlineTournament({ background: true });
      if (online.tournament && hasUnsavedLocalChanges()) await flushOnlineSave();
      renderSaveStatus();
      if (!scoreDrafts.size && !hasUnsavedLocalChanges() && !online.savePaused && stored) showToast(online.tournament ? 'Modifiche salvate online.' : 'Modifiche salvate su questo dispositivo.', 'success');
    });
    const structureIds=new Set(['groupCountInput','playoffSizeInput','protectGroupWinnersInput','groupAssignmentModeInput','silverEnabledInput','silverSizeInput','groupMatchRuleInput','quarterMatchRuleInput','semifinalMatchRuleInput','eliminationMatchRuleInput','tournamentNameInput','courtsInput','slotMinutesInput','eventDateInput','dayStartInput','dayEndInput','drawCodeInput']);
    for (const type of ['input','change']) document.addEventListener(type,(event)=>{
      if(structureIds.has(event.target.id) && (!canEdit() || tournamentStarted())) {event.stopImmediatePropagation();event.preventDefault();}
    },true);

    $('primaryActionBtn').addEventListener('click', () => {
      const action = $('primaryActionBtn').dataset.action;
      if (action === 'advance') advanceTournament();
      else switchTab(action || 'setup');
    });
    $('generateBtn').addEventListener('click', generateTournament);
    $('advanceBtn').addEventListener('click', advanceTournament);

    $$('#formatSelector .format-card').forEach((card) => card.addEventListener('click', () => {
      if (!ensureEditable() || state.matches.length) return;
      state.settings.format = card.dataset.format;
      if (state.settings.format === Engine.FORMATS.ROUND_ROBIN_FINAL4 && Engine.activeTeams(state).length > 10) {
        showToast('Questa formula è disponibile fino a 10 coppie.', 'error');
      }
      noteLocalEdit({wholeState:true});
      renderAll();
    }));
    $('groupCountInput').addEventListener('change', (event) => {
      state.settings.formatOptions.groupCount = Number(event.target.value);
      if (Number(state.settings.formatOptions.groupCount) === 2) {
        state.settings.formatOptions.protectGroupWinners = true;
        showToast('Con 2 gironi ho attivato la protezione: le vincitrici accederanno direttamente alle semifinali.', 'success');
      } else {
        state.settings.formatOptions.protectGroupWinners = false;
        if (Number(state.settings.formatOptions.playoffSize) === 6) state.settings.formatOptions.playoffSize = 8;
      }
      state.teams.forEach((item) => {
        if (Number(item.manualGroup) > state.settings.formatOptions.groupCount) item.manualGroup = null;
      });
      noteLocalEdit({wholeState:true});
      renderAll();
    });
    $('playoffSizeInput').addEventListener('change', (event) => {
      state.settings.formatOptions.playoffSize = Number(event.target.value);
      if (Number(state.settings.formatOptions.playoffSize) === 6) {
        state.settings.formatOptions.groupCount = 2;
        state.settings.formatOptions.protectGroupWinners = true;
        state.teams.forEach((item) => { if (Number(item.manualGroup) > 2) item.manualGroup = null; });
        showToast('Gold a 6: 1ª di ogni girone direttamente in semifinale; 2ª e 3ª ai quarti.', 'success');
      }
      noteLocalEdit({wholeState:true});
      renderAll();
    });
    $('protectGroupWinnersInput').addEventListener('change', (event) => {
      state.settings.formatOptions.protectGroupWinners = event.target.checked;
      if (event.target.checked) {
        state.settings.formatOptions.groupCount = 2;
        state.teams.forEach((item) => { if (Number(item.manualGroup) > 2) item.manualGroup = null; });
        showToast('Protezione attiva: le vincitrici dei gironi accederanno direttamente alle semifinali.', 'success');
      } else if (Number(state.settings.formatOptions.playoffSize) === 6) {
        state.settings.formatOptions.playoffSize = 8;
        showToast('Il Gold a 6 richiede la protezione: ho impostato Gold a 8 standard.', 'info');
      }
      noteLocalEdit({wholeState:true});
      renderAll();
    });
    $('groupAssignmentModeInput').addEventListener('change', (event) => {
      state.settings.formatOptions.groupAssignmentMode = event.target.value;
      noteLocalEdit({wholeState:true});
      renderAll();
    });
    $('silverEnabledInput').addEventListener('change', (event) => {
      state.settings.formatOptions.silverEnabled = event.target.checked;
      noteLocalEdit({wholeState:true});
      renderAll();
    });
    $('silverSizeInput').addEventListener('change', (event) => {
      state.settings.formatOptions.silverSize = event.target.value;
      noteLocalEdit({wholeState:true});
      updateSetupDerived();
      renderDashboard();
    });
    $('addGroupBtn')?.addEventListener('click', () => {
      if (!ensureEditable() || state.matches.length) return;
      const current = Number(state.settings.formatOptions.groupCount);
      if (current >= 8) { showToast('Puoi creare al massimo 8 gironi.', 'error'); return; }
      state.settings.formatOptions.groupCount = current + 1;
      noteLocalEdit({wholeState:true});
      renderAll();
    });
    $('removeGroupBtn')?.addEventListener('click', () => {
      if (!ensureEditable() || state.matches.length) return;
      const current = Number(state.settings.formatOptions.groupCount);
      if (current <= 2) { showToast('Servono almeno 2 gironi.', 'error'); return; }
      state.settings.formatOptions.groupCount = current - 1;
      state.teams.forEach((item) => {
        if (Number(item.manualGroup) > state.settings.formatOptions.groupCount) item.manualGroup = null;
      });
      noteLocalEdit({wholeState:true});
      renderAll();
    });
    $('balanceManualGroupsBtn').addEventListener('click', () => {
      if (!ensureEditable() || state.matches.length) return;
      Engine.prefillManualGroups(state);
      noteLocalEdit({wholeState:true});
      renderAll();
      showToast('Gironi precompilati in modo equilibrato. Puoi spostare liberamente le coppie prima dell’avvio.', 'success');
    });
    $('groupMatchRuleInput').addEventListener('change', (event) => { state.settings.formatOptions.groupMatchRule = event.target.value; saveLocalState(); updateSetupDerived(); renderDashboard(); });
    $('quarterMatchRuleInput').addEventListener('change', (event) => { state.settings.formatOptions.quarterMatchRule = event.target.value; state.settings.formatOptions.playoffMatchRule = event.target.value; saveLocalState(); updateSetupDerived(); renderDashboard(); });
    $('semifinalMatchRuleInput').addEventListener('change', (event) => { state.settings.formatOptions.semifinalMatchRule = event.target.value; saveLocalState(); updateSetupDerived(); renderDashboard(); });
    $('eliminationMatchRuleInput').addEventListener('change', (event) => { state.settings.formatOptions.eliminationMatchRule = event.target.value; saveLocalState(); updateSetupDerived(); renderDashboard(); });
    $('tournamentNameInput').addEventListener('input', (event) => { state.settings.tournamentName = event.target.value; noteLocalEdit({ wholeState: true, delay: 900 }); renderHeader(); });
    $('drawCodeInput').addEventListener('input', (event) => {
      if (!canEdit() || tournamentStarted()) return;
      state.settings.draw.code = event.target.value;
      noteLocalEdit({wholeState:true,delay:500});
    });
    const liveSettings = {
      courtsInput: ['courts', 1, 12], slotMinutesInput: ['slotMinutes', 20, 120],
      eventDateInput: ['eventDate'], dayStartInput: ['dayStart'], dayEndInput: ['dayEnd'],
    };
    for (const [id, [key, min, max]] of Object.entries(liveSettings)) $(id).addEventListener('input', (event) => {
      if (!canEdit() || tournamentStarted()) return;
      let value = event.target.value;
      if (min !== undefined) {
        if (!value.trim()) return;
        value = Number(value);
        if (!Number.isInteger(value) || value < min || value > max) return;
      } else if (key !== 'eventDate' && !/^\d{2}:\d{2}$/.test(value)) return;
      if (event.target.validity && !event.target.validity.valid) return;
      if (state.settings[key] === value) return;
      state.settings[key] = value;
      noteLocalEdit({wholeState:true,delay:500}); renderDashboard(); updateSetupDerived();
    });
    $('courtsInput').addEventListener('change', (event) => { state.settings.courts = Math.max(1, Math.min(12, Number(event.target.value) || 1)); noteLocalEdit({ wholeState: true, delay: 250 }); renderDashboard(); updateSetupDerived(); });
    $('slotMinutesInput').addEventListener('change', (event) => { state.settings.slotMinutes = Math.max(20, Math.min(120, Number(event.target.value) || 45)); noteLocalEdit({ wholeState: true, delay: 250 }); renderDashboard(); updateSetupDerived(); });
    $('eventDateInput').addEventListener('change', (event) => { state.settings.eventDate = event.target.value || ''; noteLocalEdit({ wholeState: true, delay: 250 }); renderDashboard(); updateSetupDerived(); });
    $('dayStartInput').addEventListener('change', (event) => { state.settings.dayStart = event.target.value || '08:45'; noteLocalEdit({ wholeState: true, delay: 250 }); renderDashboard(); updateSetupDerived(); });
    $('dayEndInput').addEventListener('change', (event) => { state.settings.dayEnd = event.target.value || '18:00'; noteLocalEdit({ wholeState: true, delay: 250 }); renderDashboard(); updateSetupDerived(); });
    $('loadDefaultsBtn').addEventListener('click', loadExampleTeamsTemplate);
    $('clearBulkBtn')?.addEventListener('click', clearBulkTeamsDraft);
    $('clearTeamsBtn').addEventListener('click', async () => {
      // Compatibility when an older index.html is still cached during deployment.
      if (!$('clearBulkBtn')) { clearBulkTeamsDraft(); return; }
      if (!ensureRosterEditable()) return;
      if (!state.teams.some(item => item.name.trim() || item.seed || item.manualGroup)) { showToast('L’elenco squadre è già vuoto.'); return; }
      const before = state, editVersion = localEditVersion;
      const confirmed = await confirmAction('Svuotare le squadre iscritte?', 'Verranno cancellati i nomi, le teste di serie e le assegnazioni manuali delle squadre caricate nel torneo.', 'Svuota squadre');
      if (!confirmed) return;
      if (!canEdit() || tournamentStarted() || state !== before || localEditVersion !== editVersion) { showToast('Il torneo è cambiato. Ricontrolla le squadre prima di svuotare.', 'error'); return; }
      state.teams.forEach((item) => { item.name = ''; item.seed = null; item.manualGroup = null; item.updatedAt = new Date().toISOString(); });
      markChanged({ render: true, immediate: true });
      showToast('Squadre iscritte svuotate.', 'success');
    });
    $('bulkPreviewBtn')?.addEventListener('click', renderBulkPreview);
    $('bulkApplyBtn')?.addEventListener('click', applyBulkTeams);
    $('bulkUseNumbersAsSeeds')?.addEventListener('change', renderBulkPreview);
    $('bulkTeamsInput')?.addEventListener('input', () => {
      clearTimeout(window.__bulkPreviewTimer);
      window.__bulkPreviewTimer = setTimeout(renderBulkPreview, 180);
    });

    $('phaseFilter').addEventListener('change', () => { writeUiState({ phaseFilter: $('phaseFilter').value }); renderMatches(); });
    $('statusFilter').addEventListener('change', () => { writeUiState({ statusFilter: $('statusFilter').value }); renderMatches(); });
    $('matchSearch').addEventListener('input', () => { writeUiState({ matchSearch: $('matchSearch').value }); renderMatches(); });
    $$('[data-live-view]').forEach((button) => button.addEventListener('click', () => switchLiveView(button.dataset.liveView)));
    $('copyWhatsAppBtn').addEventListener('click', () => copyText($('whatsappText').value, 'Messaggio copiato.'));

    $('adminLoginBtn').addEventListener('click', adminLogin);
    $('adminTournamentKey').addEventListener('input', (event) => { event.target.value = normalizeTournamentKey(event.target.value); });
    $('adminTournamentKey').addEventListener('keydown', (event) => { if (event.key === 'Enter') $('adminUsername').focus(); });
    $('adminPassword').addEventListener('keydown', (event) => { if (event.key === 'Enter') adminLogin(); });
    $('adminUsername').addEventListener('keydown', (event) => { if (event.key === 'Enter') $('adminPassword').focus(); });
    $('toggleAdminPasswordBtn').addEventListener('click', () => {
      const input = $('adminPassword');
      const reveal = input.type === 'password';
      input.type = reveal ? 'text' : 'password';
      $('toggleAdminPasswordBtn').textContent = reveal ? 'Nascondi' : 'Mostra';
      $('toggleAdminPasswordBtn').setAttribute('aria-label', reveal ? 'Nascondi password' : 'Mostra password');
    });
    $('newTournamentBtn').addEventListener('click',async()=>{
      if (!online.session || online.saving || online.creating) return;
      if (scoreDrafts.size || hasUnsavedLocalChanges()) { showToast('Salva o risolvi le modifiche in sospeso prima di aprire un nuovo torneo.', 'error'); return; }
      const confirmed = await confirmAction('Preparare un nuovo torneo?', 'Si aprirà una nuova scheda evento con iscrizioni vuote. Scegli nome e chiave: la prima squadra creerà la bozza privata condivisa con gli admin.', 'Prepara torneo');
      if (!confirmed) return;
      clearTimeout(saveTimer); DB.unsubscribe(); onlineRequest += 1;
      const key = generateTournamentKey();
      online.tournament = null; online.role = null; online.revision = null; online.admins = []; online.accessReady = true;
      online.savePaused = false; remoteConflict = null; pendingRealtimeRow = null;
      scoreDrafts.clear(); clearDirtyTracking(localEditVersion); hideSaveProblem(); showUnavailable('');
      setTournamentKeyInUrl(key); state = Engine.createDefaultState();
      setupDraftForm = { name: null, slug: null };
      sharedDraftRequested = false; draftCreationFailed = false;
      saveLocalState();
      setConnectionStatus('Crea o apri torneo');
      renderAll(); switchTab('more'); $('onlineTournamentName').focus();
    });
    $('signOutBtn').addEventListener('click', async () => {
      if (online.creating) { showToast('Attendi l’attivazione del torneo prima di uscire.', 'error'); return; }
      if (scoreDrafts.size) { showToast('Salva i punteggi modificati prima di uscire.', 'error'); return; }
      if (hasUnsavedLocalChanges()) {
        await flushOnlineSave();
        if (hasUnsavedLocalChanges()) { showToast('Risolvi o scarica la bozza prima di uscire.', 'error'); return; }
      }
      try {
        await DB.signOut();
        online.session = null; online.role = null; online.admins = []; online.accessReady = false;
        DB.unsubscribe(); state = Engine.createDefaultState(); renderAll(); switchTab('more');
        setConnectionStatus('Login richiesto');
      } catch (error) { showToast(humanizeError(error),'error'); }
    });
    $('generateTournamentKeyBtn').addEventListener('click', () => {
      const key = generateTournamentKey();
      $('onlineTournamentSlug').value = key;
      setupDraftForm.slug = key; saveLocalState();
      showToast('Chiave torneo generata.', 'success');
    });
    $('onlineTournamentSlug').addEventListener('input', (event) => { event.target.value = normalizeTournamentKey(event.target.value); setupDraftForm.slug = event.target.value; saveLocalState(); });
    $('onlineTournamentName').addEventListener('input', (event) => { setupDraftForm.name = event.target.value; saveLocalState(); });
    $('createOnlineBtn').addEventListener('click', createOnlineTournament);
    $('addAdminBtn').addEventListener('click', addAdministrator);
    $('newAdminUsername').addEventListener('keydown', (event) => { if (event.key === 'Enter') addAdministrator(); });
    $('adminList').addEventListener('click', (event) => {
      const button = event.target.closest('[data-admin-username]');
      if (button) removeAdministrator(button.dataset.adminUsername);
    });
    $('publicReadToggle').addEventListener('change', togglePublicRead);
    $('copyTournamentKeyBtn').addEventListener('click', () => copyText($('publicTournamentKeyField').value, 'Chiave torneo copiata.'));
    $('copyAdminLinkBtn')?.addEventListener('click', () => copyText(buildLink({live:false}), 'Link admin copiato. Ogni amministratore deve accedere con il proprio account.'));
    $('copyPublicLinkBtn').addEventListener('click', () => copyText($('publicLink').value, 'Link Live copiato.'));
    $('openPublicLinkBtn').addEventListener('click', () => {
      if (!$('publicLink').value) return;
      window.open($('publicLink').value, '_blank', 'noopener,noreferrer');
    });
    $('exportBtn').addEventListener('click', exportBackup);
    $('importInput').addEventListener('change', (event) => { importBackup(event.target.files?.[0]); event.target.value = ''; });
    $('resetScoresBtn').addEventListener('click', resetScores);
    $('resetTournamentBtn').addEventListener('click', resetTournament);
    $('downloadResetBackupBtn')?.addEventListener('click', downloadResetBackup);

    const cancelProgrammaticScrollRestore = () => {
      if (!scrollRestoreInProgress) return;
      uiRestoreToken += 1;
      scrollRestoreInProgress = false;
      suppressScrollCaptureUntil = 0;
    };
    window.addEventListener('wheel', cancelProgrammaticScrollRestore, { passive: true });
    window.addEventListener('touchmove', cancelProgrammaticScrollRestore, { passive: true });

    window.addEventListener('blur', captureBackgroundUiState);
    window.addEventListener('focus', () => scheduleResumeFromBackground(50));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        captureBackgroundUiState();
        return;
      }
      scheduleResumeFromBackground(40);
    });
    window.addEventListener('scroll', () => {
      if (
        resumeInProgress
        || scrollRestoreInProgress
        || Date.now() < suppressScrollCaptureUntil
        || document.visibilityState !== 'visible'
      ) return;
      lastVisibleScrollPositions[activeTab] = currentScrollTop();
      clearTimeout(scrollSaveTimer);
      scrollSaveTimer = setTimeout(() => rememberCurrentScroll({ value: lastVisibleScrollPositions[activeTab] }), 120);
    }, { passive: true });
    window.addEventListener('pageshow', () => {
      hydrateUiState();
      restoreUiControls();
      scheduleResumeFromBackground(20);
    });

    // Draft score fields and bulk-paste previews never write shared state.
    const trackSetup = (event) => {
      const target = event.target;
      if (!canEdit() || tournamentStarted() || !target.closest('#setup')) return;
      if (target.id === 'drawCodeInput') return;
      if (target.matches('input, select') && !target.disabled) noteLocalEdit({wholeState:true});
    };
    document.addEventListener('change', trackSetup);
    document.addEventListener('focusout', () => {
      setTimeout(async () => {
        if (hasUnsavedLocalChanges()) await flushOnlineSave();
        applyPendingRealtimeIfSafe();
        if (pendingRemoteRefresh && !hasUnsavedLocalChanges()) refreshOnlineIfSafe();
      }, 120);
    });
    window.addEventListener('beforeunload', (event) => {
      if (scoreDrafts.size || hasUnsavedLocalChanges() || online.creating || online.resetting || (localPersistenceError && !online.tournament)) { event.preventDefault(); event.returnValue = ''; }
    });
    window.addEventListener('online', () => {
      if (hasUnsavedLocalChanges() && !online.savePaused) flushOnlineSave();
      if (sharedDraftRequested && !online.tournament && !online.creating) {
        draftCreationFailed = false;
        scheduleOnlineSave(0);
      }
    });
    window.addEventListener('pagehide', () => {
      captureBackgroundUiState();
      saveLocalState();
      if (hasUnsavedLocalChanges()) flushOnlineSave();
      else if (sharedDraftRequested && !online.tournament) scheduleOnlineSave(0);
    });

    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      deferredInstallPrompt = event;
      $('installAppBtn').classList.remove('hidden');
    });
    $('installAppBtn').addEventListener('click', async () => {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      $('installAppBtn').classList.add('hidden');
    });
  }

  async function bootstrap() {
    initializeTheme();
    stabilizeMobileViewport();
    bindEvents();
    const requestedView = urlParams().get('open') || (urlParams().get('view') === 'live' ? 'live' : null);
    const savedUi = hydrateUiState();
    if (isPublicView()) activeTab = 'live';
    else if (VALID_TABS.has(requestedView)) activeTab = requestedView;
    else if (VALID_TABS.has(savedUi.activeTab)) activeTab = savedUi.activeTab;
    renderAll();
    restoreUiControls();
    if (activeTab === 'matches') renderMatches();
    if (activeTab === 'live') switchLiveView(activeLiveView, { persist: false });
    switchTab(activeTab, { restore: true, updateUrl: !isPublicView() });
    captureBackgroundUiState();
    await initializeOnline();
    if (online.configured) setInterval(async () => {
      if (document.visibilityState !== 'visible' || online.saving || scoreDrafts.size) return;
      if (isPublicView() || online.session) await loadOnlineTournament({quiet:true});
    },3000);
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js').catch((error) => console.warn('Service worker:', error));
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootstrap);
  else bootstrap();
})();
