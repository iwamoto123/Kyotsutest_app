import {
  INTRO,
  PASSAGE,
  QUESTIONS,
  normalizeWord,
  type Sentence,
} from './exam-content.ts';

export type ToolMode = 'read' | 'ink' | 'stock' | 'word' | 'translate';
export type TextRange = { unit: string; from: number; to: number };
export type TextPoint = { unit: string; index: number };
export const TEXT_UNITS: Sentence[] = [
  INTRO,
  { id: 'title', en: 'Night at the Museum', ja: '夜の博物館' },
  ...PASSAGE.flatMap((section, i) => [
    ...(section.title
      ? [{ id: `heading${i}`, en: section.title, ja: section.titleJa! }]
      : []),
    ...section.sentences,
  ]),
  ...QUESTIONS.flatMap((question, i) => [
    { id: `q${i}`, en: question.en, ja: question.ja },
    ...question.choices.map(([en, ja], j) => ({ id: `q${i}o${j}`, en, ja })),
  ]),
];
export const getUnit = (id: string) =>
  TEXT_UNITS.find((unit) => unit.id === id);
export function tokenize(text: string) {
  let index = 0;
  return text
    .split(/(p\.m\.|[A-Za-zÉé]+(?:'[A-Za-z]+)?|[0-9]+)/g)
    .map((text, position) => ({ text, index: position % 2 ? index++ : -1 }));
}
export const wordCount = (text: string) =>
  tokenize(text).filter((token) => token.index >= 0).length;
export function traceRanges(
  start: TextPoint,
  end: TextPoint,
  visibleIds?: string[],
): TextRange[] {
  const units = visibleIds
    ? [...new Set(visibleIds)]
        .map(getUnit)
        .filter((unit): unit is Sentence => !!unit)
    : TEXT_UNITS;
  const a = units.findIndex((unit) => unit.id === start.unit),
    b = units.findIndex((unit) => unit.id === end.unit);
  if (
    a < 0 ||
    b < 0 ||
    !Number.isInteger(start.index) ||
    !Number.isInteger(end.index)
  )
    return [];
  if (
    start.index < 0 ||
    end.index < 0 ||
    start.index >= wordCount(units[a].en) ||
    end.index >= wordCount(units[b].en)
  )
    return [];
  const reverse = a > b || (a === b && start.index > end.index);
  const left = reverse ? end : start,
    right = reverse ? start : end;
  return units.slice(Math.min(a, b), Math.max(a, b) + 1).map((unit) => ({
    unit: unit.id,
    from: unit.id === left.unit ? left.index : 0,
    to: unit.id === right.unit ? right.index : wordCount(unit.en) - 1,
  }));
}
export const rangeText = (range: TextRange) => {
  const unit = getUnit(range.unit);
  if (!unit) return '';
  const parts = tokenize(unit.en),
    start = parts.findIndex((t) => t.index === range.from),
    end = parts.findIndex((t) => t.index === range.to);
  return start < 0 || end < start
    ? ''
    : parts
        .slice(start, end + 1)
        .map((t) => t.text)
        .join('');
};
export const containsToken = (
  ranges: TextRange[],
  unit: string,
  index: number,
) => ranges.some((r) => r.unit === unit && r.from <= index && r.to >= index);

export const GUIDE_CONTENT = [
  {
    search: '学生が無料で入るために必要なこと',
    instruction: '無料で入れる「条件」が書かれた部分を、指でなぞろう。',
    summary: '無料入館 → 学生証を見せる',
    expression: 'by showing a student ID',
    meaning: '学生証を見せることで',
    keywords: ['showing', 'id'],
    miss: 'ここは無料入館の条件かな？ students と free を目印に探そう。',
    near: 'この文にありそう！「何をすれば無料か」が分かる部分までなぞってみよう。',
    check: '入館条件と、別の案内を分ける',
    feedback: [
      '学生証を見せることが条件。by showing a student ID と一致しているね。',
      '午後6時はカフェの閉店時刻。無料で入館する条件とは別の情報だね。',
      'フォームは体験講座の予約用。入館と講座の条件を分けて確認しよう。',
      '飲み物の文は、庭で飲めるという案内。無料入館の条件は別の文にあるよ。',
    ],
  },
  {
    search: '参加枠を確保する方法と、その締切',
    instruction: '予約するには何をするか。方法と締切が分かる部分をなぞろう。',
    summary: '予約 → オンラインフォーム ／ 締切 → 木曜日まで',
    expression: 'secure a place ≒ reserve a place',
    meaning: '参加枠を確保する',
    keywords: ['form', 'thursday'],
    miss: '開始時刻や定員だけでは予約方法は分からないね。reserve の文を探そう。',
    near: '予約の文を見つけたね。フォームや締切が書かれた部分までなぞろう。',
    check: '開催日と予約締切を分ける',
    feedback: [
      '指定されているのはオンラインフォーム。電話での予約は書かれていないね。',
      'フォームへの記入と木曜日までの締切。方法も期限も一致しているね。',
      'イベントは金曜日でも、予約は木曜日まで。by Thursday を確認しよう。',
      '庭の記述は飲み物について。参加枠を取るには事前にフォームへ記入するよ。',
    ],
  },
  {
    search: '曇りの場合の開催場所',
    instruction: '曇りなら会場はどうなる？ 条件と変更後の場所をなぞろう。',
    summary: '曇りの場合 → 会場を屋内へ変更',
    expression: 'move indoors ≒ move inside',
    meaning: '屋内へ移動する',
    keywords: ['indoors'],
    miss: '場所の名前だけでなく「曇りの場合」という条件まで合っているか確認しよう。',
    near: '条件の文を見つけたね。「どこへ移るか」の部分までなぞってみよう。',
    check: '条件と変更後の場所を結びつける',
    feedback: [
      '庭は飲み物についての案内。曇りの場合の会場は条件が書かれた文で確認しよう。',
      'カフェの文は閉店時刻の案内。体験講座の会場変更とは別の情報だね。',
      'move indoors は屋内へ移ること。Inside the museum と対応しているね。',
      'indoors は屋内。望遠鏡のイメージより、曇りの場合の変更を手がかりにしよう。',
    ],
  },
];
export function inspectEvidence(question: number, ranges: TextRange[]) {
  const guide = GUIDE_CONTENT[question],
    expected = QUESTIONS[question]?.evidence;
  if (!guide || !expected) return { match: false, message: '' };
  const selected = ranges.filter((range) => range.unit === expected);
  const words = selected.flatMap((range) =>
    rangeText(range).split(/\s+/).map(normalizeWord),
  );
  const match =
    question === 1
      ? guide.keywords.every((word) => words.includes(word))
      : guide.keywords.some((word) => words.includes(word));
  return {
    match,
    message: match
      ? `そこだね！ ${guide.summary}`
      : selected.length
        ? guide.near
        : guide.miss,
  };
}
export type GuideStage =
  | 'intro'
  | 'intro-summary'
  | 'question'
  | 'question-summary'
  | 'find'
  | 'evidence-feedback'
  | 'answer'
  | 'answer-feedback'
  | 'done';
export type GuideState = {
  stage: GuideStage;
  question: number;
  match: boolean;
  message: string;
};
export const createGuide = (): GuideState => ({
  stage: 'intro',
  question: 0,
  match: false,
  message: '',
});
export function nextGuide(
  state: GuideState,
  grades?: (boolean | null)[],
): GuideState {
  const map: Partial<Record<GuideStage, GuideStage>> = {
    intro: 'intro-summary',
    'intro-summary': 'question',
    question: 'question-summary',
    'question-summary': 'find',
  };
  if (map[state.stage])
    return { ...state, stage: map[state.stage]!, message: '' };
  if (state.stage === 'evidence-feedback')
    return { ...state, stage: state.match ? 'answer' : 'find', message: '' };
  if (state.stage === 'answer-feedback') {
    if (!state.match) return { ...state, stage: 'answer', message: '' };
    const next = grades
      ? grades.findIndex(
          (grade, index) => grade === null && index !== state.question,
        )
      : state.question + 1;
    return {
      ...state,
      stage: next >= 0 && next < QUESTIONS.length ? 'question' : 'done',
      question: next >= 0 && next < QUESTIONS.length ? next : state.question,
      message: '',
    };
  }
  return state;
}
export function resumeGuide(
  state: GuideState,
  grades: (boolean | null)[],
  finished: boolean,
): GuideState {
  const first = grades.findIndex((value) => value === null);
  // An unfinished question in a finished run means time ran out. Only a
  // fully graded run may preserve the last answer's explanation or retry.
  if (finished && first >= 0) return { ...state, stage: 'done' };
  if (state.stage === 'answer' || state.stage === 'answer-feedback')
    return state;
  if (finished || first < 0) return { ...state, stage: 'done' };
  if (grades[state.question] !== null || state.stage === 'done')
    return { stage: 'question', question: first, match: false, message: '' };
  return state;
}
export type NotebookEntry = {
  id: string;
  kind: 'word' | 'sentence' | 'knowledge' | 'note';
  title: string;
  en: string;
  ja: string;
  detail?: string;
  excerpt?: string;
  unit?: string;
  createdAt: number;
};
export const NOTEBOOK_KEY = 'kyotsutest-notebook-v2';
export function parseNotebook(raw: string | null): NotebookEntry[] {
  try {
    const value: unknown = JSON.parse(raw ?? '[]');
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (entry): entry is NotebookEntry =>
          entry &&
          typeof entry === 'object' &&
          ['word', 'sentence', 'knowledge', 'note'].includes(entry.kind) &&
          typeof entry.id === 'string' &&
          typeof entry.title === 'string' &&
          typeof entry.en === 'string' &&
          typeof entry.ja === 'string' &&
          Number.isFinite(entry.createdAt),
      )
      .slice(0, 500)
      .map((entry) => ({
        ...entry,
        title: entry.title.slice(0, 200),
        en: entry.en.slice(0, 2000),
        ja: entry.ja.slice(0, 2000),
        detail:
          typeof entry.detail === 'string'
            ? entry.detail.slice(0, 2000)
            : undefined,
        excerpt:
          typeof entry.excerpt === 'string'
            ? entry.excerpt.slice(0, 1000)
            : undefined,
        unit:
          typeof entry.unit === 'string' && getUnit(entry.unit)
            ? entry.unit
            : undefined,
      }));
  } catch {
    return [];
  }
}
