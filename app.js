'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const state = { config: null, me: null, challenges: [], filter: 'all', board: null, adminToken: sessionStorage.getItem('adminToken') || '' };
const CHART_COLORS = ['#e6293f', '#3ddc84', '#f0a830', '#5cc8ff', '#b79cff', '#ff7a8a', '#7ee8b0', '#ffd27a', '#9ad8ff', '#d4c2ff'];

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// Tiny markdown: `code`, **bold**, [text](url)
function md(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, href) =>
      /^(https?:\/\/|\/)/.test(href) ? `<a href="${href}" target="_blank" rel="noopener">${text}</a>` : text
    );
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.body ? 'POST' : opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status, data });
  return data;
}

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function clock(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function toast(html, cls = '') {
  const el = document.createElement('div');
  el.className = `toast ${cls}`;
  el.innerHTML = html;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), 6000);
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

const VIEWS = ['auth', 'challenges', 'scoreboard', 'feed', 'rules', 'admin', 'writeups'];

function route() {
  let tab = location.hash.slice(1).split('/')[0] || 'challenges';
  if (!VIEWS.includes(tab)) tab = 'challenges';
  if (tab === 'challenges' && !state.me) tab = 'auth';
  for (const v of VIEWS) $(`#view-${v}`).hidden = v !== tab;
  for (const a of document.querySelectorAll('#nav a')) a.classList.toggle('active', a.dataset.tab === tab);
  if (tab === 'challenges') loadChallenges();
  if (tab === 'scoreboard') loadScoreboard();
  if (tab === 'feed') loadFeed();
  if (tab === 'admin') loadAdmin();
}
window.addEventListener('hashchange', route);

// ---------------------------------------------------------------------------
// Auth + header
// ---------------------------------------------------------------------------

async function loadMe() {
  state.me = (await api('/api/me')).user;
  const el = $('#me');
  if (!state.me) {
    el.innerHTML = '<a href="#auth">Log in</a>';
    return;
  }
  const rank = state.me.hidden ? 'hidden' : state.me.rank ? `#${state.me.rank}` : '—';
  el.innerHTML = `<b>${esc(state.me.name)}</b> · ${state.me.score} pts · ${rank} <button id="logout">Log out</button>`;
  $('#logout').onclick = async () => {
    await api('/api/logout', { body: {} });
    state.me = null;
    await loadMe();
    location.hash = 'auth';
    route();
  };
}

$('#auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const mode = e.submitter?.dataset.mode || 'login';
  const form = new FormData(e.target);
  $('#auth-error').textContent = '';
  try {
    await api(`/api/${mode}`, { body: Object.fromEntries(form) });
    await loadMe();
    location.hash = 'challenges';
    route();
  } catch (err) {
    $('#auth-error').textContent = err.message;
  }
});

function tickTimer() {
  const c = state.config;
  if (!c) return;
  const now = Date.now() + state.clockSkew;
  const fmt = (ms) => {
    const t = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = t % 60;
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };
  const start = c.startTime && Date.parse(c.startTime);
  const end = c.endTime && Date.parse(c.endTime);
  let text = '';
  if (start && now < start) text = `starts in ${fmt(start - now)}`;
  else if (end && now < end) text = `${fmt(end - now)} left`;
  else if (end) text = 'competition over';
  $('#timer').textContent = text;
  if (start && now >= start && state.wasBefore) {
    state.wasBefore = false;
    toast('The competition has started.');
    if (location.hash === '#challenges') loadChallenges();
  }
  if (start && now < start) state.wasBefore = true;
}

// ---------------------------------------------------------------------------
// Challenges
// ---------------------------------------------------------------------------

async function loadChallenges() {
  if (!state.me) return;
  const banner = $('#chal-banner');
  try {
    const data = await api('/api/challenges');
    state.challenges = data.challenges;
    banner.hidden = data.phase !== 'after';
    banner.textContent = 'The competition is over. You can still submit flags for practice, but they won\'t count.';
  } catch (err) {
    state.challenges = [];
    banner.hidden = false;
    banner.textContent = err.message;
  }
  renderChallenges();
}

