/**
 * Blade Orbit — platform module.
 * StarHermit host adapter: launch-token lifecycle (fragment read, Bearer,
 * 45-min refresh), profile nickname resolution, server-time sync, own-server
 * score submission with replay envelope, platform leaderboard read, presence
 * heartbeats, telemetry consent. Fully offline-capable: every hosted feature
 * degrades to a local no-op when /api is absent.
 *
 * The platform opens the game as index.html#game_token=<jwt> (optional
 * &session_id=), stripped after the read. The JWT carries sub = user id and
 * game_scope = this game's slug — never hard-coded. Access/launch tokens are
 * never persisted to local storage.
 */

const TELEMETRY_WHITELIST = new Set(['start', 'tutorial_step', 'round_end', 'retry', 'settings_change', 'error']);
const REFRESH_MS = 45 * 60 * 1000; // token lives 60 min; re-mint at 45
const RETRY_MS = 60 * 1000;

export class Platform {
  constructor() {
    this.hosted = false;          // own-server /api reachable (time sync ok)
    this.clockOffsetMs = 0;       // server - client
    this.heartbeatTimer = null;
    this.telemetryConsent = true; // anonymous funnel events only
    this.scope = null;            // game slug from the JWT's game_scope
    this.userId = null;           // JWT sub
    this.token = null;            // launch token, memory only
    this.profile = null;          // { displayName } for the signed-in player
    this.profileNames = {};       // userId -> Promise<string> (cached)
    this._refreshTimer = null;
    this._retryTimer = null;
  }

  _headers(extra = {}) {
    const h = { ...extra };
    if (this.token) h['Authorization'] = `Bearer ${this.token}`;
    return h;
  }

  _decodeJwt(t) {
    try {
      const seg = String(t).split('.')[1];
      if (!seg) return null;
      let b64 = seg.replace(/-/g, '+').replace(/_/g, '/');
      b64 += '='.repeat((4 - (b64.length % 4)) % 4);
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return null;
    }
  }

