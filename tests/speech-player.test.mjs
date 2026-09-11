import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSpeechPlayer,
  createBrowserSpeechPort,
} from '../lib/speech-player.ts';

function fixture() {
  const calls = [],
    timers = [],
    changes = [];
  let time = 0,
    cancels = 0;
  const port = {
    speak: (text, rate, callbacks) => calls.push({ text, rate, ...callbacks }),
    cancel: () => cancels++,
  };
  const wait = (callback, delay) => {
    const task = { callback, delay, cancelled: false };
    timers.push(task);
    return () => {
      task.cancelled = true;
    };
  };
  const player = createSpeechPlayer(
    ['First sentence.', 'Second sentence.'],
    port,
    (state) => changes.push(state),
    wait,
    () => time,
  );
  return {
    player,
    calls,
    changes,
    timers,
    setTime: (value) => {
      time = value;
    },
    get cancels() {
      return cancels;
    },
    advance() {
      const task = timers.find((t) => !t.cancelled);
      assert.ok(task, 'A scheduled task exists');
      task.cancelled = true;
      task.callback();
    },
  };
}

test('continuous playback advances by sentence and can restart after completion', () => {
  const f = fixture();
  f.player.play();
  assert.equal(f.calls[0].text, 'First sentence.');
  f.calls[0].start();
  f.calls[0].end();
  f.advance();
  assert.equal(f.calls[1].text, 'Second sentence.');
  f.calls[1].start();
  f.calls[1].end();
  assert.equal(f.player.getState().phase, 'complete');
  f.player.play();
  assert.equal(f.calls[2].text, 'First sentence.');
});

test('repeat mode returns to the same sentence until paused', () => {
  const f = fixture();
  f.player.configure({ mode: 'repeat' });
  f.player.seek(1, true);
  f.calls[0].start();
  f.calls[0].end();
  f.advance();
  assert.equal(f.calls[1].text, 'Second sentence.');
  f.calls[1].end();
  f.player.pause();
  for (const timer of f.timers) timer.callback();
  assert.equal(f.calls.length, 2);
  assert.equal(f.player.getState().phase, 'paused');
});

test('shadow mode gives the learner a matching speaking interval, including after the final sentence', () => {
  const f = fixture();
  f.player.configure({ mode: 'shadow' });
  f.player.seek(1, true);
  f.calls[0].start();
  f.setTime(3400);
  f.calls[0].end();
  assert.equal(f.player.getState().phase, 'gap');
  assert.equal(f.timers.find((t) => !t.cancelled).delay, 3400);
  f.advance();
  assert.equal(f.player.getState().phase, 'complete');
});

test('pausing invalidates late onend/onerror and resumes from the same sentence', () => {
  const f = fixture();
  f.player.seek(1, true);
  const stale = f.calls[0];
  f.player.pause();
  stale.end();
  stale.error('network');
  assert.equal(f.player.getState().phase, 'paused');
  assert.equal(f.calls.length, 1);
  f.player.play();
  assert.equal(f.calls[1].text, 'Second sentence.');
});

test('speed changes restart the current sentence and discard the old queue', () => {
  const f = fixture();
  f.player.play();
  const stale = f.calls[0];
  f.player.configure({ rate: 0.75 });
  assert.equal(f.calls[1].rate, 0.75);
  stale.end();
  stale.error('interrupted');
  assert.equal(f.player.getState().phase, 'speaking');
  assert.equal(f.player.getState().index, 0);
  f.player.configure({ rate: NaN });
  assert.equal(f.player.getState().rate, 0.75);
});

test('changing mode during a shadow interval cancels the old interval', () => {
  const f = fixture();
  f.player.configure({ mode: 'shadow' });
  f.player.play();
  f.calls[0].end();
  const oldGap = f.timers.find((t) => !t.cancelled);
  f.player.configure({ mode: 'repeat' });
  oldGap.callback();
  assert.equal(f.calls.length, 2);
  assert.equal(f.player.getState().index, 0);
});

test('a missing start or native error clears the playing state and allows retry', () => {
  const f = fixture();
  f.player.play();
  f.advance();
  assert.equal(f.player.getState().phase, 'error');
  f.player.play();
  f.calls[1].error('not-allowed');
  assert.match(f.player.getState().error, /もう一度/);
  f.calls[1].end();
  assert.equal(f.calls.length, 2);
  f.player.play();
  f.calls[2].start();
  assert.equal(f.player.getState().error, '');
});

test('disposing cancels all speech and prevents future callbacks and play calls', () => {
  const f = fixture();
  f.player.play();
  const updates = f.changes.length;
  f.player.dispose();
  f.calls[0].end();
  f.calls[0].error('network');
  for (const timer of f.timers) timer.callback();
  f.player.play();
  f.player.seek(1, true);
  assert.equal(f.changes.length, updates);
  assert.equal(f.calls.length, 1);
  assert.ok(f.cancels >= 2);
});

test('returning to audio restores sentence, speed and practice pattern without autoplay', () => {
  const before = fixture();
  before.player.configure({ rate: 0.75, mode: 'repeat' });
  before.player.seek(1, true);
  before.player.pause();
  const saved = before.player.getState();
  before.player.dispose();
  const after = fixture();
  after.player.configure({ rate: saved.rate, mode: saved.mode });
  after.player.seek(saved.index, false);
  assert.equal(after.calls.length, 0);
  assert.equal(after.player.getState().phase, 'paused');
  after.player.play();
  assert.equal(after.calls[0].text, 'Second sentence.');
  assert.equal(after.calls[0].rate, 0.75);
  after.calls[0].end();
  after.advance();
  assert.equal(after.calls[1].text, 'Second sentence.');
});

test('browser adapter refreshes English voices and clears a native paused state on cancel', (t) => {
  const oldWindow = globalThis.window,
    oldUtterance = globalThis.SpeechSynthesisUtterance;
  t.after(() => {
    if (oldWindow === undefined) delete globalThis.window;
    else globalThis.window = oldWindow;
    if (oldUtterance === undefined) delete globalThis.SpeechSynthesisUtterance;
    else globalThis.SpeechSynthesisUtterance = oldUtterance;
  });
  const spoken = [],
    listeners = new Map();
  let voices = [],
    resumed = 0;
  const synth = {
    paused: false,
    getVoices: () => voices,
    speak: (value) => spoken.push(value),
    cancel() {},
    resume() {
      resumed++;
      this.paused = false;
    },
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name) => listeners.delete(name),
  };
  globalThis.window = { speechSynthesis: synth };
  globalThis.SpeechSynthesisUtterance = class {
    constructor(text) {
      this.text = text;
    }
  };
  const port = createBrowserSpeechPort();
  const callbacks = { start() {}, end() {}, error() {} };
  port.speak('Test.', 0.75, callbacks);
  assert.equal(spoken[0].lang, 'en-US');
  assert.equal(spoken[0].rate, 0.75);
  voices = [
    { lang: 'ja-JP', localService: true },
    { lang: 'en-US', localService: true },
  ];
  listeners.get('voiceschanged')();
  synth.paused = true;
  port.cancel();
  assert.equal(resumed, 1);
  assert.equal(spoken[0].onend, null);
  port.speak('Second.', 1, callbacks);
  assert.equal(spoken[1].voice, voices[1]);
  port.dispose();
  assert.equal(listeners.size, 0);
  assert.equal(spoken[1].onerror, null);
});
