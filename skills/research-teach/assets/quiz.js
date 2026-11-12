// Lesson quiz widget. Pure functions are importable from Node; DOM code runs only when document exists.

const TERMINAL = 'Tell me your score in the terminal.';

// Fisher-Yates over displayed positions; `order[k]` is the authored index of displayed option k.
export function shuffleOptions(item, rand = Math.random) {
  const order = item.options.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return {
    ...item,
    options: order.map((i) => item.options[i]),
    why: order.map((i) => item.why?.[i]),
    correct: order.indexOf(item.correct),
    order,
  };
}

export function grade(items, answers) {
  const wrong = [];
  items.forEach((it, i) => { if (answers[i] !== it.correct) wrong.push(i); });
  return { total: items.length, wrong };
}

// The lesson id from a served path (/lessons/<id>.html), else the fallback, else null.
export function lessonIdFrom(pathname, fallback) {
  return /^\/lessons\/(\d{4}-[a-z][a-z0-9-]*)\.html$/.exec(pathname ?? '')?.[1] ?? fallback ?? null;
}

export function answerLengthSpread(item) {
  const lens = item.options.map((o) => o.length);
  return Math.max(...lens) / Math.max(1, Math.min(...lens));
}

// The previous and next entries around `id` in the served lesson list (null at the ends or when absent).
export function neighbours(lessons, id) {
  const i = lessons.findIndex((l) => l.id === id);
  return { prev: i > 0 ? lessons[i - 1] : null, next: i >= 0 && i < lessons.length - 1 ? lessons[i + 1] : null };
}

// Spec 22 D6.6: `line N of M` for the lesson's PATH.md line, or null when /lessons.json has no line for it.
export function pathPosition(index, id) {
  const line = (index.lessons ?? []).find((l) => l.id === id)?.line;
  return Number.isInteger(line) && Number.isInteger(index.lines) ? `line ${line} of ${index.lines}` : null;
}

// Spec 22 D1, D6.5: the lesson's one attempt takes the predict block's quiz first (item 0), then every
// other quiz in page order. `parts` are { predict, items } in page order; bin/lib/lesson.mjs lessonItems
// reads the same order on the server.
export function mergeQuizzes(parts) {
  return [...parts.filter((p) => p.predict), ...parts.filter((p) => !p.predict)];
}

// Spec 22 D6.5: the visible text a revealed option carries, so colour is not the only signal.
export function answerMark(chosen, correct) {
  return chosen === correct ? 'Correct' : 'Not this one';
}

// Spec 48 D4: the results file of an exported copy, the one shape `teach attempt import` accepts.
export function resultsFile(key, attempts) {
  return JSON.stringify({
    format: 'research-vault-attempts', version: 1, workspace: key,
    attempts: attempts.map(({ lesson, answers, at, total, wrong }) => ({ lesson, answers, at, total, wrong })),
  }, null, 2) + '\n';
}

// Export mode: <body data-export="<key>">, set only on a page `teach export` writes; undefined when served.
const exportKey = () => document.body.dataset.export;
const STORE = 'research-vault-attempts:';
const held = []; // attempts the browser would not store, kept for the Export my results file

// The attempts stored under the workspace key: [] when none, null when storage cannot be read.
function stored() {
  try {
    const v = JSON.parse(localStorage.getItem(STORE + exportKey()) ?? '[]');
    return Array.isArray(v) ? v.filter((a) => a && typeof a === 'object') : null;
  } catch { return null; }
}

async function saveLocal({ lesson, answers }, { total, wrong }) {
  const attempt = { lesson, answers, at: new Date().toISOString(), total, wrong };
  const prior = stored();
  try {
    if (prior === null) throw new Error('storage unreadable'); // never overwrite what cannot be read
    localStorage.setItem(STORE + exportKey(), JSON.stringify([...prior, attempt]));
    return 'Saved in this browser.';
  } catch {
    held.push(attempt);
    return 'Not saved in this browser.';
  }
}

function exportButton() {
  const btn = el('button', 'quiz-export', 'Export my results');
  btn.type = 'button';
  btn.addEventListener('click', () => {
    const key = exportKey();
    const s = new Date().toISOString();
    const a = el('a');
    a.href = URL.createObjectURL(new Blob([resultsFile(key, [...(stored() ?? []), ...held])], { type: 'application/json' }));
    a.download = `results-${key}-${s.slice(0, 10).replaceAll('-', '')}-${s.slice(11, 19).replaceAll(':', '')}.json`;
    document.body.append(a);
    a.click();
    a.remove();
  });
  return btn;
}

