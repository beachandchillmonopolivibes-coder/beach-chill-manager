'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = vm.createContext({ window: { crypto: require('node:crypto').webcrypto, structuredClone } });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'engine.js'), 'utf8'), context);
const E = context.window.BeachEngine;
const blank = () => Array.from({ length: 3 }, () => ({ a: '', b: '' }));
const plain = (value) => JSON.parse(JSON.stringify(value));
function fixture(count, format = E.FORMATS.SINGLE_ELIMINATION, options = {}) {
  const state = E.createDefaultState();
  state.teams.forEach((team, index) => { team.name = index < count ? `Coppia ${index + 1}` : ''; team.seed = index < Math.ceil(count / 2) ? index + 1 : null; });
  state.settings.format = format;
  Object.assign(state.settings.formatOptions, options);
  return state;
}
function scores(match, side = 'a', loser = 5) {
  const result = blank();
  const rule = E.matchRuleDefinition(match);
  for (let index = 0; index < (rule.bestOf === 1 ? 1 : 2); index += 1) {
    result[index][side] = String(rule.targets[index]);
    result[index][side === 'a' ? 'b' : 'a'] = String(loser);
  }
  return result;
}
function completeStage(state, choose = () => 'a') {
  for (const match of [...E.currentStageMatches(state)]) {
    if (!match.bye) E.updateMatchScores(state, match.id, scores(match, choose(match)));
  }
}
function fullTournament(state, variation = 0) {
  E.generateTournament(state, { drawCode: `REGRESSION-${variation}` });
  for (let round = 0; round < 40 && !E.tournamentComplete(state); round += 1) {
    completeStage(state, (match) => (match.order + round + variation) % 2 ? 'a' : 'b');
    if (!E.tournamentComplete(state)) E.generateNextStage(state);
  }
  assert.ok(E.tournamentComplete(state), `Complete ${state.settings.format}`);
  return state;
}

test('new projects have 24 empty slots and normalization retains existing entrants', () => {
  const state = E.createDefaultState();
  assert.equal(state.teams.length, 24);
  assert.equal(E.activeTeams(state).length, 0);
  state.teams[0].name = 'Nome esistente';
  const normalized = E.normalizeState(plain(state));
  assert.equal(normalized.teams[0].name, 'Nome esistente');
  assert.equal(normalized.teams[0].id, state.teams[0].id);
});

test('strict scoring rejects decimals, negative values, impossible deuce and extra sets', () => {
  for (const [a, b] of [['-1', '21'], ['21.5', '19'], ['22', '19'], [' 21', '19'], ['1e2', '15']]) {
    assert.equal(E.setWinnerSide({ a, b }, 21), null);
  }
  assert.equal(E.setWinnerSide({ a: '21', b: '0' }, 21), 'a');
  assert.equal(E.setWinnerSide({ a: '30', b: '28' }, 21), 'a');
  assert.equal(E.setWinnerSide({ a: '22', b: '22' }, 21), null);
  const match = { aId: 'A', bId: 'B', rule: 'best_of_3_21_15', sets: [{ a: '21', b: '10' }, { a: '21', b: '10' }, { a: '0', b: '15' }] };
  assert.equal(E.scoreWinner(match), null);
  assert.match(E.validateMatchScores(match), /dopo la vittoria/);
  match.sets = [{ a: '', b: '' }, { a: '21', b: '10' }, { a: '15', b: '2' }];
  assert.equal(E.scoreWinner(match), null);
  assert.match(E.validateMatchScores(match), /precedente/);
});

test('live partial scores are accepted without assigning a winner; invalid saves are atomic', () => {
  const state = fixture(2); E.generateTournament(state);
  const match = state.matches[0];
  E.updateMatchScores(state, match.id, [{ a: '4', b: '7' }, ...blank().slice(1)]);
  assert.equal(match.winnerId, null);
  const before = JSON.stringify(state);
  assert.throws(() => E.updateMatchScores(state, match.id, [{ a: '-4', b: '7' }, ...blank().slice(1)]), /interi/);
  assert.equal(JSON.stringify(state), before);
});

