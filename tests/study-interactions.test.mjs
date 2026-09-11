import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGuide,
  getUnit,
  guideTarget,
  inspectEvidence,
  nextGuide,
  parseNotebook,
  rangeText,
  resumeGuide,
  tokenize,
  traceRanges,
} from '../lib/study-interactions.ts';
const point = (unit, word) => ({
  unit,
  index: tokenize(getUnit(unit).en).find(
    (token) => token.text.toLowerCase() === word.toLowerCase(),
  ).index,
});

test('finger tracing selects exactly the same phrase in either direction', () => {
  const start = point('s1', 'by'),
    end = point('s1', 'ID');
  const forward = traceRanges(start, end);
  assert.deepEqual(traceRanges(end, start), forward);
  assert.equal(rangeText(forward[0]), 'by showing a student ID');
  assert.equal(inspectEvidence(0, forward).match, true);
});

test('cross-sentence tracing includes visible sentences but never hidden questions', () => {
  const ranges = traceRanges(point('s5', 'café'), point('q2', 'Where'), [
    's4',
    's5',
    'q2',
    'q2o0',
  ]);
  assert.deepEqual(
    ranges.map((range) => range.unit),
    ['s5', 'q2'],
  );
  assert.deepEqual(
    traceRanges(point('s5', 'café'), point('q0', 'How'), ['s5', 'q2']),
    [],
  );
  assert.deepEqual(
    traceRanges({ unit: 's1', index: -1 }, point('s1', 'ID')),
    [],
  );
});

test('the booking guide waits for both method and deadline across separate strokes', () => {
  const method = traceRanges(point('s3', 'form'), point('s3', 'form'));
  const deadline = traceRanges(
    point('s3', 'Thursday'),
    point('s3', 'Thursday'),
  );
  assert.equal(inspectEvidence(1, method).match, false);
  assert.equal(inspectEvidence(1, deadline).match, false);
  assert.equal(inspectEvidence(1, [...method, ...deadline]).match, true);
  assert.equal(inspectEvidence(0, [...method, ...deadline]).match, false);
  const near = inspectEvidence(1, [
    ...method,
    ...traceRanges(point('s4', 'cloudy'), point('s4', 'indoors')),
  ]);
  assert.equal(near.match, false);
  assert.equal(
    guideTarget({
      ...createGuide(),
      question: 1,
      stage: 'evidence-feedback',
      ...near,
    }).anchor,
    's3',
  );
});

test('guide moves from introduction through question and evidence and supports retry', () => {
  let guide = createGuide();
  for (const stage of [
    'intro-summary',
    'question',
    'question-summary',
    'find',
  ]) {
    guide = nextGuide(guide);
    assert.equal(guide.stage, stage);
  }
  guide = nextGuide({ ...guide, stage: 'evidence-feedback', match: false });
  assert.equal(guide.stage, 'find');
  guide = nextGuide({ ...guide, stage: 'evidence-feedback', match: true });
  assert.equal(guide.stage, 'answer');
  guide = nextGuide({ ...guide, stage: 'answer-feedback', match: false }, [
    false,
    null,
    null,
  ]);
  assert.equal(guide.stage, 'answer');
  guide = nextGuide({ ...guide, stage: 'answer-feedback', match: true }, [
    false,
    true,
    null,
  ]);
  assert.equal(guide.question, 2);
  assert.equal(guide.stage, 'question');
  assert.equal(
    nextGuide({ ...guide, stage: 'answer-feedback', match: true }, [
      false,
      true,
      true,
    ]).stage,
    'done',
  );
});

test('guide resumption skips already graded evidence tasks, handles timeout, and preserves a pending retry', () => {
  const guide = { ...createGuide(), stage: 'find' };
  assert.equal(resumeGuide(guide, [true, null, true], false).question, 1);
  assert.equal(resumeGuide(guide, [null, null, null], true).stage, 'done');
  for (const stage of ['answer', 'answer-feedback']) {
    assert.equal(
      resumeGuide({ ...guide, stage }, [false, null, null], true).stage,
      'done',
    );
  }
  const retry = { ...guide, stage: 'answer-feedback', match: false };
  assert.deepEqual(resumeGuide(retry, [false, true, true], true), retry);
});

test('saved sentences keep their original context, selected phrase, and translation after reload', () => {
  const entry = {
    id: 'sentence-s1',
    kind: 'sentence',
    title: '訳せなかった文',
    en: getUnit('s1').en,
    ja: getUnit('s1').ja,
    excerpt: 'by showing',
    unit: 's1',
    createdAt: 123,
  };
  const [restored] = parseNotebook(
    JSON.stringify([entry, { kind: 'unknown' }]),
  );
  assert.equal(restored.en, entry.en);
  assert.equal(restored.excerpt, entry.excerpt);
  assert.equal(restored.ja, entry.ja);
  assert.deepEqual(parseNotebook('{broken'), []);
});

test("guide highlights the search area without revealing the answer, then points feedback at the learner's trace", () => {
  const finding = { ...createGuide(), stage: 'find' };
  assert.equal(guideTarget(finding).anchor, 'passage');
  const wrong = inspectEvidence(
    0,
    traceRanges(point('s3', 'form'), point('s3', 'Thursday')),
  );
  const feedback = {
    ...finding,
    stage: 'evidence-feedback',
    ...wrong,
  };
  assert.equal(guideTarget(feedback).anchor, 's3');
  assert.equal(guideTarget(nextGuide(feedback)).anchor, 'passage');
  const correct = inspectEvidence(
    0,
    traceRanges(point('s1', 'by'), point('s1', 'ID')),
  );
  assert.equal(guideTarget({ ...feedback, ...correct }).anchor, 's1');
});

test('feedback follows the latest answer and a finished guide has no paper destination', () => {
  const feedback = {
    ...createGuide(),
    stage: 'answer-feedback',
    answerOption: 0,
  };
  assert.equal(guideTarget(feedback).anchor, 'q0o0');
  assert.equal(guideTarget({ ...feedback, answerOption: 2 }).anchor, 'q0o2');
  assert.equal(guideTarget({ ...feedback, stage: 'done' }), null);
});
