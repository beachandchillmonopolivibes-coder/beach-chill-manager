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
const minutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));

function fixture(sizes, courts) {
  const state = E.createDefaultState();
  state.settings.format = E.FORMATS.GROUPS_PLAYOFF;
  Object.assign(state.settings, { courts, slotMinutes: 20, dayStart: '08:00', dayEnd: '23:00' });
  Object.assign(state.settings.formatOptions, { groupCount: sizes.length, groupAssignmentMode: 'manual', playoffSize: 4, protectGroupWinners: false });
  let index = 0;
  sizes.forEach((size, group) => {
    for (let n = 0; n < size; n += 1) {
      const team = state.teams[index++];
      team.name = `Coppia ${index}`; team.seed = null; team.manualGroup = group + 1;
    }
  });
  assert.equal(E.validateTeams(state), null);
  return state;
}

function generated(sizes, courts) {
  const state = fixture(sizes, courts);
  E.generateTournament(state, { drawCode: 'GROUP-ROTATION' });
  return state;
}

function verifyBookings(state) {
  assert.equal(state.metadata.scheduleWarnings.length, 0);
  const courts = new Map(), teams = new Map();
  for (const match of state.matches) {
    assert.ok(match.court && match.startTime, `${match.id} has a real slot`);
    const start = minutes(match.startTime);
    assert.ok(start >= minutes(state.settings.dayStart));
    assert.ok(start + state.settings.slotMinutes <= minutes(state.settings.dayEnd));
    const court = courts.get(match.court) || [];
    assert.ok(court.every(other => Math.abs(other - start) >= state.settings.slotMinutes), `court collision ${match.id}`);
    courts.set(match.court, [...court, start]);
    for (const id of [match.aId, match.bId]) {
      const bookings = teams.get(id) || [];
      assert.ok(bookings.every(other => Math.abs(other - start) >= state.settings.slotMinutes * 2), `team rest ${match.id}`);
      teams.set(id, [...bookings, start]);
    }
  }
  const sorted = [...state.matches].sort((a, b) => minutes(a.startTime) - minutes(b.startTime) || Number(a.court.slice(6)) - Number(b.court.slice(6)));
  assert.deepEqual(plain(state.matches.map(m => m.id)), plain(sorted.map(m => m.id)), 'match list follows actual chronological/court order');
}

test('two groups on two courts play in parallel on dedicated courts', () => {
  const state = generated([4, 4], 2);
  verifyBookings(state);
  assert.equal(state.matches.length, 12);
  assert.equal(state.matches[0].groupId, 'group-1');
  assert.equal(state.matches[1].groupId, 'group-2');
  assert.equal(state.matches[0].startTime, state.matches[1].startTime);
  assert.ok(state.matches.filter(m => m.groupId === 'group-1').every(m => m.court === 'Campo 1'));
  assert.ok(state.matches.filter(m => m.groupId === 'group-2').every(m => m.court === 'Campo 2'));
  assert.deepEqual(plain(state.matches.map(m => m.groupId)), Array.from({ length: 12 }, (_, i) => `group-${i % 2 + 1}`));
});

test('four groups rotate A/B then C/D across two courts throughout the group stage', () => {
  const state = generated([4, 4, 4, 4], 2);
  verifyBookings(state);
  assert.deepEqual(plain(state.matches.map(m => m.groupId)), Array.from({ length: 24 }, (_, i) => `group-${i % 4 + 1}`));
  assert.equal(state.matches[0].startTime, '08:00');
  assert.equal(state.matches[1].startTime, '08:00');
  assert.equal(state.matches[2].startTime, '08:20');
  assert.equal(state.matches[3].startTime, '08:20');
});

test('odd and uneven groups rotate every unfinished group instead of finishing one group first', () => {
  const state = generated([3, 4, 5], 2);
  verifyBookings(state);
  const expected = [];
  for (let game = 0; game < 10; game += 1) {
    [3, 6, 10].forEach((count, group) => { if (game < count) expected.push(`group-${group + 1}`); });
  }
  assert.deepEqual(plain(state.matches.map(m => m.groupId)), expected);
  assert.deepEqual(plain(state.groups.map(g => state.matches.filter(m => m.groupId === g.id).length)), [3, 6, 10]);
});

test('a single court alternates groups while retaining rest and every pairing', () => {
  const state = generated([4, 4], 1);
  verifyBookings(state);
  assert.deepEqual(plain(state.matches.map(m => m.groupId)), Array.from({ length: 12 }, (_, i) => `group-${i % 2 + 1}`));
  assert.equal(new Set(state.matches.map(m => [m.aId, m.bId].sort().join(':'))).size, 12);
});

test('extra courts are used without mixing the dedicated court allocation', () => {
  const state = generated([4, 4], 4);
  verifyBookings(state);
  const initial = state.matches.filter(m => m.startTime === '08:00');
  assert.equal(initial.length, 4);
  assert.deepEqual(plain(initial.map(m => m.court)), ['Campo 1', 'Campo 2', 'Campo 3', 'Campo 4']);
  assert.ok(state.matches.filter(m => m.groupId === 'group-1').every(m => ['Campo 1', 'Campo 3'].includes(m.court)));
  assert.ok(state.matches.filter(m => m.groupId === 'group-2').every(m => ['Campo 2', 'Campo 4'].includes(m.court)));
});

test('existing manual reservations survive even on another group dedicated court', () => {
  const state = generated([4, 4], 2);
  const imported = state.matches.find(m => m.groupId === 'group-1');
  imported.court = 'Campo 2'; imported.startTime = '08:00';
  const preserved = plain(imported);
  state.matches.filter(m => m !== imported).forEach(m => { m.court = ''; m.startTime = ''; });
  E.autoScheduleStage(state, 0);
  assert.deepEqual(plain(imported), preserved);
  assert.ok(state.matches.every(m => m.court && m.startTime));
  assert.equal(state.matches.filter(m => m.court === 'Campo 2' && m.startTime === '08:00').length, 1);
});

test('normalizing a started tournament keeps existing order, pairings and reservations', () => {
  const state = generated([4, 4], 2);
  state.matches.reverse();
  state.matches.forEach((m, index) => { m.order = index + 1; m.bracketOrder = index + 1; });
  const before = plain(state.matches);
  const restored = E.normalizeState(plain(state));
  assert.deepEqual(plain(restored.matches), before);
  assert.throws(() => E.generateTournament(restored), /avviato/i);
});

test('insufficient capacity leaves later rotation games unassigned with warnings', () => {
  const state = fixture([4, 4, 4, 4], 2); state.settings.dayEnd = '08:40';
  E.generateTournament(state, { drawCode: 'SHORT-DAY' });
  assert.deepEqual(plain(state.matches.filter(m => m.startTime).map(m => m.groupId)), ['group-1', 'group-2', 'group-3', 'group-4']);
  assert.equal(state.metadata.scheduleWarnings.length, 20);
  assert.ok(state.matches.filter(m => !m.startTime).every(m => !m.court));
});