test('starting freezes regeneration, bulk reset and manual composition while scores remain editable', () => {
  const state = fixture(4); E.generateTournament(state);
  assert.ok(state.metadata.startedAt);
  const before = JSON.stringify(state);
  for (const action of [E.generateTournament, E.resetTournament, E.resetScores, E.prefillManualGroups]) {
    assert.throws(() => action(state), /Torneo avviato/);
    assert.equal(JSON.stringify(state), before);
  }
  E.updateMatchScores(state, state.matches[0].id, scores(state.matches[0]));
  assert.ok(state.matches[0].winnerId);
});

test('same knockout winner retains all downstream scores; winner reversal safely removes later stages', () => {
  const state = fullTournament(fixture(8));
  const early = state.matches.find((match) => match.stage === 0 && !match.bye);
  const sameSide = early.winnerId === early.aId ? 'a' : 'b';
  const beforeLater = plain(state.matches.filter((match) => match.stage > 0));
  const same = E.updateMatchScores(state, early.id, scores(early, sameSide, 6));
  assert.equal(same.removedMatchIds.length, 0);
  assert.deepEqual(plain(state.matches.filter((match) => match.stage > 0)), beforeLater);
  const changed = E.updateMatchScores(state, early.id, scores(early, sameSide === 'a' ? 'b' : 'a'));
  assert.equal(changed.removedMatchIds.length, beforeLater.length);
  assert.equal(state.stage, 0);
  assert.equal(state.championId, null);
  assert.ok(state.metadata.startedAt);
  assert.equal(state.matches.find((match) => match.id === early.id).winnerId, early.winnerId);
  assert.equal(E.stageComplete(state), true);
  E.generateNextStage(state);
  assert.ok(state.matches.some((match) => match.stage === 1 && [match.aId, match.bId].includes(early.winnerId)));
});

test('changing group points invalidates Gold/Silver even with the same match winner', () => {
  const state = fixture(12, E.FORMATS.GROUPS_PLAYOFF, { groupCount: 2, playoffSize: 6, protectGroupWinners: true, silverEnabled: true });
  fullTournament(state);
  const group = state.matches.find((match) => match.bracket === 'G');
  const laterCount = state.matches.filter((match) => match.stage > group.stage).length;
  const originalWinner = group.winnerId;
  const result = E.updateMatchScores(state, group.id, scores(group, group.winnerId === group.aId ? 'a' : 'b', 6));
  assert.equal(group.winnerId, originalWinner);
  assert.equal(result.removedMatchIds.length, laterCount);
  assert.equal(state.postseasonPlan, null);
  assert.equal(state.qualifiers.length, 0);
  assert.equal(state.silverQualifiers.length, 0);
  assert.equal(state.championId, null);
  assert.equal(state.silverChampionId, null);
  assert.ok(state.matches.every((match) => match.bracket === 'G'));
});

test('double elimination updates champion immediately and resets champion when final becomes incomplete', () => {
  const state = fixture(2, E.FORMATS.DOUBLE_ELIMINATION);
  E.generateTournament(state); completeStage(state); E.generateNextStage(state);
  const final = state.matches.find((match) => match.id === 'F1');
  E.updateMatchScores(state, final.id, scores(final, 'a'));
  assert.equal(state.championId, final.aId);
  E.updateMatchScores(state, final.id, blank());
  assert.equal(state.championId, null);
  E.updateMatchScores(state, final.id, scores(final, 'b'));
  assert.equal(state.championId, null);
  E.generateNextStage(state);
  const reset = state.matches.find((match) => match.id === 'F2');
  assert.ok(reset);
  E.updateMatchScores(state, reset.id, scores(reset, 'b'));
  assert.equal(state.championId, reset.bId);
  E.updateMatchScores(state, final.id, scores(final, 'a'));
  assert.equal(state.matches.some((match) => match.id === 'F2'), false);
  assert.equal(state.championId, final.aId);
});

