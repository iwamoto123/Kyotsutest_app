export type PlaybackMode = 'continuous' | 'repeat' | 'shadow';
export type PlaybackState = {
  phase: 'idle' | 'speaking' | 'gap' | 'paused' | 'complete' | 'error';
  index: number;
  rate: number;
  mode: PlaybackMode;
  error: string;
};
export const initialPlayback = (): PlaybackState => ({
  phase: 'idle',
  index: 0,
  rate: 1,
  mode: 'continuous',
  error: '',
});
export type SpeechPort = {
  speak: (
    text: string,
    rate: number,
    callbacks: {
      start: () => void;
      end: () => void;
      error: (code: string) => void;
    },
  ) => void;
  cancel: () => void;
};
type Scheduler = (callback: () => void, delayMs: number) => () => void;
const schedule: Scheduler = (callback, delay) => {
  const id = setTimeout(callback, delay);
  return () => clearTimeout(id);
};

/** A cancellable sentence queue. The token also invalidates late native speech events. */
export function createSpeechPlayer(
  texts: string[],
  port: SpeechPort,
  changed: (state: PlaybackState) => void,
  wait: Scheduler = schedule,
  now = () => performance.now(),
) {
  if (!texts.length) throw new Error('Speech needs at least one sentence');
  let state = initialPlayback(),
    token = 0,
    disposed = false;
  let cancelWait = () => {},
    cancelWatchdog = () => {};
  const publish = (patch: Partial<PlaybackState>) => {
    state = { ...state, ...patch };
    if (!disposed) changed(state);
  };
  const cancel = () => {
    token++;
    cancelWait();
    cancelWatchdog();
    port.cancel();
  };
  const active = () => state.phase === 'speaking' || state.phase === 'gap';
  function fail(code: string) {
    cancel();
    publish({
      phase: 'error',
      error:
        code === 'not-allowed'
          ? '音声を開始できませんでした。再生をもう一度押してください。'
          : code === 'voice-unavailable' || code === 'language-unavailable'
            ? '英語の音声が見つかりません。端末の英語読み上げ音声を有効にしてください。'
            : '音声を再生できませんでした。端末の音量・接続を確認して再試行してください。',
    });
  }
  function speak(index: number) {
    if (disposed) return;
    cancel();
    const session = token;
    let started = now(),
      ended = false;
    publish({ phase: 'speaking', index, error: '' });
    cancelWatchdog = wait(() => {
      if (session === token) fail('timeout');
    }, 10_000);
    try {
      port.speak(texts[index], state.rate, {
        start: () => {
          if (session !== token || disposed || ended) return;
          started = now();
          cancelWatchdog();
          cancelWatchdog = wait(() => {
            if (session === token) fail('timeout');
          }, 60_000);
        },
        end: () => {
          if (session !== token || disposed || ended) return;
          ended = true;
          cancelWatchdog();
          const next = state.mode === 'repeat' ? index : index + 1;
          const delay =
            state.mode === 'shadow'
              ? Math.min(20_000, Math.max(1500, now() - started))
              : state.mode === 'repeat'
                ? 900
                : 250;
          if (next >= texts.length && state.mode !== 'shadow') {
            publish({ phase: 'complete' });
            return;
          }
          publish({ phase: 'gap' });
          cancelWait = wait(() => {
            if (session !== token || disposed) return;
            if (next >= texts.length) publish({ phase: 'complete' });
            else speak(next);
          }, delay);
        },
        error: (code) => {
          if (session === token && !disposed && !ended) fail(code);
        },
      });
    } catch {
      if (session === token) fail('failed');
    }
  }
  return {
    getState: () => state,
    play: () => speak(state.phase === 'complete' ? 0 : state.index),
    pause: () => {
      if (!active() || disposed) return;
      cancel();
      publish({ phase: 'paused', error: '' });
    },
    seek: (index: number, autoplay = active()) => {
      if (
        !Number.isInteger(index) ||
        index < 0 ||
        index >= texts.length ||
        disposed
      )
        return;
      if (autoplay) speak(index);
      else {
        cancel();
        publish({ index, phase: 'paused', error: '' });
      }
    },
    configure: (options: { rate?: number; mode?: PlaybackMode }) => {
      if (disposed) return;
      if (options.rate !== undefined && ![0.75, 1, 1.25].includes(options.rate))
        return;
      if (
        options.mode !== undefined &&
        !['continuous', 'repeat', 'shadow'].includes(options.mode)
      )
        return;
      const restart = active();
      publish(options);
      if (restart) speak(state.index);
    },
    dispose: () => {
      disposed = true;
      cancel();
    },
  };
}

export function createBrowserSpeechPort(): SpeechPort & {
  dispose: () => void;
} {
  const synthesis = window.speechSynthesis;
  let voices = synthesis.getVoices();
  let utterance: SpeechSynthesisUtterance | null = null;
  const refreshVoices = () => {
    voices = synthesis.getVoices();
  };
  synthesis.addEventListener('voiceschanged', refreshVoices);
  function cancel() {
    if (utterance) {
      utterance.onstart = null;
      utterance.onend = null;
      utterance.onerror = null;
    }
    synthesis.cancel();
    if (synthesis.paused) synthesis.resume();
    utterance = null;
  }
  return {
    cancel,
    speak(text, rate, callbacks) {
      refreshVoices();
      const voice =
        voices.find((v) => /^en[-_]US$/i.test(v.lang) && v.localService) ??
        voices.find((v) => /^en[-_]US$/i.test(v.lang)) ??
        voices.find((v) => /^en(?:[-_]|$)/i.test(v.lang));
      utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = voice?.lang ?? 'en-US';
      if (voice) utterance.voice = voice;
      utterance.rate = rate;
      utterance.onstart = callbacks.start;
      utterance.onend = callbacks.end;
      utterance.onerror = (event) => callbacks.error(event.error);
      synthesis.speak(utterance);
    },
    dispose() {
      cancel();
      synthesis.removeEventListener('voiceschanged', refreshVoices);
    },
  };
}
