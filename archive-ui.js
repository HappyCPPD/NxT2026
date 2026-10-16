'use strict';

// Archive-only UI tweaks, loaded after app.js.

// The feed is weeks old by the time anyone reads it, so show dates instead of "720h ago".
timeAgo = (ts) => new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

// ---- Writeups tab ---------------------------------------------------------
// The writeups are rendered into index.html at build time. #writeups/<id>
// opens and scrolls to one challenge.

const writeupFilter = { cat: 'all' };

function solvedIds() {
  try {
    return JSON.parse(localStorage.getItem('nxt-archive:progress')).solved || [];
  } catch {
    return [];
  }
}

function showWriteups() {
  const solved = new Set(solvedIds());
  for (const el of document.querySelectorAll('.wu')) el.classList.toggle('solved', solved.has(el.dataset.id));
  for (const el of document.querySelectorAll('.wu-cat')) el.hidden = writeupFilter.cat !== 'all' && el.dataset.cat !== writeupFilter.cat;
  for (const b of document.querySelectorAll('#wu-filters button')) b.classList.toggle('active', b.dataset.filter === writeupFilter.cat);

  const id = location.hash.split('/')[1];
  const target = id && document.getElementById(`wu-${id}`);
  if (target) {
    if (writeupFilter.cat !== 'all' && target.closest('.wu-cat').dataset.cat !== writeupFilter.cat) {
      writeupFilter.cat = 'all';
      return showWriteups();
    }
    target.open = true;
    // Offset by the sticky header, which wraps to several rows on phones.
    const header = document.querySelector('.topbar').offsetHeight;
    window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - header - 16, behavior: 'instant' });
  }
}

for (const b of document.querySelectorAll('#wu-filters button')) {
  b.onclick = () => {
    writeupFilter.cat = b.dataset.filter;
    showWriteups();
  };
}

const appRoute = route;
route = function () {
  appRoute();
  if (location.hash.startsWith('#writeups')) showWriteups();
};
window.addEventListener('hashchange', () => location.hash.startsWith('#writeups') && showWriteups());
// The in-browser API answers instantly, so app.js has usually routed already by now.
if (location.hash.startsWith('#writeups')) {
  history.scrollRestoration = 'manual';
  showWriteups();
}

// Keep the URL pointing at the writeup that's open, so it can be shared.
for (const el of document.querySelectorAll('.wu')) {
  el.addEventListener('toggle', () => {
    if (el.open && location.hash !== `#writeups/${el.dataset.id}`) history.replaceState(null, '', `#writeups/${el.dataset.id}`);
  });
}

// "Read the writeup" link at the bottom of each challenge modal.
new MutationObserver(() => {
  const body = document.getElementById('modal-body');
  const name = body.querySelector('.modal-head h2')?.textContent;
  const chal = window.ARCHIVE.challenges.find((c) => c.name === name);
  if (!chal || body.querySelector('.wu-link') || !document.getElementById(`wu-${chal.id}`)) return;
  const p = document.createElement('p');
  p.className = 'wu-link';
  p.innerHTML = `<a href="#writeups/${chal.id}">Stuck? Read the writeup →</a>`;
  p.querySelector('a').onclick = () => document.getElementById('modal').close();
  body.append(p);
}).observe(document.getElementById('modal-body'), { childList: true });
