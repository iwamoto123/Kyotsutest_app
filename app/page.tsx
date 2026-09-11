'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookMarked,
  Check,
  Compass,
  Hand,
  Headphones,
  Languages,
  PencilLine,
  RotateCcw,
  Search,
  BookmarkPlus,
  X,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import {
  INTRO,
  PASSAGE,
  QUESTIONS,
  SENTENCES,
  normalizeWord,
  type Sentence,
} from '@/lib/exam-content';
import { createRun, formatTime, runReducer, scoreRun } from '@/lib/exam-engine';
import {
  GUIDE_CONTENT,
  NOTEBOOK_KEY,
  createGuide,
  getUnit,
  guideTarget,
  inspectEvidence,
  nextGuide,
  resumeGuide,
  parseNotebook,
  rangeText,
  tokenize,
  type NotebookEntry,
  type TextRange,
  type ToolMode,
  type GuideTarget,
} from '@/lib/study-interactions';
import vocabulary from '@/lib/vocabulary.json';
import { TouchText, TextToolsContext } from './touch-text';
import { StudyGuide } from './study-guide';
import { GuideRegion, type GuideAnnotation } from './guide-region';
import { useGuideLocation } from './use-guide-location';
import { ReviewPlayer, type ReviewPlayerHandle } from './review-player';

type Mark = {
  question: number;
  ranges: TextRange[];
  evidenceBefore: string | null;
};
type Drawer =
  | null
  | { kind: 'notebook'; filter: NotebookEntry['kind'] }
  | { kind: 'word'; entry: NotebookEntry }
  | { kind: 'results' };
const dictionary: Record<string, string> = vocabulary;
const MODES: {
  id: ToolMode;
  label: string;
  icon: typeof Hand;
  help: string;
}[] = [
  {
    id: 'read',
    label: '読む',
    icon: Hand,
    help: '縦にスクロールして読む。選択肢はタップで選ぶ。',
  },
  {
    id: 'ink',
    label: '線を引く',
    icon: PencilLine,
    help: '大事な部分をなぞる。余白はスクロールできるよ。',
  },
  {
    id: 'stock',
    label: '文ストック',
    icon: BookmarkPlus,
    help: '訳せなかった部分をなぞると、文と対訳を保存。',
  },
  {
    id: 'word',
    label: '単語',
    icon: Search,
    help: '調べたい単語をタップ。長押しはいらないよ。',
  },
  {
    id: 'translate',
    label: '対訳',
    icon: Languages,
    help: '文をタップすると、英文のすぐ下に日本語。',
  },
];