function renderChallenges() {
  const cats = [...new Set(state.challenges.map((c) => c.category))];
  $('#filters').innerHTML = ['all', ...cats, 'unsolved']
    .map((f) => `<button data-filter="${f}" class="${state.filter === f ? 'active' : ''}">${f}</button>`)
    .join('');
  for (const b of document.querySelectorAll('#filters button')) {
    b.onclick = () => {
      state.filter = b.dataset.filter;
      renderChallenges();
    };
  }

  const shown = state.challenges.filter((c) =>
    state.filter === 'all' ? true : state.filter === 'unsolved' ? !c.solved : c.category === state.filter
  );
  const html = cats
    .map((cat) => {
      const list = shown.filter((c) => c.category === cat);
      if (!list.length) return '';
      const solved = state.challenges.filter((c) => c.category === cat && c.solved).length;
      const total = state.challenges.filter((c) => c.category === cat).length;
      return `
        <div class="category cat-${cat}"><span class="prompt">$</span><h2>${esc(cat)}</h2><span class="count">${solved}/${total}</span></div>
        <div class="grid">
          ${list
            .map(
              (c) => `
            <button class="chal cat-${c.category} ${c.solved ? 'solved' : ''}" data-id="${c.id}">
              <span class="name">${esc(c.name)}</span>
              <span class="meta"><span class="diff ${c.difficulty}">${c.difficulty}</span><span>${c.solves} solve${c.solves === 1 ? '' : 's'}</span><span class="pts">${c.points}</span></span>
            </button>`
            )
            .join('')}
        </div>`;
    })
    .join('');
  $('#chal-board').innerHTML = html || '<p class="empty">Nothing here.</p>';
  for (const b of document.querySelectorAll('.chal')) b.onclick = () => openChallenge(b.dataset.id);
}

function openChallenge(id) {
  const c = state.challenges.find((x) => x.id === id);
  if (!c) return;
  const modal = $('#modal');
  modal.className = `cat-${c.category}`;
  const nextHint = c.hints.length;
  $('#modal-body').innerHTML = `
    <div class="modal-head">
      <h2>${esc(c.name)}</h2>
      <div class="meta">
        <span>${esc(c.category)}</span>
        <span class="diff ${c.difficulty}">${c.difficulty}</span>
        <span>${c.points} pts</span>
        <span>${c.solves} solve${c.solves === 1 ? '' : 's'}</span>
        ${c.firstBlood ? `<span>first blood: ${esc(c.firstBlood)}</span>` : ''}
      </div>
    </div>
    <div class="desc">${md(c.description)}</div>
    ${c.files.length ? `<div class="files">${c.files.map((f) => `<a href="${f.url}" download>${esc(f.name)}</a>`).join('')}</div>` : ''}
    <div class="hints">
      ${c.hints.map((h, i) => `<div class="hint"><b>Hint ${i + 1}:</b> ${md(h)}</div>`).join('')}
      ${nextHint < c.hintCount ? `<button id="hint-btn">Show hint ${nextHint + 1} of ${c.hintCount}</button>` : ''}
    </div>
    ${
      c.solved
        ? '<p class="result ok">Solved.</p>'
        : `<form id="flag-form" class="submit-row">
             <input id="flag-input" placeholder="NxT{...}" autocomplete="off" spellcheck="false">
             <button class="primary">Submit</button>
           </form>
           <p id="flag-result" class="result"></p>`
    }`;

  $('#hint-btn')?.addEventListener('click', async () => {
    try {
      const { hint } = await api(`/api/challenges/${c.id}/hints/${nextHint}`, { body: {} });
      c.hints.push(hint);
      openChallenge(c.id);
    } catch (err) {
      toast(esc(err.message));
    }
  });

  $('#flag-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const out = $('#flag-result');
    const flag = $('#flag-input').value.trim();
    if (!flag) return;
    try {
      const r = await api(`/api/challenges/${c.id}/submit`, { body: { flag } });
      if (r.correct && r.practice) {
        out.className = 'result ok';
        out.textContent = 'Correct! (practice mode, no points)';
      } else if (r.correct) {
        c.solved = true;
        out.className = 'result ok';
        out.textContent = r.firstBlood ? 'Correct. First blood is yours.' : 'Correct.';
        await Promise.all([loadMe(), loadChallenges()]);
        setTimeout(() => modal.open && openChallenge(c.id), 1200);
      } else {
        out.className = 'result bad';
        out.textContent = r.practice ? 'Not quite. (practice mode)' : 'Not quite. Keep going.';
        e.target.classList.remove('shake');
        void e.target.offsetWidth;
        e.target.classList.add('shake');
      }
    } catch (err) {
      out.className = 'result bad';
      out.textContent = err.message;
    }
  });

  if (!modal.open) modal.showModal();
  $('#flag-input')?.focus();
}

