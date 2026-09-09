import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRun,
  runReducer,
  scoreRun,
  evidenceForQuestion,
  formatTime,
} from '../lib/exam-engine.ts';
import {
  INTRO,
  SENTENCES,
  QUESTIONS,
  normalizeWord,
} from '../lib/exam-content.ts';
import vocabulary from '../lib/vocabulary.json' with { type: 'json' };

const start = () => runReducer(createRun([0, 1, 2]), { type: 'start' });
const answer = (run, question, option) =>
  runReducer(runReducer(run, { type: 'select', question, option }), {
    type: 'grade',
    question,
  });

test('preview allows selection but cannot score or run the clock', () => {
  const ready = createRun([0, 1, 2]);
  const selected = runReducer(ready, {
    type: 'select',
    question: 0,
    option: 0,
  });
  assert.equal(selected.choices[0], 0);
  assert.equal(runReducer(selected, { type: 'grade', question: 0 }), selected);
  assert.equal(runReducer(ready, { type: 'tick', elapsedMs: 1000 }), ready);
});

test('eliminating a chosen answer clears selection; undo restores its availability', () => {
  let run = runReducer(start(), { type: 'select', question: 0, option: 0 });
  run = runReducer(run, { type: 'eliminate', question: 0, option: 0 });
  assert.equal(run.choices[0], -1);
  assert.equal(
    runReducer(run, { type: 'select', question: 0, option: 0 }),
    run,
  );
  run = runReducer(run, { type: 'eliminate', question: 0, option: 0 });
  assert.deepEqual(run.eliminated[0], []);
  assert.equal(answer(run, 0, 0).grades[0], true);
});

test('grading is final and a perfect run ends with six points and a three-answer combo', () => {
  let run = answer(start(), 0, 0);
  assert.equal(runReducer(run, { type: 'grade', question: 0 }), run);
  assert.equal(
    runReducer(run, { type: 'select', question: 0, option: 3 }),
    run,
  );
  run = answer(answer(run, 2, 2), 1, 1);
  assert.equal(scoreRun(run), 6);
  assert.equal(run.phase, 'finished');
  assert.equal(run.bestCombo, 3);
  assert.equal(runReducer(run, { type: 'tick', elapsedMs: 2000 }), run);
});

test('a wrong answer breaks the combo without erasing previous points', () => {
  const run = answer(answer(answer(start(), 0, 0), 1, 0), 2, 2);
  assert.deepEqual(run.grades, [true, false, true]);
  assert.equal(run.combo, 1);
  assert.equal(run.bestCombo, 1);
  assert.equal(scoreRun(run), 4);
});

test('timeout ends the run and rejects later answers', () => {
  const run = runReducer(start(), { type: 'tick', elapsedMs: 180_500 });
  assert.equal(run.phase, 'finished');
  assert.equal(run.remainingMs, 0);
  assert.equal(answer(run, 0, 0), run);
  assert.equal(scoreRun(run), 0);
  assert.equal(formatTime(run.remainingMs), '00:00');
});

test('grading freezes evidence, and later review does not alter the completed hint count', () => {
  let run = runReducer(start(), {
    type: 'evidence',
    question: 0,
    sentence: 's1',
  });
  run = answer(run, 0, 0);
  assert.equal(
    runReducer(run, { type: 'evidence', question: 0, sentence: 's3' }),
    run,
  );
  run = runReducer(run, { type: 'tick', elapsedMs: 180_000 });
  assert.equal(runReducer(run, { type: 'hint', sentence: 's5' }), run);
  assert.equal(
    runReducer(run, { type: 'evidence', question: 1, sentence: 's3' }),
    run,
  );
});

test('invalid timer and answer actions cannot corrupt the run', () => {
  const run = start();
  for (const elapsedMs of [-100, 0, NaN, Infinity])
    assert.equal(runReducer(run, { type: 'tick', elapsedMs }), run);
  for (const question of [-1, 3, 0.5, NaN])
    assert.equal(runReducer(run, { type: 'select', question, option: 0 }), run);
  for (const option of [-1, 4, 0.5, NaN])
    assert.equal(runReducer(run, { type: 'select', question: 0, option }), run);
  for (const duration of [-1, 0, NaN, Infinity])
    assert.throws(() => createRun([0], duration));
  assert.throws(() => createRun([]));
  assert.throws(() => createRun([4]));
  assert.equal(formatTime(1), '00:01');
  assert.equal(formatTime(180_000), '03:00');
});

test('hints count unique units; evidence can be toggled per question', () => {
  let run = runReducer(start(), { type: 'hint', sentence: 's1' });
  assert.equal(runReducer(run, { type: 'hint', sentence: 's1' }), run);
  run = runReducer(run, { type: 'evidence', question: 0, sentence: 's1' });
  run = runReducer(run, { type: 'evidence', question: 1, sentence: 's3' });
  assert.deepEqual(run.evidence, ['s1', 's3', null]);
  run = runReducer(run, { type: 'evidence', question: 0, sentence: 's1' });
  assert.deepEqual(run.evidence, [null, 's3', null]);
  assert.equal(
    runReducer(run, { type: 'evidence', question: 1, sentence: 'invalid' }),
    run,
  );
  assert.equal(scoreRun(run), 0);
});

test('evidence display shows only the active question and reveals the answer key after grading', () => {
  let run = runReducer(start(), {
    type: 'evidence',
    question: 0,
    sentence: 's3',
  });
  assert.deepEqual(evidenceForQuestion(run, 0, 's1', 's3'), {
    chosen: true,
    correct: false,
    label: 'あなたの根拠',
  });
  assert.equal(evidenceForQuestion(run, 1, 's3', 's3').chosen, false);
  assert.equal(evidenceForQuestion(run, 0, 's1', 's1').correct, false);
  run = answer(run, 0, 1);
  assert.equal(evidenceForQuestion(run, 0, 's1', 's1').correct, true);
  assert.equal(evidenceForQuestion(run, 0, 's1', 's3').chosen, true);
  assert.equal(evidenceForQuestion(run, 1, 's3', 's3').correct, false);
  run = runReducer(run, { type: 'tick', elapsedMs: 180_000 });
  assert.equal(evidenceForQuestion(run, 1, 's3', 's3').correct, true);
});

test('every interactive English word has a dictionary meaning and every answer has an evidence sentence', () => {
  const texts = [
    INTRO.en,
    ...SENTENCES.map((s) => s.en),
    ...QUESTIONS.flatMap((q) => [q.en, ...q.choices.map((c) => c[0])]),
  ];
  for (const text of texts)
    for (const word of text.match(
      /p\.m\.|[A-Za-zÉé]+(?:'[A-Za-z]+)?|[0-9]+/g,
    ) ?? [])
      assert.ok(vocabulary[normalizeWord(word)], `Missing meaning: ${word}`);
  for (const question of QUESTIONS) {
    assert.ok(SENTENCES.some((s) => s.id === question.evidence));
    assert.equal(question.choices.length, 4);
    assert.ok(question.choices[question.answer]);
  }
});
