import test from 'node:test';
import assert from 'node:assert/strict';
import {
  adjacentPage,
  swipeDirection,
  nextUnanswered,
} from '../lib/study-navigation.ts';
import { createGuide, guideTarget } from '../lib/study-interactions.ts';

test('horizontal swipes turn one leaf, while reading scrolls and short taps stay put', () => {
  assert.equal(swipeDirection(-95, 12), 1);
  assert.equal(swipeDirection(85, -20), -1);
  for (const [dx, dy] of [
    [-40, 0],
    [4, 6],
    [-80, 140],
    [90, 70],
  ]) {
    assert.equal(swipeDirection(dx, dy), 0);
  }
  assert.equal(adjacentPage(0, swipeDirection(85, 0)), 0);
  assert.equal(adjacentPage(3, swipeDirection(-95, 0)), 3);
  assert.equal(adjacentPage(1, swipeDirection(-400, 0)), 2);
});

test('continue skips both correct and incorrect graded questions and finds an earlier skipped question', () => {
  assert.equal(nextUnanswered([true, null, null], 0), 1);
  assert.equal(nextUnanswered([false, true, null], 0), 2);
  assert.equal(nextUnanswered([null, true, false], 2), 0);
  assert.equal(nextUnanswered([false, true, true], 2), -1);
});

test('guide destinations follow the corresponding question leaf and traced text', () => {
  for (let question = 0; question < 3; question++) {
    for (const stage of [
      'question',
      'question-summary',
      'answer',
      'answer-feedback',
    ]) {
      const destination = guideTarget({
        ...createGuide(),
        question,
        stage,
        answerOption: 2,
      });
      assert.equal(destination.page, question + 1);
    }
    assert.equal(
      guideTarget({ ...createGuide(), question, stage: 'find' }).page,
      0,
    );
  }
  const wrongTrace = guideTarget({
    ...createGuide(),
    question: 0,
    stage: 'evidence-feedback',
    evidenceUnit: 'q2o1',
    match: false,
  });
  assert.equal(wrongTrace.page, 3);
  assert.equal(wrongTrace.anchor, 'q2o1');
});