// ---------------------------------------------------------------------------
// Scoreboard
// ---------------------------------------------------------------------------

async function loadScoreboard() {
  state.board = await api('/api/scoreboard');
  const rows = state.board.rows;
  $('#board-body').innerHTML = rows.length
    ? rows
        .map(
          (r) => `
      <tr class="${state.me && r.name === state.me.name ? 'mine' : ''}">
        <td class="rank">${r.rank}</td>
        <td>${esc(r.name)}</td>
        <td class="num">${r.solves}</td>
        <td class="num">${r.score}</td>
      </tr>`
        )
        .join('')
    : '<tr><td colspan="4" class="empty">No players yet.</td></tr>';
  renderChart();
}

function renderChart() {
  const { history, start } = state.board;
  const W = 900, H = 280, L = 44, R = 16, T = 12, B = 28;
  const now = Date.now() + state.clockSkew;
  const maxScore = Math.max(100, ...history.flatMap((s) => s.points.map((p) => p[1])));
  const niceMax = Math.ceil(maxScore / 100) * 100;
  const t0 = Math.min(start, ...history.flatMap((s) => s.points.map((p) => p[0])));
  const x = (t) => L + ((t - t0) / Math.max(1, now - t0)) * (W - L - R);
  const y = (v) => T + (1 - v / niceMax) * (H - T - B);

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Score over time for the top players">`;
  for (let i = 0; i <= 4; i++) {
    const v = (niceMax / 4) * i;
    svg += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#272231"/>`;
    svg += `<text x="${L - 8}" y="${y(v) + 4}" fill="#847e92" font-size="11" text-anchor="end">${v}</text>`;
  }
  for (let i = 0; i <= 4; i++) {
    const t = t0 + ((now - t0) / 4) * i;
    const anchor = i === 0 ? 'start' : i === 4 ? 'end' : 'middle';
    svg += `<text x="${x(t)}" y="${H - 8}" fill="#847e92" font-size="11" text-anchor="${anchor}">${clock(t)}</text>`;
  }
  history.forEach((s, i) => {
    const color = CHART_COLORS[i % CHART_COLORS.length];
    let d = `M${x(t0)},${y(0)}`;
    let last = 0;
    for (const [t, v] of s.points) {
      d += ` H${x(t)} V${y(v)}`;
      last = v;
    }
    d += ` H${x(now)}`;
    svg += `<path d="${d}" fill="none" stroke="${color}" stroke-width="2.25" stroke-linejoin="round"/>`;
    svg += `<circle cx="${x(now)}" cy="${y(last)}" r="3.5" fill="${color}"/>`;
  });
  if (!history.length) svg += `<text x="${W / 2}" y="${H / 2}" fill="#847e92" text-anchor="middle">No solves yet, be the first!</text>`;
  svg += '</svg>';
  $('#chart').innerHTML = svg;
  $('#legend').innerHTML = history
    .map((s, i) => `<span><i style="background:${CHART_COLORS[i % CHART_COLORS.length]}"></i>${esc(s.name)}</span>`)
    .join('');
}

// ---------------------------------------------------------------------------
// Feed
// ---------------------------------------------------------------------------