test('renaming entrants cannot change the final standings tie-break or initial seed ordering', () => {
  const state = fixture(4, E.FORMATS.ROUND_ROBIN_FINAL4);
  state.teams.forEach((team) => { team.seed = null; });
  E.generateTournament(state);
  const before = E.getGroupStandings(state, 'group-1').map((row) => row.teamId);
  state.teams[0].name = 'ZZZZ'; state.teams[3].name = 'AAAA';
  const after = E.getGroupStandings(state, 'group-1').map((row) => row.teamId);
  assert.deepEqual(plain(after), plain(before));
});

test('manual uneven groups produce the correct workload estimate', () => {
  const state = fixture(12, E.FORMATS.GROUPS_PLAYOFF, { groupCount: 2, playoffSize: 4, protectGroupWinners: false, groupAssignmentMode: 'manual' });
  state.teams.forEach((team, index) => { team.manualGroup = index < 2 ? 1 : 2; });
  assert.equal(E.validateTeams(state), null);
  assert.equal(E.estimateMatches(state).groupMatches, 46);
  assert.equal(E.estimateMatches(state).guaranteed, 1);
  E.generateTournament(state);
  assert.equal(state.matches.filter((match) => match.bracket === 'G').length, 46);
  assert.equal(E.estimateMatches(state).minimum, 49);
});

test('scheduler tracks actual court identities and preserves existing reservations', () => {
  const state = fixture(4); state.settings.courts = 2; E.generateTournament(state);
  state.matches[0].court = 'Campo 2'; state.matches[0].startTime = '08:45';
  state.matches[1].court = ''; state.matches[1].startTime = '';
  E.autoScheduleStage(state, 0);
  assert.equal(state.matches[0].court, 'Campo 2');
  assert.equal(state.matches[1].court, 'Campo 1');
  assert.equal(state.matches[1].startTime, '08:45');
});

test('schedule overflow stays unassigned with a warning rather than inventing colliding 23:59 slots', () => {
  const state = fixture(24, E.FORMATS.GROUPS_PLAYOFF, { groupCount: 2, playoffSize: 4, protectGroupWinners: false });
  state.settings.courts = 1; state.settings.dayStart = '08:45'; state.settings.dayEnd = '09:30';
  E.generateTournament(state);
  assert.equal(state.matches.filter((match) => match.startTime).length, 1);
  assert.ok(state.matches.filter((match) => !match.startTime).every((match) => !match.court));
  assert.equal(state.metadata.scheduleWarnings.length, state.matches.length - 1);
  assert.equal(state.matches.some((match) => match.startTime === '23:59'), false);
});

test('normalization handles null optional records and infers legacy start without discarding names', () => {
  const state = E.normalizeState({ teams: [null], groups: [null], matches: [null], settings: 'invalid', metadata: 'invalid' });
  assert.equal(state.teams.length, 24);
  assert.ok(state.metadata.startedAt);
  assert.equal(typeof state.settings, 'object');
  assert.equal(state.matches[0].sets.length, 3);
});

test('reloading a started tournament leaves all immutable roster/settings/opening-match fields unchanged', () => {
  for (const format of [E.FORMATS.SINGLE_ELIMINATION, E.FORMATS.DOUBLE_ELIMINATION, E.FORMATS.GROUPS_PLAYOFF]) {
    const state = fixture(12, format, { groupCount: 2, playoffSize: 6, protectGroupWinners: true });
    E.generateTournament(state);
    const normalized = E.normalizeState(plain(state));
    assert.deepEqual(plain(normalized.settings), plain(state.settings));
    assert.deepEqual(plain(normalized.teams), plain(state.teams));
    assert.deepEqual(plain(normalized.groups), plain(state.groups));
    assert.deepEqual(plain(normalized.matches), plain(state.matches));
    assert.equal(normalized.metadata.startedAt, state.metadata.startedAt);
  }
});

