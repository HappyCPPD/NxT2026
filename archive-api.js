'use strict';

// Archive mode for GitHub Pages: there is no server, so this answers the
// player UI's /api/* calls in the browser. Loaded before app.js; the data comes
// from data.js (written by tools/build-static.js). Progress lives in
// localStorage, so it's per browser and never leaves the device.

(function () {
  const A = window.ARCHIVE;
  const KEY = 'nxt-archive:progress';
  // Absolute base of the site, so challenge links work under /<repo>/ too.
  const BASE = location.origin + location.pathname.replace(/[^/]*$/, '');

  function load() {
    try {
      const p = JSON.parse(localStorage.getItem(KEY));
      if (p && Array.isArray(p.solved) && p.hints) return p;
    } catch {}
    return { solved: [], hints: {} };
  }

  function store(p) {
    try {
      localStorage.setItem(KEY, JSON.stringify(p));
    } catch {}
  }

  const byId = new Map(A.challenges.map((c) => [c.id, c]));

  function score(p) {
    return p.solved.reduce((sum, id) => sum + (byId.get(id)?.points || 0), 0);
  }

  async function sha256(s) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  function view(c, p) {
    const unlocked = p.hints[c.id] || 0;
    return {
      id: c.id,
      name: c.name,
      category: c.category,
      difficulty: c.difficulty,
      points: c.points,
      description: c.description.replace(/\]\(\/(?!\/)/g, `](${BASE}`),
      files: c.files.map((f) => ({ name: f, url: `files/${c.id}/${encodeURIComponent(f)}` })),
      hintCount: c.hints.length,
      hints: c.hints.slice(0, unlocked),
      solves: c.solves,
      firstBlood: c.firstBlood,
      solved: p.solved.includes(c.id),
    };
  }

  async function handle(method, path, body) {
    const p = load();
    const route = `${method} ${path.split('?')[0]}`;

    if (route === 'GET /api/config') {
      const end = A.config.endTime && Date.parse(A.config.endTime);
      return [200, { ...A.config, now: end ? Math.max(Date.now(), end + 1000) : Date.now(), phase: 'live', joinCodeRequired: false }];
    }
    if (route === 'GET /api/me') return [200, { user: { name: 'you', score: score(p), rank: null, hidden: false } }];
    if (route === 'POST /api/register' || route === 'POST /api/login' || route === 'POST /api/logout') return [200, { name: 'you' }];
    if (route === 'GET /api/scoreboard') return [200, A.scoreboard];
    if (route === 'GET /api/feed') return [200, { feed: A.feed }];
    if (route === 'GET /api/updates') return [200, { seq: 0, events: [] }];
    if (route === 'GET /api/challenges') return [200, { challenges: A.challenges.map((c) => view(c, p)), phase: 'live' }];
    if (path.startsWith('/api/admin')) return [403, { error: 'The admin view is not part of the archive.' }];

    const hint = path.match(/^\/api\/challenges\/([\w-]+)\/hints\/(\d+)$/);
    if (method === 'POST' && hint) {
      const c = byId.get(hint[1]);
      const idx = Number(hint[2]);
      if (!c || idx >= c.hints.length) return [404, { error: 'No such hint.' }];
      const have = p.hints[c.id] || 0;
      if (idx > have) return [400, { error: 'Unlock the earlier hints first.' }];
      p.hints[c.id] = Math.max(have, idx + 1);
      store(p);
      return [200, { hint: c.hints[idx] }];
    }

    const submit = path.match(/^\/api\/challenges\/([\w-]+)\/submit$/);
    if (method === 'POST' && submit) {
      const c = byId.get(submit[1]);
      if (!c) return [404, { error: 'No such challenge.' }];
      const flag = String(body.flag || '').trim();
      if (!flag) return [400, { error: 'Enter a flag.' }];
      if (p.solved.includes(c.id)) return [200, { correct: true, alreadySolved: true }];
      const hash = await sha256(flag);
      if (![c.flagHash, ...(c.altFlagHashes || [])].includes(hash)) return [200, { correct: false }];
      p.solved.push(c.id);
      store(p);
      return [200, { correct: true, firstBlood: false }];
    }

    return [404, { error: 'Not found' }];
  }

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, opts = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    if (!url.startsWith('/api/')) return realFetch(input, opts);
    const [status, data] = await handle(opts.method || 'GET', url, opts.body ? JSON.parse(opts.body) : {});
    return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  };
})();
