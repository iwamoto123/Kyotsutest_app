'use client';

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { flushSync } from 'react-dom';
import {
  ArrowLeft,
  ArrowRight,
  BookMarked,
  Check,
  Languages,
  Paperclip,
  RotateCcw,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  INTRO,
  PASSAGE,
  QUESTIONS,
  SENTENCES,
  normalizeWord,
} from '@/lib/exam-content';
import {
  createRun,
  formatTime,
  runReducer,
  scoreRun,
  type RunAction,
} from '@/lib/exam-engine';
import vocabulary from '@/lib/vocabulary.json';

const dictionary: Record<string, string> = vocabulary;
const STORAGE_KEY = 'kyotsutest-vocabulary-v1';
type WordEntry = { word: string; meaning: string; context: string };
type Registry = {
  registerTool: (
    tool: {
      name: string;
      description: string;
      inputSchema: object;
      annotations: { readOnlyHint: boolean };
      execute: (input: unknown) => unknown;
    },
    options: { signal: AbortSignal },
  ) => void | Promise<void>;
};

const UnitContext = createContext<{
  hintOn: boolean;
  translated: Set<string>;
  clickUnit: (id: string, normal?: () => void) => void;
}>({ hintOn: false, translated: new Set(), clickUnit: () => {} });

function words(text: string) {
  return text
    .split(/(p\.m\.|[A-Za-zÉé]+(?:'[A-Za-z]+)?|[0-9]+)/g)
    .map((part, i) =>
      i % 2 ? (
        <span key={i} data-word={normalizeWord(part)}>
          {part}
        </span>
      ) : (
        part
      ),
    );
}
function Unit({
  id,
  en,
  ja,
  className = '',
  onClick,
}: {
  id: string;
  en: string;
  ja: string;
  className?: string;
  onClick?: () => void;
}) {
  const { hintOn, translated, clickUnit } = useContext(UnitContext);
  return (
    <button
      type="button"
      className={`english-unit ${className}`}
      data-unit={id}
      data-en={en}
      onClick={() => clickUnit(id, onClick)}
    >
      <span className="original" lang="en">
        {words(en)}
      </span>
      {hintOn && translated.has(id) && (
        <span className="translation" lang="ja">
          {ja}
        </span>
      )}
    </button>
  );
}

export default function Home() {
  const [run, setRun] = useState(() =>
    createRun(QUESTIONS.map((q) => q.answer)),
  );
  const [page, setPage] = useState(0);
  const [activeQuestion, setActiveQuestion] = useState(0);
  const [compare, setCompare] = useState(false);
  const [turnDirection, setTurnDirection] = useState('forward');
  const [hintOn, setHintOn] = useState(false);
  const [translated, setTranslated] = useState<Set<string>>(new Set());
  const [modal, setModal] = useState<WordEntry | 'book' | 'results' | null>(
    null,
  );
  const [saved, setSaved] = useState<Record<string, WordEntry>>({});
  const [storageAvailable, setStorageAvailable] = useState(true);
  const [sound, setSound] = useState(false);
  const [message, setMessage] = useState('');
  const root = useRef<HTMLElement>(null);
  const sheet = useRef<HTMLElement>(null);
  const audio = useRef<AudioContext | null>(null);
  const messageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressUntil = useRef(0);
  const runRef = useRef(run);
  const savedRef = useRef(saved);
  const hint = useRef({
    pointer: null as number | null,
    started: 0,
    held: false,
    latched: false,
    previousLatch: false,
    dragged: false,
    key: false,
  });
  const live = useRef({ page, modal, activeQuestion, compare, hintOn });
  useLayoutEffect(() => {
    runRef.current = run;
    savedRef.current = saved;
    live.current = { page, modal, activeQuestion, compare, hintOn };
  });

  function dispatch(action: RunAction) {
    setRun((previous) => runReducer(previous, action));
  }
  function announce(text: string) {
    setMessage(text);
    if (messageTimer.current) clearTimeout(messageTimer.current);
    messageTimer.current = setTimeout(() => setMessage(''), 1700);
  }
  function playSound(kind: 'paper' | 'pencil' | 'correct' | 'save') {
    if (!sound) return;
    try {
      audio.current ??= new AudioContext();
      void audio.current.resume();
      const notes =
        kind === 'correct'
          ? [523, 659, 784]
          : kind === 'save'
            ? [660, 880]
            : kind === 'paper'
              ? [180]
              : [400];
      notes.forEach((frequency, index) => {
        const oscillator = audio.current!.createOscillator(),
          gain = audio.current!.createGain();
        const start = audio.current!.currentTime + index * 0.07;
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.001, start);
        gain.gain.linearRampToValueAtTime(0.03, start + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.12);
        oscillator.connect(gain).connect(audio.current!.destination);
        oscillator.start(start);
        oscillator.stop(start + 0.13);
      });
    } catch {
      /* Sound is optional on browsers without Web Audio. */
    }
  }
  const actions = useRef({
    turn: (_page: number) => {},
    showWord: (_word: string, _context: string) => {},
    reveal: (_id: string) => {},
    eliminate: (_q: number, _option: number) => {},
  });
  function turn(nextPage: number) {
    if (nextPage === page || nextPage < 0 || nextPage > 1) return;
    setTurnDirection(nextPage > page ? 'forward' : 'backward');
    setPage(nextPage);
    playSound('paper');
    window.scrollTo({ top: 0, behavior: 'auto' });
  }
  function updateHint() {
    const enabled =
      hint.current.held || hint.current.latched || hint.current.key;
    setHintOn(enabled);
    if (!enabled) setTranslated(new Set());
  }
  function clearHint() {
    hint.current.pointer = null;
    hint.current.held = false;
    hint.current.latched = false;
    hint.current.key = false;
    updateHint();
  }
  function reveal(id: string) {
    setTranslated((previous) => new Set([...previous, id]));
    dispatch({ type: 'hint', sentence: id });
  }
  function showWord(word: string, context: string) {
    if (!dictionary[word]) return;
    clearHint();
    setModal({ word, meaning: dictionary[word], context });
  }
  function eliminate(question: number, option: number) {
    dispatch({ type: 'eliminate', question, option });
    playSound('pencil');
  }
  useLayoutEffect(() => {
    actions.current = { turn, showWord, reveal, eliminate };
  });

  useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      const safe: Record<string, WordEntry> = {};
      for (const [word, entry] of Object.entries(raw)) {
        if (dictionary[word] && entry && typeof entry === 'object')
          safe[word] = {
            word,
            meaning: dictionary[word],
            context:
              typeof (entry as WordEntry).context === 'string'
                ? (entry as WordEntry).context.slice(0, 500)
                : '',
          };
      }
      // Browser storage is unavailable during server rendering; restore after hydration.
      // oxlint-disable-next-line react/react-compiler
      setSaved(safe);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
    } catch {
      setStorageAvailable(false);
    }
    return () => {
      if (messageTimer.current) clearTimeout(messageTimer.current);
      void audio.current?.close();
    };
  }, []);

  useEffect(() => {
    if (run.phase !== 'playing' || modal) return;
    let last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      dispatch({ type: 'tick', elapsedMs: now - last });
      last = now;
    }, 100);
    return () => clearInterval(timer);
  }, [run.phase, modal]);

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    let press: {
      pointer: number;
      x: number;
      y: number;
      timer: ReturnType<typeof setTimeout>;
      element: HTMLElement;
    } | null = null;
    let swipe: {
      pointer: number;
      x: number;
      y: number;
      question: number | null;
      option: number | null;
    } | null = null;
    const hintTouches = new Set<number>();
    function cancelPress() {
      if (press) {
        clearTimeout(press.timer);
        press.element.classList.remove('word-pressed');
        press = null;
      }
    }
    function down(event: PointerEvent) {
      const target = event.target instanceof Element ? event.target : null;
      if (!target || live.current.modal || event.button !== 0) return;
      if (target.closest('[data-hint]')) {
        event.preventDefault();
        cancelPress();
        if (hint.current.pointer !== null) return;
        hint.current.pointer = event.pointerId;
        hint.current.started = performance.now();
        hint.current.previousLatch = hint.current.latched;
        hint.current.held = true;
        hint.current.dragged = false;
        (target.closest('[data-hint]') as HTMLElement).setPointerCapture(
          event.pointerId,
        );
        updateHint();
        return;
      }
      const unit = target.closest<HTMLElement>('[data-unit]');
      if (
        (hint.current.held || hint.current.latched || hint.current.key) &&
        unit
      ) {
        event.preventDefault();
        hintTouches.add(event.pointerId);
        if (hint.current.held) hint.current.dragged = true;
        actions.current.reveal(unit.dataset.unit!);
        return;
      }
      const row = target.closest<HTMLElement>('[data-choice-row]');
      if (target.closest('.exam-sheet') || row)
        swipe = {
          pointer: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          question: row ? Number(row.dataset.question) : null,
          option: row ? Number(row.dataset.choiceRow) : null,
        };
      const word = target.closest<HTMLElement>('[data-word]');
      if (!word || !dictionary[word.dataset.word!]) return;
      cancelPress();
      word.classList.add('word-pressed');
      const pending = {
        phase: runRef.current.phase,
        pointer: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        timer: 0 as unknown as ReturnType<typeof setTimeout>,
        element: word,
      };
      pending.timer = setTimeout(() => {
        if (press !== pending || live.current.modal) return;
        if (
          pending.phase === 'playing' &&
          runRef.current.phase === 'finished'
        ) {
          cancelPress();
          return;
        }
        cancelPress();
        swipe = null;
        suppressUntil.current = performance.now() + 650;
        actions.current.showWord(word.dataset.word!, unit?.dataset.en || '');
      }, 450);
      press = pending;
    }
    function move(event: PointerEvent) {
      if (
        press &&
        press.pointer === event.pointerId &&
        Math.hypot(event.clientX - press.x, event.clientY - press.y) > 10
      )
        cancelPress();
      if (hint.current.pointer === event.pointerId) {
        const unit = document
          .elementFromPoint(event.clientX, event.clientY)
          ?.closest<HTMLElement>('[data-unit]');
        if (unit) {
          hint.current.dragged = true;
          actions.current.reveal(unit.dataset.unit!);
        }
      }
    }
    function up(event: PointerEvent) {
      if (hintTouches.delete(event.pointerId))
        suppressUntil.current = performance.now() + 400;
      if (press?.pointer === event.pointerId) cancelPress();
      if (swipe?.pointer === event.pointerId) {
        const dx = event.clientX - swipe.x,
          dy = event.clientY - swipe.y;
        if (
          Math.abs(dx) > 60 &&
          Math.abs(dx) > Math.abs(dy) * 1.5 &&
          !live.current.modal
        ) {
          suppressUntil.current = performance.now() + 450;
          if (swipe.question !== null && swipe.option !== null)
            actions.current.eliminate(swipe.question, swipe.option);
          else actions.current.turn(live.current.page + (dx < 0 ? 1 : -1));
        }
        swipe = null;
      }
      if (hint.current.pointer === event.pointerId) {
        const tapped =
          performance.now() - hint.current.started < 240 &&
          !hint.current.dragged;
        hint.current.pointer = null;
        hint.current.held = false;
        hint.current.latched = tapped ? !hint.current.previousLatch : false;
        updateHint();
      }
    }
    function cancel(event: PointerEvent) {
      if (press?.pointer === event.pointerId) cancelPress();
      if (swipe?.pointer === event.pointerId) swipe = null;
      hintTouches.delete(event.pointerId);
      if (hint.current.pointer === event.pointerId) clearHint();
    }
    function blur() {
      cancelPress();
      swipe = null;
      clearHint();
    }
    function keydown(event: KeyboardEvent) {
      if (event.key === 'Escape') clearHint();
      if (event.code === 'KeyH' && !event.repeat && !live.current.modal) {
        event.preventDefault();
        hint.current.key = true;
        updateHint();
      }
    }
    function keyup(event: KeyboardEvent) {
      if (event.code === 'KeyH') {
        hint.current.key = false;
        updateHint();
      }
    }
    function context(event: MouseEvent) {
      if ((event.target as Element).closest('[data-word], [data-hint]'))
        event.preventDefault();
    }
    function captureClick(event: MouseEvent) {
      if (
        performance.now() < suppressUntil.current &&
        (event.target as Element).closest('[data-unit], [data-choice-row]')
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    }
    element.addEventListener('pointerdown', down);
    element.addEventListener('contextmenu', context);
    element.addEventListener('click', captureClick, true);
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', cancel);
    document.addEventListener('scroll', cancelPress, true);
    document.addEventListener('keydown', keydown);
    document.addEventListener('keyup', keyup);
    window.addEventListener('blur', blur);
    return () => {
      cancelPress();
      element.removeEventListener('pointerdown', down);
      element.removeEventListener('contextmenu', context);
      element.removeEventListener('click', captureClick, true);
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', cancel);
      document.removeEventListener('scroll', cancelPress, true);
      document.removeEventListener('keydown', keydown);
      document.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', blur);
    };
  }, []);

  function saveWords(entries: WordEntry[]) {
    const next = { ...savedRef.current };
    entries.forEach((entry) => {
      next[entry.word] = entry;
    });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      setStorageAvailable(false);
    }
    savedRef.current = next;
    setSaved(next);
  }
  useEffect(() => {
    const context = (document as Document & { modelContext?: Registry })
      .modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const register = (tool: Parameters<Registry['registerTool']>[0]) => {
      try {
        void Promise.resolve(
          context.registerTool(tool, { signal: lifecycle.signal }),
        ).catch(() => {});
      } catch {
        /* Optional browser capability. */
      }
    };
    register({
      name: 'get_study_progress',
      description:
        'Read this practice run and the vocabulary saved on this device.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: () => ({
        phase: runRef.current.phase,
        score: scoreRun(runRef.current),
        grades: runRef.current.grades,
        savedWords: Object.keys(savedRef.current),
      }),
    });
    register({
      name: 'save_vocabulary',
      description:
        'Save known words from this practice booklet to the same device vocabulary notebook used by the interface.',
      inputSchema: {
        type: 'object',
        properties: {
          words: {
            type: 'array',
            items: { type: 'string' },
            minItems: 1,
            maxItems: 50,
          },
        },
        required: ['words'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
      execute: (input) => {
        const words = (input as { words?: unknown })?.words;
        if (
          !Array.isArray(words) ||
          !words.length ||
          words.length > 50 ||
          words.some(
            (word) =>
              typeof word !== 'string' || !dictionary[normalizeWord(word)],
          )
        )
          throw new Error('Choose 1–50 words from this booklet.');
        flushSync(() =>
          saveWords(
            words.map((word) => ({
              word: normalizeWord(word),
              meaning: dictionary[normalizeWord(word)],
              context: '',
            })),
          ),
        );
        return { savedWords: Object.keys(savedRef.current) };
      },
    });
    return () => lifecycle.abort();
  }, []);

  function clickUnit(id: string, normal?: () => void) {
    if (performance.now() < suppressUntil.current) return;
    if (hint.current.held || hint.current.latched || hint.current.key)
      reveal(id);
    else normal?.();
  }
  function select(question: number, option: number) {
    setActiveQuestion(question);
    dispatch({ type: 'select', question, option });
    playSound('pencil');
  }
  function grade(question: number) {
    const current = runRef.current;
    if (
      current.phase !== 'playing' ||
      current.grades[question] !== null ||
      current.choices[question] < 0
    )
      return;
    dispatch({ type: 'grade', question });
    const correct = current.choices[question] === QUESTIONS[question].answer;
    if (correct) {
      playSound('correct');
      announce(
        current.combo >= 1
          ? `${current.combo + 1}問連続正解。+2点`
          : '正解。+2点',
      );
    } else announce('根拠を見直してみよう。');
  }
  function renderQuestion(index: number, compact = false) {
    const question = QUESTIONS[index],
      marked = run.grades[index] !== null;
    return (
      <section
        className={`question-block ${marked ? 'graded' : ''} ${compact ? 'compact-question' : ''}`}
        key={index}
        onFocus={() => setActiveQuestion(index)}
      >
        <div className="question-stem">
          <b>問{index + 1}</b>
          <Unit id={`q${index}`} en={question.en} ja={question.ja} />
          <span
            className={`answer-box ${marked ? (run.grades[index] ? 'correct-mark' : 'wrong-mark') : ''}`}
          >
            {index + 1}
          </span>
        </div>
        <RadioGroup
          className="choices"
          value={run.choices[index] < 0 ? '' : String(run.choices[index])}
          onValueChange={(value) => {
            if (!hintOn) select(index, Number(value));
          }}
          aria-label={`問${index + 1}の選択肢`}
          disabled={marked || run.phase === 'finished'}
        >
          {question.choices.map(([en, ja], option) => (
            <div
              className={`choice-row ${run.eliminated[index].includes(option) ? 'eliminated' : ''} ${marked && option === question.answer ? 'answer-correct' : ''}`}
              data-choice-row={option}
              data-question={index}
              key={option}
            >
              <span className="number-wrap">
                <span aria-hidden="true">{option + 1}</span>
                <RadioGroupItem
                  value={String(option)}
                  className="choice-radio"
                  disabled={run.eliminated[index].includes(option)}
                  aria-label={`選択肢${option + 1}: ${en}`}
                />
              </span>
              <Unit
                id={`q${index}o${option}`}
                en={en}
                ja={ja}
                onClick={() => select(index, option)}
              />
              {!marked && run.phase !== 'finished' && (
                <button
                  type="button"
                  className="eliminate-button"
                  onClick={() => eliminate(index, option)}
                  aria-label={`選択肢${option + 1}を${run.eliminated[index].includes(option) ? '戻す' : '消す'}`}
                >
                  {run.eliminated[index].includes(option) ? (
                    <RotateCcw size={13} />
                  ) : (
                    <span>／</span>
                  )}
                </button>
              )}
            </div>
          ))}
        </RadioGroup>
        {run.evidence[index] && (
          <button
            type="button"
            className="evidence-note"
            onClick={() => {
              setActiveQuestion(index);
              turn(0);
            }}
          >
            <Paperclip size={13} />
            <span>
              {SENTENCES.find((s) => s.id === run.evidence[index])?.en}
            </span>
          </button>
        )}
        {marked ? (
          <div
            className={`teacher-note ${run.grades[index] ? '' : 'review-note'}`}
          >
            <b>
              {run.grades[index] ? '正解' : `正解は ${question.answer + 1}`}
            </b>
            {question.explanation}
          </div>
        ) : (
          run.phase === 'playing' &&
          run.choices[index] >= 0 && (
            <Button
              variant="ghost"
              className="grade-button"
              onClick={() => grade(index)}
            >
              この解答を確定 <Check size={14} />
            </Button>
          )
        )}
      </section>
    );
  }
  const total = scoreRun(run);
  const answered = run.grades.filter((value) => value !== null).length;

  return (
    <UnitContext.Provider value={{ hintOn, translated, clickUnit }}>
      <main className={`exam-app ${hintOn ? 'hint-active' : ''}`} ref={root}>
        <header className="app-header">
          <span className="app-name">
            攻略ノート<small>英語・リーディング</small>
          </span>
          <div
            className={`session-clock ${run.remainingMs <= 30_000 ? 'urgent' : ''}`}
          >
            <small>
              {modal && run.phase === 'playing'
                ? '一時停止'
                : run.phase === 'ready'
                  ? '制限時間'
                  : '残り時間'}
            </small>
            {formatTime(run.remainingMs)}
          </div>
          <Button
            variant="ghost"
            className="icon-button"
            aria-label={sound ? '効果音をオフ' : '効果音をオン'}
            aria-pressed={sound}
            onClick={() => setSound(!sound)}
          >
            {sound ? <Volume2 /> : <VolumeX />}
          </Button>
          <Button
            variant="ghost"
            className="notebook-button"
            onClick={() => {
              clearHint();
              setModal('book');
            }}
          >
            <BookMarked />
            <span>{Object.keys(saved).length}</span>
            <span className="sr-only">保存した単語</span>
          </Button>
        </header>
        <div className="run-progress">
          <div className="progress-stamps">
            {run.grades.map((value, i) => (
              <button
                type="button"
                className={
                  value === null ? '' : value ? 'stamp-correct' : 'stamp-review'
                }
                key={i}
                onClick={() => {
                  setActiveQuestion(i);
                  if (page === 0) setCompare(true);
                }}
              >
                {value === null ? `問${i + 1}` : value ? '○' : '×'}
              </button>
            ))}
          </div>
          <span>
            {total} / 6 点{run.combo > 1 && <b> · {run.combo}問連続</b>}
          </span>
        </div>
        <div className="book-index">
          <button
            onClick={() => turn(0)}
            aria-current={page === 0 ? 'page' : undefined}
          >
            本文
          </button>
          <button
            onClick={() => turn(1)}
            aria-current={page === 1 ? 'page' : undefined}
          >
            設問
          </button>
          <Button
            variant="ghost"
            className="compare-toggle"
            aria-pressed={compare}
            onClick={() => {
              setCompare(!compare);
              if (page === 1 && !compare) turn(0);
            }}
          >
            <Paperclip size={14} />
            {compare ? '挟んだ設問を閉じる' : '設問を挟む'}
          </Button>
        </div>
        <article
          className={`exam-sheet leaf-${turnDirection}`}
          key={page}
          ref={sheet}
        >
          <h1>英語（リーディング）</h1>
          <div className="exam-heading">
            <b>第1問</b>
            <span>（配点 6）</span>
            {run.phase === 'finished' && (
              <span className="completion-stamp">
                {total === 6 ? '全問正解' : '復習へ'}
              </span>
            )}
          </div>
          {page === 0 ? (
            <>
              <Unit {...INTRO} className="exam-intro" />
              <section className="notice">
                <h2>Night at the Museum</h2>
                {PASSAGE.map((section, i) => (
                  <div key={i}>
                    {section.title && <h3>{section.title}</h3>}
                    {section.sentences.map((sentence) => (
                      <Unit
                        key={sentence.id}
                        {...sentence}
                        className={`passage-sentence ${run.evidence.includes(sentence.id) ? 'underlined' : ''} ${run.grades.some((grade, index) => grade && QUESTIONS[index].evidence === sentence.id) ? 'evidence-correct' : ''}`}
                        onClick={() => {
                          if (
                            run.phase === 'finished' ||
                            run.grades[activeQuestion] !== null
                          )
                            return;
                          dispatch({
                            type: 'evidence',
                            question: activeQuestion,
                            sentence: sentence.id,
                          });
                          playSound('pencil');
                          announce(
                            `問${activeQuestion + 1}の根拠${run.evidence[activeQuestion] === sentence.id ? 'を解除' : 'に下線'}`,
                          );
                        }}
                      />
                    ))}
                  </div>
                ))}
              </section>
              <p className="paper-instruction">
                文をタップで根拠に下線。単語を長押しで辞書。
              </p>
            </>
          ) : (
            QUESTIONS.map((_, index) => renderQuestion(index))
          )}
          <footer className="paper-footer">
            <span>― {page + 1} ―</span>
            <small>練習問題 01</small>
          </footer>
          <button
            type="button"
            className={`page-corner ${page ? 'corner-left' : ''}`}
            onClick={() => turn(page ? 0 : 1)}
            aria-label={page ? '本文ページへ戻る' : '設問ページをめくる'}
          >
            <span />
          </button>
        </article>
        <nav className="page-navigation" aria-label="ページをめくる">
          <Button variant="ghost" disabled={page === 0} onClick={() => turn(0)}>
            <ArrowLeft />
            前へ
          </Button>
          <span>
            {page + 1} / 2 <small>左右にスワイプ</small>
          </span>
          <Button variant="ghost" disabled={page === 1} onClick={() => turn(1)}>
            次へ
            <ArrowRight />
          </Button>
        </nav>
        {compare && page === 0 && (
          <aside className="comparison-sheet">
            <div className="comparison-header">
              <Paperclip size={16} />
              <span>本文と見比べる</span>
              <div>
                {QUESTIONS.map((_, i) => (
                  <button
                    type="button"
                    key={i}
                    className={i === activeQuestion ? 'active' : ''}
                    onClick={() => setActiveQuestion(i)}
                  >
                    問{i + 1}
                  </button>
                ))}
              </div>
            </div>
            {renderQuestion(activeQuestion, true)}
          </aside>
        )}
        {run.phase === 'finished' && (
          <section className="run-result" aria-live="polite">
            <strong>
              {total === 6
                ? 'この一冊、攻略完了。'
                : '次の一周で、取り戻そう。'}
            </strong>
            <span>
              {total} / 6 点 · {answered}問解答 · 対訳 {run.hinted.length}か所
            </span>
            <Button variant="outline" onClick={() => setModal('results')}>
              今回の攻略を見る
            </Button>
          </section>
        )}
        <div className="tool-dock">
          <Button
            variant="outline"
            className="hint-button"
            data-hint
            aria-pressed={hintOn}
            onClick={(event) => {
              if (event.detail === 0) {
                hint.current.latched = !hint.current.latched;
                updateHint();
              }
            }}
          >
            <Languages />
            <span>
              対訳ヒント
              <small>
                {hintOn ? '英文の下に日本語を表示' : '押しながら文をタップ'}
              </small>
            </span>
          </Button>
          <Button
            className="main-action"
            onClick={() => {
              if (run.phase === 'ready') {
                dispatch({ type: 'start' });
                announce('3分で3問。冊子を攻略しよう。');
              } else if (run.phase === 'finished') {
                setRun(createRun(QUESTIONS.map((q) => q.answer)));
                clearHint();
                setPage(0);
                setActiveQuestion(0);
                window.scrollTo({ top: 0, behavior: 'auto' });
              } else if (
                run.choices[activeQuestion] >= 0 &&
                run.grades[activeQuestion] === null
              )
                grade(activeQuestion);
              else {
                if (page === 0) turn(1);
                else {
                  setCompare(true);
                  turn(0);
                }
              }
            }}
          >
            {run.phase === 'ready'
              ? '演習を始める'
              : run.phase === 'finished'
                ? 'もう一度挑戦'
                : run.choices[activeQuestion] >= 0 &&
                    run.grades[activeQuestion] === null
                  ? `問${activeQuestion + 1}を確定`
                  : page === 0
                    ? '設問をめくる'
                    : '本文と見比べる'}
            <ArrowRight size={16} />
          </Button>
          <p>ヒントはタップでON/OFFも可。選択肢を横に払うと消去。</p>
        </div>
        {message && (
          <output className="action-message" aria-live="polite">
            {message}
          </output>
        )}
        <p className="app-caption">
          オリジナル演習問題 · 本試験の得点や偏差値を判定するものではありません
        </p>
        <Dialog
          open={modal !== null}
          onOpenChange={(open) => {
            if (!open) setModal(null);
          }}
        >
          <DialogContent className="vocabulary-dialog">
            <DialogTitle>
              {modal === 'book'
                ? `単語帳 — ${Object.keys(saved).length}語`
                : modal === 'results'
                  ? '今回の攻略'
                  : modal?.word || '辞書'}
            </DialogTitle>
            <DialogDescription>
              {modal === 'results'
                ? '紙面に残した、今回の解答と根拠。'
                : storageAvailable
                  ? 'この端末に保存されます。辞書を開いている間は時計が止まります。'
                  : 'この画面を開いている間保存されます。辞書を開いている間は時計が止まります。'}
            </DialogDescription>
            <div className="dialog-body">
              {modal === 'book' ? (
                Object.keys(saved).length ? (
                  Object.values(saved).map((entry) => (
                    <button
                      className="saved-word"
                      type="button"
                      key={entry.word}
                      onClick={() => setModal(entry)}
                    >
                      <b>{entry.word}</b>
                      <span>{entry.meaning}</span>
                    </button>
                  ))
                ) : (
                  <p className="empty-notebook">
                    英文の単語を長押しして、意味と一緒に集めていこう。
                  </p>
                )
              ) : modal === 'results' ? (
                <>
                  <div className="result-score">
                    {total}
                    <small> / 6点</small>
                  </div>
                  {QUESTIONS.map((question, i) => (
                    <div className="result-line" key={i}>
                      <b>
                        {run.grades[i] === null
                          ? '—'
                          : run.grades[i]
                            ? '○'
                            : '×'}
                      </b>
                      <span>
                        問{i + 1}　{question.skill}
                        <small>
                          {run.evidence[i] === question.evidence
                            ? '根拠の一致まで確認'
                            : question.explanation}
                        </small>
                      </span>
                    </div>
                  ))}
                  <p className="storage-note">
                    正解数・時間・ヒント利用は、この演習内の記録です。
                  </p>
                </>
              ) : (
                modal && (
                  <>
                    <p className="dictionary-meaning">{modal.meaning}</p>
                    <p className="dictionary-context" lang="en">
                      {modal.context}
                    </p>
                    <Button
                      className="save-word-button"
                      onClick={() => {
                        saveWords([modal]);
                        playSound('save');
                        announce(`「${modal.word}」を単語帳へ`);
                      }}
                    >
                      {saved[modal.word] ? (
                        <>
                          <Check />
                          保存済み
                        </>
                      ) : (
                        <>
                          <BookMarked />
                          単語帳に保存
                        </>
                      )}
                    </Button>
                  </>
                )
              )}
            </div>
          </DialogContent>
        </Dialog>
      </main>
    </UnitContext.Provider>
  );
}