  // Fragment first (the platform contract); query forms are local-dev only.
  _readLaunchToken() {
    try {
      const h = new URLSearchParams(String(location.hash || '').replace(/^#/, ''));
      const t = h.get('game_token');
      if (t) {
        h.delete('game_token');
        h.delete('session_id');
        const rest = h.toString();
        history.replaceState(null, '', location.pathname + location.search + (rest ? '#' + rest : ''));
        return t;
      }
      const q = new URLSearchParams(location.search);
      return q.get('game_token') || q.get('launch_token') || q.get('token') || null;
    } catch {
      return null;
    }
  }

  async init() {
    this.token = this._readLaunchToken();
    if (this.token) {
      const claims = this._decodeJwt(this.token);
      if (!claims) this.token = null; // malformed: treat as standalone
      else {
        if (typeof claims.sub === 'string' && claims.sub) this.userId = claims.sub;
        if (typeof claims.game_scope === 'string' && claims.game_scope) this.scope = claims.game_scope;
        if (!this.userId || !this.scope) this.token = null; // not a usable launch token
      }
    }
    if (this.token) {
      this._scheduleRefresh();
      this.fetchProfile(); // nickname lands async via the profile chip listener
    }

    // Round-trip-adjusted time sync with the host.
    try {
      const t0 = Date.now();
      const res = await fetch('/api/v1/time', { cache: 'no-store' });
      if (!res.ok) throw new Error('no-time');
      const body = await res.json();
      const t1 = Date.now();
      const rtt = t1 - t0;
      // Hosts expose the epoch under different keys (`now`, `serverTime`, `epochMs`).
      const serverMs = Number(body.now ?? body.serverTime ?? body.epochMs);
      if (!Number.isFinite(serverMs)) throw new Error('no-time');
      this.clockOffsetMs = serverMs + rtt / 2 - t1;
      this.hosted = true;
    } catch {
      this.hosted = false;
      this.clockOffsetMs = 0;
    }
    return this;
  }

  get tokenHosted() {
    return !!this.token;
  }

  serverNow() {
    return new Date(Date.now() + this.clockOffsetMs);
  }

  // ---------- token refresh (scoped tokens may re-mint) ----------

  _scheduleRefresh() {
    if (this._refreshTimer) clearInterval(this._refreshTimer);
    this._refreshTimer = setInterval(() => this._refreshToken(), REFRESH_MS);
  }

  _refreshToken() {
    if (!this.token || !this.scope) return Promise.resolve(false);
    return this._api(`games/${encodeURIComponent(this.scope)}/launch-token`, {
      method: 'POST',
      body: '{}',
    }).then((body) => {
      if (body && typeof body.token === 'string' && body.token) {
        this.token = body.token;
        const claims = this._decodeJwt(this.token);
        if (claims && claims.sub) this.userId = claims.sub;
        if (claims && claims.game_scope) this.scope = claims.game_scope;
        return true;
      }
      this._retryRefresh();
      return false;
    }).catch(() => {
      this._retryRefresh();
      return false;
    });
  }

  _retryRefresh() {
    if (this._retryTimer || !this.token) return;
    this._retryTimer = setTimeout(() => {
      this._retryTimer = null;
      this._refreshToken();
    }, RETRY_MS);
  }

  // ---------- identity ----------
  // Nickname via GET /api/v1/users/{id}/profile — the only profile read a
  // game-scoped token may make. Never /api/v1/me, never usernames.
  profileFor(userId) {
    if (!userId || typeof userId !== 'string') return Promise.resolve('player');
    if (this.profileNames[userId]) return this.profileNames[userId];
    const p = this._api(`users/${encodeURIComponent(userId)}/profile`)
      .then((r) => {
        const name = r && typeof r.nickname === 'string' && r.nickname ? r.nickname : null;
        return name || ('Player ' + userId.slice(0, 8));
      })
      .catch(() => 'Player ' + userId.slice(0, 8));
    this.profileNames[userId] = p;
    return p;
  }

  // The signed-in player's display name, or null when anonymous.
  async fetchProfile() {
    if (!this.userId) return null;
    const displayName = (await this.profileFor(this.userId)).slice(0, 40);
    this.profile = { displayName, userId: this.userId };
    return this.profile;
  }

  // ---------- own-server routes (game script backend; local dev + platform) ----------

  /** Submit a ranked score claim: replay envelope + components + checksum. */
  async submitScore(envelope) {
    if (!this.hosted) return { ok: false, reason: 'offline', label: 'casual' };
    try {
      const res = await fetch('/api/v1/scores', {
        method: 'POST',
        headers: this._headers({ 'content-type': 'application/json' }),
        body: JSON.stringify(envelope),
      });
      if (res.status === 429) return { ok: false, reason: 'rate-limited', label: 'casual' };
      const body = await res.json();
      if (body.error) return { ok: false, reason: body.error, label: 'casual' };
      return { ok: true, rank: body.rank, label: 'ranked' };
    } catch {
      return { ok: false, reason: 'network', label: 'casual' };
    }
  }

  // ---------- platform leaderboard (read-only; clients never submit) ----------

  /**
   * Read the game's leaderboard through the platform: the game record yields
   * leaderboardId, entries come from the leaderboards route, and user ids
   * resolve to profile nicknames. No leaderboardId (or no token/host) →
   * { ok: false } and the UI shows local bests only.
   */
  async fetchLeaderboard({ friendsOnly = false, page = 1, pageSize = 20 } = {}) {
    if (!this.token || !this.scope) return { ok: false, entries: [], label: 'casual' };
    try {
      const game = await this._api(`games/${encodeURIComponent(this.scope)}`);
      const leaderboardId = game && game.leaderboardId;
      if (!leaderboardId) return { ok: false, entries: [], label: 'casual', reason: 'no-leaderboard' };
      const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (friendsOnly) qs.set('friendsOnly', 'true');
      const body = await this._api(`leaderboards/${encodeURIComponent(leaderboardId)}/entries?${qs.toString()}`);
      const raw = (body && (body.entries || body.items)) || [];
      const entries = await Promise.all(raw.map(async (e) => ({
        rank: e.rank,
        score: e.score ?? e.value,
        userId: e.userId ?? e.playerId ?? null,
        name: await this.profileFor(e.userId ?? e.playerId ?? ''),
      })));
      return { ok: true, entries, label: 'ranked' };
    } catch {
      return { ok: false, entries: [], label: 'casual' };
    }
  }

  // ---------- generic JSON GET (throws on transport/HTTP errors) ----------

  async _api(path) {
    const res = await fetch(`/api/v1/${path}`, { headers: this._headers({ accept: 'application/json' }) });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error((body && body.error) || `http-${res.status}`);
    return body;
  }

  // ---------- presence + telemetry (own-server routes) ----------

  /** Throttled presence heartbeat while actively playing. */
  startPresence() {
    if (!this.hosted || this.heartbeatTimer) return;
    const beat = () => fetch('/api/v1/presence', { method: 'POST', headers: this._headers(), body: '{}' }).catch(() => {});
    beat();
    this.heartbeatTimer = setInterval(beat, 45000);
  }

  stopPresence() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  /** Anonymous funnel telemetry — whitelisted events, no raw text or trails. */
  track(event, detail = {}) {
    if (!this.telemetryConsent || !TELEMETRY_WHITELIST.has(event)) return;
    if (!this.hosted) return;
    const safe = {};
    for (const k of ['mode', 'tier', 'result', 'category']) {
      if (typeof detail[k] === 'string' && detail[k].length < 40) safe[k] = detail[k];
    }
    fetch('/api/v1/telemetry', {
      method: 'POST',
      headers: this._headers({ 'content-type': 'application/json' }),
      body: JSON.stringify({ event, detail: safe, ts: Date.now() }),
    }).catch(() => {});
  }
}
