// Plan 2026-11-18 browser terminal D4 and D6: the script of the terminal page teach serve --terminal builds at
// /term/lessons/<lesson id>.html. The lesson is in the page's frame; the terminal, xterm.js on the server's one shell,
// is in its .term-screen element. The browser part imports xterm.js only when `document` exists, so node --test can
// import the pure functions below.

// The largest body POST /term/input takes, in bytes (createServer's TERM_BODY_MAX).
export const INPUT_MAX = 65536;

const encoder = new TextEncoder();
// The longest start of `text` whose body {"data":"..."} is at most `max` bytes, cut between code points.
function firstPart(text, max) {
  let size = JSON.stringify({ data: '' }).length, end = 0;
  for (const ch of text) {
    size += encoder.encode(JSON.stringify(ch)).length - 2;
    if (size > max) break;
    end += ch.length;
  }
  return text.slice(0, end);
}

// D4: what is typed, sent with `send(data)` one request at a time. What is typed while a request is out is joined
// into the next one; text whose body would pass `max` bytes goes in several requests.
export function inputQueue(send, max = INPUT_MAX) {
  let queued = '', out = false;
  const next = () => {
    if (out || !queued) return;
    const part = firstPart(queued, max);
    queued = queued.slice(part.length);
    out = true;
    new Promise((r) => r(send(part))).catch(() => {}).finally(() => { out = false; next(); }); // a throw in send stalls nothing
  };
  return (text) => { queued += text; next(); };
}

// D6: what a Run button types: the <pre>'s text lines joined by carriage returns, with one at the end.
export const runText = (text) => text.replace(/\n+$/, '').split('\n').join('\r') + '\r';

if (typeof document !== 'undefined') {
  const [{ Terminal }, { FitAddon }] = await Promise.all([import('./xterm.mjs'), import('./addon-fit.mjs')]);
  const post = (route, body) => fetch(route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const term = new Terminal({ cursorBlink: true });
  const fit = new FitAddon();
  term.loadAddon(fit);
  const screen = document.querySelector('.term-screen');
  term.open(screen);
  // A 409 (`terminal not running`): the shell has ended, so what was typed shows the ended line, not nothing.
  const typeIn = inputQueue((data) => post('/term/input', { data }).then((r) => { if (r.status === 409) showEnded(); }));
  term.onData(typeIn);
  // D4 (the review, F7): only the tab that has focus sets the size, when the pane changes size and after each new stream.
  const resize = () => { if (document.hasFocus()) post('/term/resize', { rows: term.rows, cols: term.cols }); };
  term.onResize(resize);
  window.addEventListener('focus', resize); // a page opened without focus has sent no size yet
  new ResizeObserver(() => fit.fit()).observe(screen);

  const ended = document.createElement('p');
  ended.className = 'term-ended';
  ended.hidden = true;
  ended.append('The shell ended. ');
  const again = document.createElement('button');
  again.type = 'button';
  again.textContent = 'Start a new shell';
  ended.append(again);
  screen.after(ended);

  // Each stream starts with the shell's kept output, so the screen is cleared first. A stream this page closes
  // (`reading.abort()`) ends quietly; one the server cuts while the shell runs (too much unsent) is opened again after
  // 250 ms, so output faster than the page reads does not reconnect in a tight loop; one the server ends, or a server
  // that is gone, shows the ended line.
  let reading = null, shellEnded = false;
  const showEnded = () => { shellEnded = true; ended.hidden = false; };
  const open = async () => {
    reading?.abort();
    const ctl = reading = new AbortController();
    shellEnded = false;
    ended.hidden = true;
    term.reset();
    let cut = false;
    try {
      const res = await fetch('/term/stream', { signal: ctl.signal });
      if (!res.ok) return term.write(await res.text()); // a 403: the line says what to open
      resize();
      const reader = res.body.getReader();
      try {
        for (let r = await reader.read(); !r.done; r = await reader.read()) term.write(r.value);
      } catch { cut = true; }
    } catch { /* aborted, or the server is gone */ }
    if (ctl.signal.aborted) return;
    if (cut) {
      await new Promise((r) => setTimeout(r, 250));
      if (!ctl.signal.aborted) open(); // a hidden tab or a newer open aborts ctl meanwhile
      return;
    }
    showEnded();
  };
  again.addEventListener('click', () => { open(); term.focus(); });
  // D4 (the review, F2): a hidden tab holds no stream.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { reading?.abort(); reading = null; } else if (!shellEnded) open();
  });

  // D4 and D6: on each load of the frame, the address bar shows /term plus the frame's path when that is a lesson's
  // (the page route, /term/lessons/<lesson id>.html), and each <pre> of the lesson's step block gets a Run button,
  // once for each document.
  const frame = document.querySelector('iframe');
  const framed = () => {
    const doc = frame.contentDocument;
    if (!doc?.body || doc.body.dataset.termRun) return; // a page of another origin, or one that has its buttons
    doc.body.dataset.termRun = '1';
    const { pathname } = frame.contentWindow.location;
    if (pathname.startsWith('/lessons/')) history.replaceState(null, '', '/term' + pathname);
    for (const pre of doc.querySelectorAll('[data-block="step"] pre')) {
      const run = doc.createElement('button');
      run.type = 'button';
      run.textContent = 'Run';
      run.addEventListener('click', () => { typeIn(runText(pre.textContent)); term.focus(); });
      pre.after(run);
    }
  };
  frame.addEventListener('load', framed);
  // The frame can finish loading before this module has run.
  if (frame.contentDocument?.readyState === 'complete' && frame.contentWindow.location.href !== 'about:blank') framed();
  if (!document.hidden) open();
  term.focus();
}