async function loadFeed() {
  const { feed } = await api('/api/feed');
  $('#feed-list').innerHTML = feed.length
    ? feed
        .map(
          (f) => `
      <li><time title="${new Date(f.ts).toLocaleString()}">${timeAgo(f.ts)}</time>
        <span>${f.firstBlood ? '<span class="blood">FIRST BLOOD</span> ' : ''}<b>${esc(f.user)}</b> solved <b>${esc(f.chal)}</b>
        <span class="muted">(${esc(f.category)}, ${f.points} pts)</span></span></li>`
        )
        .join('')
    : '<li class="empty">Nothing yet. Go solve something!</li>';
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

$('#admin-login').addEventListener('submit', (e) => {
  e.preventDefault();
  state.adminToken = $('#admin-token').value;
  sessionStorage.setItem('adminToken', state.adminToken);
  loadAdmin();
});

async function loadAdmin() {
  if (!state.adminToken) return;
  let data;
  try {
    data = await api('/api/admin', { headers: { 'X-Admin-Token': state.adminToken } });
    $('#admin-error').textContent = '';
    $('#admin-login').hidden = true;
  } catch (err) {
    $('#admin-error').textContent = err.message;
    $('#admin-login').hidden = false;
    return;
  }
  const table = (head, rows) =>
    `<table class="admin-table"><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('') || `<tr><td colspan="${head.length}" class="muted">none</td></tr>`}</tbody></table>`;

  $('#admin-body').innerHTML = `
    <div class="admin-grid">
      <div class="card"><h2>Players</h2>${table(
        ['Name', 'Solves', 'Wrong', 'Hints', ''],
        data.users.map(
          (u) => `<tr><td>${esc(u.name)}${u.hidden ? ' <span class="muted">(hidden)</span>' : ''}</td><td>${u.solves}</td><td>${u.wrong}</td><td>${u.hints}</td>
          <td><button data-hide="${u.id}">${u.hidden ? 'Unhide' : 'Hide'}</button></td></tr>`
        )
      )}<p class="muted">Hidden players don't appear on the scoreboard or trigger webhooks. Hide your own test account.</p></div>
      <div class="card"><h2>Challenges</h2>${table(
        ['Challenge', 'Solves', 'Wrong'],
        data.challenges.map((c) => `<tr><td>${esc(c.name)}</td><td>${c.solves}</td><td>${c.wrong}</td></tr>`)
      )}</div>
      <div class="card"><h2>Submissions</h2>${table(
        ['When', 'Player', 'Challenge', 'Flag'],
        data.attempts.map(
          (a) => `<tr><td>${clock(a.ts)}</td><td>${esc(a.user)}</td><td>${esc(a.chal)}</td><td class="${a.correct ? 'ok' : 'bad'}"><code>${esc(a.flag)}</code></td></tr>`
        )
      )}</div>
      <div class="card"><h2>Hints opened</h2>${table(
        ['When', 'Player', 'Challenge', '#'],
        data.hints.map((h) => `<tr><td>${clock(h.ts)}</td><td>${esc(h.user)}</td><td>${esc(h.chal)}</td><td>${h.idx + 1}</td></tr>`)
      )}</div>
    </div>`;
  for (const b of document.querySelectorAll('[data-hide]')) {
    b.onclick = async () => {
      await api(`/api/admin/users/${b.dataset.hide}/hide`, { body: {}, headers: { 'X-Admin-Token': state.adminToken } });
      loadAdmin();
    };
  }
}

// ---------------------------------------------------------------------------
// Live updates
// ---------------------------------------------------------------------------

// Poll for new events. (Polling works through Cloudflare quick tunnels, which
// don't support Server-Sent Events.)
async function pollUpdates() {
  try {
    const { seq, events } = await api(`/api/updates?after=${state.seq ?? -1}`);
    const fresh = state.seq !== undefined;
    state.seq = seq;
    if (!fresh || !events.length) return;
    for (const { type, data } of events) {
      if (type === 'solve' && data.firstBlood) toast(`<b>${esc(data.user)}</b> drew first blood on <b>${esc(data.chal)}</b>`, 'blood');
      else if (type === 'solve') toast(`<b>${esc(data.user)}</b> solved <b>${esc(data.chal)}</b> (+${data.points})`);
      else if (type === 'register') toast(`<b>${esc(data.name)}</b> joined`);
    }
    refreshVisible();
  } catch {
    // Server briefly unreachable; try again next tick.
  } finally {
    setTimeout(pollUpdates, 4000);
  }
}

function refreshVisible() {
  const tab = location.hash.slice(1) || 'challenges';
  if (state.me) loadMe();
  if (tab === 'scoreboard') loadScoreboard();
  if (tab === 'feed') loadFeed();
  if (tab === 'challenges' && state.me && !$('#modal').open) loadChallenges();
  if (tab === 'admin') loadAdmin();
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

(async function init() {
  state.config = await api('/api/config');
  state.clockSkew = state.config.now - Date.now();
  document.title = state.config.compName;
  $('#comp-name').textContent = state.config.compName;
  $('#join-code-row').hidden = !state.config.joinCodeRequired;
  await loadMe();
  route();
  pollUpdates();
  tickTimer();
  setInterval(tickTimer, 1000);
  setInterval(() => location.hash === '#scoreboard' && renderChart(), 30000);
})();
