'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { publicConfig } = require('../scripts/build.cjs');
const good = { SUPABASE_URL: 'https://example.supabase.co/', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example' };
test('build exposes only the intended public configuration', () => {
  const config = publicConfig({ ...good, SUPABASE_SECRET_KEY: 'never-output', PASSWORD: 'never-output' });
  assert.equal(config.supabaseUrl, 'https://example.supabase.co');
  assert.equal(config.adminEmailDomain, 'admin.beachvolley.app');
  assert.equal(JSON.stringify(config).includes('never-output'), false);
});
test('production build requires both Supabase values; local demo is explicit', () => {
  assert.throws(() => publicConfig({ VERCEL: '1' }), /Deployment interrotto/);
  assert.throws(() => publicConfig({ SUPABASE_URL: good.SUPABASE_URL }), /insieme/);
  assert.equal(publicConfig({}).supabaseUrl, '');
});
test('build rejects privileged keys and malformed backend origins', () => {
  for (const key of ['sb_secret_example', 'service_role', 'eyJhbGciOiJIUzI1NiJ9.payload.signature']) {
    assert.throws(() => publicConfig({ ...good, SUPABASE_PUBLISHABLE_KEY: key }), /Publishable key/);
  }
  for (const url of ['http://example.supabase.co', 'https://user:pass@example.supabase.co', 'https://example.supabase.co/rest/v1', 'https://example.supabase.co?token=secret']) {
    assert.throws(() => publicConfig({ ...good, SUPABASE_URL: url }), /SUPABASE_URL/);
  }
});
test('build validates tournament identifiers and labels', () => {
  assert.throws(() => publicConfig({ DEFAULT_TOURNAMENT_SLUG: '../escape' }), /SLUG/);
  assert.throws(() => publicConfig({ DEFAULT_TOURNAMENT_NAME: 'a'.repeat(161) }), /NAME/);
  assert.equal(publicConfig({ DEFAULT_TOURNAMENT_SLUG: 'beach-2026', DEFAULT_TOURNAMENT_NAME: 'A "quoted" tournament' }).defaultTournamentName, 'A "quoted" tournament');
});

test('build refuses example placeholders instead of deploying a disconnected app', () => {
  assert.throws(() => publicConfig({ SUPABASE_URL: 'https://YOUR_PROJECT.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_YOUR_KEY' }), /segnaposto/);
});
