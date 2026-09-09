export type RunState = {
  phase: 'ready' | 'playing' | 'finished';
  remainingMs: number;
  durationMs: number;
  answerKey: number[];
  choices: number[];
  eliminated: number[][];
  grades: (boolean | null)[];
  evidence: (string | null)[];
  hinted: string[];
  combo: number;
  bestCombo: number;
};
export type RunAction =
  | { type: 'start' }
  | { type: 'tick'; elapsedMs: number }
  | { type: 'select' | 'eliminate'; question: number; option: number }
  | { type: 'grade'; question: number }
  | { type: 'evidence'; question: number; sentence: string }
  | { type: 'hint'; sentence: string };
export function createRun(answerKey: number[], durationMs = 180_000): RunState {
  if (
    !answerKey.length ||
    answerKey.some((n) => !Number.isInteger(n) || n < 0 || n > 3)
  )
    throw new Error('Invalid answer key');
  if (!Number.isFinite(durationMs) || durationMs <= 0)
    throw new Error('Invalid duration');
  return {
    phase: 'ready',
    remainingMs: durationMs,
    durationMs,
    answerKey: [...answerKey],
    choices: answerKey.map(() => -1),
    eliminated: answerKey.map(() => []),
    grades: answerKey.map(() => null),
    evidence: answerKey.map(() => null),
    hinted: [],
    combo: 0,
    bestCombo: 0,
  };
}
export function runReducer(state: RunState, action: RunAction): RunState {
  if (action.type === 'start')
    return state.phase === 'ready' ? { ...state, phase: 'playing' } : state;
  if (action.type === 'tick') {
    if (
      state.phase !== 'playing' ||
      !Number.isFinite(action.elapsedMs) ||
      action.elapsedMs <= 0
    )
      return state;
    const remainingMs = Math.max(0, state.remainingMs - action.elapsedMs);
    return {
      ...state,
      remainingMs,
      phase: remainingMs === 0 ? 'finished' : 'playing',
    };
  }
  if (action.type === 'hint')
    return state.phase === 'finished' || state.hinted.includes(action.sentence)
      ? state
      : { ...state, hinted: [...state.hinted, action.sentence] };
  const index = action.question;
  if (!Number.isInteger(index) || index < 0 || index >= state.answerKey.length)
    return state;
  if (state.phase === 'finished' || state.grades[index] !== null) return state;
  if (action.type === 'evidence') {
    if (!/^s[0-5]$/.test(action.sentence)) return state;
    return {
      ...state,
      evidence: state.evidence.map((value, i) =>
        i === index
          ? value === action.sentence
            ? null
            : action.sentence
          : value,
      ),
    };
  }
  if (action.type === 'select' || action.type === 'eliminate') {
    const option = action.option;
    if (!Number.isInteger(option) || option < 0 || option > 3) return state;
    if (action.type === 'select')
      return state.eliminated[index].includes(option)
        ? state
        : {
            ...state,
            choices: state.choices.map((value, i) =>
              i === index ? option : value,
            ),
          };
    const removed = state.eliminated[index].includes(option);
    return {
      ...state,
      eliminated: state.eliminated.map((values, i) =>
        i === index
          ? removed
            ? values.filter((n) => n !== option)
            : [...values, option]
          : values,
      ),
      choices: state.choices.map((value, i) =>
        i === index && value === option && !removed ? -1 : value,
      ),
    };
  }
  if (
    action.type === 'grade' &&
    state.phase === 'playing' &&
    state.choices[index] >= 0
  ) {
    const correct = state.choices[index] === state.answerKey[index];
    const grades = state.grades.map((value, i) =>
      i === index ? correct : value,
    );
    const combo = correct ? state.combo + 1 : 0;
    return {
      ...state,
      grades,
      combo,
      bestCombo: Math.max(state.bestCombo, combo),
      phase: grades.every((value) => value !== null) ? 'finished' : 'playing',
    };
  }
  return state;
}
export const scoreRun = (run: RunState) =>
  run.grades.filter(Boolean).length * 2;
export const formatTime = (ms: number) => {
  const seconds = Math.ceil(Math.max(0, ms) / 1000);
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
};
