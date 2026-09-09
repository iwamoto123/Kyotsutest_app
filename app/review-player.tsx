'use client';

import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  useSyncExternalStore,
  type Ref,
} from 'react';
import { Headphones, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  createSpeechPlayer,
  createBrowserSpeechPort,
  initialPlayback,
  type PlaybackMode,
} from '@/lib/speech-player';
import { SENTENCES } from '@/lib/exam-content';

export type ReviewPlayerHandle = {
  playSentence: (index: number) => void;
  pause: () => void;
};
const subscribeSupport = () => () => {};
const speechSupported = () =>
  typeof window !== 'undefined' &&
  'speechSynthesis' in window &&
  'SpeechSynthesisUtterance' in window;

export function ReviewPlayer({
  ref,
  suspended,
  onSentenceChange,
  onPlay,
}: {
  ref: Ref<ReviewPlayerHandle>;
  suspended: boolean;
  onSentenceChange: (index: number | null) => void;
  onPlay: () => void;
}) {
  const [state, setState] = useState(initialPlayback);
  const supported = useSyncExternalStore(
    subscribeSupport,
    speechSupported,
    () => false,
  );
  const player = useRef<ReturnType<typeof createSpeechPlayer> | null>(null);
  const port = useRef<ReturnType<typeof createBrowserSpeechPort> | null>(null);
  const running = state.phase === 'speaking' || state.phase === 'gap';
  function getPlayer() {
    if (!supported) return null;
    if (!player.current) {
      port.current = createBrowserSpeechPort();
      player.current = createSpeechPlayer(
        SENTENCES.map((s) => s.en),
        port.current,
        (next) => {
          setState(next);
          onSentenceChange(
            next.phase === 'speaking' || next.phase === 'gap'
              ? next.index
              : null,
          );
        },
      );
    }
    return player.current;
  }
  useImperativeHandle(ref, () => ({
    playSentence(index) {
      if (!supported) return;
      onPlay();
      getPlayer()?.seek(index, true);
    },
    pause() {
      player.current?.pause();
    },
  }));
  useEffect(() => {
    const pause = () => player.current?.pause();
    const visibility = () => {
      if (document.hidden) pause();
    };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', pause);
    return () => {
      player.current?.dispose();
      port.current?.dispose();
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', pause);
    };
  }, []);
  useEffect(() => {
    if (suspended) player.current?.pause();
  }, [suspended]);
  return (
    <section className="review-audio" aria-label="英文の音声とシャドーイング">
      <div className="audio-heading">
        <Headphones size={16} />
        <strong>音読・シャドーイング</strong>
        <span>
          {state.index + 1} / {SENTENCES.length} 文
        </span>
      </div>
      <div className="audio-controls">
        <Button
          variant="ghost"
          disabled={!supported || state.index === 0}
          aria-label="前の文"
          onClick={() => {
            if (running) onPlay();
            getPlayer()?.seek(state.index - 1);
          }}
        >
          <SkipBack />
        </Button>
        <Button
          className="audio-play"
          disabled={!supported}
          onClick={() => {
            if (running) getPlayer()?.pause();
            else {
              onPlay();
              getPlayer()?.play();
            }
          }}
        >
          {running ? (
            <>
              <Pause />
              一時停止
            </>
          ) : (
            <>
              <Play />
              {state.phase === 'complete'
                ? '最初から再生'
                : state.phase === 'paused'
                  ? 'この文から再開'
                  : state.phase === 'error'
                    ? '再試行'
                    : '英文を再生'}
            </>
          )}
        </Button>
        <Button
          variant="ghost"
          disabled={!supported || state.index === SENTENCES.length - 1}
          aria-label="次の文"
          onClick={() => {
            if (running) onPlay();
            getPlayer()?.seek(state.index + 1);
          }}
        >
          <SkipForward />
        </Button>
      </div>
      <div className="audio-settings">
        <Select
          value={state.rate}
          onValueChange={(value) => {
            if (value !== null) getPlayer()?.configure({ rate: Number(value) });
          }}
          disabled={!supported}
        >
          <SelectTrigger aria-label="読み上げ速度">
            <SelectValue>{state.rate}倍速</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {[0.75, 1, 1.25].map((rate) => (
              <SelectItem value={rate} key={rate}>
                {rate}倍速
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={state.mode}
          onValueChange={(value) => {
            if (value) getPlayer()?.configure({ mode: value as PlaybackMode });
          }}
          disabled={!supported}
        >
          <SelectTrigger aria-label="音読の練習方法">
            <SelectValue>
              {
                {
                  continuous: '通して聴く',
                  repeat: '1文リピート',
                  shadow: '聴く → 自分で発音',
                }[state.mode]
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="continuous">通して聴く</SelectItem>
            <SelectItem value="repeat">1文リピート</SelectItem>
            <SelectItem value="shadow">聴く → 自分で発音</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <p className="audio-guidance" aria-live="polite">
        {!supported
          ? 'このブラウザーは音声読み上げに対応していません。Safari / Chrome などで開いてください。'
          : state.error ||
            (state.phase === 'gap' && state.mode === 'shadow'
              ? 'あなたの番。同じ文を声に出してみよう。'
              : state.phase === 'complete'
                ? '最後まで聴けました。次は音声に少し遅れて声を重ねよう。'
                : state.phase === 'paused'
                  ? '一時停止中。再開・速度変更は文の先頭から。'
                  : state.mode === 'repeat'
                    ? '同じ文を繰り返します。少し遅れて声を重ねよう。'
                    : state.mode === 'shadow'
                      ? '1文を聴くたびに、発音する時間が入ります。'
                      : '音声に少し遅れて声を重ねよう。本文の文をタップでそこから再生。')}
      </p>
      <small className="audio-source">
        端末の英語読み上げ音声を使用 · 録音なし
      </small>
    </section>
  );
}
