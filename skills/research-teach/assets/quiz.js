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

export function renderQuiz(container, data, { rand = Math.random, submit = postAttempt } = {}) {
  const items = data.items;
  const answers = new Array(items.length);
  let answered = 0;
  const root = el('div', 'quiz');
  const result = el('p', 'quiz-result');

  items.forEach((authored, n) => {
    const item = shuffleOptions(authored, rand);
    const box = el('div', 'quiz-item');
    box.append(el('p', 'quiz-q', item.q));
    const why = el('p', 'quiz-why');
    item.options.forEach((text, k) => {
      const btn = el('button', 'quiz-option', text);
      btn.type = 'button';
      btn.addEventListener('click', async () => {
        if (answers[n] !== undefined) return;
        answers[n] = item.order[k];
        btn.classList.add(k === item.correct ? 'correct' : 'wrong');
        why.textContent = item.why[k] ?? '';
        box.querySelectorAll('button').forEach((b) => { b.disabled = true; });
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
  });
  root.append(result);
  container.append(root);
}

if (typeof document !== 'undefined') {
  for (const script of document.querySelectorAll('script[data-quiz]')) {
    let target = script.closest('[data-block="quiz"]');
    if (!target) {
      target = el('div');
      script.after(target);
    }
    renderQuiz(target, JSON.parse(script.textContent));
  }
}
