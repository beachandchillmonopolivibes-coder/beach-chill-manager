'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function publicConfig(env, defaults = {}) {
  const value = (name, fallback = '') => String(env[name] ?? fallback).trim();
  const config = {
    supabaseUrl: value('SUPABASE_URL', defaults.supabaseUrl),
    supabasePublishableKey: value('SUPABASE_PUBLISHABLE_KEY', defaults.supabasePublishableKey),
    defaultTournamentSlug: value('DEFAULT_TOURNAMENT_SLUG', defaults.defaultTournamentSlug || 'beach-chill-2026'),
    defaultTournamentName: value('DEFAULT_TOURNAMENT_NAME', defaults.defaultTournamentName || 'Beach & Chill 2026'),
    adminEmailDomain: 'admin.beachvolley.app',
  };
  if (Boolean(config.supabaseUrl) !== Boolean(config.supabasePublishableKey)) {
    throw new Error('Configura insieme SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY.');
  }
  if (config.supabaseUrl) {
    if (/(?:YOUR_PROJECT|YOUR_KEY|YOUR_SUPABASE|INCOLLA_QUI|PLACEHOLDER)/i.test(config.supabaseUrl + ' ' + config.supabasePublishableKey)) {
      throw new Error('Sostituisci i valori segnaposto con URL e Publishable key reali del tuo progetto.');
    }
    let url;
    try { url = new URL(config.supabaseUrl); } catch (_) { throw new Error('SUPABASE_URL non valido.'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) {
      throw new Error('SUPABASE_URL deve essere un URL HTTPS del progetto, senza percorsi /rest/v1 o credenziali.');
    }
    config.supabaseUrl = url.origin;
    if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(config.supabasePublishableKey)) {
      throw new Error('Usa una Publishable key sb_publishable_...; le chiavi secret/service_role non sono ammesse nel browser.');
    }
  } else if (env.VERCEL === '1') {
    throw new Error('Deployment interrotto: aggiungi SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY nelle variabili Vercel e ripeti il deploy.');
  }
  if (!/^[a-z0-9][a-z0-9-]{2,49}$/.test(config.defaultTournamentSlug)) {
    throw new Error('DEFAULT_TOURNAMENT_SLUG: usa 3–50 caratteri minuscoli, numeri e trattini; primo carattere alfanumerico.');
  }
  if (!config.defaultTournamentName || config.defaultTournamentName.length > 160) {
    throw new Error('DEFAULT_TOURNAMENT_NAME deve contenere 1–160 caratteri.');
  }
  return config;
}

function build(root = path.resolve(__dirname, '..'), env = process.env) {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'config.js'), 'utf8'), sandbox, { timeout: 1000 });
  const config = publicConfig(env, sandbox.window.BEACH_APP_CONFIG);
  const output = path.join(root, 'dist');
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output);
  const runtime = fs.readdirSync(root).filter(name => /\.(?:html|css|js|png|webmanifest)$/.test(name) && name !== 'config.js');
  for (const filename of ['index.html', 'app.js', 'engine.js', 'db.js', 'sw.js', 'style.css', 'manifest.webmanifest']) {
    if (!runtime.includes(filename)) throw new Error(`File applicativo mancante: ${filename}`);
  }
  for (const filename of runtime) fs.copyFileSync(path.join(root, filename), path.join(output, filename));
  const vendor = path.join(root, 'vendor');
  if (fs.existsSync(vendor)) fs.cpSync(vendor, path.join(output, 'vendor'), { recursive: true });
  fs.writeFileSync(path.join(output, 'config.js'), `/* Configurazione pubblica generata: non contiene segreti. */\nwindow.BEACH_APP_CONFIG = ${JSON.stringify(config, null, 2)};\n`);
  console.log(`Build completata: dist/ (${runtime.length + 1} file). Modalità ${config.supabaseUrl ? 'Supabase' : 'demo locale'}.`);
  return { output, config, runtime };
}
if (require.main === module) {
  try { build(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { build, publicConfig };
