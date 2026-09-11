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
  Menu,
  Play,
  BookOpen,
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
import { initialPlayback } from '@/lib/speech-player';
import { SessionSummary } from './session-summary';
import { NotebookList } from './notebook-list';
import { usePageSwipe } from './use-page-swipe';
import {
  BOOK_PAGES,
  adjacentPage,
  nextUnanswered,
  type StudyView,
  type ReviewKind,
} from '@/lib/study-navigation';

type Mark = {
  question: number;
  ranges: TextRange[];
  evidenceBefore: string | null;
};
type Drawer =
  | null
  | { kind: 'notebook'; filter: NotebookEntry['kind'] }
  | { kind: 'word'; entry: NotebookEntry }
  | { kind: 'tools' }
  | { kind: 'menu' };
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
    help: '左右に払ってページをめくる。単語はタップ、解答は左の□にチェック。',
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
  const [view, setView] = useState<StudyView>('study');
  const [reviewKind, setReviewKind] = useState<ReviewKind>('answers');
  const [notebookFilter, setNotebookFilter] =
    useState<NotebookEntry['kind']>('note');
  const review = view === 'review';
  const [fullTranslation, setFullTranslation] = useState(true);
  const [translated, setTranslated] = useState<Set<string>>(new Set());
  const [marks, setMarks] = useState<Mark[]>([]);
  const [draft, setDraft] = useState<TextRange[]>([]);
  const [entries, setEntries] = useState<NotebookEntry[]>([]);
  const [storageAvailable, setStorageAvailable] = useState(true);
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [listening, setListening] = useState<number | null>(null);
  const [sound, setSound] = useState(false);
  const [audioCheckpoint, setAudioCheckpoint] = useState(initialPlayback);
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
  const returnPoint = useRef({
    page: 0,
    question: 0,
    mode: 'read' as ToolMode,
    top: 0,
    compare: false,
    peek: null as number | null,
    translated: new Set<string>(),
  });
  const pageOffsets = useRef<Record<string, number>>({});
  const pageSpace = review ? `review:${reviewKind}` : 'study';
  const restoring = useRef(false);
  const turnDirection = useRef(1);
  useLayoutEffect(() => {
    notebook.current = entries;
    runRef.current = run;
  });
  const question =
    peekQuestion ??
    (guided && view === 'study'
      ? guide.question
      : page > 0
        ? page - 1
        : activeQuestion);
  const showGuide = guided && view === 'study' && peekQuestion === null;
  const swipe = usePageSwipe(
    view !== 'summary' &&
      mode === 'read' &&
      drawer === null &&
      !(review && reviewKind === 'notebook'),
    (direction) => {
      const next = adjacentPage(page, direction);
      if (next !== page) turn(next);
      else
        announce(
          page === 0
            ? '最初のページです。左に払うと問1へ。'
            : '最後のページです。下のボタンから結果・復習へ進めます。',
        );
    },
  );
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
    if (run.phase !== 'playing' || guided || drawer || view !== 'study') return;
    let last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      setRun((previous) =>
        runReducer(previous, { type: 'tick', elapsedMs: now - last }),
      );
      last = now;
    }, 200);
    return () => clearInterval(timer);
  }, [run.phase, guided, drawer, view]);
  useEffect(() => {
    if (listening === null || !review || page !== 0) return;
    scroll.current
      ?.querySelector<HTMLElement>(`[data-unit="${SENTENCES[listening].id}"]`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [listening, page, review]);
  useEffect(() => {
    if (run.remainingMs === 0 && view === 'study') showSummary();
  }, [run.remainingMs, view]);

  useLayoutEffect(() => {
    if (restoring.current) {
      restoring.current = false;
      return;
    }
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

  function turn(next: number, target?: string, space = pageSpace) {
    player.current?.pause();
    // Capture before the new page can clamp scrollTop and emit a scroll event.
    const savedTop = pageOffsets.current[`${space}:${next}`] ?? 0;
    turnDirection.current = next >= page ? 1 : -1;
    setPage(next);
    if (!showGuide && next > 0) setActiveQuestion(next - 1);
    setDraft([]);
    requestAnimationFrame(() => {
      if (target)
        scroll.current
          ?.querySelector<HTMLElement>(`[data-unit="${target}"]`)
          ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      else
        scroll.current?.scrollTo({
          top: savedTop,
          behavior: 'auto',
        });
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
  function capturePlace() {
    if (view === 'study')
      returnPoint.current = {
        page,
        question: activeQuestion,
        mode,
        top: scroll.current?.scrollTop ?? 0,
        compare,
        peek: peekQuestion,
        translated: new Set(translated),
      };
  }
  function showSummary() {
    capturePlace();
    player.current?.pause();
    setListening(null);
    setDraft([]);
    setDrawer(null);
    setView('summary');
    setMode('read');
  }
  function resumeStudy() {
    if (run.phase === 'finished') return;
    const saved = returnPoint.current;
    player.current?.pause();
    setListening(null);
    setDrawer(null);
    restoring.current = guided && saved.peek === null;
    setView('study');
    setPage(saved.page);
    setActiveQuestion(saved.question);
    setMode(saved.mode);
    setCompare(saved.compare);
    setPeekQuestion(saved.peek);
    setTranslated(new Set(saved.translated));
    requestAnimationFrame(() =>
      scroll.current?.scrollTo({ top: saved.top, behavior: 'auto' }),
    );
  }
  function changeReview(kind: ReviewKind, index = activeQuestion) {
    player.current?.pause();
    setListening(null);
    setMode('read');
    setReviewKind(kind);
    setActiveQuestion(index);
    setFullTranslation(kind !== 'answers');
    setCompare(false);
    setDrawer(null);
    turn(kind === 'answers' ? index + 1 : 0, undefined, `review:${kind}`);
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
    if (view === 'study')
      setRun((previous) =>
        runReducer(previous, { type: 'hint', sentence: unit }),
      );
    setMode('read');
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
      setMode('read');
      return;
    }
    if (mode !== 'ink') return;
    if (view !== 'study') {
      setMode('read');
      return;
    }
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
    setMode('read');
    tone();
  }
  function undoInk() {
    const lastIndex = marks.findLastIndex((mark) => mark.question === question);
    if (
      view !== 'study' ||
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
    if (view !== 'study') return;
    if (mode !== 'read') {
      announce('書き込みをキャンセルしてから、左の□にチェックしよう。');
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
    if (view !== 'study') return;
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
      showSummary();
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
    const next = nextGuide(
      guide.stage === 'answer-feedback' ? { ...guide, match: true } : guide,
      run.grades,
    );
    setGuide(next);
    setActiveQuestion(next.question);
    if (next.stage === 'question' || next.stage === 'answer') {
      setTool('read');
      setPracticeChoice(-1);
    }
    if (next.stage === 'find') setTool('ink');
    if (next.stage === 'done') {
      setTool('read');
      showSummary();
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
    if (review) {
      setReviewKind('translation');
      setFullTranslation(true);
    }
    turn(
      target ? Number(target[1]) + 1 : 0,
      unit,
      review ? 'review:translation' : 'study',
    );
  }
  function startReview(kind: ReviewKind = 'answers', index = question) {
    capturePlace();
    setPeekQuestion(null);
    setView('review');
    changeReview(kind, index);
  }
  function restart() {
    setPeekQuestion(null);
    player.current?.pause();
    setRun(createRun(QUESTIONS.map((q) => q.answer)));
    setGuide(createGuide());
    setPracticeChoice(-1);
    setActiveQuestion(0);
    restoring.current = false;
    setView('study');
    setMarks([]);
    setDraft([]);
    setTranslated(new Set());
    setDrawer(null);
    setMode('read');
    setCompare(false);
    setListening(null);
    setAudioCheckpoint(initialPlayback());
    pageOffsets.current = {};
    turn(0);
  }
  function nextQuestion() {
    const next = nextUnanswered(run.grades, question);
    if (next < 0 || run.phase === 'finished') showSummary();
    else {
      setActiveQuestion(next);
      setMode('read');
      turn(next + 1);
    }
  }
  function retryGuideAnswer() {
    setGuide({ ...guide, stage: 'answer', message: '' });
    setPracticeChoice(-1);
    setMode('read');
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

  function renderText(unit: Sentence, options: { className?: string } = {}) {
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
      revealed = review || (!showGuide && (graded || run.phase === 'finished'));
    const choice =
      showGuide && index === guide.question
        ? guide.stage === 'answer-feedback'
          ? (guide.answerOption ?? practiceChoice)
          : practiceChoice
        : run.choices[index];
    const locked =
      review ||
      peekQuestion !== null ||
      (showGuide
        ? guide.stage !== 'answer' || index !== guide.question
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
              className={`answer-box ${revealed && graded ? (run.grades[index] ? 'correct-mark' : 'wrong-mark') : ''}`}
            >
              {index + 1}
            </span>
          </div>
        </GuideRegion>
        {showGuide &&
          index === guide.question &&
          guide.stage.startsWith('answer') && (
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
                    aria-label={`選択肢${option + 1}にチェック`}
                    disabled={run.eliminated[index].includes(option)}
                  />
                  <small className="choice-index" aria-hidden="true">
                    {option + 1}
                  </small>
                  <span aria-hidden="true">
                    {choice === option && <Check size={18} strokeWidth={3} />}
                  </span>
                </div>
                {renderText({ id: `q${index}o${option}`, en, ja })}
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
              setTool(
                review || graded || run.phase === 'finished' ? 'read' : 'ink',
              );
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
            <b>
              {run.grades[index] === null
                ? `未回答 · 正解は ${q.answer + 1}`
                : run.grades[index]
                  ? '正解'
                  : `正解は ${q.answer + 1}`}
            </b>
            {q.explanation}
          </p>
        )}
      </section>
    );
  }
  const title =
    drawer?.kind === 'word'
      ? drawer.entry.title
      : drawer?.kind === 'tools'
        ? '紙面に書き込む'
        : drawer?.kind === 'menu'
          ? '続け方を選ぶ'
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
          {view === 'study' ? (
            <Button
              variant="ghost"
              className="header-menu"
              onClick={() => {
                player.current?.pause();
                setDrawer({ kind: 'menu' });
              }}
            >
              <Menu size={19} />
              中断
            </Button>
          ) : review ? (
            <Button
              variant="ghost"
              className="header-menu"
              onClick={showSummary}
            >
              <ArrowLeft size={18} />
              結果
            </Button>
          ) : (
            <BookOpen size={23} />
          )}
          <div className="app-name">
            {view === 'study' ? '問題冊子' : review ? '復習' : '学習記録'}
            <small>英語・リーディング</small>
          </div>
          <div className="session-clock">
            <small>
              {view !== 'study' || drawer
                ? '時計停止'
                : guided
                  ? 'ガイドあり'
                  : '残り時間'}
            </small>
            {guided || view !== 'study'
              ? `${run.grades.filter((value) => value !== null).length} / 3 問`
              : formatTime(run.remainingMs)}
          </div>
          <Button
            variant="ghost"
            className="notebook-button"
            onClick={() =>
              view === 'study' ? openNotebook() : startReview('notebook')
            }
            aria-label={`攻略ノート ${entries.length}件`}
          >
            <BookMarked size={21} />
            <span>{entries.length}</span>
          </Button>
        </header>
        {view === 'summary' ? (
          <SessionSummary
            run={run}
            onResume={resumeStudy}
            onRestart={restart}
            onReview={startReview}
          />
        ) : (
          <>
            {review && (
              <nav className="review-navigation" aria-label="復習の種類">
                {[
                  { id: 'answers', label: '解説', icon: BookOpen },
                  { id: 'translation', label: '全訳', icon: Languages },
                  { id: 'audio', label: '音声・音読', icon: Headphones },
                  { id: 'notebook', label: 'ノート', icon: BookMarked },
                ].map((item) => (
                  <Button
                    key={item.id}
                    variant="ghost"
                    aria-current={reviewKind === item.id ? 'page' : undefined}
                    onClick={() => changeReview(item.id as ReviewKind)}
                  >
                    <item.icon size={18} />
                    {item.label}
                  </Button>
                ))}
              </nav>
            )}
            <div
              className={`paper-scroll ${swipe.drag ? 'is-swiping' : ''}`}
              ref={scroll}
              data-paper-scroll
              onScroll={() => {
                if (scroll.current)
                  pageOffsets.current[`${pageSpace}:${page}`] =
                    scroll.current.scrollTop;
              }}
              {...swipe.handlers}
            >
              {review && reviewKind === 'notebook' ? (
                <div className="review-notebook">
                  <div
                    className="notebook-filter-buttons"
                    aria-label="ノートの種類"
                  >
                    {filters.map((filter) => (
                      <Button
                        key={filter.id}
                        variant="ghost"
                        aria-pressed={notebookFilter === filter.id}
                        onClick={() => setNotebookFilter(filter.id)}
                      >
                        {filter.label}
                      </Button>
                    ))}
                  </div>
                  <NotebookList
                    entries={entries}
                    filter={notebookFilter}
                    onView={viewSavedUnit}
                  />
                </div>
              ) : (
                <>
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
                  {review && reviewKind !== 'answers' && (
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
                  <article
                    className={`exam-sheet turn-${turnDirection.current > 0 ? 'forward' : 'back'}`}
                    key={page}
                    style={
                      swipe.drag
                        ? {
                            transform: `translateX(${swipe.drag}px) rotateY(${swipe.drag / -14}deg)`,
                            animation: 'none',
                          }
                        : undefined
                    }
                  >
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
                                    })}
                                    {review && reviewKind === 'audio' && (
                                      <Button
                                        variant="ghost"
                                        className="sentence-play"
                                        onClick={() =>
                                          player.current?.playSentence(
                                            SENTENCES.findIndex(
                                              (item) => item.id === sentence.id,
                                            ),
                                          )
                                        }
                                      >
                                        <Play size={14} />
                                        この文を聴く
                                      </Button>
                                    )}
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
                    ) : (
                      renderQuestion(page - 1)
                    )}
                    <footer className="paper-footer">
                      <span>― {page + 1} ―</span>
                      <small>練習問題 01</small>
                    </footer>
                    <Button
                      variant="ghost"
                      className="page-corner"
                      aria-label={
                        page < 3
                          ? `${BOOK_PAGES[page + 1]}へめくる`
                          : '前のページへ'
                      }
                      onClick={() =>
                        turn(adjacentPage(page, page < 3 ? 1 : -1))
                      }
                    >
                      {page < 3 ? <ArrowRight /> : <ArrowLeft />}
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
                </>
              )}
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
                    <X size={16} />
                  </Button>
                </div>
              )}
              {review ? (
                <>
                  {reviewKind === 'audio' && (
                    <div className="review-dock">
                      <ReviewPlayer
                        ref={player}
                        checkpoint={audioCheckpoint}
                        onCheckpoint={setAudioCheckpoint}
                        suspended={
                          drawer !== null || page !== 0 || mode !== 'read'
                        }
                        onSentenceChange={setListening}
                        onPlay={() => {
                          setMode('read');
                          if (page !== 0) turn(0);
                        }}
                      />
                    </div>
                  )}
                  <div className="review-return">
                    <Button variant="outline" onClick={showSummary}>
                      <ArrowLeft size={16} />
                      結果へ戻る
                    </Button>
                    <Button
                      onClick={run.phase === 'finished' ? restart : resumeStudy}
                    >
                      {run.phase === 'finished' ? 'もう一度挑戦' : '解答を再開'}
                      <ArrowRight size={16} />
                    </Button>
                  </div>
                </>
              ) : peekQuestion !== null ? (
                <div className="peek-guide">
                  <span>保存した問{peekQuestion + 1}を確認中</span>
                  <Button onClick={returnToGuide}>
                    ガイドに戻る
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
                  onRetry={retryGuideAnswer}
                  onReview={() => startReview('answers', question)}
                />
              ) : (
                <div className="free-study-action">
                  <strong>
                    {run.phase === 'finished'
                      ? '解答が終わりました'
                      : run.grades[question] !== null
                        ? `問${question + 1} ${run.grades[question] ? '正解！' : '解説を確認しよう'}`
                        : run.phase === 'ready'
                          ? '左の□にチェックして答えよう'
                          : `問${question + 1} · ${run.choices[question] >= 0 ? `選択肢 ${run.choices[question] + 1} を選択中` : '答えを1つ選ぼう'}`}
                  </strong>
                  <Button
                    onClick={() => {
                      if (run.phase === 'finished') showSummary();
                      else if (run.grades[question] !== null) nextQuestion();
                      else if (run.choices[question] >= 0) submit();
                      else if (run.phase === 'ready') {
                        setRun((previous) =>
                          runReducer(previous, { type: 'start' }),
                        );
                        turn(question + 1);
                      } else turn(question + 1);
                    }}
                    disabled={
                      run.phase === 'playing' &&
                      run.grades[question] === null &&
                      run.choices[question] < 0 &&
                      page > 0
                    }
                  >
                    {run.phase === 'finished'
                      ? '結果・復習へ進む'
                      : run.grades[question] !== null
                        ? '次の問へ'
                        : run.choices[question] >= 0
                          ? '解答をチェック'
                          : run.phase === 'ready'
                            ? '演習を始める'
                            : '左の□にチェック'}
                    <ArrowRight size={17} />
                  </Button>
                  {run.grades[question] !== null && (
                    <Button
                      variant="ghost"
                      onClick={() => startReview('answers', question)}
                    >
                      この問を復習
                    </Button>
                  )}
                </div>
              )}
              {!(review && reviewKind === 'notebook') && (
                <>
                  <div
                    className={`paper-utility ${mode !== 'read' ? 'using-tool' : ''}`}
                  >
                    <span>
                      {mode === 'ink'
                        ? '1回なぞると線を引きます'
                        : mode === 'stock'
                          ? 'なぞった文を対訳と保存'
                          : mode === 'translate'
                            ? '訳を見る文をタップ'
                            : '単語はタップで意味を確認'}
                    </span>
                    {mode !== 'read' ? (
                      <Button variant="outline" onClick={() => setTool('read')}>
                        キャンセル
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        onClick={() => {
                          player.current?.pause();
                          setDrawer({ kind: 'tools' });
                        }}
                      >
                        <PencilLine size={16} />
                        書き込む
                      </Button>
                    )}
                    {view === 'study' && (
                      <Button
                        variant="ghost"
                        className="help-exit"
                        onClick={() => {
                          player.current?.pause();
                          setDrawer({ kind: 'menu' });
                        }}
                      >
                        わからない・中断
                      </Button>
                    )}
                  </div>
                  <nav className="book-pager" aria-label="問題冊子のページ">
                    <Button
                      variant="ghost"
                      disabled={page === 0}
                      aria-label="前のページ"
                      onClick={() => {
                        setTool('read');
                        turn(adjacentPage(page, -1));
                      }}
                    >
                      <ArrowLeft size={19} />
                    </Button>
                    <span>
                      <strong>
                        {BOOK_PAGES[page]}{' '}
                        <small>
                          {page + 1} / {BOOK_PAGES.length}
                        </small>
                      </strong>
                      <small>左右にスワイプでめくる</small>
                    </span>
                    <Button
                      variant="ghost"
                      disabled={page === BOOK_PAGES.length - 1}
                      aria-label="次のページ"
                      onClick={() => {
                        setTool('read');
                        turn(adjacentPage(page, 1));
                      }}
                    >
                      <ArrowRight size={19} />
                    </Button>
                  </nav>
                </>
              )}
            </div>
          </>
        )}
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
                aria-label="パネルを閉じる"
                onClick={() => setDrawer(null)}
              >
                <X size={21} />
              </Button>
            </div>
            <SheetDescription>
              {drawer?.kind === 'word'
                ? 'タップした単語の意味。文と一緒に残せます。'
                : drawer?.kind === 'tools'
                  ? '1回使うと、いつものタップ・ページめくりに戻ります。'
                  : drawer?.kind === 'menu'
                    ? '今は時計を止めています。問題と下線は残ります。'
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
              ) : drawer?.kind === 'tools' ? (
                <div className="sheet-action-list">
                  {[
                    {
                      id: 'ink',
                      icon: PencilLine,
                      label: '線を引く',
                      help: '大事な部分を1回なぞる',
                    },
                    {
                      id: 'stock',
                      icon: BookmarkPlus,
                      label: '文を保存',
                      help: '訳せなかった箇所をなぞり、文全体と訳を保存',
                    },
                    {
                      id: 'translate',
                      icon: Languages,
                      label: 'この文の訳を見る',
                      help: '文をタップすると、英文の下に日本語',
                    },
                  ].map((tool) => (
                    <button
                      key={tool.id}
                      disabled={
                        tool.id === 'ink' &&
                        (review ||
                          run.phase === 'finished' ||
                          run.grades[question] !== null)
                      }
                      onClick={() => {
                        setDrawer(null);
                        setTool(tool.id as ToolMode);
                      }}
                    >
                      <tool.icon size={22} />
                      <span>
                        <strong>{tool.label}</strong>
                        <small>{tool.help}</small>
                      </span>
                      <ArrowRight size={17} />
                    </button>
                  ))}
                  <Button
                    variant="ghost"
                    onClick={() => {
                      undoInk();
                      setDrawer(null);
                    }}
                    disabled={
                      review ||
                      !marks.some((mark) => mark.question === question) ||
                      run.grades[question] !== null ||
                      run.phase === 'finished'
                    }
                  >
                    <RotateCcw size={17} />
                    直前の線を取り消す
                  </Button>
                </div>
              ) : drawer?.kind === 'menu' ? (
                <div className="sheet-action-list">
                  <button onClick={() => startReview('answers', question)}>
                    <BookOpen size={23} />
                    <span>
                      <strong>わからないので、復習する</strong>
                      <small>
                        問{question + 1}の解説へ。あとで解答に戻れます。
                      </small>
                    </span>
                    <ArrowRight size={18} />
                  </button>
                  <button onClick={showSummary}>
                    <BookMarked size={23} />
                    <span>
                      <strong>ここまでで終了する</strong>
                      <small>ここまでの結果と、復習の入口へ</small>
                    </span>
                    <ArrowRight size={18} />
                  </button>
                  <label className="menu-guide-setting">
                    <span>
                      <strong>解き方ガイド</strong>
                      <small>オンにすると時計を止めて練習</small>
                    </span>
                    <Switch
                      checked={guided}
                      onCheckedChange={toggleGuide}
                      disabled={review}
                    />
                  </label>
                  <Button
                    className="save-word-button"
                    onClick={() => setDrawer(null)}
                  >
                    そのまま解き続ける
                    <ArrowRight size={17} />
                  </Button>
                </div>
              ) : drawer?.kind === 'notebook' ? (
                <NotebookList
                  entries={entries}
                  filter={drawer.filter}
                  onView={viewSavedUnit}
                />
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
                {view === 'study'
                  ? '問題に戻る'
                  : review
                    ? '復習に戻る'
                    : '結果に戻る'}
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      </main>
    </TextToolsContext.Provider>
  );
}