export default function Home() {
  const [run, setRun] = useState(() =>
    createRun(QUESTIONS.map((q) => q.answer)),
  );
  const [guided, setGuided] = useState(true);
  const [guide, setGuide] = useState(createGuide);
  const [mode, setMode] = useState<ToolMode>('read');
  const [page, setPage] = useState(0);
  const [activeQuestion, setActiveQuestion] = useState(0);
  const [practiceChoice, setPracticeChoice] = useState(-1);
  const [compare, setCompare] = useState(false);
  const [peekQuestion, setPeekQuestion] = useState<number | null>(null);
  const [review, setReview] = useState(false);
  const [fullTranslation, setFullTranslation] = useState(true);
  const [translated, setTranslated] = useState<Set<string>>(new Set());
  const [marks, setMarks] = useState<Mark[]>([]);
  const [draft, setDraft] = useState<TextRange[]>([]);
  const [entries, setEntries] = useState<NotebookEntry[]>([]);
  const [storageAvailable, setStorageAvailable] = useState(true);
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [listening, setListening] = useState<number | null>(null);
  const [sound, setSound] = useState(false);
  const [notice, setNotice] = useState<{
    text: string;
    undo?: () => void;
  } | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const player = useRef<ReviewPlayerHandle>(null);
  const notebook = useRef(entries);
  const runRef = useRef(run);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audio = useRef<AudioContext | null>(null);
  useLayoutEffect(() => {
    notebook.current = entries;
    runRef.current = run;
  });
  const question =
    peekQuestion ?? (guided && !review ? guide.question : activeQuestion);
  const showGuide = guided && !review && peekQuestion === null;
  const currentGuide = GUIDE_CONTENT[question];
  const score = scoreRun(run);
  const selected = showGuide ? practiceChoice : run.choices[question];
  const target = showGuide ? guideTarget(guide) : null;
  const targetLocation = useGuideLocation(scroll, target, page);
  const annotation: GuideAnnotation | undefined = !showGuide
    ? undefined
    : guide.stage === 'intro-summary'
      ? {
          title: '場面の整理',
          expression: 'a notice about an evening event',
          text: '読むものは、博物館の夜のイベント案内。',
          tone: 'note',
        }
      : guide.stage === 'question-summary'
        ? {
            title: '今回、本文で探すこと',
            text: currentGuide.search,
            tone: 'note',
          }
        : guide.stage === 'evidence-feedback'
          ? {
              title: guide.match ? '✓ 見つけた根拠' : 'この箇所で確認すること',
              expression: guide.match ? currentGuide.expression : undefined,
              text: guide.match ? currentGuide.summary : guide.message,
              tone: guide.match ? 'success' : 'retry',
            }
          : guide.stage === 'answer-feedback'
            ? {
                title: guide.match ? '✓ 根拠と一致' : '根拠と比べてみよう',
                text: guide.message,
                tone: guide.match ? 'success' : 'retry',
              }
            : undefined;
  const stocked = new Set(
    entries
      .filter((entry) => entry.kind === 'sentence' && entry.unit)
      .map((entry) => entry.unit!),
  );

  function announce(text: string, undo?: () => void) {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice({ text, undo });
    noticeTimer.current = setTimeout(() => setNotice(null), undo ? 5500 : 2200);
  }
  function tone() {
    if (!sound) return;
    try {
      audio.current ??= new AudioContext();
      void audio.current.resume();
      const oscillator = audio.current.createOscillator(),
        gain = audio.current.createGain();
      oscillator.frequency.value = 660;
      gain.gain.setValueAtTime(0.025, audio.current.currentTime);
      gain.gain.exponentialRampToValueAtTime(
        0.001,
        audio.current.currentTime + 0.13,
      );
      oscillator.connect(gain).connect(audio.current.destination);
      oscillator.start();
      oscillator.stop(audio.current.currentTime + 0.14);
    } catch {
      /* Optional effect sound. */
    }
  }
  function writeNotebook(next: NotebookEntry[]) {
    notebook.current = next;
    setEntries(next);
    try {
      localStorage.setItem(NOTEBOOK_KEY, JSON.stringify(next));
    } catch {
      setStorageAvailable(false);
    }
  }
  function saveEntries(incoming: NotebookEntry[], toast?: string) {
    const before = notebook.current;
    const ids = new Set(incoming.map((entry) => entry.id));
    writeNotebook(
      [
        ...incoming.map((entry) => ({
          ...entry,
          createdAt:
            before.find((old) => old.id === entry.id)?.createdAt ??
            entry.createdAt,
        })),
        ...before.filter((entry) => !ids.has(entry.id)),
      ].slice(0, 500),
    );
    if (toast)
      announce(toast, () => {
        const retained = notebook.current.filter((entry) => !ids.has(entry.id));
        writeNotebook([
          ...before.filter((entry) => ids.has(entry.id)),
          ...retained,
        ]);
        setNotice(null);
      });
  }
  function note(
    id: string,
    title: string,
    en: string,
    ja: string,
    detail?: string,
  ) {
    saveEntries([
      {
        id: `note-${id}`,
        kind: 'note',
        title,
        en,
        ja,
        detail,
        createdAt: Date.now(),
      },
    ]);
  }
  useEffect(() => {
    try {
      const stored = parseNotebook(localStorage.getItem(NOTEBOOK_KEY));
      let old: unknown = {};
      try {
        old = JSON.parse(
          localStorage.getItem('kyotsutest-vocabulary-v1') || '{}',
        );
      } catch {
        /* A damaged old word list must not hide the current notebook. */
      }
      const migrated: NotebookEntry[] =
        old && typeof old === 'object'
          ? Object.entries(old)
              .filter(
                ([word]) =>
                  dictionary[word] &&
                  !stored.some((entry) => entry.id === `word-${word}`),
              )
              .map(([word, entry]) => ({
                id: `word-${word}`,
                kind: 'word',
                title: word,
                en:
                  entry &&
                  typeof entry === 'object' &&
                  'context' in entry &&
                  typeof entry.context === 'string'
                    ? entry.context
                    : '',
                ja: dictionary[word],
                createdAt: Date.now(),
              }))
          : [];
      // The device notebook can only be restored after hydration.
      // oxlint-disable-next-line react/react-compiler
      writeNotebook([...stored, ...migrated]);
    } catch {
      setStorageAvailable(false);
    }
    return () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      void audio.current?.close();
    };
  }, []);
  useEffect(() => {
    if (run.phase !== 'playing' || guided || drawer || review) return;
    let last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      setRun((previous) =>
        runReducer(previous, { type: 'tick', elapsedMs: now - last }),
      );
      last = now;
    }, 200);
    return () => clearInterval(timer);
  }, [run.phase, guided, drawer, review]);
  useEffect(() => {
    if (listening === null || !review || page !== 0) return;
    scroll.current
      ?.querySelector<HTMLElement>(`[data-unit="${SENTENCES[listening].id}"]`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [listening, page, review]);

  useLayoutEffect(() => {
    if (!target) return;
    player.current?.pause();
    setPage(target.page);
    setDraft([]);
    const frame = requestAnimationFrame(() => scrollToTarget(target, true));
    return () => cancelAnimationFrame(frame);
    // Only a new guide step moves the paper. Manual page changes, scrolling,
    // dictionary use, and mode switches must not pull the reader back.
  }, [
    guide.stage,
    guide.question,
    guide.evidenceUnit,
    guide.answerOption,
    showGuide,
  ]);

  function scrollToTarget(destination: GuideTarget, includeContext = false) {
    const container = scroll.current;
    const element = container?.querySelector<HTMLElement>(
      `[data-guide-anchor="${destination.anchor}"]`,
    );
    if (!container || !element) return;
    const context = element.previousElementSibling;
    const firstChoice = element.querySelector<HTMLElement>('.choice-row');
    let alignTo = element;
    // Include the preceding evidence only when the first choice still fits.
    // The location link always goes directly to the numbered destination.
    if (
      includeContext &&
      context instanceof HTMLElement &&
      context.matches('.answer-reference') &&
      firstChoice
    ) {
      const required =
        firstChoice.getBoundingClientRect().bottom -
        context.getBoundingClientRect().top;
      if (required <= container.clientHeight - 28) alignTo = context;
    }
    const reduced = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    container.scrollTo({
      top:
        container.scrollTop +
        alignTo.getBoundingClientRect().top -
        container.getBoundingClientRect().top -
        14,
      behavior: reduced ? 'auto' : 'smooth',
    });
  }
  function showTarget(destination = target) {
    if (!destination) return;
    player.current?.pause();
    setPage(destination.page);
    setDraft([]);
    if (guide.stage === 'find') setMode('ink');
    if (guide.stage === 'answer') setMode('read');
    requestAnimationFrame(() => scrollToTarget(destination));
  }

  function turn(next: number, target?: string) {
    player.current?.pause();
    setPage(next);
    setDraft([]);
    requestAnimationFrame(() => {
      if (target)
        scroll.current
          ?.querySelector<HTMLElement>(`[data-unit="${target}"]`)
          ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      else scroll.current?.scrollTo({ top: 0, behavior: 'auto' });
    });
  }
  function setTool(next: ToolMode) {
    setMode(next);
    setDraft([]);
    player.current?.pause();
  }
  function openNotebook(filter: NotebookEntry['kind'] = 'note') {
    player.current?.pause();
    setDrawer({ kind: 'notebook', filter });
  }
  function lookup(unitId: string, index: number) {
    const unit = getUnit(unitId),
      token = unit && tokenize(unit.en).find((token) => token.index === index);
    if (!unit || !token) return;
    const word = normalizeWord(token.text),
      meaning = dictionary[word];
    if (!meaning) {
      announce('この語は辞書にまだ登録されていません。');
      return;
    }
    player.current?.pause();
    setDrawer({
      kind: 'word',
      entry: {
        id: `word-${word}`,
        kind: 'word',
        title: word,
        en: unit.en,
        ja: meaning,
        unit: unitId,
        createdAt: Date.now(),
      },
    });
  }
  function translate(unit: string) {
    setTranslated((previous) => {
      const next = new Set(previous);
      if (next.has(unit)) next.delete(unit);
      else next.add(unit);
      return next;
    });
    setRun((previous) =>
      runReducer(previous, { type: 'hint', sentence: unit }),
    );
  }
  function recordMistake(
    kind: 'evidence' | 'answer',
    detail: string,
    en: string,
    suffix = '',
  ) {
    saveEntries([
      {
        id: `check-${question}-${kind}-${suffix}`,
        kind: 'knowledge',
        title: currentGuide.check,
        en,
        ja: detail,
        detail: `問${question + 1}で確認したこと：${currentGuide.summary}`,
        unit: QUESTIONS[question].evidence,
        createdAt: Date.now(),
      },
    ]);
  }
  function onTrace(ranges: TextRange[]) {
    if (!ranges.length) return;
    if (mode === 'stock') {
      saveEntries(
        ranges.map((range) => {
          const unit = getUnit(range.unit)!;
          return {
            id: `sentence-${unit.id}`,
            kind: 'sentence' as const,
            title: '訳せなかった文',
            en: unit.en,
            ja: unit.ja,
            excerpt: rangeText(range),
            unit: unit.id,
            createdAt: Date.now(),
          };
        }),
        `${ranges.length}文を、対訳と一緒にストック`,
      );
      tone();
      return;
    }
    if (mode !== 'ink') return;
    if (peekQuestion !== null) {
      announce('保存した文を確認中です。ガイドに戻ってから線を引こう。');
      return;
    }
    if (run.phase === 'finished' || run.grades[question] !== null) {
      announce('採点時の線を残しています。復習したい文はストックできるよ。');
      return;
    }
    const mark = { question, ranges, evidenceBefore: run.evidence[question] };
    setMarks((previous) => [...previous, mark]);
    const passage = ranges.filter((range) => /^s[0-5]$/.test(range.unit));
    const result = inspectEvidence(question, [
      ...marks
        .filter((mark) => mark.question === question)
        .flatMap((mark) => mark.ranges),
      ...ranges,
    ]);
    const evidence = result.match
      ? QUESTIONS[question].evidence
      : passage.at(-1)?.unit;
    if (evidence)
      setRun((previous) =>
        previous.evidence[question] === evidence
          ? previous
          : runReducer(previous, {
              type: 'evidence',
              question,
              sentence: evidence,
            }),
      );
    if (showGuide && ['find', 'evidence-feedback'].includes(guide.stage)) {
      setGuide({
        ...guide,
        stage: 'evidence-feedback',
        ...result,
      });
      if (result.match)
        note(
          `evidence-${question}`,
          `問${question + 1}の根拠`,
          getUnit(QUESTIONS[question].evidence)!.en,
          currentGuide.summary,
          `${currentGuide.expression}：${currentGuide.meaning}`,
        );
      else
        recordMistake(
          'evidence',
          result.message,
          ranges.map(rangeText).join(' '),
          ranges.map((range) => range.unit).join('-'),
        );
    } else announce('指でなぞった部分に線を引いたよ。');
    tone();
  }
  function undoInk() {
    const lastIndex = marks.findLastIndex((mark) => mark.question === question);
    if (
      lastIndex < 0 ||
      run.grades[question] !== null ||
      run.phase === 'finished'
    )
      return;
    const last = marks[lastIndex];
    setMarks((previous) => previous.filter((_, index) => index !== lastIndex));
    setRun((previous) => ({
      ...previous,
      evidence: previous.evidence.map((value, i) =>
        i === question ? last.evidenceBefore : value,
      ),
    }));
    if (showGuide && guide.stage === 'evidence-feedback')
      setGuide({ ...guide, stage: 'find', match: false, message: '' });
  }
  function choose(index: number, option: number) {
    if (mode !== 'read') {
      announce('解答を選ぶときは「読む」に切り替えよう。');
      return;
    }
    if (showGuide) {
      if (guide.stage !== 'answer' || index !== guide.question) {
        announce('ガイドの順番で、まず探すことと根拠を確認しよう。');
        return;
      }
      setPracticeChoice(option);
    } else {
      setActiveQuestion(index);
      setRun((previous) =>
        runReducer(previous, { type: 'select', question: index, option }),
      );
    }
  }
  function submit(index = question) {
    const choice = showGuide ? practiceChoice : run.choices[index];
    if (choice < 0 || (showGuide && guide.stage !== 'answer')) return;
    const correct = choice === QUESTIONS[index].answer;
    setRun((previous) => {
      const running =
        previous.phase === 'ready'
          ? runReducer(previous, { type: 'start' })
          : previous;
      return runReducer(
        runReducer(running, {
          type: 'select',
          question: index,
          option: choice,
        }),
        { type: 'grade', question: index },
      );
    });
    if (showGuide) {
      const message = GUIDE_CONTENT[index].feedback[choice];
      setGuide({
        ...guide,
        stage: 'answer-feedback',
        match: correct,
        message,
        answerOption: choice,
      });
      if (!correct)
        recordMistake(
          'answer',
          message,
          QUESTIONS[index].choices[choice][0],
          String(choice),
        );
      else
        note(
          `answer-${index}`,
          `問${index + 1}で整理したこと`,
          GUIDE_CONTENT[index].expression,
          GUIDE_CONTENT[index].summary,
          GUIDE_CONTENT[index].meaning,
        );
    } else if (!correct)
      saveEntries([
        {
          id: `check-${index}-answer-${choice}`,
          kind: 'knowledge',
          title: GUIDE_CONTENT[index].check,
          en: QUESTIONS[index].choices[choice][0],
          ja: GUIDE_CONTENT[index].feedback[choice],
          detail: GUIDE_CONTENT[index].summary,
          unit: QUESTIONS[index].evidence,
          createdAt: Date.now(),
        },
      ]);
    if (correct) tone();
  }
  function findEvidence() {
    setTool('ink');
    showTarget(guideTarget({ ...guide, stage: 'find' }));
  }
  function advance() {
    if (guide.stage === 'done') {
      startReview();
      return;
    }
    if (guide.stage === 'intro') {
      note(
        'intro',
        '文章の場面',
        'a notice about an evening event',
        '読むもの：博物館の夜のイベント案内',
      );
      setRun((previous) => runReducer(previous, { type: 'start' }));
    }
    if (guide.stage === 'question')
      note(
        `question-${question}`,
        `問${question + 1}で探すこと`,
        QUESTIONS[question].en,
        currentGuide.search,
      );
    const next = nextGuide(guide, run.grades);
    setGuide(next);
    setActiveQuestion(next.question);
    if (next.stage === 'question' || next.stage === 'answer') {
      setTool('read');
      setPracticeChoice(-1);
    }
    if (next.stage === 'find') setTool('ink');
    if (next.stage === 'done') {
      setTool('read');
      setDrawer({ kind: 'results' });
    }
  }
  function toggleGuide(enabled: boolean) {
    setGuided(enabled);
    setPeekQuestion(null);
    setDraft([]);
    setMode('read');
    setPracticeChoice(-1);
    if (enabled) {
      setRun((previous) => ({
        ...previous,
        eliminated: previous.eliminated.map((values, i) =>
          previous.grades[i] === null ? [] : values,
        ),
      }));
      const next = resumeGuide(guide, run.grades, run.phase === 'finished');
      setGuide(next);
      setActiveQuestion(next.question);
      if (next.stage === 'find') setTool('ink');
    }
  }
  function returnToGuide() {
    setPeekQuestion(null);
    setMode(guide.stage === 'find' ? 'ink' : 'read');
  }
  function viewSavedUnit(unit: string) {
    setDrawer(null);
    setTool('read');
    const target = /^q([0-2])/.exec(unit);
    if (target && guided && !review && Number(target[1]) !== guide.question)
      setPeekQuestion(Number(target[1]));
    else setPeekQuestion(null);
    if (target) setActiveQuestion(Number(target[1]));
    turn(target ? 1 : 0, unit);
  }
  function startReview() {
    setPeekQuestion(null);
    player.current?.pause();
    setReview(true);
    setMode('read');
    setFullTranslation(true);
    setDrawer(null);
    setCompare(false);
    turn(0);
  }
  function restart() {
    setPeekQuestion(null);
    player.current?.pause();
    setRun(createRun(QUESTIONS.map((q) => q.answer)));
    setGuide(createGuide());
    setPracticeChoice(-1);
    setActiveQuestion(0);
    setReview(false);
    setMarks([]);
    setDraft([]);
    setTranslated(new Set());
    setDrawer(null);
    setMode('read');
    setCompare(false);
    setListening(null);
    turn(0);
  }

  useEffect(() => {
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
    const context = (document as Document & { modelContext?: Registry })
      .modelContext;
    if (!context) return;
    const lifecycle = new AbortController();
    const register = (tool: Parameters<Registry['registerTool']>[0]) => {
      try {
        void Promise.resolve(
          context.registerTool(tool, { signal: lifecycle.signal }),
        ).catch(() => {});
      } catch {
        /* Optional browser feature. */
      }
    };
    register({
      name: 'get_study_progress',
      description: 'Read the current practice and this device notebook.',
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
        notebook: notebook.current,
      }),
    });
    register({
      name: 'save_vocabulary',
      description: 'Save known words from this booklet to the device notebook.',
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
          throw new Error('Choose 1–50 known words.');
        saveEntries(
          words.map((word) => ({
            id: `word-${normalizeWord(word)}`,
            kind: 'word',
            title: normalizeWord(word),
            en: '',
            ja: dictionary[normalizeWord(word)],
            createdAt: Date.now(),
          })),
        );
        return {
          savedWords: notebook.current
            .filter((entry) => entry.kind === 'word')
            .map((entry) => entry.title),
        };
      },
    });
    return () => lifecycle.abort();
  }, []);

  function renderText(
    unit: Sentence,
    options: { className?: string; onRead?: () => void } = {},
  ) {
    return (
      <GuideRegion
        anchor={unit.id}
        target={target}
        annotation={annotation}
        className="text-region"
      >
        <TouchText {...unit} {...options} />
      </GuideRegion>
    );
  }

  function renderQuestion(index: number) {
    const q = QUESTIONS[index],
      graded = run.grades[index] !== null,
      revealed = !showGuide && (graded || run.phase === 'finished');
    const choice = showGuide
      ? guide.stage === 'answer-feedback'
        ? (guide.answerOption ?? practiceChoice)
        : practiceChoice
      : run.choices[index];
    const locked =
      peekQuestion !== null ||
      (showGuide
        ? guide.stage !== 'answer'
        : graded || run.phase === 'finished');
    return (
      <section className="question-block" key={index}>
        <GuideRegion
          anchor={`question-${index}`}
          target={target}
          annotation={annotation}
          className="stem-region"
        >
          <div className="question-stem">
            <b>問{index + 1}</b>
            {renderText({ id: `q${index}`, en: q.en, ja: q.ja })}
            <span
              className={`answer-box ${revealed ? (run.grades[index] ? 'correct-mark' : 'wrong-mark') : ''}`}
            >
              {index + 1}
            </span>
          </div>
        </GuideRegion>
        {showGuide && guide.stage.startsWith('answer') && (
          <aside className="answer-reference">
            <div>
              <span className="reference-number">3</span>
              <strong>見つけた根拠</strong>
              <Button
                variant="ghost"
                onClick={() => {
                  setTool('read');
                  turn(0, q.evidence);
                }}
              >
                本文で確認
                <ArrowRight size={14} />
              </Button>
            </div>
            <span lang="en">{getUnit(q.evidence)!.en}</span>
            <p>{GUIDE_CONTENT[index].summary}</p>
          </aside>
        )}
        <GuideRegion
          anchor={`choices-${index}`}
          target={target}
          annotation={annotation}
          className="choices-region"
        >
          <RadioGroup
            className="choices"
            value={choice < 0 ? '' : String(choice)}
            aria-label={`問${index + 1}の選択肢`}
            onValueChange={(value) => {
              if (value !== null) choose(index, Number(value));
            }}
            disabled={locked || mode !== 'read'}
          >
            {q.choices.map(([en, ja], option) => (
              <div
                className={`choice-row ${choice === option ? 'choice-selected' : ''} ${run.eliminated[index].includes(option) ? 'eliminated' : ''} ${revealed && q.answer === option ? 'answer-correct' : ''}`}
                key={option}
              >
                <div className="number-wrap">
                  <RadioGroupItem
                    value={String(option)}
                    className="choice-radio"
                    aria-label={`選択肢${option + 1}`}
                    disabled={run.eliminated[index].includes(option)}
                  />
                  <span aria-hidden="true">{option + 1}</span>
                </div>
                {renderText(
                  { id: `q${index}o${option}`, en, ja },
                  {
                    onRead: () => {
                      if (!locked) choose(index, option);
                    },
                  },
                )}
                {!showGuide && !locked && (
                  <Button
                    variant="ghost"
                    className="eliminate-button"
                    aria-label={`選択肢${option + 1}を${run.eliminated[index].includes(option) ? '戻す' : '消す'}`}
                    onClick={() =>
                      setRun((previous) =>
                        runReducer(previous, {
                          type: 'eliminate',
                          question: index,
                          option,
                        }),
                      )
                    }
                  >
                    {run.eliminated[index].includes(option) ? (
                      <RotateCcw size={15} />
                    ) : (
                      '／'
                    )}
                  </Button>
                )}
              </div>
            ))}
          </RadioGroup>
        </GuideRegion>
        {!showGuide && (
          <Button
            className="evidence-link"
            variant="ghost"
            onClick={() => {
              setActiveQuestion(index);
              setCompare(true);
              setTool(graded || run.phase === 'finished' ? 'read' : 'ink');
              turn(0);
            }}
          >
            <PencilLine size={16} />
            {revealed ? '本文で根拠を見比べる' : '本文で根拠をなぞる'}
            <ArrowRight size={16} />
          </Button>
        )}
        {revealed && (
          <p className="teacher-note">
            <b>{run.grades[index] ? '正解' : `正解は ${q.answer + 1}`}</b>
            {q.explanation}
          </p>
        )}
        {!showGuide && !locked && run.choices[index] >= 0 && (
          <Button className="grade-button" onClick={() => submit(index)}>
            問{index + 1}を確定
            <Check size={16} />
          </Button>
        )}
      </section>
    );
  }
  const title =
    drawer?.kind === 'word'
      ? drawer.entry.title
      : drawer?.kind === 'results'
        ? '今回の整理'
        : '自分の攻略ノート';
  const filters = [
    { id: 'note', label: '整理' },
    { id: 'word', label: '単語' },
    { id: 'sentence', label: '文' },
    { id: 'knowledge', label: '次に確認' },
  ] as const;
  const correctUnit =
    review ||
    (!showGuide && (run.grades[question] !== null || run.phase === 'finished'))
      ? QUESTIONS[question].evidence
      : null;

  return (
    <TextToolsContext.Provider
      value={{
        mode,
        marks: marks
          .filter((mark) => mark.question === question)
          .flatMap((mark) => mark.ranges),
        draft,
        fullTranslation: review && fullTranslation,
        translated,
        stocked,
        correctUnit,
        onDraft: setDraft,
        onTrace,
        onWord: lookup,
        onTranslate: translate,
      }}
    >
      <main className={`exam-app tool-${mode} ${review ? 'review-mode' : ''}`}>
        <header className="app-header">
          <div className="app-name">
            攻略ノート<small>英語・リーディング</small>
          </div>
          <div className="session-clock">
            <small>
              {review
                ? '復習'
                : guided
                  ? 'ガイド中・時計停止'
                  : drawer
                    ? '一時停止'
                    : '残り時間'}
            </small>
            {guided || review
              ? `${run.grades.filter((value) => value !== null).length} / 3 問`
              : formatTime(run.remainingMs)}
          </div>
          <Button
            variant="ghost"
            className="notebook-button"
            onClick={() => openNotebook()}
            aria-label={`攻略ノート ${entries.length}件`}
          >
            <BookMarked size={21} />
            <span>{entries.length}</span>
          </Button>
        </header>
        <div className="paper-scroll" ref={scroll} data-paper-scroll>
          <div className="paper-meta">
            <span>
              {showGuide
                ? page === 0
                  ? '本文ページ'
                  : '設問・選択肢ページ'
                : review
                  ? '全訳・音声で復習'
                  : '3分で3問に挑戦'}
            </span>
            <span>
              {showGuide ? `問${question + 1} / 3` : `${score} / 6 点`}
            </span>
          </div>
          {review && (
            <section className="review-options">
              <label>
                全訳を表示
                <Switch
                  checked={fullTranslation}
                  onCheckedChange={setFullTranslation}
                />
              </label>
              <span>英文の下に日本語を表示</span>
            </section>
          )}
          {page === 0 && !showGuide && (
            <section className="evidence-picker">
              <span>
                <PencilLine size={15} />
                {review ? '根拠を見比べる' : '線を引く設問'}
              </span>
              <div>
                {QUESTIONS.map((_, i) => (
                  <Button
                    variant="ghost"
                    key={i}
                    className={i === question ? 'active' : ''}
                    onClick={() => setActiveQuestion(i)}
                  >
                    問{i + 1}
                  </Button>
                ))}
              </div>
            </section>
          )}
          <article className="exam-sheet" key={page}>
            <h1>英語（リーディング）</h1>
            <div className="exam-heading">
              <b>第1問</b>
              <span>（配点 6）</span>
            </div>
            {page === 0 ? (
              <>
                {renderText(INTRO, { className: 'exam-intro' })}
                <GuideRegion
                  anchor="passage"
                  target={target}
                  annotation={annotation}
                  className="passage-region"
                >
                  {showGuide && guide.stage === 'find' && (
                    <p className="passage-search">
                      <span>問{question + 1}で探すこと</span>
                      {currentGuide.search}
                    </p>
                  )}
                  <section className="notice">
                    <h2>
                      {renderText({
                        id: 'title',
                        en: 'Night at the Museum',
                        ja: '夜の博物館',
                      })}
                    </h2>
                    {PASSAGE.map((section, index) => (
                      <div key={index}>
                        {section.title && (
                          <h3>
                            {renderText({
                              id: `heading${index}`,
                              en: section.title,
                              ja: section.titleJa!,
                            })}
                          </h3>
                        )}
                        {section.sentences.map((sentence) => (
                          <div key={sentence.id}>
                            {renderText(sentence, {
                              className: `passage-sentence ${listening !== null && SENTENCES[listening].id === sentence.id ? 'sentence-playing' : ''}`,
                              onRead: review
                                ? () =>
                                    player.current?.playSentence(
                                      SENTENCES.findIndex(
                                        (item) => item.id === sentence.id,
                                      ),
                                    )
                                : undefined,
                            })}
                          </div>
                        ))}
                      </div>
                    ))}
                  </section>
                </GuideRegion>
                <p className="paper-instruction">
                  {MODES.find((tool) => tool.id === mode)!.help}
                </p>
              </>
            ) : peekQuestion !== null ? (
              renderQuestion(peekQuestion)
            ) : showGuide ? (
              renderQuestion(question)
            ) : (
              QUESTIONS.map((_, index) => renderQuestion(index))
            )}
            <footer className="paper-footer">
              <span>― {page + 1} ―</span>
              <small>練習問題 01</small>
            </footer>
            <Button
              variant="ghost"
              className="page-corner"
              aria-label={page === 0 ? '設問へめくる' : '本文へ戻る'}
              onClick={() => turn(page === 0 ? 1 : 0)}
            >
              {page === 0 ? <ArrowRight /> : <ArrowLeft />}
            </Button>
          </article>
          {compare && page === 0 && !showGuide && (
            <aside className="comparison-sheet">
              <div className="comparison-header">
                <span>本文と設問を見比べる</span>
                <Button
                  variant="ghost"
                  aria-label="挟んだ設問を閉じる"
                  onClick={() => setCompare(false)}
                >
                  <X size={18} />
                </Button>
              </div>
              {renderQuestion(question)}
            </aside>
          )}
          {run.phase === 'finished' && !showGuide && !review && (
            <section className="run-result">
              <strong>{score} / 6 点</strong>
              <p>解答と根拠を見比べて、次の一周へ。</p>
              <Button onClick={startReview}>
                <Headphones />
                全訳・音声で復習
              </Button>
              <Button variant="outline" onClick={restart}>
                もう一度解く
              </Button>
            </section>
          )}
          <div className="notebook-invite">
            <BookMarked size={17} />
            <span>整理メモ・単語・文・次に確認すること</span>
            <Button variant="ghost" onClick={() => openNotebook()}>
              ノートを見る
            </Button>
          </div>
          <p className="app-caption">
            オリジナル演習問題 ·
            共通テストの得点や偏差値を推定するものではありません
          </p>
        </div>
        <div className="bottom-workspace">
          {notice && (
            <div className="action-message" role="status">
              <span>{notice.text}</span>
              {notice.undo && (
                <Button variant="ghost" onClick={notice.undo}>
                  取り消す
                </Button>
              )}
              <Button
                variant="ghost"
                aria-label="通知を閉じる"
                onClick={() => setNotice(null)}
              >
                <X size={15} />
              </Button>
            </div>
          )}
          {review ? (
            <div className="review-dock">
              <ReviewPlayer
                ref={player}
                suspended={drawer !== null || page !== 0 || mode !== 'read'}
                onSentenceChange={setListening}
                onPlay={() => {
                  setMode('read');
                  if (page !== 0) turn(0);
                }}
              />
              <Button
                variant="ghost"
                className="review-exit"
                onClick={() => {
                  player.current?.pause();
                  setReview(false);
                  setListening(null);
                }}
              >
                解答へ戻る
              </Button>
            </div>
          ) : peekQuestion !== null ? (
            <div className="peek-guide">
              <span>
                ノートの問{peekQuestion + 1}
                を確認中。ガイドの続きは残っています。
              </span>
              <Button onClick={returnToGuide}>
                ガイドへ戻る
                <ArrowRight size={15} />
              </Button>
            </div>
          ) : showGuide ? (
            <StudyGuide
              state={guide}
              target={target}
              location={targetLocation}
              mode={mode}
              selectedOption={selected}
              nextQuestion={run.grades.findIndex(
                (grade, index) => grade === null && index !== question,
              )}
              onNext={advance}
              onSubmit={() => submit()}
              onTarget={() => showTarget()}
              onFind={findEvidence}
            />
          ) : (
            <div className="free-action">
              <span>
                {run.combo > 1
                  ? `${run.combo}問連続正解`
                  : run.phase === 'ready'
                    ? '設問を先に見るのもOK'
                    : run.phase === 'finished'
                      ? '演習終了'
                      : '根拠を探して、解答を確定しよう'}
              </span>
              <Button
                onClick={() => {
                  if (run.phase === 'ready')
                    setRun((previous) =>
                      runReducer(previous, { type: 'start' }),
                    );
                  else if (run.phase === 'finished') startReview();
                  else if (
                    run.choices[question] >= 0 &&
                    run.grades[question] === null
                  )
                    submit();
                  else turn(page === 0 ? 1 : 0);
                }}
              >
                {run.phase === 'ready'
                  ? '演習を始める'
                  : run.phase === 'finished'
                    ? '復習する'
                    : run.choices[question] >= 0 &&
                        run.grades[question] === null
                      ? `問${question + 1}を確定`
                      : page === 0
                        ? '設問を見る'
                        : '本文を見る'}
                <ArrowRight size={16} />
              </Button>
            </div>
          )}
          <div className="thumb-navigation">
            <nav aria-label="問題冊子のページ">
              <Button
                variant="ghost"
                aria-current={page === 0 ? 'page' : undefined}
                onClick={() => turn(0)}
              >
                <ArrowLeft size={15} />
                本文
              </Button>
              <Button
                variant="ghost"
                aria-current={page === 1 ? 'page' : undefined}
                onClick={() => turn(1)}
              >
                設問
                <ArrowRight size={15} />
              </Button>
            </nav>
            <label className="guide-switch">
              <Compass size={16} />
              ガイド
              <Switch
                checked={guided}
                onCheckedChange={toggleGuide}
                disabled={review}
              />
            </label>
            {mode === 'ink' && (
              <Button
                variant="ghost"
                className="undo-ink"
                aria-label="最後の線を取り消す"
                disabled={
                  !marks.some((mark) => mark.question === question) ||
                  run.grades[question] !== null ||
                  run.phase === 'finished'
                }
                onClick={undoInk}
              >
                <RotateCcw size={17} />
              </Button>
            )}
          </div>
          <RadioGroup
            className="tool-dock"
            value={mode}
            onValueChange={(value) => {
              if (value) setTool(value as ToolMode);
            }}
            aria-label="指で操作するモード"
          >
            {MODES.map((tool) => (
              <label
                htmlFor={`tool-${tool.id}`}
                className={mode === tool.id ? 'active-tool' : ''}
                key={tool.id}
              >
                <RadioGroupItem
                  id={`tool-${tool.id}`}
                  value={tool.id}
                  className="sr-only"
                />
                <tool.icon size={20} />
                <span>{tool.label}</span>
              </label>
            ))}
          </RadioGroup>
        </div>
        <Sheet
          open={drawer !== null}
          onOpenChange={(open) => {
            if (!open) setDrawer(null);
          }}
        >
          <SheetContent
            side="bottom"
            showCloseButton={false}
            className="study-drawer"
          >
            <div className="drawer-handle" />
            <div className="drawer-heading">
              <SheetTitle>{title}</SheetTitle>
              <Button
                variant="ghost"
                aria-label="ノートを閉じる"
                onClick={() => setDrawer(null)}
              >
                <X size={21} />
              </Button>
            </div>
            <SheetDescription>
              {drawer?.kind === 'word'
                ? 'タップした単語の意味。文と一緒に残せます。'
                : storageAvailable
                  ? 'この端末に保存。ガイドを切っても残ります。'
                  : 'このブラウザーでは、開いている間だけ保存されます。'}
            </SheetDescription>
            {drawer?.kind === 'notebook' && (
              <RadioGroup
                className="notebook-tabs"
                value={drawer.filter}
                onValueChange={(value) => {
                  if (value)
                    setDrawer({
                      kind: 'notebook',
                      filter: value as NotebookEntry['kind'],
                    });
                }}
                aria-label="ノートの種類"
              >
                {filters.map((filter) => (
                  <label
                    key={filter.id}
                    htmlFor={`filter-${filter.id}`}
                    className={drawer.filter === filter.id ? 'active' : ''}
                  >
                    <RadioGroupItem
                      className="sr-only"
                      id={`filter-${filter.id}`}
                      value={filter.id}
                    />
                    {filter.label}
                    <small>
                      {
                        entries.filter((entry) => entry.kind === filter.id)
                          .length
                      }
                    </small>
                  </label>
                ))}
              </RadioGroup>
            )}
            <div className="drawer-scroll">
              {drawer?.kind === 'word' ? (
                <>
                  <p className="dictionary-meaning">{drawer.entry.ja}</p>
                  <p className="dictionary-context" lang="en">
                    {drawer.entry.en}
                  </p>
                  <Button
                    className="save-word-button"
                    onClick={() => {
                      saveEntries(
                        [drawer.entry],
                        '単語を例文と一緒に保存したよ。',
                      );
                      tone();
                      setDrawer(null);
                    }}
                  >
                    {entries.some((entry) => entry.id === drawer.entry.id) ? (
                      <>
                        <Check />
                        保存済み・閉じる
                      </>
                    ) : (
                      <>
                        <BookmarkPlus />
                        単語をストック
                      </>
                    )}
                  </Button>
                </>
              ) : drawer?.kind === 'results' ? (
                <>
                  <div className="result-score">
                    <strong>
                      {score}
                      <small> / 6点</small>
                    </strong>
                    <span>最初に選んだ解答の得点</span>
                  </div>
                  {QUESTIONS.map((q, i) => (
                    <div className="result-line" key={i}>
                      <span>
                        {run.grades[i] === null
                          ? '—'
                          : run.grades[i]
                            ? '○'
                            : '×'}
                      </span>
                      <div>
                        <b>
                          問{i + 1}　{q.skill}
                        </b>
                        <p>{GUIDE_CONTENT[i].summary}</p>
                      </div>
                    </div>
                  ))}
                  <p className="storage-note">
                    ガイドありでは、時間を気にせず解き方を練習できます。確認し直した内容はノートに残っています。
                  </p>
                  <Button className="save-word-button" onClick={startReview}>
                    <Headphones />
                    全訳・音声で復習
                  </Button>
                  <Button
                    variant="ghost"
                    className="save-word-button"
                    onClick={() => openNotebook()}
                  >
                    整理ノートを見る
                  </Button>
                  <Button
                    variant="outline"
                    className="save-word-button"
                    onClick={restart}
                  >
                    もう一度解く
                  </Button>
                </>
              ) : drawer?.kind === 'notebook' ? (
                <>
                  {entries.filter((entry) => entry.kind === drawer.filter)
                    .length === 0 ? (
                    <div className="empty-notebook">
                      <BookMarked size={30} />
                      <p>
                        {drawer.filter === 'word'
                          ? '「単語」に切り替えて、英文の単語をタップ。'
                          : drawer.filter === 'sentence'
                            ? '「文ストック」で、訳せなかった部分をなぞろう。文全体と日本語訳がここに残ります。'
                            : drawer.filter === 'knowledge'
                              ? '迷ったところ・取り違えた情報が、次に確認することとして残ります。'
                              : 'ガイドで解き進めると、場面・探すこと・根拠が日本語でまとまります。'}
                      </p>
                    </div>
                  ) : (
                    entries
                      .filter((entry) => entry.kind === drawer.filter)
                      .map((entry) => (
                        <article
                          className={`notebook-entry entry-${entry.kind}`}
                          key={entry.id}
                        >
                          <small>{entry.title}</small>
                          {entry.en && <p lang="en">{entry.en}</p>}
                          <strong>{entry.ja}</strong>
                          {entry.excerpt && (
                            <div className="saved-excerpt">
                              なぞった部分：
                              <span lang="en">{entry.excerpt}</span>
                            </div>
                          )}
                          {entry.detail && (
                            <p className="entry-detail">{entry.detail}</p>
                          )}
                          {entry.unit && (
                            <Button
                              variant="ghost"
                              onClick={() => {
                                viewSavedUnit(entry.unit!);
                              }}
                            >
                              冊子で見る
                              <ArrowRight size={14} />
                            </Button>
                          )}
                        </article>
                      ))
                  )}
                </>
              ) : null}
            </div>
            <div className="drawer-footer">
              <Button
                variant="ghost"
                aria-label={sound ? '効果音をオフ' : '効果音をオン'}
                onClick={() => setSound(!sound)}
              >
                {sound ? <Volume2 size={17} /> : <VolumeX size={17} />}効果音{' '}
                {sound ? 'ON' : 'OFF'}
              </Button>
              <Button variant="outline" onClick={() => setDrawer(null)}>
                冊子に戻る
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      </main>
    </TextToolsContext.Provider>
  );
}