// progress.html of an exported copy: the attempts this browser holds, lesson linked, date and score.
function renderLocalProgress(section) {
  const attempts = [...(stored() ?? []), ...held];
  const table = el('table', 'progress');
  const head = el('tr');
  for (const h of ['lesson', 'date', 'score']) head.append(el('th', null, h));
  table.append(head);
  for (const a of attempts) {
    const link = el('a', null, String(a.lesson));
    link.href = `lessons/${encodeURIComponent(String(a.lesson))}.html`;
    const cell = el('td');
    cell.append(link);
    const score = Number.isInteger(a.total) && Array.isArray(a.wrong) ? `${a.total - a.wrong.length}/${a.total}` : '';
    const row = el('tr');
    row.append(cell, el('td', null, String(a.at ?? '').slice(0, 10)), el('td', null, score));
    table.append(row);
  }
  section.append(attempts.length ? table : el('p', null, 'No attempts saved in this browser.'), exportButton());
}

async function renderNav() {
  if (exportKey() !== undefined) return; // an exported page carries its nav built in; never fetch /lessons.json
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(location.origin)) return;
  let index;
  try {
    const res = await fetch('/lessons.json');
    if (!res.ok) return;
    index = await res.json();
  } catch { return; }
  const id = lessonIdFrom(location.pathname, document.body.dataset.lesson);
  const { prev, next } = neighbours(index.lessons ?? [], id);
  const nav = el('nav', 'lesson-nav');
  const link = (href, text, cls) => { const a = el('a', cls, text); a.href = href; return a; };
  nav.append(link('/', 'All lessons', 'lesson-nav-index'));
  nav.append(link('/progress', 'Progress', 'lesson-nav-progress'));
  nav.append(link('/assets/reading.html', 'How to read', 'lesson-nav-reading'));
  if (prev) nav.append(link(prev.path, `\u2190 ${prev.title}`, 'lesson-nav-prev'));
  const pos = pathPosition(index, id);
  if (pos) nav.append(el('span', 'lesson-nav-line', pos));
  if (next) nav.append(link(next.path, `${next.title} \u2192`, 'lesson-nav-next'));
  document.body.prepend(nav);
}

