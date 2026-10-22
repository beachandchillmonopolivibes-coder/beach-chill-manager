(function (global) {
  'use strict';

  const STATE_VERSION = 12;
  const FORMATS = Object.freeze({
    GROUPS_PLAYOFF: 'groups_playoff',
    DOUBLE_ELIMINATION: 'double_elimination',
    SINGLE_ELIMINATION: 'single_elimination',
    ROUND_ROBIN_FINAL4: 'round_robin_final4',
  });

  const FORMAT_LABELS = Object.freeze({
    [FORMATS.GROUPS_PLAYOFF]: 'Gironi + playoff',
    [FORMATS.DOUBLE_ELIMINATION]: 'Doppia eliminazione',
    [FORMATS.SINGLE_ELIMINATION]: 'Eliminazione diretta',
    [FORMATS.ROUND_ROBIN_FINAL4]: 'Girone unico + Final Four',
  });


  const MATCH_RULES = Object.freeze({
    SINGLE_21: 'single_21',
    SINGLE_15: 'single_15',
    BEST_OF_3_15: 'best_of_3_15',
    BEST_OF_3_21_15: 'best_of_3_21_15',
  });

  const MATCH_RULE_DEFINITIONS = Object.freeze({
    [MATCH_RULES.SINGLE_21]: Object.freeze({ bestOf: 1, targets: [21], label: 'Set unico a 21', shortLabel: '1 × 21' }),
    [MATCH_RULES.SINGLE_15]: Object.freeze({ bestOf: 1, targets: [15], label: 'Set unico a 15', shortLabel: '1 × 15' }),
    [MATCH_RULES.BEST_OF_3_15]: Object.freeze({ bestOf: 3, targets: [15, 15, 15], label: '2 su 3 a 15', shortLabel: '15 · 15 · 15' }),
    [MATCH_RULES.BEST_OF_3_21_15]: Object.freeze({ bestOf: 3, targets: [21, 21, 15], label: '2 su 3: 21, 21, tie-break 15', shortLabel: '21 · 21 · 15' }),
  });

  const DEFAULT_BYE_CYCLE = [2, 1, 3, 1, 2, 1];
  const INITIAL_BRACKET = 'I';
  const WINNERS_BRACKET = 'W';
  const LOSERS_BRACKET = 'L';
  const FINALS_BRACKET = 'F';
  const GROUP_BRACKET = 'G';
  const KNOCKOUT_BRACKET = 'K';
  const SILVER_BRACKET = 'S';

  // Le nuove installazioni partono senza iscritti; i backup mantengono i nomi esistenti.
  const DEFAULT_TEAMS = [];

  const DEFAULT_OPENING = [];

  function nowIso() {
    return new Date().toISOString();
  }

  function uuid() {
    if (global.crypto?.randomUUID) return global.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
      const random = Math.random() * 16 | 0;
      const value = char === 'x' ? random : (random & 0x3 | 0x8);
      return value.toString(16);
    });
  }

  function structuredCloneSafe(value) {
    if (typeof global.structuredClone === 'function') return global.structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function createDrawCode() {
    if (global.crypto?.getRandomValues) {
      const values = new Uint32Array(2);
      global.crypto.getRandomValues(values);
      return `${values[0].toString(36)}${values[1].toString(36)}`.slice(0, 10).toUpperCase();
    }
    return `${Date.now().toString(36)}${Math.floor(Math.random() * 0xffffffff).toString(36)}`.slice(-10).toUpperCase();
  }

  function hashString(value) {
    let hash = 2166136261 >>> 0;
    for (const char of String(value || 'DRAW')) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function mulberry32(seed) {
    let value = seed >>> 0;
    return function random() {
      value |= 0;
      value = value + 0x6D2B79F5 | 0;
      let t = Math.imul(value ^ value >>> 15, 1 | value);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function seededShuffle(input, random) {
    const list = [...input];
    for (let index = list.length - 1; index > 0; index -= 1) {
      const other = Math.floor(random() * (index + 1));
      [list[index], list[other]] = [list[other], list[index]];
    }
    return list;
  }

  function createDefaultState() {
    const teams = DEFAULT_TEAMS.map(([name, seed]) => ({
      id: uuid(),
      name,
      seed,
      groupId: null,
      manualGroup: null,
      losses: 0,
      byes: 0,
      initialByes: 0,
      fairByes: 0,
      technicalByes: 0,
      out: false,
      updatedAt: nowIso(),
    }));
    while (teams.length < 24) {
      teams.push({
        id: uuid(), name: '', seed: null, groupId: null, manualGroup: null,
        losses: 0, byes: 0, initialByes: 0, fairByes: 0,
        technicalByes: 0, out: false, updatedAt: nowIso(),
      });
    }

    return {
      schemaVersion: STATE_VERSION,
      teams,
      matches: [],
      groups: [],
      qualifiers: [],
      silverQualifiers: [],
      postseasonPlan: null,
      stage: -1,
      championId: null,
      silverChampionId: null,
      finalResetPlayed: false,
      settings: {
        tournamentName: global.BEACH_APP_CONFIG?.defaultTournamentName || 'Beach & Chill Monopoli Vibes',
        maxTeams: 24,
        format: FORMATS.DOUBLE_ELIMINATION,
        courts: 5,
        slotMinutes: 45,
        eventDate: '',
        dayStart: '08:45',
        dayEnd: '18:00',
        singleDay: true,
        firstSetTarget: 15,
        formatOptions: {
          groupCount: 4,
          playoffSize: 8,
          protectGroupWinners: false,
          groupAssignmentMode: 'random_protected',
          silverEnabled: false,
          silverSize: 'all',
          finalFourSize: 4,
          groupMatchRule: MATCH_RULES.SINGLE_21,
          quarterMatchRule: MATCH_RULES.SINGLE_21,
          playoffMatchRule: MATCH_RULES.SINGLE_21,
          semifinalMatchRule: MATCH_RULES.SINGLE_21,
          eliminationMatchRule: MATCH_RULES.BEST_OF_3_15,
          finalMatchRule: MATCH_RULES.BEST_OF_3_21_15,
        },
        draw: {
          code: null,
          generatedAt: null,
          explanation: 'Sorteggio casuale protetto e riproducibile.',
        },
        byePolicy: {
          mode: 'initial-ts1-then-weighted-top3',
          cycle: [...DEFAULT_BYE_CYCLE],
          cursor: 0,
          lastTeamId: null,
          history: [],
          explanation: 'TS1 riceve il bye iniziale; i successivi seguono una priorità ponderata TS1:TS2:TS3 = 3:2:1.',
        },
      },
      metadata: {
        createdAt: nowIso(),
        updatedAt: nowIso(),
      },
    };
  }

  function normalizeState(input) {
    const fallback = createDefaultState();
    const source = input && typeof input === 'object' && !Array.isArray(input) ? structuredCloneSafe(input) : fallback;
    const state = source;

    state.schemaVersion = STATE_VERSION;
    state.teams = Array.isArray(state.teams) ? state.teams : fallback.teams;
    state.matches = Array.isArray(state.matches) ? state.matches : [];
    state.groups = Array.isArray(state.groups) ? state.groups : [];
    state.qualifiers = Array.isArray(state.qualifiers) ? state.qualifiers : [];
    state.silverQualifiers = Array.isArray(state.silverQualifiers) ? state.silverQualifiers : [];
    state.postseasonPlan = state.postseasonPlan && typeof state.postseasonPlan === 'object' ? state.postseasonPlan : null;
    state.stage = Number.isInteger(state.stage) ? state.stage : -1;
    state.championId = state.championId || null;
    state.silverChampionId = state.silverChampionId || null;
    state.finalResetPlayed = Boolean(state.finalResetPlayed);

    state.settings = plainObject(state.settings);
    state.settings.tournamentName = String(state.settings.tournamentName || fallback.settings.tournamentName);
    state.settings.maxTeams = 24;
    state.settings.format = Object.values(FORMATS).includes(state.settings.format)
      ? state.settings.format
      : FORMATS.DOUBLE_ELIMINATION;
    state.settings.courts = clampInteger(state.settings.courts, 1, 12, 5);
    state.settings.slotMinutes = clampInteger(state.settings.slotMinutes, 20, 120, 45);
    state.settings.eventDate = String(state.settings.eventDate || '');
    state.settings.dayStart = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(state.settings.dayStart || '')) ? String(state.settings.dayStart) : '08:45';
    state.settings.dayEnd = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(state.settings.dayEnd || '')) ? String(state.settings.dayEnd) : '18:00';
    state.settings.singleDay = true;
    state.settings.firstSetTarget = 15;
    state.settings.formatOptions = plainObject(state.settings.formatOptions);
    state.settings.formatOptions.groupCount = clampInteger(state.settings.formatOptions.groupCount, 2, 8, 4);
    state.settings.formatOptions.playoffSize = [4, 6, 8].includes(Number(state.settings.formatOptions.playoffSize))
      ? Number(state.settings.formatOptions.playoffSize)
      : 8;
    state.settings.formatOptions.protectGroupWinners = typeof state.settings.formatOptions.protectGroupWinners === 'boolean'
      ? state.settings.formatOptions.protectGroupWinners
      : Number(state.settings.formatOptions.groupCount) === 2;
    state.settings.formatOptions.groupAssignmentMode = ['random_protected', 'manual'].includes(state.settings.formatOptions.groupAssignmentMode)
      ? state.settings.formatOptions.groupAssignmentMode
      : 'random_protected';
    state.settings.formatOptions.silverEnabled = Boolean(state.settings.formatOptions.silverEnabled);
    state.settings.formatOptions.silverSize = ['all', 4, 8, 16, '4', '8', '16'].includes(state.settings.formatOptions.silverSize)
      ? String(state.settings.formatOptions.silverSize)
      : 'all';
    state.settings.formatOptions.finalFourSize = 4;
    state.settings.formatOptions.groupMatchRule = [
      MATCH_RULES.SINGLE_21,
      MATCH_RULES.SINGLE_15,
      MATCH_RULES.BEST_OF_3_15,
      MATCH_RULES.BEST_OF_3_21_15,
    ].includes(state.settings.formatOptions.groupMatchRule)
      ? state.settings.formatOptions.groupMatchRule
      : MATCH_RULES.SINGLE_21;
    const legacyPlayoffMatchRule = normalizeMatchRule(
      state.settings.formatOptions.playoffMatchRule,
      MATCH_RULES.SINGLE_21,
    );
    state.settings.formatOptions.quarterMatchRule = normalizeMatchRule(
      state.settings.formatOptions.quarterMatchRule,
      legacyPlayoffMatchRule,
    );
    state.settings.formatOptions.semifinalMatchRule = normalizeMatchRule(
      state.settings.formatOptions.semifinalMatchRule,
      legacyPlayoffMatchRule,
    );
    // Alias mantenuto per importare e riesportare backup precedenti.
    state.settings.formatOptions.playoffMatchRule = state.settings.formatOptions.quarterMatchRule;
    state.settings.formatOptions.eliminationMatchRule = normalizeMatchRule(
      state.settings.formatOptions.eliminationMatchRule,
      MATCH_RULES.BEST_OF_3_15,
    );
    // La finale dei formati a gironi è sempre la partita classica di beach volley.
    state.settings.formatOptions.finalMatchRule = MATCH_RULES.BEST_OF_3_21_15;

    state.settings.draw = plainObject(state.settings.draw);
    state.settings.draw.code = state.settings.draw.code || null;
    state.settings.draw.generatedAt = state.settings.draw.generatedAt || null;
    state.settings.draw.explanation = state.settings.draw.explanation || fallback.settings.draw.explanation;

    state.settings.byePolicy = plainObject(state.settings.byePolicy);
    state.settings.byePolicy.mode = 'initial-ts1-then-weighted-top3';
    state.settings.byePolicy.cycle = Array.isArray(state.settings.byePolicy.cycle)
      && state.settings.byePolicy.cycle.length
      ? state.settings.byePolicy.cycle.map(Number)
      : [...DEFAULT_BYE_CYCLE];
    state.settings.byePolicy.cursor = Number.isInteger(state.settings.byePolicy.cursor)
      ? Math.abs(state.settings.byePolicy.cursor) % state.settings.byePolicy.cycle.length
      : 0;
    state.settings.byePolicy.lastTeamId = state.settings.byePolicy.lastTeamId || null;
    state.settings.byePolicy.history = Array.isArray(state.settings.byePolicy.history)
      ? state.settings.byePolicy.history
      : [];
    state.settings.byePolicy.explanation = fallback.settings.byePolicy.explanation;

    state.metadata = plainObject(state.metadata);
    state.metadata.createdAt = state.metadata.createdAt || nowIso();
    state.metadata.updatedAt = state.metadata.updatedAt || nowIso();
    if (state.matches.length && !state.metadata.startedAt) {
      state.metadata.startedAt = state.settings.draw.generatedAt || state.metadata.createdAt;
    }

    while (state.teams.length < 24) {
      state.teams.push({
        id: uuid(), name: '', seed: null, groupId: null, manualGroup: null,
        losses: 0, byes: 0, initialByes: 0, fairByes: 0,
        technicalByes: 0, out: false, updatedAt: nowIso(),
      });
    }
    state.teams = state.teams.slice(0, 24).map((value) => {
      const item = plainObject(value);
      return {
        id: item.id || uuid(),
        name: String(item.name || ''),
        seed: item.seed === '' || item.seed == null ? null : Number(item.seed),
        groupId: item.groupId || null,
        manualGroup: Number.isInteger(Number(item.manualGroup)) && Number(item.manualGroup) > 0 ? Number(item.manualGroup) : null,
        losses: Number(item.losses || 0),
        byes: Number(item.byes || 0),
        initialByes: Number(item.initialByes || 0),
        fairByes: Number(item.fairByes || 0),
        technicalByes: Number(item.technicalByes || 0),
        out: Boolean(item.out),
        updatedAt: item.updatedAt || nowIso(),
      };
    });

    state.groups = state.groups.map((value, index) => {
      const group = plainObject(value);
      return {
        id: group.id || `group-${index + 1}`,
        name: group.name || `Girone ${String.fromCharCode(65 + index)}`,
        teamIds: Array.isArray(group.teamIds) ? group.teamIds : [],
      };
    });

    state.matches = state.matches.map((value, index) => {
      const match = plainObject(value);
      return {
        id: String(match.id || `M${index + 1}`),
        bracket: String(match.bracket || INITIAL_BRACKET),
        round: String(match.round || ''),
        stage: Number.isInteger(match.stage) ? match.stage : 0,
        order: Number.isFinite(Number(match.order)) ? Number(match.order) : index + 1,
        bracketOrder: Number.isFinite(Number(match.bracketOrder)) ? Number(match.bracketOrder) : index + 1,
        aId: match.aId || null,
        bId: match.bId || null,
        groupId: match.groupId || null,
        groupRound: match.groupRound != null && match.groupRound !== '' && Number.isFinite(Number(match.groupRound)) ? Number(match.groupRound) : null,
        bye: Boolean(match.bye),
        byeKind: match.byeKind || (match.bye ? 'technical' : null),
        court: String(match.court || ''),
        startTime: String(match.startTime || ''),
        rule: normalizeMatchRule(match.rule, inferMatchRule(state, match)),
        sets: Array.isArray(match.sets) && match.sets.length === 3
          ? match.sets.map((set) => ({ a: String(set?.a ?? ''), b: String(set?.b ?? '') }))
          : [{ a: '', b: '' }, { a: '', b: '' }, { a: '', b: '' }],
        winnerId: match.winnerId || null,
        loserId: match.loserId || null,
        byeReason: match.byeReason || null,
        pairingReason: match.pairingReason || null,
        sourceA: match.sourceA || null,
        sourceB: match.sourceB || null,
        updatedAt: match.updatedAt || nowIso(),
      };
    });

    // Migrazione non distruttiva: se un torneo esistente non aveva ancora campo/orario,
    // completa automaticamente il calendario senza sovrascrivere le assegnazioni manuali.
    [...new Set(state.matches.map((match) => match.stage))]
      .sort((a, b) => a - b)
      .forEach((stage) => autoScheduleStage(state, stage));

    recomputeTeams(state);
    migrateLegacyGroupPlayoff(state);
    return state;
  }

  function plainObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function tournamentStarted(state) {
    return Boolean(state.metadata?.startedAt || state.matches?.length);
  }

  function assertDraft(state) {
    if (tournamentStarted(state)) {
      throw new Error('Torneo avviato: puoi modificare soltanto i nomi delle coppie iscritte e i punteggi. Crea un nuovo torneo per cambiare struttura.');
    }
  }

  // Controlla il file originale prima di normalizzarlo: la normalizzazione
  // serve alle migrazioni, non deve trasformare riferimenti corrotti in un
  // torneo avviato impossibile da correggere dalla pagina Squadre.
  function validateStateSnapshot(raw) {
    const object = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value));
    const identifier = (value) => typeof value === 'string' && value.trim().length > 0 && value.length <= 128;
    const optionalArray = (value) => value == null || Array.isArray(value);
    const fail = (detail) => `Backup non valido: ${detail}`;
    if (!object(raw) || !Array.isArray(raw.teams) || raw.teams.length > 24 || !object(raw.settings)
      || !Array.isArray(raw.matches) || raw.matches.length > 1000 || !optionalArray(raw.groups)) {
      return fail('struttura del file non riconosciuta.');
    }
    if (raw.settings.format != null && !Object.values(FORMATS).includes(raw.settings.format)) return fail('formula del torneo sconosciuta.');
    if (raw.settings.formatOptions != null && !object(raw.settings.formatOptions)) return fail('opzioni della formula non valide.');
    if (raw.metadata != null && !object(raw.metadata)) return fail('metadati non validi.');
    if (raw.metadata?.startedAt && (typeof raw.metadata.startedAt !== 'string' || !Number.isFinite(Date.parse(raw.metadata.startedAt)) || !raw.matches.length)) return fail('data di avvio o partite iniziali mancanti.');
    const ids = new Set();
    const activeIds = new Set();
    const activeNames = new Set();
    for (const entry of raw.teams) {
      if (!object(entry) || !identifier(entry.id) || ids.has(entry.id) || typeof entry.name !== 'string' || entry.name.length > 120) {
        return fail('identificativi o nomi delle coppie mancanti o duplicati.');
      }
      ids.add(entry.id);
      if (entry.name.trim()) {
        activeIds.add(entry.id);
        const name = entry.name.trim().toLocaleLowerCase('it');
        if (raw.matches.length && activeNames.has(name)) return fail('nomi delle coppie duplicati nel torneo avviato.');
        activeNames.add(name);
      }
      if (entry.seed != null && entry.seed !== '' && (!Number.isInteger(Number(entry.seed)) || Number(entry.seed) < 1 || Number(entry.seed) > 24)) return fail('testa di serie non valida.');
    }
    const groups = raw.groups || [];
    const groupIds = new Set();
    const membership = new Map();
    if (groups.length > 8) return fail('troppi gironi.');
    for (const group of groups) {
      if (!object(group) || !identifier(group.id) || groupIds.has(group.id) || !Array.isArray(group.teamIds)) return fail('identificativi o composizione dei gironi non validi.');
      groupIds.add(group.id);
      for (const id of group.teamIds) {
        if (!activeIds.has(id) || membership.has(id)) return fail('una coppia dei gironi non esiste oppure compare più volte.');
        membership.set(id, group.id);
      }
    }
    for (const entry of raw.teams) {
      if (entry.groupId != null && entry.groupId !== '' && (!groupIds.has(entry.groupId) || membership.get(entry.id) !== entry.groupId)) return fail('riferimento della coppia al girone incoerente.');
    }
    const brackets = new Set([INITIAL_BRACKET, WINNERS_BRACKET, LOSERS_BRACKET, FINALS_BRACKET, GROUP_BRACKET, KNOCKOUT_BRACKET, SILVER_BRACKET]);
    const matchIds = new Set();
    const byMatchId = new Map();
    const stages = new Set();
    for (const match of raw.matches) {
      if (!object(match) || !identifier(match.id) || matchIds.has(match.id) || !Number.isInteger(match.stage) || match.stage < 0 || match.stage > 1000) return fail('identificativo o fase di una partita non valido.');
      matchIds.add(match.id); byMatchId.set(match.id, match); stages.add(match.stage);
      if (match.bracket != null && !brackets.has(match.bracket)) return fail('tabellone della partita sconosciuto.');
      if (match.rule != null && !Object.values(MATCH_RULES).includes(match.rule)) return fail('regola dei set sconosciuta.');
      if (match.bye) {
        if (Boolean(match.aId) === Boolean(match.bId) || !activeIds.has(match.aId || match.bId)) return fail('il bye richiede una sola coppia iscritta.');
      } else if (!activeIds.has(match.aId) || !activeIds.has(match.bId) || match.aId === match.bId) {
        return fail('i partecipanti della partita non corrispondono a due coppie iscritte distinte.');
      }
      if (match.groupId != null && !groupIds.has(match.groupId)) return fail('girone della partita inesistente.');
      if (match.bracket === GROUP_BRACKET && (!groupIds.has(match.groupId) || membership.get(match.aId) !== match.groupId || membership.get(match.bId) !== match.groupId)) return fail('partecipanti della partita esterni al girone indicato.');
      if (match.sets != null && (!Array.isArray(match.sets) || match.sets.length !== 3 || match.sets.some((set) => !object(set)))) return fail('campi dei set non validi.');
      for (const set of match.sets || []) {
        for (const side of ['a', 'b']) {
          if (set[side] != null && set[side] !== '' && scoreNumber(set[side]) == null) return fail('i punteggi devono essere interi non negativi.');
        }
      }
      for (const field of ['winnerId', 'loserId']) {
        if (match[field] != null && ![match.aId, match.bId].includes(match[field])) return fail('vincitrice o perdente estranea alla partita.');
      }
    }
    if (raw.matches.length) {
      const maximum = Math.max(...stages);
      if (!Number.isInteger(raw.stage) || raw.stage !== maximum || !stages.has(0) || stages.size !== maximum + 1) return fail('la fase corrente non coincide con le partite presenti.');
      if (activeIds.size < 2) return fail('un torneo avviato richiede almeno due coppie.');
    } else if (raw.stage != null && raw.stage !== -1) return fail('un torneo senza partite deve essere in configurazione.');
    for (const match of raw.matches) {
      for (const field of ['sourceA', 'sourceB']) {
        if (match[field] != null && (!byMatchId.has(match[field]) || byMatchId.get(match[field]).stage >= match.stage)) return fail('riferimento a una partita precedente incoerente.');
      }
    }
    for (const field of ['championId', 'silverChampionId']) {
      if (raw[field] != null && !activeIds.has(raw[field])) return fail('campione non presente tra le coppie iscritte.');
    }
    for (const field of ['qualifiers', 'silverQualifiers']) {
      if (!optionalArray(raw[field])) return fail('elenco delle qualificate non valido.');
      const qualified = new Set();
      for (const item of raw[field] || []) {
        if (!object(item) || !activeIds.has(item.teamId) || qualified.has(item.teamId) || (item.groupId != null && !groupIds.has(item.groupId))) return fail('riferimenti delle qualificate incoerenti.');
        qualified.add(item.teamId);
      }
    }
    if (raw.postseasonPlan != null) {
      const plan = raw.postseasonPlan;
      if (!object(plan) || plan.type !== 'two-group-winners-semis' || !['preliminary', 'quarter', 'semifinal', 'final', 'complete'].includes(plan.step)
        || !Array.isArray(plan.branchMatchIds) || plan.branchMatchIds.some((id) => !matchIds.has(id))) return fail('piano dei playoff incoerente.');
      for (const field of ['winnerAId', 'winnerBId', 'secondAId', 'secondBId']) {
        if (plan[field] != null && !activeIds.has(plan[field])) return fail('partecipante del piano playoff inesistente.');
      }
    }
    try {
      // Le regole opzionali mancanti vengono inferite come per i backup legacy.
      const normalized = normalizeState(raw);
      for (const match of normalized.matches) {
        if (match.bye) {
          if (match.sets.some((set) => set.a !== '' || set.b !== '')) return fail('un bye non può contenere punteggi.');
        } else {
          const error = validateMatchScores(match);
          if (error) return fail(error);
        }
      }
    } catch (_) { return fail('dati incompatibili con questa versione.'); }
    return '';
  }

  function clampInteger(value, minimum, maximum, fallback) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed)) return fallback;
    return Math.max(minimum, Math.min(maximum, parsed));
  }

  function team(state, id) {
    return state.teams.find((item) => item.id === id) || null;
  }

  function teamByName(state, name) {
    const normalized = String(name || '').trim().toLocaleLowerCase('it');
    return state.teams.find((item) => item.name.trim().toLocaleLowerCase('it') === normalized) || null;
  }

  function activeTeams(state) {
    return state.teams.filter((item) => item.name.trim());
  }

  function seedRank(item) {
    return Number(item?.seed) || 999;
  }

  function sortBySeed(list) {
    // A parità di ranking, l’ordine d’iscrizione resta stabile anche dopo un cambio di nome.
    return [...list].sort((a, b) => seedRank(a) - seedRank(b));
  }

  function formatLabel(format) {
    return FORMAT_LABELS[format] || 'Torneo';
  }

  function normalizeMatchRule(value, fallback = MATCH_RULES.BEST_OF_3_15) {
    return Object.values(MATCH_RULES).includes(value) ? value : fallback;
  }

  function matchRuleDefinition(value) {
    const key = typeof value === 'string' ? value : value?.rule;
    return MATCH_RULE_DEFINITIONS[normalizeMatchRule(key)] || MATCH_RULE_DEFINITIONS[MATCH_RULES.BEST_OF_3_15];
  }

  function matchRuleLabel(match) {
    return matchRuleDefinition(match).label;
  }

  function isGroupBasedFormat(format) {
    return [FORMATS.GROUPS_PLAYOFF, FORMATS.ROUND_ROBIN_FINAL4].includes(format);
  }

  function groupPostseasonRule(state, roundLabel) {
    const label = String(roundLabel || '').toLocaleLowerCase('it');
    if (label.includes('semifinal')) return state.settings.formatOptions.semifinalMatchRule;
    if (label.includes('quarti') || label.includes('ottavi') || label.includes('preliminar')) {
      return state.settings.formatOptions.quarterMatchRule;
    }
    if (/(^|·\s*)finale\b/.test(label)) return state.settings.formatOptions.finalMatchRule;
    return state.settings.formatOptions.quarterMatchRule;
  }

  function inferMatchRule(state, match) {
    if (match?.bracket === GROUP_BRACKET) return state.settings.formatOptions.groupMatchRule;
    if ([KNOCKOUT_BRACKET, SILVER_BRACKET].includes(match?.bracket) && isGroupBasedFormat(state.settings.format)) {
      return groupPostseasonRule(state, match?.round);
    }
    return state.settings.formatOptions.eliminationMatchRule || MATCH_RULES.BEST_OF_3_15;
  }

  function resolveMatchRule(state, options = {}) {
    return normalizeMatchRule(options.rule, inferMatchRule(state, options));
  }

  function scoreNumber(value) {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    if (!/^\d+$/.test(String(value))) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
  }

  function setWinnerSide(set, target) {
    if (!set || set.a === '' || set.b === '') return null;
    const a = scoreNumber(set.a);
    const b = scoreNumber(set.b);
    if (a == null || b == null || a === b) return null;
    const minimum = Number(target || 15);
    const maximum = Math.max(a, b);
    const difference = Math.abs(a - b);
    if (maximum < minimum || difference < 2) return null;
    // Dopo la soglia il set termina al primo vantaggio di due punti.
    if (maximum > minimum && difference !== 2) return null;
    return a > b ? 'a' : 'b';
  }

  function matchStatus(match) {
    if (match.bye) return 'BYE';
    if (!match.aId || !match.bId) return 'IN ATTESA';
    return match.winnerId ? 'CONCLUSA' : 'DA GIOCARE';
  }

  function analyzeMatchScores(match) {
    if (match.bye) return { winnerId: match.aId || match.bId || null, error: null };
    if (!match.aId || !match.bId || match.aId === match.bId) return { winnerId: null, error: 'La partita richiede due coppie distinte.' };
    const definition = matchRuleDefinition(match);
    const sets = Array.isArray(match.sets) ? match.sets : [];
    let aSets = 0;
    let bSets = 0;
    let incomplete = false;
    let winnerId = null;
    for (let index = 0; index < Math.max(sets.length, 3); index += 1) {
      const set = sets[index] || { a: '', b: '' };
      const enteredA = set.a != null && set.a !== '';
      const enteredB = set.b != null && set.b !== '';
      const entered = enteredA || enteredB;
      if (!entered) {
        if (index < definition.targets.length) incomplete = true;
        continue;
      }
      if (index >= definition.targets.length) return { winnerId: null, error: 'Sono presenti punti in un set non previsto.' };
      if (winnerId) return { winnerId: null, error: 'Non si può giocare un altro set dopo la vittoria della partita.' };
      if (incomplete) return { winnerId: null, error: 'Completa il set precedente prima di inserire quello successivo.' };
      const a = enteredA ? scoreNumber(set.a) : null;
      const b = enteredB ? scoreNumber(set.b) : null;
      if ((enteredA && a == null) || (enteredB && b == null)) {
        return { winnerId: null, error: 'I punti devono essere numeri interi non negativi.' };
      }
      if (!enteredA || !enteredB) { incomplete = true; continue; }
      const target = definition.targets[index];
      if (Math.max(a, b) > target && Math.abs(a - b) > 2) {
        return { winnerId: null, error: `Punteggio impossibile nel set ${index + 1}: oltre ${target} il set termina con due punti di vantaggio.` };
      }
      const side = setWinnerSide(set, target);
      if (!side) { incomplete = true; continue; }
      if (side === 'a') aSets += 1;
      else bSets += 1;
      const required = definition.bestOf === 1 ? 1 : 2;
      if (aSets === required) winnerId = match.aId;
      if (bSets === required) winnerId = match.bId;
    }
    return { winnerId, error: null };
  }

  function validateMatchScores(match) {
    return analyzeMatchScores(match).error;
  }

  function scoreWinner(match) {
    const result = analyzeMatchScores(match);
    return result.error ? null : result.winnerId;
  }

  function refreshMatchWinner(match) {
    const winner = scoreWinner(match);
    match.winnerId = winner;
    if (!winner || match.bye) {
      match.loserId = null;
      return;
    }
    match.loserId = match.aId === winner ? match.bId : match.aId;
  }

  function validateTeams(state) {
    const active = activeTeams(state);
    if (active.length < 2 || active.length > 24) return 'Inserisci da 2 a 24 coppie.';
    const dayStart = scheduleTimeToMinutes(state.settings.dayStart);
    const dayEnd = scheduleTimeToMinutes(state.settings.dayEnd);
    if (dayStart == null || dayEnd == null || dayEnd <= dayStart) return 'L’orario di fine deve seguire quello di inizio nella stessa giornata.';

    const names = new Set();
    const seeds = new Set();
    const ids = state.teams.map((item) => item.id);
    if (new Set(ids).size !== ids.length || ids.some((id) => typeof id !== 'string' || !id)) return 'Gli identificativi delle coppie devono essere univoci e non vuoti.';
    for (const item of active) {
      const name = item.name.trim().toLocaleLowerCase('it');
      if (names.has(name)) return `Nome duplicato: ${item.name}`;
      names.add(name);
      if (item.seed == null || item.seed === '') continue;
      const rank = Number(item.seed);
      if (!Number.isInteger(rank) || rank < 1 || rank > active.length) {
        return `Testa di serie non valida per ${item.name}.`;
      }
      if (seeds.has(rank)) return `Testa di serie duplicata: ${rank}.`;
      seeds.add(rank);
    }

    const format = state.settings.format;
    if (format === FORMATS.DOUBLE_ELIMINATION) {
      const maxSeeds = Math.ceil(active.length / 2);
      if (seeds.size > maxSeeds) {
        return `Con ${active.length} coppie puoi proteggere al massimo ${maxSeeds} teste di serie nel turno iniziale.`;
      }
    }

    if (format === FORMATS.GROUPS_PLAYOFF) {
      const groups = Number(state.settings.formatOptions.groupCount);
      const playoff = Number(state.settings.formatOptions.playoffSize);
      if (!Number.isInteger(groups) || groups < 2 || groups > 8 || groups > active.length) {
        return 'Scegli un numero di gironi valido (da 2 a 8).';
      }
      if (![4, 6, 8].includes(playoff) || playoff > active.length) {
        return 'La dimensione del playoff deve essere 4, 6 o 8 e non può superare le coppie iscritte.';
      }
      const protectWinners = Boolean(state.settings.formatOptions.protectGroupWinners);
      if (playoff === 6 && !protectWinners) {
        return 'Il playoff a 6 richiede la protezione delle vincitrici dei gironi.';
      }
      if (protectWinners && groups !== 2) {
        return 'Per mandare le vincitrici dei gironi direttamente in semifinale servono esattamente 2 gironi.';
      }
      const requiredPerGroup = protectWinners ? playoff / 2 : 2;
      if (protectWinners && Math.floor(active.length / groups) < requiredPerGroup) {
        return `Con Gold a ${playoff} servono almeno ${requiredPerGroup} coppie per girone.`;
      }
      if (playoff < groups) {
        return 'Il playoff deve avere almeno tanti posti quanti sono i gironi, per qualificare tutte le vincitrici.';
      }
      if (Math.floor(active.length / groups) < 2) {
        return 'Ogni girone deve contenere almeno due coppie.';
      }
      const assignmentMode = state.settings.formatOptions.groupAssignmentMode;
      if (assignmentMode === 'manual') {
        const counts = new Array(groups).fill(0);
        for (const item of active) {
          const groupNumber = Number(item.manualGroup);
          if (!Number.isInteger(groupNumber) || groupNumber < 1 || groupNumber > groups) {
            return `Assegna ${item.name} a uno dei ${groups} gironi.`;
          }
          counts[groupNumber - 1] += 1;
        }
        const minimumGroupSize = protectWinners ? playoff / 2 : 2;
        const invalidGroup = counts.findIndex((count) => count < minimumGroupSize);
        if (invalidGroup >= 0) {
          return protectWinners
            ? `Il Girone ${String.fromCharCode(65 + invalidGroup)} deve contenere almeno ${minimumGroupSize} coppie per il Gold a ${playoff} con vincitrice direttamente in semifinale.`
            : `Il Girone ${String.fromCharCode(65 + invalidGroup)} deve contenere almeno due coppie.`;
        }
      }
      if (state.settings.formatOptions.silverEnabled) {
        const availableForSilver = active.length - playoff;
        if (availableForSilver < 2) {
          return 'Il Silver Bracket richiede almeno due coppie non qualificate al playoff Gold.';
        }
      }
    }

    if (format === FORMATS.ROUND_ROBIN_FINAL4) {
      if (active.length < 4) return 'Il Girone unico + Final Four richiede almeno 4 coppie.';
      if (active.length > 10) return 'Il Girone unico + Final Four è disponibile fino a 10 coppie, per evitare un numero eccessivo di partite.';
    }

    return null;
  }

  function createMatch(state, options) {
    const match = {
      id: options.id,
      bracket: options.bracket,
      round: options.round,
      stage: options.stage,
      order: Number(options.order || state.matches.length + 1),
      bracketOrder: Number(options.bracketOrder || options.order || state.matches.length + 1),
      aId: options.aId || null,
      bId: options.bId || null,
      groupId: options.groupId || null,
      groupRound: Number(options.groupRound || 0) || null,
      bye: Boolean(options.bye),
      byeKind: options.bye ? (options.byeKind || 'technical') : null,
      court: String(options.court || ''),
      startTime: String(options.startTime || ''),
      rule: resolveMatchRule(state, options),
      sets: [{ a: '', b: '' }, { a: '', b: '' }, { a: '', b: '' }],
      winnerId: null,
      loserId: null,
      byeReason: options.byeReason || null,
      pairingReason: options.pairingReason || null,
      sourceA: options.sourceA || null,
      sourceB: options.sourceB || null,
      updatedAt: nowIso(),
    };
    if (match.bye) match.winnerId = match.aId || match.bId;
    state.matches.push(match);
    return match;
  }


  function scheduleTimeToMinutes(value) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || ''));
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return hours * 60 + minutes;
  }

  function scheduleMinutesToTime(value) {
    const minutes = Math.round(Number(value));
    if (!Number.isFinite(minutes) || minutes < 0 || minutes >= 1440) return '';
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  }

  function isPlayableMatch(match) {
    return Boolean(match && !match.bye && match.aId && match.bId);
  }

  function autoScheduleStage(state, stage, options = {}) {
    const force = Boolean(options.force);
    const courts = Math.max(1, Number(state.settings.courts) || 1);
    const slotMinutes = Math.max(20, Number(state.settings.slotMinutes) || 45);
    const dayStart = scheduleTimeToMinutes(state.settings.dayStart) ?? 525;
    const dayEnd = scheduleTimeToMinutes(state.settings.dayEnd) ?? 1080;
    const stageMatches = state.matches
      .filter((match) => match.stage === stage && isPlayableMatch(match))
      .sort((a, b) => (a.groupRound || 0) - (b.groupRound || 0) || a.order - b.order || a.bracketOrder - b.bracketOrder);
    const stageIds = new Set(stageMatches.map((match) => match.id));
    state.metadata.scheduleWarnings = (Array.isArray(state.metadata.scheduleWarnings) ? state.metadata.scheduleWarnings : [])
      .filter((entry) => !stageIds.has(entry.matchId));
    if (!stageMatches.length) return state;

    const previous = state.matches.filter((match) => match.stage < stage && isPlayableMatch(match));
    const previousScheduled = previous.filter((match) => scheduleTimeToMinutes(match.startTime) != null && match.court);
    const previousLastStart = previousScheduled.length
      ? Math.max(...previousScheduled.map((match) => scheduleTimeToMinutes(match.startTime)))
      : null;
    const baseStart = previousLastStart == null ? dayStart : Math.max(dayStart, previousLastStart + slotMinutes * 2);
    const courtBookings = new Map();
    const teamBookings = new Map();
    const reserve = (match, start) => {
      if (!courtBookings.has(match.court)) courtBookings.set(match.court, []);
      courtBookings.get(match.court).push(start);
      [match.aId, match.bId].forEach((id) => {
        if (!teamBookings.has(id)) teamBookings.set(id, []);
        teamBookings.get(id).push(start);
      });
    };
    previousScheduled.forEach((match) => reserve(match, scheduleTimeToMinutes(match.startTime)));
    const existing = force ? [] : stageMatches.filter((match) => scheduleTimeToMinutes(match.startTime) != null && match.court);
    existing.forEach((match) => reserve(match, scheduleTimeToMinutes(match.startTime)));
    const existingIds = new Set(existing.map((match) => match.id));
    const missingPrevious = previousScheduled.length !== previous.length;
    const warn = (match, reason) => state.metadata.scheduleWarnings.push({ matchId: match.id, reason });

    existing.forEach((match) => {
      const start = scheduleTimeToMinutes(match.startTime);
      if (start < dayStart || start + slotMinutes > dayEnd) warn(match, 'Orario importato fuori dalla fascia della giornata.');
      if ((courtBookings.get(match.court) || []).filter((other) => Math.abs(start - other) < slotMinutes).length > 1) {
        warn(match, 'Assegnazione importata in conflitto con un’altra partita sullo stesso campo.');
      }
      if ([match.aId, match.bId].some((id) => (teamBookings.get(id) || []).filter((other) => Math.abs(start - other) < slotMinutes).length > 1)) {
        warn(match, 'Una coppia risulta impegnata contemporaneamente in un’altra partita importata.');
      }
    });

    stageMatches.forEach((match) => {
      if (existingIds.has(match.id)) return;
      let assigned = false;
      if (!missingPrevious) {
        for (let start = baseStart; start + slotMinutes <= dayEnd && !assigned; start += slotMinutes) {
          // Un intervallo libero fra due gare della stessa coppia offre riposo
          // e protegge dalle partite che superano la durata indicativa dello slot.
          const teamBusy = [match.aId, match.bId].some((id) => (teamBookings.get(id) || []).some((other) => Math.abs(start - other) < slotMinutes * 2));
          if (teamBusy) continue;
          for (let number = 1; number <= courts; number += 1) {
            const court = `Campo ${number}`;
            if ((courtBookings.get(court) || []).some((other) => Math.abs(start - other) < slotMinutes)) continue;
            match.startTime = scheduleMinutesToTime(start);
            match.court = court;
            reserve(match, start);
            assigned = true;
            break;
          }
        }
      }
      if (!assigned) {
        match.startTime = '';
        match.court = '';
        warn(match, missingPrevious
          ? 'Calendario non assegnato: alcune partite delle fasi precedenti non hanno uno slot disponibile.'
          : 'Nessuno slot disponibile entro l’orario di fine giornata; aumenta i campi o amplia la fascia prima dell’avvio.');
      }
      match.updatedAt = nowIso();
    });
    return state;
  }

  function registerBye(state, item, match, reason, kind) {
    if (!item) return;
    state.settings.byePolicy.history.push({
      at: nowIso(), stage: match.stage, bracket: match.bracket,
      matchId: match.id, teamId: item.id, seed: item.seed,
      kind: kind || match.byeKind || 'technical', reason,
      cursor: state.settings.byePolicy.cursor,
    });
  }

  function clearCompetition(state) {
    state.matches = [];
    state.groups = [];
    state.qualifiers = [];
    state.silverQualifiers = [];
    state.postseasonPlan = null;
    state.stage = -1;
    state.championId = null;
    state.silverChampionId = null;
    state.finalResetPlayed = false;
    state.settings.draw.code = null;
    state.settings.draw.generatedAt = null;
    state.settings.byePolicy.cursor = 0;
    state.settings.byePolicy.lastTeamId = null;
    state.settings.byePolicy.history = [];
    state.teams.forEach((item) => {
      item.groupId = null;
      item.losses = 0;
      item.byes = 0;
      item.initialByes = 0;
      item.fairByes = 0;
      item.technicalByes = 0;
      item.out = false;
    });
  }

  function isKnockoutFinalMatch(match) {
    if (!match || ![KNOCKOUT_BRACKET, SILVER_BRACKET].includes(match.bracket)) return false;
    const segments = String(match.round || '').split('·').map((item) => item.trim().toLocaleLowerCase('it'));
    return segments.at(-1) === 'finale';
  }

  function latestFinalMatch(state, bracket) {
    return state.matches
      .filter((match) => match.bracket === bracket && isKnockoutFinalMatch(match))
      .sort((a, b) => b.stage - a.stage || b.order - a.order || b.bracketOrder - a.bracketOrder)[0] || null;
  }

  function syncKnockoutChampions(state) {
    if (state.settings.format === FORMATS.DOUBLE_ELIMINATION) {
      const finalOne = state.matches.find((match) => match.id === 'F1');
      const finalTwo = state.matches.find((match) => match.id === 'F2');
      state.finalResetPlayed = Boolean(finalTwo);
      state.championId = finalTwo
        ? finalTwo.winnerId || null
        : finalOne?.winnerId === finalOne?.aId ? finalOne?.winnerId || null : null;
      return;
    }
    if (![FORMATS.GROUPS_PLAYOFF, FORMATS.ROUND_ROBIN_FINAL4, FORMATS.SINGLE_ELIMINATION].includes(state.settings.format)) return;

    const goldFinal = latestFinalMatch(state, KNOCKOUT_BRACKET);
    state.championId = goldFinal?.winnerId || null;

    const silverFinal = latestFinalMatch(state, SILVER_BRACKET);
    if (silverFinal) state.silverChampionId = silverFinal.winnerId || null;
    else state.silverChampionId = null;

    const plan = state.postseasonPlan;
    if (plan?.type === 'two-group-winners-semis' && ['final', 'complete'].includes(plan.step)) {
      const protectedFinal = state.matches.find((match) => match.id === plan.branchMatchIds?.[0]) || goldFinal;
      if (protectedFinal?.winnerId) {
        state.championId = protectedFinal.winnerId;
        plan.step = 'complete';
      } else if (plan.step === 'complete') {
        plan.step = 'final';
      }
    }
  }

  function recomputeTeams(state) {
    const format = state.settings.format;
    state.teams.forEach((item) => {
      item.losses = 0;
      item.byes = 0;
      item.initialByes = 0;
      item.fairByes = 0;
      item.technicalByes = 0;
      item.out = false;
    });

    for (const match of state.matches) {
      refreshMatchWinner(match);
      if (match.bye && match.winnerId) {
        const winner = team(state, match.winnerId);
        if (winner) {
          winner.byes += 1;
          if (match.byeKind === 'initial') winner.initialByes += 1;
          else if (match.byeKind === 'fair') winner.fairByes += 1;
          else winner.technicalByes += 1;
        }
      }
      if (match.loserId && match.bracket !== GROUP_BRACKET) {
        const loser = team(state, match.loserId);
        if (loser) loser.losses += 1;
      }
    }

    if (format === FORMATS.DOUBLE_ELIMINATION) {
      state.teams.forEach((item) => { item.out = item.losses >= 2; });
    } else if (format === FORMATS.SINGLE_ELIMINATION) {
      const losers = new Set(state.matches.filter((m) => m.bracket === KNOCKOUT_BRACKET && m.loserId).map((m) => m.loserId));
      state.teams.forEach((item) => { item.out = losers.has(item.id); });
    } else if ([FORMATS.GROUPS_PLAYOFF, FORMATS.ROUND_ROBIN_FINAL4].includes(format)) {
      const knockoutMatches = state.matches.filter((m) => [KNOCKOUT_BRACKET, SILVER_BRACKET].includes(m.bracket));
      if (knockoutMatches.length) {
        const participants = new Set(knockoutMatches.flatMap((m) => [m.aId, m.bId]).filter(Boolean));
        const losers = new Set(knockoutMatches.filter((m) => m.loserId).map((m) => m.loserId));
        activeTeams(state).forEach((item) => {
          item.out = !participants.has(item.id) || losers.has(item.id);
        });
      }
    }

    syncKnockoutChampions(state);
    state.metadata.updatedAt = nowIso();
  }

  function currentStage(state) {
    if (!state.matches.length) return -1;
    return Math.max(...state.matches.map((match) => match.stage));
  }

  function currentStageMatches(state) {
    const stage = currentStage(state);
    return state.matches.filter((match) => match.stage === stage);
  }

  function stageComplete(state, stage = currentStage(state)) {
    const matches = state.matches.filter((match) => match.stage === stage);
    return matches.length > 0 && matches.every((match) => match.bye || Boolean(match.winnerId));
  }

  function nextId(state, prefix) {
    let index = 1;
    while (state.matches.some((match) => match.id === `${prefix}${index}`)) index += 1;
    return `${prefix}${index}`;
  }

  function matchIndex(state, match) {
    return state.matches.indexOf(match);
  }

  function lastMatchRecord(state, teamId) {
    let found = null;
    for (const match of state.matches) {
      if (![match.aId, match.bId, match.winnerId, match.loserId].includes(teamId)) continue;
      if (!found || match.stage > found.match.stage
        || (match.stage === found.match.stage && matchIndex(state, match) > matchIndex(state, found.match))) {
        found = { match, won: match.winnerId === teamId, lost: match.loserId === teamId };
      }
    }
    return found;
  }

  function hasPlayed(state, aId, bId) {
    if (!aId || !bId) return false;
    return state.matches.some((match) => !match.bye
      && ((match.aId === aId && match.bId === bId) || (match.aId === bId && match.bId === aId))
      && Boolean(match.winnerId));
  }

  function spreadIndices(total, count) {
    if (total <= 0 || count <= 0) return [];
    const selected = [0];
    if (count > 1 && total > 1) selected.push(total - 1);
    while (selected.length < Math.min(count, total)) {
      let best = null;
      let bestScore = null;
      for (let candidate = 0; candidate < total; candidate += 1) {
        if (selected.includes(candidate)) continue;
        const minimum = Math.min(...selected.map((position) => Math.abs(position - candidate)));
        const totalDistance = selected.reduce((sum, position) => sum + Math.abs(position - candidate), 0);
        const score = [minimum, totalDistance, -candidate];
        if (!bestScore || score[0] > bestScore[0]
          || (score[0] === bestScore[0] && score[1] > bestScore[1])
          || (score[0] === bestScore[0] && score[1] === bestScore[1] && score[2] > bestScore[2])) {
          best = candidate;
          bestScore = score;
        }
      }
      selected.push(best);
    }
    return selected;
  }

  function generateProtectedOpening(state, active, drawCode) {
    const random = mulberry32(hashString(drawCode));
    const seeded = sortBySeed(active.filter((item) => item.seed != null));
    const seedOne = seeded.find((item) => Number(item.seed) === 1) || seeded[0] || null;
    const initialBye = active.length % 2 === 1 ? (seedOne || seededShuffle(active, random)[0]) : null;
    const remaining = active.filter((item) => item.id !== initialBye?.id);
    const protectedTeams = sortBySeed(remaining.filter((item) => item.seed != null));
    const unseeded = seededShuffle(remaining.filter((item) => item.seed == null), random);
    const entries = [];

    for (const seededTeam of protectedTeams) {
      const opponent = unseeded.shift();
      if (!opponent) throw new Error('Troppe teste di serie: non è possibile evitare uno scontro TS–TS nel turno iniziale.');
      const flip = random() > 0.5;
      entries.push({
        a: flip ? opponent : seededTeam,
        b: flip ? seededTeam : opponent,
        seedRank: Number(seededTeam.seed),
        pairingReason: `Sorteggio protetto: TS ${seededTeam.seed} contro una coppia non testa di serie.`,
      });
    }

    while (unseeded.length >= 2) {
      const a = unseeded.shift();
      const b = unseeded.shift();
      entries.push({ a, b, seedRank: 999, pairingReason: 'Sorteggio casuale tra coppie non teste di serie.' });
    }

    if (initialBye) {
      entries.push({
        a: initialBye, b: null, seedRank: seedRank(initialBye), bye: true,
        byeKind: 'initial',
        byeReason: initialBye.seed ? `Bye iniziale assegnato alla TS ${initialBye.seed}.` : 'Bye iniziale tecnico.',
        pairingReason: 'Bye iniziale dovuto al numero dispari di coppie.',
      });
    }

    const ordered = new Array(entries.length).fill(null);
    const protectedEntries = entries.filter((entry) => entry.seedRank < 999).sort((a, b) => a.seedRank - b.seedRank);
    const others = seededShuffle(entries.filter((entry) => entry.seedRank >= 999), random);
    const positions = spreadIndices(entries.length, protectedEntries.length);
    protectedEntries.forEach((entry, index) => { ordered[positions[index]] = entry; });
    const empty = ordered.map((entry, index) => entry ? null : index).filter((index) => index != null);
    others.forEach((entry, index) => { ordered[empty[index]] = entry; });

    ordered.forEach((entry, index) => {
      const match = createMatch(state, {
        id: `I${index + 1}`, bracket: INITIAL_BRACKET, round: 'Turno iniziale',
        stage: 0, order: index + 1, bracketOrder: index + 1,
        aId: entry.a?.id, bId: entry.b?.id, bye: Boolean(entry.bye),
        byeKind: entry.byeKind, court: entry.bye ? 'AUTO · BYE' : '',
        byeReason: entry.byeReason, pairingReason: entry.pairingReason,
      });
      if (entry.bye) registerBye(state, entry.a, match, entry.byeReason, entry.byeKind);
    });
  }

  function chooseFairBye(state, list, bracket, stage) {
    if (list.length % 2 === 0) return null;
    const policy = state.settings.byePolicy;
    const lastId = policy.lastTeamId;
    const canAvoidConsecutive = list.some((item) => item.id !== lastId);
    const cycle = policy.cycle;

    for (let offset = 0; offset < cycle.length; offset += 1) {
      const cycleIndex = (policy.cursor + offset) % cycle.length;
      const rank = Number(cycle[cycleIndex]);
      const candidate = list.find((item) => Number(item.seed) === rank);
      if (!candidate) continue;
      if (canAvoidConsecutive && candidate.id === lastId) continue;
      policy.cursor = (cycleIndex + 1) % cycle.length;
      policy.lastTeamId = candidate.id;
      return {
        team: candidate, kind: 'fair',
        reason: `Bye fair nel ${bracket === WINNERS_BRACKET ? 'Winner' : 'Loser'} Bracket: priorità ponderata assegnata alla TS ${rank}.`,
      };
    }

    const sorted = [...list].sort((a, b) => {
      const consecutiveA = canAvoidConsecutive && a.id === lastId ? 1 : 0;
      const consecutiveB = canAvoidConsecutive && b.id === lastId ? 1 : 0;
      return consecutiveA - consecutiveB
        || a.fairByes - b.fairByes
        || a.byes - b.byes
        || seedRank(a) - seedRank(b)
        || state.teams.indexOf(a) - state.teams.indexOf(b);
    });
    const candidate = sorted[0];
    policy.lastTeamId = candidate.id;
    return {
      team: candidate, kind: 'technical',
      reason: `Bye tecnico nello stage ${stage}: assegnato alla coppia eleggibile con meno bye, privilegiando il ranking.`,
    };
  }

  function entrantForTeam(state, item) {
    const record = lastMatchRecord(state, item.id);
    return {
      team: item,
      sourceMatchId: record?.match?.id || null,
      pathOrder: record?.match?.bracketOrder || record?.match?.order || seedRank(item),
      freshDrop: Boolean(record?.lost && record.match.bracket === WINNERS_BRACKET),
    };
  }

  function makeWinnersRound(state, teams, stage) {
    const entrants = teams.map((item) => entrantForTeam(state, item))
      .sort((a, b) => a.pathOrder - b.pathOrder || seedRank(a.team) - seedRank(b.team));
    const selection = chooseFairBye(state, teams, WINNERS_BRACKET, stage);
    const byeId = selection?.team?.id || null;
    const playing = entrants.filter((entry) => entry.team.id !== byeId);
    const specs = [];

    if (selection) {
      const entry = entrants.find((candidate) => candidate.team.id === byeId);
      specs.push({ bye: true, entry, selection, bracketOrder: entry.pathOrder });
    }
    for (let index = 0; index < playing.length; index += 2) {
      specs.push({ bye: false, a: playing[index], b: playing[index + 1], bracketOrder: Math.min(playing[index].pathOrder, playing[index + 1].pathOrder) });
    }
    specs.sort((a, b) => a.bracketOrder - b.bracketOrder);

    specs.forEach((spec, index) => {
      if (spec.bye) {
        const match = createMatch(state, {
          id: nextId(state, WINNERS_BRACKET), bracket: WINNERS_BRACKET,
          round: 'Tabellone Vincenti', stage, order: index + 1, bracketOrder: index + 1,
          aId: spec.entry.team.id, bye: true, byeKind: spec.selection.kind,
          court: 'AUTO · BYE', byeReason: spec.selection.reason,
          pairingReason: 'Passaggio automatico nel Winner Bracket.', sourceA: spec.entry.sourceMatchId,
        });
        registerBye(state, spec.entry.team, match, spec.selection.reason, spec.selection.kind);
      } else {
        createMatch(state, {
          id: nextId(state, WINNERS_BRACKET), bracket: WINNERS_BRACKET,
          round: 'Tabellone Vincenti', stage, order: index + 1, bracketOrder: index + 1,
          aId: spec.a.team.id, bId: spec.b.team.id,
          pairingReason: 'Percorso fisso: si incontrano i vincitori dei rami adiacenti.',
          sourceA: spec.a.sourceMatchId, sourceB: spec.b.sourceMatchId,
        });
      }
    });
  }

  function buildTargetPartnerMap(entrants) {
    const target = new Map();
    const drops = entrants.filter((entry) => entry.freshDrop).sort((a, b) => a.pathOrder - b.pathOrder);
    const survivors = entrants.filter((entry) => !entry.freshDrop).sort((a, b) => a.pathOrder - b.pathOrder);
    const used = new Set();
    if (drops.length && survivors.length) {
      const reversed = [...survivors].reverse();
      const count = Math.min(drops.length, reversed.length);
      for (let index = 0; index < count; index += 1) {
        target.set(drops[index].team.id, reversed[index].team.id);
        target.set(reversed[index].team.id, drops[index].team.id);
        used.add(drops[index].team.id);
        used.add(reversed[index].team.id);
      }
    }
    const remaining = entrants.filter((entry) => !used.has(entry.team.id)).sort((a, b) => a.pathOrder - b.pathOrder);
    let left = 0;
    let right = remaining.length - 1;
    while (left < right) {
      target.set(remaining[left].team.id, remaining[right].team.id);
      target.set(remaining[right].team.id, remaining[left].team.id);
      left += 1;
      right -= 1;
    }
    return target;
  }

  function pairCost(state, a, b, targetMap, mixedAvailable) {
    let cost = 0;
    if (hasPlayed(state, a.team.id, b.team.id)) cost += 100000;
    if (targetMap.get(a.team.id) !== b.team.id) cost += 180;
    if (mixedAvailable && a.freshDrop === b.freshDrop) cost += 1500;
    cost += Math.abs(a.pathOrder - b.pathOrder);
    cost += Math.abs(seedRank(a.team) - seedRank(b.team)) / 1000;
    return cost;
  }

  function minimumCostPairing(state, entrants, targetMap) {
    const count = entrants.length;
    if (!count) return [];
    if (count % 2) throw new Error('Numero dispari dopo l’assegnazione del bye.');
    const mixed = entrants.some((entry) => entry.freshDrop) && entrants.some((entry) => !entry.freshDrop);
    const memo = new Map();
    const fullMask = (1 << count) - 1;

    function solve(mask) {
      if (mask === 0) return { cost: 0, pairs: [] };
      if (memo.has(mask)) return memo.get(mask);
      let first = 0;
      while (((mask >> first) & 1) === 0) first += 1;
      const withoutFirst = mask & ~(1 << first);
      let best = null;
      for (let other = first + 1; other < count; other += 1) {
        if (((withoutFirst >> other) & 1) === 0) continue;
        const rest = solve(withoutFirst & ~(1 << other));
        const cost = pairCost(state, entrants[first], entrants[other], targetMap, mixed) + rest.cost;
        if (!best || cost < best.cost) best = { cost, pairs: [[entrants[first], entrants[other]], ...rest.pairs] };
      }
      memo.set(mask, best);
      return best;
    }

    if (count > 18) {
      const pool = [...entrants];
      const pairs = [];
      while (pool.length) {
        const a = pool.shift();
        let bestIndex = 0;
        let bestCost = Infinity;
        pool.forEach((b, index) => {
          const cost = pairCost(state, a, b, targetMap, mixed);
          if (cost < bestCost) { bestCost = cost; bestIndex = index; }
        });
        pairs.push([a, pool.splice(bestIndex, 1)[0]]);
      }
      return pairs;
    }
    return solve(fullMask).pairs;
  }

  function makeLosersRound(state, teams, stage) {
    let entrants = teams.map((item) => entrantForTeam(state, item))
      .sort((a, b) => a.pathOrder - b.pathOrder || seedRank(a.team) - seedRank(b.team));
    const selection = chooseFairBye(state, teams, LOSERS_BRACKET, stage);
    const created = [];

    if (selection) {
      const entry = entrants.find((candidate) => candidate.team.id === selection.team.id);
      entrants = entrants.filter((candidate) => candidate.team.id !== selection.team.id);
      const match = createMatch(state, {
        id: nextId(state, LOSERS_BRACKET), bracket: LOSERS_BRACKET,
        round: 'Tabellone Perdenti', stage, order: 1, bracketOrder: 1,
        aId: entry.team.id, bye: true, byeKind: selection.kind,
        court: 'AUTO · BYE', byeReason: selection.reason,
        pairingReason: 'Passaggio automatico nel Loser Bracket.', sourceA: entry.sourceMatchId,
      });
      registerBye(state, entry.team, match, selection.reason, selection.kind);
      created.push(match);
    }

    const targetMap = buildTargetPartnerMap(entrants);
    const pairs = minimumCostPairing(state, entrants, targetMap);
    pairs.sort((a, b) => Math.min(a[0].pathOrder, a[1].pathOrder) - Math.min(b[0].pathOrder, b[1].pathOrder));
    pairs.forEach(([a, b]) => {
      const rematch = hasPlayed(state, a.team.id, b.team.id);
      const cross = a.freshDrop !== b.freshDrop;
      created.push(createMatch(state, {
        id: nextId(state, LOSERS_BRACKET), bracket: LOSERS_BRACKET,
        round: 'Tabellone Perdenti', stage, order: created.length + 1, bracketOrder: created.length + 1,
        aId: a.team.id, bId: b.team.id,
        pairingReason: rematch
          ? 'Rivincita inevitabile: non esisteva un’alternativa valida.'
          : cross
            ? 'Incrocio standard: nuova retrocessa contro superstite; rivincite evitate.'
            : 'Incrocio a serpentina con rivincite evitate.',
        sourceA: a.sourceMatchId, sourceB: b.sourceMatchId,
      }));
    });
    return created;
  }

  function generateDoubleElimination(state, active, drawCode) {
    generateProtectedOpening(state, active, drawCode);
    state.stage = 0;
  }

  function advanceDoubleElimination(state) {
    recomputeTeams(state);
    if (!stageComplete(state)) throw new Error('Completa le partite del turno corrente.');
    if (state.championId) return state;

    const finalOne = state.matches.find((match) => match.id === 'F1');
    const finalTwo = state.matches.find((match) => match.id === 'F2');
    if (finalOne?.winnerId && !finalTwo) {
      if (finalOne.winnerId === finalOne.aId) {
        state.championId = finalOne.winnerId;
        recomputeTeams(state);
        return state;
      }
      state.stage += 1;
      createMatch(state, {
        id: 'F2', bracket: FINALS_BRACKET, round: 'Finalissima decisiva', stage: state.stage,
        order: 1, bracketOrder: 1, aId: finalOne.aId, bId: finalOne.bId,
        pairingReason: 'Bracket reset: entrambe le finaliste hanno ora una sconfitta.',
        sourceA: 'F1', sourceB: 'F1',
      });
      recomputeTeams(state);
      return state;
    }
    if (finalTwo?.winnerId) {
      state.championId = finalTwo.winnerId;
      recomputeTeams(state);
      return state;
    }

    const alive = activeTeams(state).filter((item) => !item.out);
    const undefeated = sortBySeed(alive.filter((item) => item.losses === 0));
    const oneLoss = sortBySeed(alive.filter((item) => item.losses === 1));
    if (alive.length === 1) {
      state.championId = alive[0].id;
      return state;
    }

    state.stage += 1;
    const stage = state.stage;
    if (undefeated.length === 1 && oneLoss.length === 1) {
      createMatch(state, {
        id: 'F1', bracket: FINALS_BRACKET, round: 'Finalissima', stage,
        order: 1, bracketOrder: 1, aId: undefeated[0].id, bId: oneLoss[0].id,
        pairingReason: 'Imbattuta del Winner Bracket contro vincitrice del Loser Bracket.',
        sourceA: lastMatchRecord(state, undefeated[0].id)?.match?.id,
        sourceB: lastMatchRecord(state, oneLoss[0].id)?.match?.id,
      });
    } else {
      if (undefeated.length > 1) makeWinnersRound(state, undefeated, stage);
      if (oneLoss.length > 1) makeLosersRound(state, oneLoss, stage);
      if (undefeated.length <= 1 && oneLoss.length <= 1) throw new Error('Impossibile generare il turno successivo.');
    }
    recomputeTeams(state);
    return state;
  }

  function nextPowerOfTwo(value) {
    let power = 1;
    while (power < value) power *= 2;
    return power;
  }

  function standardSeedOrder(size) {
    if (size === 1) return [1];
    let order = [1, 2];
    while (order.length < size) {
      const sum = order.length * 2 + 1;
      order = order.flatMap((rank) => [rank, sum - rank]);
    }
    return order;
  }

  function rankedTeamsForBracket(teams, random) {
    const total = teams.length;
    const ranked = new Array(total + 1).fill(null);
    const explicit = teams.filter((item) => Number.isInteger(Number(item.seed)) && Number(item.seed) >= 1 && Number(item.seed) <= total);
    explicit.forEach((item) => { ranked[Number(item.seed)] = item; });
    const unseeded = seededShuffle(teams.filter((item) => !explicit.includes(item)), random);
    for (let rank = 1; rank <= total; rank += 1) {
      if (!ranked[rank]) ranked[rank] = unseeded.shift() || null;
    }
    return ranked;
  }

  function knockoutRoundLabel(teamCount) {
    if (teamCount === 2) return 'Finale';
    if (teamCount === 4) return 'Semifinali';
    if (teamCount === 8) return 'Quarti di finale';
    if (teamCount === 16) return 'Ottavi di finale';
    if (teamCount === 32) return 'Sedicesimi di finale';
    return `Turno a ${teamCount}`;
  }

  function generateSingleElimination(state, active, drawCode) {
    const random = mulberry32(hashString(drawCode));
    const size = nextPowerOfTwo(active.length);
    const ranked = rankedTeamsForBracket(active, random);
    const order = standardSeedOrder(size);
    const slots = order.map((rank) => ranked[rank] || null);
    let matchOrder = 1;
    for (let index = 0; index < slots.length; index += 2) {
      const a = slots[index];
      const b = slots[index + 1];
      if (!a && !b) continue;
      const bye = !a || !b;
      const participant = a || b;
      const match = createMatch(state, {
        id: `K${matchOrder}`, bracket: KNOCKOUT_BRACKET,
        round: knockoutRoundLabel(size), stage: 0, order: matchOrder, bracketOrder: matchOrder,
        aId: a?.id || participant?.id, bId: b?.id || null, bye,
        byeKind: bye ? 'seeded' : null,
        court: bye ? 'AUTO · BYE' : '',
        byeReason: bye ? 'Bye nel tabellone standard alla successiva potenza di due.' : null,
        pairingReason: bye
          ? 'Posizione protetta del tabellone a eliminazione diretta.'
          : 'Accoppiamento fissato dal tabellone standard con teste di serie distribuite.',
      });
      if (bye) registerBye(state, participant, match, match.byeReason, 'seeded');
      matchOrder += 1;
    }
    state.stage = 0;
  }

  function advanceKnockout(state) {
    recomputeTeams(state);
    if (!stageComplete(state)) throw new Error('Completa le partite del turno corrente.');
    const current = currentStageMatches(state).filter((match) => match.bracket === KNOCKOUT_BRACKET)
      .sort((a, b) => a.bracketOrder - b.bracketOrder);
    const winners = current.map((match) => team(state, match.winnerId)).filter(Boolean);
    if (winners.length === 1) {
      state.championId = winners[0].id;
      recomputeTeams(state);
      return state;
    }
    state.stage += 1;
    const stage = state.stage;
    const label = knockoutRoundLabel(winners.length);
    for (let index = 0; index < winners.length; index += 2) {
      createMatch(state, {
        id: nextId(state, KNOCKOUT_BRACKET), bracket: KNOCKOUT_BRACKET,
        round: label, stage, order: index / 2 + 1, bracketOrder: index / 2 + 1,
        aId: winners[index].id, bId: winners[index + 1].id,
        rule: isGroupBasedFormat(state.settings.format)
          ? groupPostseasonRule(state, label)
          : state.settings.formatOptions.eliminationMatchRule,
        pairingReason: label === 'Finale' && isGroupBasedFormat(state.settings.format)
          ? 'Finale classica di beach volley: 2 su 3, primi due set a 21 e tie-break a 15.'
          : 'Percorso fisso: avanzano i vincitori dei rami adiacenti.',
        sourceA: current[index]?.id, sourceB: current[index + 1]?.id,
      });
    }
    recomputeTeams(state);
    return state;
  }

  function roundRobinPairs(teamIds) {
    const ids = [...teamIds];
    if (ids.length % 2) ids.push(null);
    const rounds = [];
    const count = ids.length;
    for (let round = 0; round < count - 1; round += 1) {
      const pairs = [];
      for (let index = 0; index < count / 2; index += 1) {
        const a = ids[index];
        const b = ids[count - 1 - index];
        if (a && b) pairs.push(round % 2 ? [b, a] : [a, b]);
      }
      rounds.push(pairs);
      const fixed = ids[0];
      const tail = ids.slice(1);
      tail.unshift(tail.pop());
      ids.splice(0, ids.length, fixed, ...tail);
    }
    return rounds;
  }

  function balancedGroupNumbers(items, count) {
    const ordered = sortBySeed(items);
    const assignments = new Map();
    ordered.forEach((item, index) => {
      const row = Math.floor(index / count);
      const position = index % count;
      const groupIndex = row % 2 ? count - 1 - position : position;
      assignments.set(item.id, groupIndex + 1);
    });
    return assignments;
  }

  function prefillManualGroups(state) {
    assertDraft(state);
    const active = activeTeams(state);
    const count = Number(state.settings.formatOptions.groupCount);
    const assignments = balancedGroupNumbers(active, count);
    active.forEach((item) => {
      item.manualGroup = assignments.get(item.id) || null;
    });
    state.metadata.updatedAt = nowIso();
    return state;
  }

  function assignGroups(state, active, count, drawCode) {
    const groups = Array.from({ length: count }, (_, index) => ({
      id: `group-${index + 1}`,
      name: `Girone ${String.fromCharCode(65 + index)}`,
      teamIds: [],
    }));

    if (state.settings.formatOptions.groupAssignmentMode === 'manual') {
      active.forEach((item) => {
        const groupNumber = Number(item.manualGroup);
        const group = groups[groupNumber - 1];
        if (!group) throw new Error(`Girone manuale non valido per ${item.name}.`);
        group.teamIds.push(item.id);
        item.groupId = group.id;
      });
      state.settings.draw.explanation = 'Composizione manuale dei gironi definita dall’amministratore.';
      state.groups = groups;
      return groups;
    }

    const random = mulberry32(hashString(drawCode));
    const seeded = sortBySeed(active.filter((item) => item.seed != null));
    const unseeded = seededShuffle(active.filter((item) => item.seed == null), random);
    const ranked = [...seeded, ...unseeded];
    ranked.forEach((item, index) => {
      const row = Math.floor(index / count);
      const position = index % count;
      const groupIndex = row % 2 ? count - 1 - position : position;
      groups[groupIndex].teamIds.push(item.id);
      item.groupId = groups[groupIndex].id;
    });
    state.settings.draw.explanation = 'Sorteggio casuale protetto: le teste di serie sono distribuite a serpentina nei gironi.';
    state.groups = groups;
    return groups;
  }

  function createGroupMatches(state, groups) {
    let order = 1;
    groups.forEach((group, groupIndex) => {
      const rounds = roundRobinPairs(group.teamIds);
      rounds.forEach((pairs, roundIndex) => {
        pairs.forEach(([aId, bId]) => {
          createMatch(state, {
            id: `G${groupIndex + 1}-${roundIndex + 1}-${order}`,
            bracket: GROUP_BRACKET, round: group.name, groupId: group.id,
            groupRound: roundIndex + 1, stage: 0, order, bracketOrder: order,
            aId, bId,
            rule: state.settings.formatOptions.groupMatchRule,
            pairingReason: `${group.name}, giornata ${roundIndex + 1} · ${matchRuleDefinition(state.settings.formatOptions.groupMatchRule).label}.`,
          });
          order += 1;
        });
      });
    });
  }

  function getGroupStandings(state, groupId) {
    const group = state.groups.find((item) => item.id === groupId);
    if (!group) return [];
    const rows = group.teamIds.map((teamId) => ({
      teamId, registrationOrder: state.teams.findIndex((item) => item.id === teamId), played: 0, wins: 0, losses: 0,
      setsFor: 0, setsAgainst: 0, pointsFor: 0, pointsAgainst: 0,
    }));
    const byId = new Map(rows.map((row) => [row.teamId, row]));
    const matches = state.matches.filter((match) => match.bracket === GROUP_BRACKET && match.groupId === groupId && match.winnerId);
    for (const match of matches) {
      const a = byId.get(match.aId);
      const b = byId.get(match.bId);
      if (!a || !b) continue;
      a.played += 1; b.played += 1;
      if (match.winnerId === match.aId) { a.wins += 1; b.losses += 1; }
      else { b.wins += 1; a.losses += 1; }
      for (const set of match.sets) {
        if (set.a === '' || set.b === '') continue;
        const aPoints = Number(set.a);
        const bPoints = Number(set.b);
        if (!Number.isFinite(aPoints) || !Number.isFinite(bPoints)) continue;
        a.pointsFor += aPoints; a.pointsAgainst += bPoints;
        b.pointsFor += bPoints; b.pointsAgainst += aPoints;
        if (aPoints > bPoints) { a.setsFor += 1; b.setsAgainst += 1; }
        if (bPoints > aPoints) { b.setsFor += 1; a.setsAgainst += 1; }
      }
    }
    const ordered = rows.map((row) => ({
      ...row,
      team: team(state, row.teamId),
      setDiff: row.setsFor - row.setsAgainst,
      pointDiff: row.pointsFor - row.pointsAgainst,
      pointRatio: row.pointsAgainst > 0 ? row.pointsFor / row.pointsAgainst : (row.pointsFor > 0 ? 999 : 0),
    })).sort(compareStandingRows);

    // Nei casi di parità a due, lo scontro diretto precede differenza set e punti.
    // Con tre o più coppie a pari vittorie restano validi i criteri aggregati.
    let cursor = 0;
    while (cursor < ordered.length) {
      let end = cursor + 1;
      while (end < ordered.length && ordered[end].wins === ordered[cursor].wins) end += 1;
      if (end - cursor === 2) {
        const first = ordered[cursor];
        const second = ordered[cursor + 1];
        const direct = matches.find((match) => (match.aId === first.teamId && match.bId === second.teamId)
          || (match.aId === second.teamId && match.bId === first.teamId));
        if (direct?.winnerId === second.teamId) {
          ordered[cursor] = second;
          ordered[cursor + 1] = first;
        }
      }
      cursor = end;
    }
    return ordered.map((row, index) => ({ ...row, rank: index + 1 }));
  }

  function compareStandingRows(a, b) {
    return b.wins - a.wins
      || b.pointDiff - a.pointDiff
      || b.pointRatio - a.pointRatio
      || a.pointsAgainst - b.pointsAgainst
      || b.pointsFor - a.pointsFor
      || b.setDiff - a.setDiff
      || seedRank(a.team) - seedRank(b.team)
      || (a.registrationOrder ?? 0) - (b.registrationOrder ?? 0)
      || String(a.teamId).localeCompare(String(b.teamId));
  }

  function getAllGroupStandings(state) {
    return state.groups.map((group) => ({ group, rows: getGroupStandings(state, group.id) }));
  }

  function groupStageComplete(state) {
    const matches = state.matches.filter((match) => match.bracket === GROUP_BRACKET);
    return matches.length > 0 && matches.every((match) => Boolean(match.winnerId));
  }

  function rankedGroupCandidates(state) {
    const standings = getAllGroupStandings(state);
    const ranked = [];
    let rank = 0;
    while (true) {
      const layer = standings.map(({ group, rows }) => {
        const row = rows[rank];
        return row ? { ...row, groupId: group.id, groupName: group.name, groupRank: rank + 1 } : null;
      }).filter(Boolean).sort(compareStandingRows);
      if (!layer.length) break;
      ranked.push(...layer);
      rank += 1;
    }
    return ranked;
  }

  function selectGroupQualifiers(state, size) {
    const playoffSize = Number(size);
    const protectWinners = Boolean(state.settings.formatOptions.protectGroupWinners);
    if (protectWinners && Number(state.settings.formatOptions.groupCount) === 2 && [4, 6, 8].includes(playoffSize)) {
      const standings = getAllGroupStandings(state);
      if (standings.length !== 2) return [];
      const perGroup = playoffSize / 2;
      const qualifiers = [];
      for (let rank = 0; rank < perGroup; rank += 1) {
        standings.forEach(({ group, rows }) => {
          const row = rows[rank];
          if (row) qualifiers.push({
            ...row,
            groupId: group.id,
            groupName: group.name,
            groupRank: rank + 1,
          });
        });
      }
      return qualifiers;
    }
    return rankedGroupCandidates(state).slice(0, playoffSize);
  }

  function selectSilverQualifiers(state, goldQualifiers) {
    const goldIds = new Set(goldQualifiers.map((entry) => entry.teamId));
    const available = rankedGroupCandidates(state).filter((entry) => !goldIds.has(entry.teamId));
    const configured = state.settings.formatOptions.silverSize;
    const size = configured === 'all' ? available.length : Math.min(Number(configured) || available.length, available.length);
    return available.slice(0, size);
  }

  function getGroupQualificationPreview(state) {
    if (!state.groups.length || state.settings.format !== FORMATS.GROUPS_PLAYOFF) {
      return { goldIds: [], silverIds: [] };
    }
    const gold = selectGroupQualifiers(state, Number(state.settings.formatOptions.playoffSize));
    const silver = state.settings.formatOptions.silverEnabled ? selectSilverQualifiers(state, gold) : [];
    return {
      goldIds: gold.map((entry) => entry.teamId),
      silverIds: silver.map((entry) => entry.teamId),
    };
  }

  function permutations(values) {
    if (values.length <= 1) return [values];
    const result = [];
    values.forEach((value, index) => {
      const rest = values.slice(0, index).concat(values.slice(index + 1));
      permutations(rest).forEach((tail) => result.push([value, ...tail]));
    });
    return result;
  }

  function pairQualifiedTeams(qualifiers) {
    const ranked = qualifiers.map((entry, index) => ({ ...entry, playoffSeed: index + 1 }));
    const size = ranked.length;

    // A 4 e 8 squadre viene usato il seeding standard dei tabelloni seri:
    // 4: 1-4 / 2-3
    // 8: 1-8 / 4-5 // 2-7 / 3-6
    // In questo modo la n.1 e la n.2 sono sempre in metà opposte del tabellone.
    if (![4, 8].includes(size)) {
      const half = size / 2;
      const top = ranked.slice(0, half);
      const bottom = ranked.slice(half).reverse();
      return top.map((higher, index) => [higher, bottom[index]]);
    }

    const slots = standardSeedOrder(size).map((seed) => ranked[seed - 1]);
    const basePairs = [];
    for (let index = 0; index < slots.length; index += 2) {
      const first = slots[index];
      const second = slots[index + 1];
      const protectedSeed = first.playoffSeed < second.playoffSeed ? first : second;
      const opponent = protectedSeed === first ? second : first;
      basePairs.push({ protectedSeed, opponent });
    }

    // Le teste alte restano nelle posizioni standard. Vengono permutati soltanto
    // gli avversari più bassi per evitare, quando possibile, una rivincita dello stesso girone.
    const opponentPermutations = permutations(basePairs.map((pair) => pair.opponent));
    const scorePermutation = (opponents) => basePairs.reduce((score, pair, index) => {
      const opponent = opponents[index];
      const sameGroupPenalty = pair.protectedSeed.groupId === opponent.groupId ? 10000 : 0;
      const winnerVsWinnerPenalty = pair.protectedSeed.groupRank === 1 && opponent.groupRank === 1 ? 5000 : 0;
      const seedingDeviation = Math.abs(opponent.playoffSeed - pair.opponent.playoffSeed);
      return score + sameGroupPenalty + winnerVsWinnerPenalty + seedingDeviation;
    }, 0);

    opponentPermutations.sort((a, b) => scorePermutation(a) - scorePermutation(b));
    const selectedOpponents = opponentPermutations[0];
    return basePairs.map((pair, index) => [pair.protectedSeed, selectedOpponents[index]]);
  }

  function avoidSameGroupInSlots(slots) {
    const result = [...slots];
    for (let index = 0; index < result.length; index += 2) {
      const a = result[index];
      const b = result[index + 1];
      if (!a || !b || a.groupId !== b.groupId) continue;
      for (let candidateIndex = index + 2; candidateIndex < result.length; candidateIndex += 1) {
        const candidate = result[candidateIndex];
        if (!candidate || candidate.groupId === a.groupId) continue;
        const mateIndex = candidateIndex % 2 ? candidateIndex - 1 : candidateIndex + 1;
        const mate = result[mateIndex];
        if (mate && mate.groupId === b.groupId) continue;
        result[index + 1] = candidate;
        result[candidateIndex] = b;
        break;
      }
    }
    return result;
  }

  function twoGroupProtectedLayout(state, qualifiers) {
    const groups = state.groups.map((group) => ({
      group,
      entries: qualifiers
        .filter((entry) => entry.groupId === group.id)
        .sort((a, b) => a.groupRank - b.groupRank),
    }));
    if (groups.length !== 2) return null;
    const [groupA, groupB] = groups;
    const pick = (bucket, rank) => bucket.entries.find((entry) => entry.groupRank === rank) || null;
    return {
      groupA,
      groupB,
      a1: pick(groupA, 1), a2: pick(groupA, 2), a3: pick(groupA, 3), a4: pick(groupA, 4),
      b1: pick(groupB, 1), b2: pick(groupB, 2), b3: pick(groupB, 3), b4: pick(groupB, 4),
    };
  }

  function createProtectedBye(state, entry, stage, order) {
    const match = createMatch(state, {
      id: nextId(state, KNOCKOUT_BRACKET), bracket: KNOCKOUT_BRACKET,
      round: 'Gold · Accesso diretto semifinali', stage,
      order, bracketOrder: order,
      aId: entry.teamId, bId: null,
      bye: true, byeKind: 'playoff-seed', court: 'AUTO · SEMIFINALE',
      rule: state.settings.formatOptions.semifinalMatchRule,
      byeReason: `Vincitrice del ${entry.groupName}: accesso diretto alla semifinale.`,
      pairingReason: `${entry.groupName}: 1ª classificata, qualificata direttamente alla semifinale.`,
    });
    registerBye(state, team(state, entry.teamId), match, match.byeReason, 'playoff-seed');
    return match;
  }

  function createGoldPlayoff(state, qualifiers, stage) {
    state.qualifiers = qualifiers.map((entry, index) => ({
      teamId: entry.teamId, groupId: entry.groupId, groupRank: entry.groupRank, playoffSeed: index + 1,
    }));
    state.postseasonPlan = null;

    const protectedMode = Boolean(state.settings.formatOptions.protectGroupWinners)
      && Number(state.settings.formatOptions.groupCount) === 2
      && [4, 6, 8].includes(qualifiers.length);
    const layout = protectedMode ? twoGroupProtectedLayout(state, qualifiers) : null;

    if (layout && qualifiers.length === 4 && [layout.a1, layout.a2, layout.b1, layout.b2].every(Boolean)) {
      const semiA = createMatch(state, {
        id: nextId(state, KNOCKOUT_BRACKET), bracket: KNOCKOUT_BRACKET,
        round: 'Gold · Semifinali', stage, order: 1, bracketOrder: 1,
        aId: layout.a1.teamId, bId: layout.b2.teamId,
        rule: state.settings.formatOptions.semifinalMatchRule,
        pairingReason: `Semifinale crossover: vincitrice ${layout.a1.groupName} contro 2ª ${layout.b2.groupName}.`,
      });
      const semiB = createMatch(state, {
        id: nextId(state, KNOCKOUT_BRACKET), bracket: KNOCKOUT_BRACKET,
        round: 'Gold · Semifinali', stage, order: 2, bracketOrder: 2,
        aId: layout.b1.teamId, bId: layout.a2.teamId,
        rule: state.settings.formatOptions.semifinalMatchRule,
        pairingReason: `Semifinale crossover: vincitrice ${layout.b1.groupName} contro 2ª ${layout.a2.groupName}.`,
      });
      state.postseasonPlan = {
        type: 'two-group-winners-semis', size: 4, step: 'semifinal',
        winnerAId: layout.a1.teamId, winnerBId: layout.b1.teamId,
        branchMatchIds: [semiA.id, semiB.id],
      };
      return;
    }

    if (layout && qualifiers.length === 6 && [layout.a1, layout.a2, layout.a3, layout.b1, layout.b2, layout.b3].every(Boolean)) {
      createProtectedBye(state, layout.a1, stage, 1);
      const quarterA = createMatch(state, {
        id: nextId(state, KNOCKOUT_BRACKET), bracket: KNOCKOUT_BRACKET,
        round: 'Gold · Quarti di finale', stage, order: 2, bracketOrder: 2,
        aId: layout.b2.teamId, bId: layout.a3.teamId,
        rule: state.settings.formatOptions.quarterMatchRule,
        pairingReason: `Quarto crossover: 2ª ${layout.b2.groupName} contro 3ª ${layout.a3.groupName}. La vincente affronta la vincitrice del ${layout.a1.groupName}.`,
      });
      createProtectedBye(state, layout.b1, stage, 3);
      const quarterB = createMatch(state, {
        id: nextId(state, KNOCKOUT_BRACKET), bracket: KNOCKOUT_BRACKET,
        round: 'Gold · Quarti di finale', stage, order: 4, bracketOrder: 4,
        aId: layout.a2.teamId, bId: layout.b3.teamId,
        rule: state.settings.formatOptions.quarterMatchRule,
        pairingReason: `Quarto crossover: 2ª ${layout.a2.groupName} contro 3ª ${layout.b3.groupName}. La vincente affronta la vincitrice del ${layout.b1.groupName}.`,
      });
      state.postseasonPlan = {
        type: 'two-group-winners-semis', size: 6, step: 'quarter',
        winnerAId: layout.a1.teamId, winnerBId: layout.b1.teamId,
        branchMatchIds: [quarterA.id, quarterB.id],
      };
      return;
    }

    if (layout && qualifiers.length === 8 && [layout.a1, layout.a2, layout.a3, layout.a4, layout.b1, layout.b2, layout.b3, layout.b4].every(Boolean)) {
      createProtectedBye(state, layout.a1, stage, 1);
      const preliminaryA = createMatch(state, {
        id: nextId(state, KNOCKOUT_BRACKET), bracket: KNOCKOUT_BRACKET,
        round: 'Gold · Turno preliminare', stage, order: 2, bracketOrder: 2,
        aId: layout.a3.teamId, bId: layout.b4.teamId,
        rule: state.settings.formatOptions.quarterMatchRule,
        pairingReason: `Preliminare crossover: 3ª ${layout.a3.groupName} contro 4ª ${layout.b4.groupName}. La vincente affronterà la 2ª del ${layout.b2.groupName}.`,
      });
      createProtectedBye(state, layout.b1, stage, 3);
      const preliminaryB = createMatch(state, {
        id: nextId(state, KNOCKOUT_BRACKET), bracket: KNOCKOUT_BRACKET,
        round: 'Gold · Turno preliminare', stage, order: 4, bracketOrder: 4,
        aId: layout.b3.teamId, bId: layout.a4.teamId,
        rule: state.settings.formatOptions.quarterMatchRule,
        pairingReason: `Preliminare crossover: 3ª ${layout.b3.groupName} contro 4ª ${layout.a4.groupName}. La vincente affronterà la 2ª del ${layout.a2.groupName}.`,
      });
      state.postseasonPlan = {
        type: 'two-group-winners-semis', size: 8, step: 'preliminary',
        winnerAId: layout.a1.teamId, winnerBId: layout.b1.teamId,
        secondAId: layout.a2.teamId, secondBId: layout.b2.teamId,
        branchMatchIds: [preliminaryA.id, preliminaryB.id],
      };
      return;
    }

    const pairs = pairQualifiedTeams(qualifiers);
    pairs.forEach(([a, b], index) => {
      createMatch(state, {
        id: `K${index + 1}`, bracket: KNOCKOUT_BRACKET,
        round: `Gold · ${knockoutRoundLabel(qualifiers.length)}`, stage,
        order: index + 1, bracketOrder: index + 1,
        aId: a.teamId, bId: b.teamId,
        rule: groupPostseasonRule(state, `Gold · ${knockoutRoundLabel(qualifiers.length)}`),
        pairingReason: `Seed Gold ${a.playoffSeed} contro seed ${b.playoffSeed}: tabellone standard; stesso girone evitato quando possibile.`,
      });
    });
  }

  function createSilverPlayoff(state, silverEntries, stage) {
    state.silverQualifiers = silverEntries.map((entry) => ({
      teamId: entry.teamId, groupId: entry.groupId, groupRank: entry.groupRank,
    }));
    if (silverEntries.length < 2) return;
    const bracketSize = nextPowerOfTwo(silverEntries.length);
    const ranked = new Array(bracketSize + 1).fill(null);
    silverEntries.forEach((entry, index) => { ranked[index + 1] = entry; });
    let slots = standardSeedOrder(bracketSize).map((rank) => ranked[rank] || null);
    slots = avoidSameGroupInSlots(slots);
    let order = 1;
    for (let index = 0; index < slots.length; index += 2) {
      const a = slots[index];
      const b = slots[index + 1];
      if (!a && !b) continue;
      const participant = a || b;
      const bye = !a || !b;
      const label = knockoutRoundLabel(bracketSize);
      const match = createMatch(state, {
        id: `S${order}`, bracket: SILVER_BRACKET,
        round: `Silver · ${label}`, stage,
        order: 100 + order, bracketOrder: order,
        aId: a?.teamId || participant?.teamId, bId: b?.teamId || null,
        bye, byeKind: bye ? 'silver' : null,
        court: bye ? 'AUTO · BYE' : '',
        rule: groupPostseasonRule(state, `Silver · ${label}`),
        byeReason: bye ? 'Bye tecnico Silver assegnato in base alla classifica dei gironi.' : null,
        pairingReason: bye
          ? 'Posizione protetta Silver: le migliori non qualificate ricevono gli eventuali bye tecnici.'
          : 'Silver Bracket: migliori non qualificate contro le più basse, evitando lo stesso girone quando possibile.',
      });
      if (bye) registerBye(state, team(state, participant.teamId), match, match.byeReason, 'silver');
      order += 1;
    }
  }

  function createGroupPostseason(state) {
    const playoffSize = Number(state.settings.formatOptions.playoffSize);
    const qualifiers = selectGroupQualifiers(state, playoffSize);
    if (qualifiers.length !== playoffSize) throw new Error('Non è stato possibile determinare tutte le qualificate Gold.');
    state.stage += 1;
    const stage = state.stage;
    createGoldPlayoff(state, qualifiers, stage);
    if (state.settings.formatOptions.silverEnabled) {
      const silver = selectSilverQualifiers(state, qualifiers);
      createSilverPlayoff(state, silver, stage);
    } else {
      state.silverQualifiers = [];
      state.silverChampionId = null;
    }
  }

  function createStandardBracketNextStage(state, bracket, matches, nextStage) {
    const winners = matches.map((match) => team(state, match.winnerId)).filter(Boolean);
    if (winners.length === 1) {
      if (bracket === KNOCKOUT_BRACKET) state.championId = winners[0].id;
      else state.silverChampionId = winners[0].id;
      return false;
    }
    if (winners.length < 2) return false;
    const label = knockoutRoundLabel(winners.length);
    for (let index = 0; index < winners.length; index += 2) {
      const prefix = bracket === KNOCKOUT_BRACKET ? 'K' : 'S';
      const title = bracket === KNOCKOUT_BRACKET ? 'Gold' : 'Silver';
      createMatch(state, {
        id: nextId(state, prefix), bracket,
        round: `${title} · ${label}`, stage: nextStage,
        order: (bracket === KNOCKOUT_BRACKET ? 0 : 100) + index / 2 + 1,
        bracketOrder: index / 2 + 1,
        aId: winners[index].id, bId: winners[index + 1].id,
        rule: groupPostseasonRule(state, `${title} · ${label}`),
        pairingReason: label === 'Finale'
          ? `Finale ${title}: formato classico 21 · 21 · 15.`
          : `Percorso fisso ${title}: avanzano i vincitori dei rami adiacenti.`,
        sourceA: matches[index]?.id, sourceB: matches[index + 1]?.id,
      });
    }
    return true;
  }

  function advanceProtectedGold(state, currentGold, nextStage) {
    const plan = state.postseasonPlan;
    if (!plan || plan.type !== 'two-group-winners-semis') return null;
    const matchById = (id) => state.matches.find((match) => match.id === id) || null;
    const branchWinners = (plan.branchMatchIds || []).map((id) => matchById(id)?.winnerId).filter(Boolean);

    if (plan.step === 'preliminary') {
      if (branchWinners.length !== 2) throw new Error('Completa i due preliminari Gold.');
      const quarterA = createMatch(state, {
        id: nextId(state, KNOCKOUT_BRACKET), bracket: KNOCKOUT_BRACKET,
        round: 'Gold · Quarti di finale', stage: nextStage, order: 1, bracketOrder: 1,
        aId: plan.secondBId, bId: branchWinners[0],
        rule: state.settings.formatOptions.quarterMatchRule,
        pairingReason: 'Quarto protetto: 2ª del Girone B contro la vincente del preliminare; la vincente affronterà la 1ª del Girone A.',
        sourceB: plan.branchMatchIds[0],
      });
      const quarterB = createMatch(state, {
        id: nextId(state, KNOCKOUT_BRACKET), bracket: KNOCKOUT_BRACKET,
        round: 'Gold · Quarti di finale', stage: nextStage, order: 2, bracketOrder: 2,
        aId: plan.secondAId, bId: branchWinners[1],
        rule: state.settings.formatOptions.quarterMatchRule,
        pairingReason: 'Quarto protetto: 2ª del Girone A contro la vincente del preliminare; la vincente affronterà la 1ª del Girone B.',
        sourceB: plan.branchMatchIds[1],
      });
      plan.step = 'quarter';
      plan.branchMatchIds = [quarterA.id, quarterB.id];
      return true;
    }

    if (plan.step === 'quarter') {
      if (branchWinners.length !== 2) throw new Error('Completa i due quarti Gold.');
      const semiA = createMatch(state, {
        id: nextId(state, KNOCKOUT_BRACKET), bracket: KNOCKOUT_BRACKET,
        round: 'Gold · Semifinali', stage: nextStage, order: 1, bracketOrder: 1,
        aId: plan.winnerAId, bId: branchWinners[0],
        rule: state.settings.formatOptions.semifinalMatchRule,
        pairingReason: 'Semifinale: vincitrice del Girone A contro la qualificata del proprio ramo.',
        sourceB: plan.branchMatchIds[0],
      });
      const semiB = createMatch(state, {
        id: nextId(state, KNOCKOUT_BRACKET), bracket: KNOCKOUT_BRACKET,
        round: 'Gold · Semifinali', stage: nextStage, order: 2, bracketOrder: 2,
        aId: plan.winnerBId, bId: branchWinners[1],
        rule: state.settings.formatOptions.semifinalMatchRule,
        pairingReason: 'Semifinale: vincitrice del Girone B contro la qualificata del proprio ramo.',
        sourceB: plan.branchMatchIds[1],
      });
      plan.step = 'semifinal';
      plan.branchMatchIds = [semiA.id, semiB.id];
      return true;
    }

    if (plan.step === 'semifinal') {
      if (branchWinners.length !== 2) throw new Error('Completa le due semifinali Gold.');
      const final = createMatch(state, {
        id: nextId(state, KNOCKOUT_BRACKET), bracket: KNOCKOUT_BRACKET,
        round: 'Gold · Finale', stage: nextStage, order: 1, bracketOrder: 1,
        aId: branchWinners[0], bId: branchWinners[1],
        rule: state.settings.formatOptions.finalMatchRule,
        pairingReason: 'Finale Gold: formato classico 21 · 21 · 15.',
        sourceA: plan.branchMatchIds[0], sourceB: plan.branchMatchIds[1],
      });
      plan.step = 'final';
      plan.branchMatchIds = [final.id];
      return true;
    }

    if (plan.step === 'final') {
      const winnerId = matchById(plan.branchMatchIds?.[0])?.winnerId;
      if (!winnerId) throw new Error('Completa la finale Gold.');
      state.championId = winnerId;
      plan.step = 'complete';
      return false;
    }
    return false;
  }

  function advanceGroupKnockouts(state) {
    recomputeTeams(state);
    if (!stageComplete(state)) throw new Error('Completa le partite del turno corrente.');
    const current = currentStageMatches(state)
      .filter((match) => [KNOCKOUT_BRACKET, SILVER_BRACKET].includes(match.bracket));
    if (!current.length) throw new Error('Nessun tabellone Gold o Silver attivo.');

    const nextStage = state.stage + 1;
    let created = false;
    const goldMatches = current.filter((match) => match.bracket === KNOCKOUT_BRACKET).sort((a, b) => a.bracketOrder - b.bracketOrder);
    const silverMatches = current.filter((match) => match.bracket === SILVER_BRACKET).sort((a, b) => a.bracketOrder - b.bracketOrder);

    if (goldMatches.length) {
      const protectedResult = advanceProtectedGold(state, goldMatches, nextStage);
      if (protectedResult === null) created = createStandardBracketNextStage(state, KNOCKOUT_BRACKET, goldMatches, nextStage) || created;
      else created = Boolean(protectedResult) || created;
    }
    if (silverMatches.length) {
      created = createStandardBracketNextStage(state, SILVER_BRACKET, silverMatches, nextStage) || created;
    }
    if (created) state.stage = nextStage;
    recomputeTeams(state);
    return state;
  }

  function generateGroupsPlayoff(state, active, drawCode) {
    const groups = assignGroups(state, active, Number(state.settings.formatOptions.groupCount), drawCode);
    createGroupMatches(state, groups);
    state.stage = 0;
  }

  function generateRoundRobinFinal4(state, active) {
    const group = { id: 'group-1', name: 'Girone unico', teamIds: active.map((item) => item.id) };
    active.forEach((item) => { item.groupId = group.id; });
    state.groups = [group];
    createGroupMatches(state, [group]);
    state.stage = 0;
  }

  function advanceGroupsPlayoff(state) {
    if (!stageComplete(state)) throw new Error('Completa le partite del turno corrente.');
    const postseasonExists = state.matches.some((match) => [KNOCKOUT_BRACKET, SILVER_BRACKET].includes(match.bracket));
    if (!postseasonExists) {
      createGroupPostseason(state);
      recomputeTeams(state);
      return state;
    }
    return advanceGroupKnockouts(state);
  }

  function advanceRoundRobinFinal4(state) {
    if (!stageComplete(state)) throw new Error('Completa le partite del turno corrente.');
    const knockout = state.matches.filter((match) => match.bracket === KNOCKOUT_BRACKET);
    if (!knockout.length) {
      const top = getGroupStandings(state, 'group-1').slice(0, 4);
      if (top.length < 4) throw new Error('Servono quattro qualificate per la Final Four.');
      state.qualifiers = top.map((entry) => ({ teamId: entry.teamId, groupId: 'group-1', groupRank: entry.rank }));
      state.stage += 1;
      createMatch(state, {
        id: 'K1', bracket: KNOCKOUT_BRACKET, round: 'Semifinali', stage: state.stage,
        order: 1, bracketOrder: 1, aId: top[0].teamId, bId: top[3].teamId,
        rule: state.settings.formatOptions.semifinalMatchRule,
        pairingReason: 'Semifinale standard: 1ª contro 4ª.',
      });
      createMatch(state, {
        id: 'K2', bracket: KNOCKOUT_BRACKET, round: 'Semifinali', stage: state.stage,
        order: 2, bracketOrder: 2, aId: top[1].teamId, bId: top[2].teamId,
        rule: state.settings.formatOptions.semifinalMatchRule,
        pairingReason: 'Semifinale standard: 2ª contro 3ª.',
      });
      recomputeTeams(state);
      return state;
    }
    return advanceKnockout(state);
  }

  function generateTournament(state, options = {}) {
    assertDraft(state);
    const error = validateTeams(state);
    if (error) throw new Error(error);
    clearCompetition(state);
    const active = activeTeams(state);
    const drawCode = String(options.drawCode || createDrawCode()).trim().toUpperCase();
    state.settings.draw.code = drawCode;
    state.settings.draw.generatedAt = nowIso();

    switch (state.settings.format) {
      case FORMATS.GROUPS_PLAYOFF:
        generateGroupsPlayoff(state, active, drawCode);
        break;
      case FORMATS.SINGLE_ELIMINATION:
        generateSingleElimination(state, active, drawCode);
        break;
      case FORMATS.ROUND_ROBIN_FINAL4:
        generateRoundRobinFinal4(state, active);
        break;
      case FORMATS.DOUBLE_ELIMINATION:
      default:
        generateDoubleElimination(state, active, drawCode);
        break;
    }
    autoScheduleStage(state, state.stage, { force: true });
    state.metadata.startedAt = state.metadata.startedAt || nowIso();
    recomputeTeams(state);
    return state;
  }

  function generateNextStage(state) {
    if (!state.matches.length) throw new Error('Prima genera il torneo.');
    recomputeTeams(state);
    if (tournamentComplete(state)) return state;
    let result;
    switch (state.settings.format) {
      case FORMATS.GROUPS_PLAYOFF:
        result = advanceGroupsPlayoff(state);
        break;
      case FORMATS.SINGLE_ELIMINATION:
        result = advanceKnockout(state);
        break;
      case FORMATS.ROUND_ROBIN_FINAL4:
        result = advanceRoundRobinFinal4(state);
        break;
      case FORMATS.DOUBLE_ELIMINATION:
      default:
        result = advanceDoubleElimination(state);
        break;
    }
    autoScheduleStage(state, state.stage);
    return result;
  }

  function rollbackToStage(state, stage, matchId = null) {
    const target = Number(stage);
    if (!Number.isInteger(target) || target < 0) return state;
    state.matches = state.matches.filter((match) => match.stage <= target);
    const match = matchId ? state.matches.find((item) => item.id === matchId) : null;
    if (match && !match.bye) {
      match.sets = [{ a: '', b: '' }, { a: '', b: '' }, { a: '', b: '' }];
      match.winnerId = null;
      match.loserId = null;
      match.updatedAt = nowIso();
    }
    state.stage = state.matches.length ? Math.max(...state.matches.map((item) => item.stage)) : -1;
    state.championId = null;
    state.silverChampionId = null;
    state.finalResetPlayed = false;
    state.qualifiers = state.matches.some((item) => item.bracket === KNOCKOUT_BRACKET) ? state.qualifiers : [];
    state.silverQualifiers = state.matches.some((item) => item.bracket === SILVER_BRACKET) ? state.silverQualifiers : [];
    if (!state.matches.some((item) => item.bracket === KNOCKOUT_BRACKET)) state.postseasonPlan = null;
    else reconcileProtectedPostseasonPlan(state);
    state.settings.byePolicy.history = state.settings.byePolicy.history.filter((entry) => Number(entry.stage) <= target);
    const lastBye = state.settings.byePolicy.history.at(-1);
    state.settings.byePolicy.lastTeamId = lastBye?.teamId || null;
    state.settings.byePolicy.cursor = Number.isInteger(lastBye?.cursor) ? lastBye.cursor : 0;
    state.metadata.scheduleWarnings = (state.metadata.scheduleWarnings || []).filter((entry) => state.matches.some((item) => item.id === entry.matchId));
    recomputeTeams(state);
    return state;
  }

  // La correzione è atomica: i punteggi vengono validati prima di cambiare lo stato.
  // I risultati successivi restano validi soltanto se partecipanti e qualificazioni
  // non possono cambiare; i gironi usano anche i punti per gli spareggi.
  function updateMatchScores(state, matchId, sets) {
    const match = state.matches.find((item) => item.id === matchId);
    if (!match) throw new Error('Partita non trovata.');
    if (match.bye) throw new Error('Un bye non prevede punteggi.');
    if (!Array.isArray(sets) || sets.length !== 3) throw new Error('Inserisci i tre campi set previsti dal modello.');
    const candidate = {
      ...match,
      sets: sets.map((set) => ({ a: set?.a == null ? '' : String(set.a), b: set?.b == null ? '' : String(set.b) })),
    };
    const error = validateMatchScores(candidate);
    if (error) throw new Error(error);
    const changed = JSON.stringify(match.sets) !== JSON.stringify(candidate.sets);
    if (!changed) return { state, removedMatchIds: [], standingsChanged: false };
    const oldWinner = scoreWinner(match);
    const newWinner = scoreWinner(candidate);
    const standingsChanged = match.bracket === GROUP_BRACKET;
    const invalidate = standingsChanged || oldWinner !== newWinner;
    const removedMatchIds = invalidate
      ? state.matches.filter((item) => item.stage > match.stage).map((item) => item.id)
      : [];
    if (removedMatchIds.length) rollbackToStage(state, match.stage);
    match.sets = candidate.sets;
    match.updatedAt = nowIso();
    refreshMatchWinner(match);
    recomputeTeams(state);
    return { state, removedMatchIds, standingsChanged };
  }

  function resetScores(state) {
    assertDraft(state);
    if (!state.matches.length) return state;
    state.matches = state.matches.filter((match) => match.stage === 0);
    state.matches.forEach((match) => {
      match.sets = [{ a: '', b: '' }, { a: '', b: '' }, { a: '', b: '' }];
      if (!match.bye) {
        match.winnerId = null;
        match.loserId = null;
      }
      match.court = '';
      match.startTime = '';
      match.updatedAt = nowIso();
    });
    state.stage = 0;
    state.championId = null;
    state.silverChampionId = null;
    state.finalResetPlayed = false;
    state.qualifiers = [];
    state.silverQualifiers = [];
    state.postseasonPlan = null;
    state.settings.byePolicy.history = state.settings.byePolicy.history.filter((entry) => Number(entry.stage) === 0);
    const initialBye = state.settings.byePolicy.history.find((entry) => entry.kind === 'initial');
    state.settings.byePolicy.lastTeamId = initialBye?.teamId || null;
    state.settings.byePolicy.cursor = 0;
    autoScheduleStage(state, 0, { force: true });
    recomputeTeams(state);
    return state;
  }

  function resetTournament(state) {
    assertDraft(state);
    clearCompetition(state);
    state.metadata.updatedAt = nowIso();
    return state;
  }

  function estimateMatches(state) {
    const count = activeTeams(state).length;
    if (!count) return { minimum: 0, maximum: 0, guaranteed: 0, groupMatches: 0, playoffMatches: 0 };
    const format = state.settings.format;
    if (format === FORMATS.SINGLE_ELIMINATION) {
      return { minimum: count - 1, maximum: count - 1, guaranteed: 1, groupMatches: 0, playoffMatches: count - 1 };
    }
    if (format === FORMATS.DOUBLE_ELIMINATION) {
      return { minimum: count * 2 - 2, maximum: count * 2 - 1, guaranteed: 2, groupMatches: 0, playoffMatches: count * 2 - 2 };
    }
    if (format === FORMATS.ROUND_ROBIN_FINAL4) {
      const groups = count * (count - 1) / 2;
      return { minimum: groups + 3, maximum: groups + 3, guaranteed: count - 1, groupMatches: groups, playoffMatches: 3 };
    }
    const groupCount = Number(state.settings.formatOptions.groupCount);
    const base = Math.floor(count / groupCount);
    const remainder = count % groupCount;
    const manualCounts = new Array(groupCount).fill(0);
    if (state.settings.formatOptions.groupAssignmentMode === 'manual') {
      activeTeams(state).forEach((item) => {
        const groupIndex = Number(item.manualGroup) - 1;
        if (Number.isInteger(groupIndex) && groupIndex >= 0 && groupIndex < groupCount) manualCounts[groupIndex] += 1;
      });
    }
    const useManual = manualCounts.reduce((sum, value) => sum + value, 0) === count;
    let groupMatches = 0;
    let minimumGroupSize = Infinity;
    for (let index = 0; index < groupCount; index += 1) {
      const size = state.groups.length === groupCount
        ? state.groups[index].teamIds.length
        : useManual ? manualCounts[index] : base + (index < remainder ? 1 : 0);
      minimumGroupSize = Math.min(minimumGroupSize, size);
      groupMatches += size * (size - 1) / 2;
    }
    const goldParticipants = Number(state.settings.formatOptions.playoffSize);
    const playoff = goldParticipants - 1;
    const availableSilver = Math.max(0, count - goldParticipants);
    const configuredSilver = state.settings.formatOptions.silverSize === 'all'
      ? availableSilver
      : Math.min(availableSilver, Number(state.settings.formatOptions.silverSize) || availableSilver);
    const silverMatches = state.settings.formatOptions.silverEnabled && configuredSilver >= 2
      ? configuredSilver - 1
      : 0;
    return {
      minimum: groupMatches + playoff + silverMatches,
      maximum: groupMatches + playoff + silverMatches,
      guaranteed: Math.max(1, minimumGroupSize - 1),
      groupMatches,
      playoffMatches: playoff,
      silverMatches,
    };
  }

  function hasEnteredPostseasonResult(match) {
    return Boolean(match && !match.bye && (match.winnerId || match.sets?.some((set) => set.a !== '' || set.b !== '')));
  }

  function reconcileProtectedPostseasonPlan(state) {
    const plan = state.postseasonPlan;
    if (!plan || plan.type !== 'two-group-winners-semis') return state;
    const gold = state.matches.filter((match) => match.bracket === KNOCKOUT_BRACKET);
    if (!gold.length) { state.postseasonPlan = null; return state; }
    const latestStage = Math.max(...gold.map((match) => match.stage));
    const latest = gold.filter((match) => match.stage === latestStage).sort((a, b) => a.bracketOrder - b.bracketOrder);
    const round = latest.map((match) => match.round).join(' ').toLowerCase();
    if (round.includes('preliminare')) plan.step = 'preliminary';
    else if (round.includes('quarti')) plan.step = 'quarter';
    else if (round.includes('semifinali')) plan.step = 'semifinal';
    else if (round.includes('finale')) plan.step = 'final';
    plan.branchMatchIds = latest.filter((match) => !match.bye).map((match) => match.id);
    return state;
  }

  function migrateLegacyGroupPlayoff(state) {
    if (state.settings.format !== FORMATS.GROUPS_PLAYOFF) return false;
    if (!state.settings.formatOptions.protectGroupWinners) return false;
    if (Number(state.settings.formatOptions.groupCount) !== 2 || state.groups.length !== 2) return false;
    const gold = state.matches.filter((match) => match.bracket === KNOCKOUT_BRACKET);
    if (!gold.length || state.postseasonPlan?.type === 'two-group-winners-semis') return false;
    const postseason = state.matches.filter((match) => [KNOCKOUT_BRACKET, SILVER_BRACKET].includes(match.bracket));
    if (postseason.some(hasEnteredPostseasonResult)) return false;
    if (!groupStageComplete(state)) return false;

    state.matches = state.matches.filter((match) => ![KNOCKOUT_BRACKET, SILVER_BRACKET].includes(match.bracket));
    state.qualifiers = [];
    state.silverQualifiers = [];
    state.championId = null;
    state.silverChampionId = null;
    state.postseasonPlan = null;
    state.settings.byePolicy.history = state.settings.byePolicy.history.filter((entry) => ![KNOCKOUT_BRACKET, SILVER_BRACKET].includes(entry.bracket));
    state.stage = state.matches.length ? Math.max(...state.matches.map((match) => match.stage)) : 0;
    createGroupPostseason(state);
    autoScheduleStage(state, state.stage, { force: true });
    state.metadata.migrationNeedsSave = true;
    state.metadata.migrationNotice = 'Playoff corretto: le vincitrici dei due gironi accedono direttamente alle semifinali.';
    state.metadata.migratedAt = nowIso();
    recomputeTeams(state);
    return true;
  }

  function completedMatches(state) {
    return state.matches.filter((match) => match.winnerId && !match.bye).length;
  }

  function tournamentComplete(state) {
    if (!state.championId) return false;
    if (state.settings.format === FORMATS.GROUPS_PLAYOFF
      && state.settings.formatOptions.silverEnabled
      && state.matches.some((match) => match.bracket === SILVER_BRACKET)) {
      return Boolean(state.silverChampionId);
    }
    return true;
  }

  function tournamentProgress(state) {
    const estimate = estimateMatches(state);
    const completed = completedMatches(state);
    const total = Math.max(estimate.minimum, state.matches.filter((match) => !match.bye).length, 1);
    return {
      completed,
      total,
      percent: tournamentComplete(state) ? 100 : Math.min(99, Math.round(completed / total * 100)),
    };
  }

  function phaseLabel(state) {
    if (tournamentComplete(state)) return 'Torneo concluso';
    if (!state.matches.length) return 'Configurazione';
    const stageMatches = currentStageMatches(state);
    if (state.settings.format === FORMATS.GROUPS_PLAYOFF && !state.matches.some((m) => m.bracket === KNOCKOUT_BRACKET)) return 'Fase a gironi';
    if (state.settings.format === FORMATS.ROUND_ROBIN_FINAL4 && !state.matches.some((m) => m.bracket === KNOCKOUT_BRACKET)) return 'Girone unico';
    const rounds = [...new Set(stageMatches.map((match) => match.round).filter(Boolean))];
    if (rounds.length === 1) return rounds[0];
    if (state.settings.format === FORMATS.DOUBLE_ELIMINATION) return `Turno ${currentStage(state) + 1}`;
    return rounds.join(' · ') || `Turno ${currentStage(state) + 1}`;
  }

  function formatSummary(state) {
    const estimate = estimateMatches(state);
    const active = activeTeams(state).length;
    const format = state.settings.format;
    if (format === FORMATS.GROUPS_PLAYOFF) {
      const assignment = state.settings.formatOptions.groupAssignmentMode === 'manual' ? 'gironi manuali' : 'sorteggio protetto';
      const silver = state.settings.formatOptions.silverEnabled
        ? ` · Silver ${state.settings.formatOptions.silverSize === 'all' ? 'per tutte le non qualificate' : `a ${state.settings.formatOptions.silverSize}`}`
        : '';
      const playoffNote = state.settings.formatOptions.protectGroupWinners && Number(state.settings.formatOptions.groupCount) === 2 ? ' (vincitrici dei gironi direttamente in semifinale)' : '';
      return `${state.settings.formatOptions.groupCount} gironi · ${assignment} · ${matchRuleDefinition(state.settings.formatOptions.groupMatchRule).label} · Gold a ${state.settings.formatOptions.playoffSize}${playoffNote}${silver} · quarti ${matchRuleDefinition(state.settings.formatOptions.quarterMatchRule).shortLabel} · semifinali ${matchRuleDefinition(state.settings.formatOptions.semifinalMatchRule).shortLabel} · finale 21/21/15 · ${estimate.minimum} partite`;
    }
    if (format === FORMATS.ROUND_ROBIN_FINAL4) return `Girone unico · ${matchRuleDefinition(state.settings.formatOptions.groupMatchRule).label} · Final Four · finale 21/21/15 · ${estimate.minimum} partite`;
    if (format === FORMATS.SINGLE_ELIMINATION) return `${active} coppie · ${matchRuleDefinition(state.settings.formatOptions.eliminationMatchRule).label} · ${estimate.minimum} partite · una sconfitta elimina`;
    return `${active} coppie · ${matchRuleDefinition(state.settings.formatOptions.eliminationMatchRule).label} · ${estimate.minimum}–${estimate.maximum} partite · due sconfitte eliminano`;
  }

  function nextByePriority(state, eligibleTeams = null) {
    const list = eligibleTeams || activeTeams(state).filter((item) => !item.out);
    const cycle = state.settings.byePolicy.cycle;
    const start = state.settings.byePolicy.cursor % cycle.length;
    const last = state.settings.byePolicy.lastTeamId;
    const avoid = list.some((item) => item.id !== last);
    for (let offset = 0; offset < cycle.length; offset += 1) {
      const rank = cycle[(start + offset) % cycle.length];
      const candidate = list.find((item) => Number(item.seed) === rank);
      if (!candidate) continue;
      if (avoid && candidate.id === last) continue;
      return { rank, team: candidate };
    }
    return null;
  }

  global.BeachEngine = {
    STATE_VERSION,
    FORMATS,
    FORMAT_LABELS,
    MATCH_RULES,
    MATCH_RULE_DEFINITIONS,
    DEFAULT_TEAMS,
    DEFAULT_OPENING,
    DEFAULT_BYE_CYCLE,
    createDefaultState,
    normalizeState,
    validateStateSnapshot,
    tournamentStarted,
    validateTeams,
    validateMatchScores,
    updateMatchScores,
    prefillManualGroups,
    generateTournament,
    generateNextStage,
    autoScheduleStage,
    recomputeTeams,
    refreshMatchWinner,
    scoreWinner,
    matchStatus,
    matchRuleDefinition,
    matchRuleLabel,
    setWinnerSide,
    resetScores,
    resetTournament,
    rollbackToStage,
    team,
    teamByName,
    activeTeams,
    sortBySeed,
    seedRank,
    nextByePriority,
    structuredCloneSafe,
    hasPlayed,
    currentStage,
    currentStageMatches,
    stageComplete,
    getGroupStandings,
    getAllGroupStandings,
    getGroupQualificationPreview,
    groupStageComplete,
    estimateMatches,
    completedMatches,
    tournamentProgress,
    tournamentComplete,
    phaseLabel,
    formatLabel,
    formatSummary,
  };
})(window);
