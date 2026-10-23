'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = vm.createContext({ window: { crypto: require('node:crypto').webcrypto, structuredClone } });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'engine.js'), 'utf8'), context);
const E = context.window.BeachEngine;
const plain = value => JSON.parse(JSON.stringify(value));
const blank = () => Array.from({ length: 3 }, () => ({ a: '', b: '' }));

function fixture(format, count) {
  const state = E.createDefaultState();
  state.teams.forEach((team, index) => { team.name = index < count ? `Coppia ${index + 1}` : ''; team.seed = index < 3 ? index + 1 : null; });
  state.settings.format = format;
  Object.assign(state.settings.formatOptions, { groupCount: 2, playoffSize: 4, protectGroupWinners: false, silverEnabled: false });
  E.generateTournament(state, { drawCode: 'CONFIRMED-SCORE-RESET' });
  return state;
}

function scores(match, side = 'a') {
  const sets = blank();
  const rule = E.matchRuleDefinition(match);
  for (let index = 0; index < (rule.bestOf === 1 ? 1 : 2); index += 1) {
    sets[index][side] = String(rule.targets[index]);
    sets[index][side === 'a' ? 'b' : 'a'] = '5';
  }
  return sets;
}

function finish(state, forceFinalReset = false) {
  for (let round = 0; round < 50 && !E.tournamentComplete(state); round += 1) {
    for (const match of [...E.currentStageMatches(state)]) {
      if (!match.bye && !match.winnerId) E.updateMatchScores(state, match.id, scores(match, forceFinalReset && match.id === 'F1' ? 'b' : 'a'));
    }
    if (!E.tournamentComplete(state)) E.generateNextStage(state);
  }
  assert.ok(E.tournamentComplete(state), `finished ${state.settings.format}`);
}

function staticMatch(match) {
  const copy = plain(match);
  for (const key of ['sets', 'winnerId', 'loserId', 'updatedAt']) delete copy[key];
  return copy;
}

function registration(team) {
  const copy = plain(team);
  for (const key of ['losses', 'byes', 'initialByes', 'fairByes', 'technicalByes', 'out', 'updatedAt']) delete copy[key];
  return copy;
}

for (const [format, count] of [[E.FORMATS.SINGLE_ELIMINATION, 6], [E.FORMATS.DOUBLE_ELIMINATION, 6], [E.FORMATS.GROUPS_PLAYOFF, 6], [E.FORMATS.ROUND_ROBIN_FINAL4, 4]]) {
  test(`confirmed score reset preserves the opening draw and schedule and permits replay (${format})`, () => {
    const state = fixture(format, count);
    const openingReferences = state.matches.filter(match => match.stage === 0);
    const opening = plain(openingReferences.map(staticMatch));
    const draw = plain(state.settings.draw);
    const settings = plain(state.settings);
    const groups = plain(state.groups);
    const entrants = plain(state.teams.map(registration));
    const started = state.metadata.startedAt;
    finish(state, format === E.FORMATS.DOUBLE_ELIMINATION);
    assert.ok(state.matches.some(match => match.stage > 0));
    if (format === E.FORMATS.DOUBLE_ELIMINATION) assert.ok(state.matches.some(match => match.id === 'F2'), 'fixture covers a decisive bracket reset final');
    const later = state.matches.find(match => match.stage > 0);
    state.metadata.scheduleWarnings = [{ matchId: openingReferences[0].id, reason: 'Existing reservation warning' }, { matchId: later.id, reason: 'Removed stage warning' }];

    E.resetScores(state, { allowStarted: true });

    assert.equal(state.stage, 0);
    assert.equal(state.metadata.startedAt, started);
    assert.deepEqual(plain(state.settings.draw), draw);
    assert.deepEqual(plain(state.groups), groups);
    const nextSettings = plain(state.settings);
    for (const key of ['cursor', 'lastTeamId', 'history']) {
      delete settings.byePolicy[key]; delete nextSettings.byePolicy[key];
    }
    assert.deepEqual(nextSettings, settings, 'static settings remain database-lock compatible');
    assert.deepEqual(plain(state.teams.map(registration)), entrants);
    assert.deepEqual(plain(state.matches.map(staticMatch)), opening, 'no opening pair, source, bye, court, time or order changes');
    state.matches.forEach((match, index) => {
      assert.equal(match, openingReferences[index], 'existing opening match objects are retained');
      assert.deepEqual(plain(match.sets), blank());
      assert.equal(match.winnerId, match.bye ? match.aId || match.bId : null);
      assert.equal(match.loserId, null);
    });
    assert.equal(state.championId, null);
    assert.equal(state.silverChampionId, null);
    assert.equal(state.finalResetPlayed, false);
    assert.deepEqual(plain(state.qualifiers), []);
    assert.deepEqual(plain(state.silverQualifiers), []);
    assert.equal(state.postseasonPlan, null);
    assert.deepEqual(plain(state.metadata.scheduleWarnings), [{ matchId: openingReferences[0].id, reason: 'Existing reservation warning' }]);
    assert.equal(E.validateStateSnapshot(plain(state)), '');
    assert.throws(() => E.generateTournament(state), /Torneo avviato/, 'score reset does not reopen roster or redraw');
    finish(state);
    assert.ok(state.championId, 'the unchanged opening round can progress to a new champion');
  });
}

test('unconfirmed score resets remain rejected and leave a started tournament unchanged', () => {
  const state = fixture(E.FORMATS.SINGLE_ELIMINATION, 4);
  E.updateMatchScores(state, state.matches[0].id, scores(state.matches[0]));
  const before = plain(state);
  assert.throws(() => E.resetScores(state), /Torneo avviato/);
  assert.throws(() => E.resetScores(state, { allowStarted: false }), /Torneo avviato/);
  assert.deepEqual(plain(state), before);
});

test('a confirmed reset clears partial opening scores without changing a manual reservation', () => {
  const state = fixture(E.FORMATS.SINGLE_ELIMINATION, 4);
  const match = state.matches[0];
  match.court = 'Campo centrale'; match.startTime = '13:17';
  E.updateMatchScores(state, match.id, [{ a: '3', b: '7' }, ...blank().slice(1)]);
  const initial = plain(state.matches.map(staticMatch));
  E.resetScores(state, { allowStarted: true });
  assert.deepEqual(plain(state.matches.map(staticMatch)), initial);
  assert.deepEqual(plain(match.sets), blank());
  assert.equal(match.court, 'Campo centrale');
  assert.equal(match.startTime, '13:17');
});
