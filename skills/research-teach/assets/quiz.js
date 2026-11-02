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

async function renderNav() {
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
// answers array and one POST; the score goes after the last part's items.
export function renderQuiz(parts, { rand = Math.random, submit = postAttempt } = {}) {
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
          const reply = await submit({ lesson: lessonIdFrom(location.pathname, document.body.dataset.lesson), answers });
          result.append(el('span', null, ` ${reply ?? TERMINAL}`));
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
}