async function postAttempt(payload) {
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(location.origin)) return null;
  try {
    const res = await fetch('/attempt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return null;
    const r = await res.json();
    return Number.isInteger(r.score) ? `recorded ${r.id}: ${r.score}/${r.total}` : null;
  } catch {
    return null;
  }
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// `parts` are { container, items } in attempt order (mergeQuizzes): every item joins one attempt, one
// answers array and one POST (in export mode, one saveLocal); the score goes after the last part's items.
export function renderQuiz(parts, { rand = Math.random, submit = exportKey() === undefined ? postAttempt : saveLocal } = {}) {
  const items = parts.flatMap((p) => p.items);
  const answers = new Array(items.length);
  let answered = 0;
  const result = el('p', 'quiz-result');
  result.setAttribute('role', 'status');
  let n = 0;
  parts.forEach((part, pi) => {
    const root = el('div', 'quiz');
    for (const authored of part.items) {
      const i = n++;
      const item = shuffleOptions(authored, rand);
      const box = el('div', 'quiz-item');
      const q = el('p', 'quiz-q', item.q);
      q.id = `quiz-q-${i}`;
      box.setAttribute('role', 'group');
      box.setAttribute('aria-labelledby', q.id);
      box.append(q);
      const why = el('p', 'quiz-why');
      why.setAttribute('role', 'status');
      item.options.forEach((text, k) => {
        const btn = el('button', 'quiz-option', text);
        btn.type = 'button';
        btn.addEventListener('click', async () => {
          if (answers[i] !== undefined) return;
          answers[i] = item.order[k];
          btn.classList.add(k === item.correct ? 'correct' : 'wrong');
          btn.textContent = `${answerMark(k, item.correct)}: ${text}`;
          why.textContent = item.why[k] ?? '';
          // aria-disabled, not disabled: the buttons stay focusable, the guard above ignores a second click.
          box.querySelectorAll('button').forEach((b) => { b.setAttribute('aria-disabled', 'true'); });
          if (++answered < items.length) return;
          const { total, wrong } = grade(items, answers);
          result.textContent = `Score: ${total - wrong.length}/${total}`;
          const reply = await submit({ lesson: lessonIdFrom(location.pathname, document.body.dataset.lesson), answers }, { total, wrong });
          result.append(el('span', null, ` ${reply ?? TERMINAL}`));
          if (exportKey() !== undefined) result.append(exportButton());
        });
        box.append(btn);
      });
      box.append(why);
      root.append(box);
    }
    if (pi === parts.length - 1) root.append(result);
    part.container.append(root);
  });
}

// Spec 49 D3: the status line of a lab reply, its final line only when the reader reported done and that line starts
// "lab: " (the server writes it after the script's output has ended, and a script's own line never starts so).
export const LAB_ENDED_EARLY = 'The reply ended before the lab finished.';
export function labStatus(text, done) {
  const last = text.replace(/\n$/, '').split('\n').at(-1);
  return done && last.startsWith('lab: ') ? last : LAB_ENDED_EARLY;
}

// Spec 49 D3: the lab buttons, only on a lesson teach serve --labs served through the lab address (data-lab-live on
// the first element whose data-block is lab), never on an exported copy, and only from the server's own origin. Each
// button posts {"lab": "<id>"} and appends the reply, chunk by chunk, to the output through textContent only. Stop is
// enabled while a Run or Check my work reply is open; Run and Reset only while nothing is open; Check my work also
// beside Run, not beside Reset or itself. A 4xx or 5xx reply's body becomes the status.
export function renderLab(section) {
  if (!section?.dataset || section.dataset.labLive === undefined || exportKey() !== undefined) return;
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(location.origin)) return;
  const id = section.dataset.lab;
  const open = { run: false, verify: false, reset: false };
  const output = el('pre', 'lab-output');
  const status = el('p', 'lab-status');
  status.setAttribute('role', 'status');
  const bar = el('div', 'lab-buttons');
  const buttons = {};
  const update = () => {
    const any = open.run || open.verify || open.reset;
    buttons.run.disabled = any;
    buttons.reset.disabled = any;
    if (buttons.verify) buttons.verify.disabled = open.verify || open.reset;
    buttons.stop.disabled = !(open.run || open.verify);
  };
  const act = async (action) => {
    const own = action !== 'stop';
    if (own) {
      open[action] = true;
      if (action !== 'verify') output.textContent = '';
      status.textContent = '';
      update();
    }
    let text = '', done = false, ok = false;
    try {
      const res = await fetch(`/lab/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lab: id }) });
      ok = res.ok;
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) { done = true; break; }
        const s = dec.decode(chunk.value, { stream: true });
        text += s;
        if (ok && own) output.textContent += s;
      }
    } catch { /* the reply ended early */ }
    if (own) {
      open[action] = false;
      update();
    }
    if (!ok && done) status.textContent = text.trim();
    else if (own) status.textContent = labStatus(text, done);
  };
  for (const [action, label] of [['run', 'Run'], ['stop', 'Stop'], ['reset', 'Reset'], ...(section.dataset.labVerify !== undefined ? [['verify', 'Check my work']] : [])]) {
    const b = el('button', `lab-${action}`, label);
    b.type = 'button';
    b.addEventListener('click', () => act(action));
    buttons[action] = b;
    bar.append(b);
  }
  update();
  section.append(bar, output, status);
}

// Issue 65 (spec 47 D1): each element carrying data-cast gets the asciinema player, when the page loaded it from assets/
// (`player` is window.AsciinemaPlayer); without it the transcript <pre> after the element is what the page shows. An
// exported copy carries the cast's text in data-cast-text.
export function mountReplays(root, player) {
  if (!player) return;
  for (const el of root.querySelectorAll('[data-cast]')) player.create(el.dataset.castText !== undefined ? { data: el.dataset.castText } : el.dataset.cast, el);
}

if (typeof document !== 'undefined') {
  renderNav();
  const parts = [...document.querySelectorAll('script[data-quiz]')].map((script) => {
    let container = script.closest('[data-block="quiz"]');
    if (!container) {
      container = el('div');
      script.after(container);
    }
    return { container, items: JSON.parse(script.textContent).items, predict: !!script.closest('[data-block="predict"]') };
  });
  if (parts.length) renderQuiz(mergeQuizzes(parts));
  const local = exportKey() !== undefined && document.querySelector('[data-block="progress"]');
  if (local) renderLocalProgress(local);
  renderLab(document.querySelector('[data-block="lab"]'));
  mountReplays(document, globalThis.AsciinemaPlayer);
}