test('backup validator accepts blank drafts and legacy optional fields without mutating the file', () => {
  const draft = plain(E.createDefaultState());
  assert.equal(E.validateStateSnapshot(draft), '');
  const phantomStart = structuredClone(draft); phantomStart.metadata.startedAt = new Date().toISOString();
  assert.match(E.validateStateSnapshot(phantomStart), /avvio o partite iniziali/);
  const legacy = plain(fullTournament(fixture(8)));
  delete legacy.metadata;
  for (const match of legacy.matches) delete match.rule;
  const before = JSON.stringify(legacy);
  assert.equal(E.validateStateSnapshot(legacy), '');
  assert.equal(JSON.stringify(legacy), before);
});

test('backup validator rejects broken references, stages, groups and scores before they can lock the app', () => {
  const valid = plain(fullTournament(fixture(8)));
  const corruptions = [
    (state) => { state.matches[0].aId = 'missing-team'; },
    (state) => { state.matches[0].bId = state.matches[0].aId; },
    (state) => { state.matches[0].id = state.matches[1].id; },
    (state) => { state.matches[0].stage = 0.5; },
    (state) => { state.stage = 99; },
    (state) => { state.matches[0].bracket = 'unknown'; },
    (state) => { state.matches[0].rule = 'unknown'; },
    (state) => { state.matches[0].sets[0].a = '-1'; },
    (state) => { state.matches[0].sets[0].a = 21.5; },
    (state) => { state.matches[0].sets[0] = { a: '17', b: '0' }; },
    (state) => { state.matches[0].sourceA = state.matches.at(-1).id; },
    (state) => { state.championId = 'missing-team'; },
    (state) => { state.qualifiers = [{ teamId: 'missing-team' }]; },
    (state) => { state.matches[0] = null; },
  ];
  for (const corrupt of corruptions) {
    const invalid = structuredClone(valid); corrupt(invalid);
    assert.match(E.validateStateSnapshot(invalid), /Backup non valido/);
  }
  const grouped = plain(fullTournament(fixture(8, E.FORMATS.GROUPS_PLAYOFF, { groupCount: 2, playoffSize: 4, protectGroupWinners: true })));
  assert.equal(E.validateStateSnapshot(grouped), '');
  grouped.groups[1].teamIds.push(grouped.groups[0].teamIds[0]);
  assert.match(E.validateStateSnapshot(grouped), /compare più volte/);
});

test('all supported formulas complete with unique entrants and the expected number of games', () => {
  let trials = 0;
  for (let variation = 0; variation < 2; variation += 1) {
    for (let count = 2; count <= 24; count += 1) {
      for (const format of Object.values(E.FORMATS)) {
        const configurations = format === E.FORMATS.GROUPS_PLAYOFF
          ? [2, 3, 4, 5, 6, 7, 8].flatMap((groupCount) => [4, 6, 8].flatMap((playoffSize) => [false, true].flatMap((protectGroupWinners) => [false, true].map((silverEnabled) => ({ groupCount, playoffSize, protectGroupWinners, silverEnabled })))))
          : [{}];
        for (const options of configurations) {
          const state = fixture(count, format, options);
          if (E.validateTeams(state)) continue;
          fullTournament(state, variation); trials += 1;
          assert.equal(E.validateStateSnapshot(plain(state)), '', `Valid backup: ${format}, ${count}`);
          assert.equal(new Set(state.matches.map((match) => match.id)).size, state.matches.length);
          assert.equal(state.matches.some((match) => !match.bye && match.aId === match.bId), false);
          const played = state.matches.filter((match) => !match.bye).length;
          const estimate = E.estimateMatches(state);
          assert.ok(played >= estimate.minimum && played <= estimate.maximum, `${format}, ${count}, games ${played}`);
          if (format === E.FORMATS.DOUBLE_ELIMINATION) {
            assert.ok(E.activeTeams(state).filter((team) => team.id !== state.championId).every((team) => team.losses === 2));
            assert.ok(E.team(state, state.championId).losses <= 1);
          }
          const before = state.matches.length; E.generateNextStage(state); assert.equal(state.matches.length, before);
        }
      }
    }
  }
  assert.ok(trials >= 900, `Ran ${trials} tournament simulations`);
});
