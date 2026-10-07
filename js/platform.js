/**
 * Blade Orbit — platform module.
 * StarHermit side goes through window.StarHermit (starhermit-sdk.js, loaded
 * first as a classic script): launch token + renewal, sign-in, profile
 * nickname and avatar, platform leaderboard read and score submit, cloud save, settings KV,
 * invite link and control bindings. Without a launch token none of these
 * makes a request.
 * Own-server use is limited to GET /api/v1/time, and only when signed in;
 * standalone uses the local clock and makes no own-server request.
 */

const SH = (typeof window !== 'undefined' && window.StarHermit) || null;
// Read the launch fragment as early as possible (module evaluation, before main.js runs).
if (SH && !SH.__boInit) { SH.init(); SH.__boInit = true; }

export class Platform {
  constructor(sh = SH) {
    this.sh = sh;
    this.clockOffsetMs = 0;       // server - client (signed in only)
    this.profile = null;          // { displayName, userId } for the signed-in player
    this._pushedSettings = null;  // last settings mirrored to the KV store
    this._cloudReady = false;
  }

  get tokenHosted() { return !!(this.sh && this.sh.signedIn); }
  get token() { return this.tokenHosted ? this.sh.token : null; }
  get userId() { return this.tokenHosted ? this.sh.userId : null; }
  get scope() { return this.sh ? this.sh.slug : null; }

  _headers(extra = {}) {
    const h = { ...extra };
    if (this.token) h['Authorization'] = `Bearer ${this.token}`;
    return h;
  }

  async init() {
    // Round-trip-adjusted time sync — signed in only (launch token).
    if (!this.tokenHosted) return this;
    try {
      const t0 = Date.now();
      const res = await fetch('/api/v1/time', { cache: 'no-store', headers: this._headers() });
      if (!res.ok) throw new Error('no-time');
      const body = await res.json();
      const t1 = Date.now();
      const rtt = t1 - t0;
      // Hosts expose the epoch under different keys (`now`, `serverTime`, `epochMs`).
      const serverMs = Number(body.now ?? body.serverTime ?? body.epochMs);
      if (!Number.isFinite(serverMs)) throw new Error('no-time');
      this.clockOffsetMs = serverMs + rtt / 2 - t1;
    } catch {
      this.clockOffsetMs = 0;
    }
    return this;
  }

  serverNow() {
    return new Date(Date.now() + this.clockOffsetMs);
  }

  // ---------- identity ----------
  // Nickname via GET /api/v1/users/{id}/profile (SDK, cached). Never /api/v1/me.
  profileFor(userId) {
    if (!userId || typeof userId !== 'string') return Promise.resolve('player');
    const fallback = 'Player ' + userId.slice(0, 8);
    if (!this.tokenHosted) return Promise.resolve(fallback);
    return this.sh.profile(userId).then((p) => (p && p.nickname) || fallback, () => fallback);
  }

  // The signed-in player's display name, or null when anonymous.
  async fetchProfile() {
    if (!this.tokenHosted) return null;
    const p = await this.sh.profile();
    if (!p) return null;
    this.profile = { displayName: String(p.displayName).slice(0, 40), userId: this.userId };
    return this.profile;
  }

  /** Object URL of the signed-in player's avatar, or null. */
  avatarUrl() { return this.tokenHosted ? this.sh.avatarUrl() : Promise.resolve(null); }

  // ---------- sign-in, invite, auth state ----------
  canSignIn() { return !!(this.sh && this.sh.canSignIn()); }
  signIn() { return !!(this.sh && this.sh.signIn()); }
  inviteLink() { return this.tokenHosted ? this.sh.inviteLink() : null; }
  /** fn({ signedIn, reason }) whenever the StarHermit session changes. */
  onAuth(fn) {
    if (!this.sh) return () => {};
    return this.sh.on('auth', (a) => {
      if (!a.signedIn) { this.profile = null; this._cloudReady = false; this._pushedSettings = null; }
      fn(a);
    });
  }

  // ---------- cloud save + settings KV + controls ----------
  /** Signed-in start: { remote, settings, bindings } or null standalone. */
  async loadAccount(keyDefaults) {
    if (!this.tokenHosted) return null;
    const [remote, settings, bindings] = await Promise.all([
      this.sh.loadJSON(), this.sh.getSettings(), this.sh.loadBindings(keyDefaults),
    ]);
    this._cloudReady = true;
    this._pushedSettings = JSON.parse(JSON.stringify(settings || {}));
    return { remote, settings: settings || {}, bindings };
  }

  /** Debounced cloud save of the progress document (after loadAccount). */
  saveCloud(doc) {
    if (!this.tokenHosted || !this._cloudReady) return false;
    this.sh.saveJSON(doc);
    return true;
  }

  flushCloud() { return this.tokenHosted ? this.sh.flushSave(true) : Promise.resolve(false); }

  /** PATCH the settings keys that changed since the last mirror. */
  mirrorSettings(s) {
    if (!this.tokenHosted || !this._pushedSettings) return null;
    const patch = {};
    for (const k of Object.keys(s)) {
      if (JSON.stringify(s[k]) !== JSON.stringify(this._pushedSettings[k])) patch[k] = s[k];
    }
    this._pushedSettings = JSON.parse(JSON.stringify(s));
    return Object.keys(patch).length ? this.sh.patchSettings(patch) : null;
  }

  // ---------- leaderboard submit (score-script.js) ----------

  /**
   * Post a finished run's total to the `high-score` board; resolves
   * { posted, rank } — the player's rank on that board, or null. Standalone → not posted.
   */
  async submitScore(total) {
    if (!this.tokenHosted || typeof this.sh.submitScores !== 'function') return { posted: false, rank: null };
    let keys = [];
    try { keys = await this.sh.submitScores({ 'high-score': Math.max(0, Math.round(total)) }); } catch { keys = []; }
    if (!keys.includes('high-score')) return { posted: false, rank: null };
    try {
      const r = await this.sh.leaderboard('high-score', { pageSize: 100 });
      const me = (r.items || []).find((i) => i.userId === this.userId);
      return { posted: true, rank: me ? me.rank : null };
    } catch {
      return { posted: true, rank: null };
    }
  }

  // ---------- platform leaderboard (read) ----------

  /**
   * Read the game's first platform leaderboard; user ids resolve to profile
   * nicknames. No board (or no token) → { ok: false } and the UI explains.
   */
  async fetchLeaderboard({ friendsOnly = false, page = 1, pageSize = 20 } = {}) {
    if (!this.tokenHosted) return { ok: false, entries: [], label: 'casual' };
    try {
      const r = await this.sh.leaderboard(null, { page, pageSize, scope: friendsOnly ? 'friends' : undefined });
      if (!r.board) return { ok: false, entries: [], label: 'casual', reason: 'no-leaderboard' };
      const raw = r.items || r.entries || [];
      const entries = await Promise.all(raw.map(async (e) => ({
        rank: e.rank,
        score: e.score ?? e.value,
        userId: e.userId ?? e.playerId ?? null,
        name: e.nickname || await this.profileFor(e.userId ?? e.playerId ?? ''),
      })));
      return { ok: true, entries, label: 'ranked' };
    } catch {
      return { ok: false, entries: [], label: 'casual' };
    }
  }
}
