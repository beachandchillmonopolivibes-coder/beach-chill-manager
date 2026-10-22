(function (global) {
  'use strict';

  let client = null;
  let channel = null;
  let subscriptionVersion = 0;

  function config() {
    return global.BEACH_APP_CONFIG || {};
  }

  function isConfigured() {
    const c = config();
    const key = String(c.supabasePublishableKey || '').trim();
    if (!key || /YOUR_|INCOLLA_QUI|PLACEHOLDER/i.test(key) || key.startsWith('sb_secret_')) return false;
    try {
      const url = new URL(String(c.supabaseUrl || ''));
      if (url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) return false;
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname))) return false;
      if (/YOUR_PROJECT/i.test(url.hostname)) return false;
      // A legacy service_role JWT is a secret too, even though it resembles an anon key.
      if (key.split('.').length === 3) {
        const segment = key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        const payload = JSON.parse(global.atob(segment.padEnd(Math.ceil(segment.length / 4) * 4, '=')));
        if (payload.role !== 'anon') return false;
      } else if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return false;
      return true;
    } catch (_) { return false; }
  }

  function adminEmailDomain() {
    // Questo dominio deve coincidere con le RPC SQL; non è un server email.
    return 'admin.beachvolley.app';
  }

  function normalizeUsername(value) {
    const username = String(value || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)) {
      throw new Error('invalid_username');
    }
    return username;
  }

  function usernameToEmail(username) {
    return `${normalizeUsername(username)}@${adminEmailDomain()}`;
  }

  function sessionUsername(session) {
    const email = String(session?.user?.email || '').trim().toLowerCase();
    if (!email) return '';
    const suffix = `@${adminEmailDomain()}`;
    return email.endsWith(suffix) ? email.slice(0, -suffix.length) : email.split('@')[0];
  }

  function init() {
    if (!isConfigured()) return null;
    if (!global.supabase?.createClient) {
      throw new Error('Libreria Supabase non caricata. Controlla la connessione Internet.');
    }
    if (!client) {
      client = global.supabase.createClient(
        config().supabaseUrl,
        config().supabasePublishableKey,
        {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: false,
          },
        },
      );
    }
    return client;
  }

  function getClient() {
    return client || init();
  }

  async function getSession() {
    const c = getClient();
    if (!c) return null;
    const { data, error } = await c.auth.getSession();
    if (error) throw error;
    return data.session || null;
  }

  function onAuthStateChange(callback) {
    const c = getClient();
    if (!c) return { data: { subscription: { unsubscribe() {} } } };
    return c.auth.onAuthStateChange((event, session) => callback(event, session));
  }

  async function signInAdmin(username, password) {
    const c = getClient();
    if (!c) throw new Error('Supabase non configurato.');
    const secret = String(password || '');
    if (!secret) throw new Error('password_required');
    const { data, error } = await c.auth.signInWithPassword({
      email: usernameToEmail(username),
      password: secret,
    });
    if (error) throw error;
    return data.session || null;
  }

  async function signOut() {
    const c = getClient();
    if (!c) return;
    const { error } = await c.auth.signOut();
    if (error) throw error;
  }

  async function loadTournamentBySlug(slug) {
    const c = getClient();
    if (!c) return null;
    const { data, error } = await c
      .from('tournaments')
      .select('id,slug,name,public_read,state,revision,owner_id,updated_at')
      .eq('slug', slug)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  }

  async function getMyRole(tournamentId) {
    const c = getClient();
    if (!c || !tournamentId) return null;
    const { data, error } = await c.rpc('get_my_tournament_role', {
      p_tournament_id: tournamentId,
    });
    if (error) throw error;
    return data || null;
  }

  async function createTournament(name, slug, state) {
    const c = getClient();
    if (!c) throw new Error('Supabase non configurato.');
    const { data, error } = await c.rpc('create_tournament_draft', {
      p_name: name.trim(),
      p_slug: slug.trim().toLowerCase(),
      p_state: state,
    });
    if (error) {
      if (['PGRST202', '42883'].includes(error.code) && String(error.message || '').includes('create_tournament_draft')) {
        throw new Error('shared_draft_migration_required');
      }
      throw error;
    }
    return Array.isArray(data) ? data[0] : data;
  }

  async function saveTournamentState(tournamentId, state, expectedRevision) {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error('revision_conflict');
    if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('invalid_tournament_state');
    const c = getClient();
    if (!c) throw new Error('Supabase non configurato.');
    const { data, error } = await c.rpc('save_tournament_state', {
      p_tournament_id: tournamentId,
      p_state: state,
      p_expected_revision: expectedRevision,
    });
    if (error) throw error;
    return Array.isArray(data) ? data[0] : data;
  }

  async function addTournamentAdmin(tournamentId, username) {
    const c = getClient();
    if (!c) throw new Error('Supabase non configurato.');
    const { data, error } = await c.rpc('add_tournament_admin', {
      p_tournament_id: tournamentId,
      p_username: normalizeUsername(username),
    });
    if (error) throw error;
    return data;
  }

  async function listTournamentAdmins(tournamentId) {
    const c = getClient();
    if (!c || !tournamentId) return [];
    const { data, error } = await c.rpc('list_tournament_admins', {
      p_tournament_id: tournamentId,
    });
    if (error) throw error;
    return Array.isArray(data) ? data : [];
  }

  async function removeTournamentAdmin(tournamentId, username) {
    const c = getClient();
    if (!c) throw new Error('Supabase non configurato.');
    const { data, error } = await c.rpc('remove_tournament_admin', {
      p_tournament_id: tournamentId,
      p_username: normalizeUsername(username),
    });
    if (error) throw error;
    return Boolean(data);
  }

  async function setPublicRead(tournamentId, publicRead) {
    const c = getClient();
    if (!c) throw new Error('Supabase non configurato.');
    const { data, error } = await c.rpc('set_tournament_public_read', {
      p_tournament_id: tournamentId,
      p_public_read: Boolean(publicRead),
    });
    if (error) throw error;
    return Array.isArray(data) ? data[0] : data;
  }

  function subscribeToTournament(tournamentId, callback, onStatus = () => {}) {
    const c = getClient();
    if (!c || !tournamentId) return null;
    unsubscribe();
    const version = subscriptionVersion;
    channel = c
      .channel(`tournament-${tournamentId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'tournaments',
          filter: `id=eq.${tournamentId}`,
        },
        (payload) => { if (version === subscriptionVersion) callback(payload.new); },
      )
      .subscribe((status, error) => { if (version === subscriptionVersion) onStatus(status, error); });
    return channel;
  }

  function unsubscribe() {
    subscriptionVersion += 1;
    if (client && channel) {
      // La rimozione è asincrona: i messaggi tardivi vengono ignorati dal token.
      Promise.resolve(client.removeChannel(channel)).catch(() => {});
      channel = null;
    }
  }

  global.BeachDB = {
    isConfigured,
    init,
    getClient,
    getSession,
    onAuthStateChange,
    signInAdmin,
    signOut,
    sessionUsername,
    normalizeUsername,
    usernameToEmail,
    loadTournamentBySlug,
    getMyRole,
    createTournament,
    saveTournamentState,
    addTournamentAdmin,
    listTournamentAdmins,
    removeTournamentAdmin,
    setPublicRead,
    subscribeToTournament,
    unsubscribe,
  };
})(window);
