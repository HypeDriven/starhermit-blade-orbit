/**
 * Blade Orbit — platform module.
 * StarHermit host adapter: server-time sync, score submission with replay
 * envelope, presence heartbeats, telemetry consent. Fully offline-capable:
 * every hosted feature degrades to a local no-op when /api is absent.
 * Access/launch tokens are never persisted to local storage.
 */

const TELEMETRY_WHITELIST = new Set(['start', 'tutorial_step', 'round_end', 'retry', 'settings_change', 'error']);

export class Platform {
  constructor() {
    this.hosted = false;
    this.clockOffsetMs = 0; // server - client
    this.heartbeatTimer = null;
    this.telemetryConsent = true; // anonymous funnel events only
    this.scope = null;
  }

  async init() {
    // Read launch scope from the short-lived token (query param), never hard-code a slug.
    try {
      const params = new URLSearchParams(location.search);
      const token = params.get('launch_token');
      if (token) {
        const payload = JSON.parse(atob(token.split('.')[1] || ''));
        this.scope = payload.scope || payload.game || null;
      }
    } catch { this.scope = null; }

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

  serverNow() {
    return new Date(Date.now() + this.clockOffsetMs);
  }

  /** Submit a ranked score claim: replay envelope + components + checksum. */
  async submitScore(envelope) {
    if (!this.hosted) return { ok: false, reason: 'offline', label: 'casual' };
    try {
      const res = await fetch('/api/v1/scores', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
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

  async fetchLeaderboard(contentId, filter = 'global') {
    if (!this.hosted) return { ok: false, entries: [], label: 'casual' };
    try {
      const res = await fetch(`/api/v1/scores/${encodeURIComponent(contentId)}?filter=${filter}`);
      const body = await res.json();
      if (body.error) return { ok: false, entries: [], label: 'casual' };
      return { ok: true, entries: body.entries || [], label: body.label || 'ranked' };
    } catch {
      return { ok: false, entries: [], label: 'casual' };
    }
  }

  /** Throttled presence heartbeat while actively playing. */
  startPresence() {
    if (!this.hosted || this.heartbeatTimer) return;
    const beat = () => fetch('/api/v1/presence', { method: 'POST', body: '{}' }).catch(() => {});
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
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event, detail: safe, ts: Date.now() }),
    }).catch(() => {});
  }
}
