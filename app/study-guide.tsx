'use client';
import {
  Check,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  PencilLine,
  LocateFixed,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  GUIDE_CONTENT,
  type GuideState,
  type GuideTarget,
  type ToolMode,
} from '@/lib/study-interactions';
import type { GuideLocation } from './use-guide-location';

export function StudyGuide({
  state,
  target,
  location,
  mode,
  selectedOption,
  nextQuestion,
  onNext,
  onSubmit,
  onTarget,
  onFind,
}: {
  state: GuideState;
  target: GuideTarget | null;
  location: GuideLocation;
  mode: ToolMode;
  selectedOption: number;
  nextQuestion: number;
  onNext: () => void;
  onSubmit: () => void;
  onTarget: () => void;
  onFind: () => void;
}) {
  const content = GUIDE_CONTENT[state.question];
  const current = target?.step ?? 4;
  const away = target !== null && location === 'other-page';
  const answerMode = state.stage === 'answer' && mode !== 'read';
  let title = '',
    body = '',
    action = '';
  switch (state.stage) {
    case 'intro':
      title = '導入文を読んで、場面をつかもう。';
      body = '何について、どんな文章を読むのかな？';
      action = '読めた・場面を整理';
      break;
    case 'intro-summary':
      title = '英文の下で、場面を整理したよ。';
      body = '次は設問を読んで、探す情報を決めよう。';
      action = '次は、設問文を見る';
      break;
    case 'question':
      title = `問${state.question + 1}で聞かれていることは？`;
      body = '②の設問文に注目しよう。';
      action = '読めた・探すことを整理';
      break;
    case 'question-summary':
      title = '探すことを、設問の下にまとめたよ。';
      body = '次は本文へ。根拠になる部分に線を引こう。';
      action = '次は、本文で根拠を探す';
      break;
    case 'find':
      title = content.instruction;
      body = '根拠だと思う英文をなぞって、指を離そう。';
      break;
    case 'evidence-feedback':
      title = state.match
        ? '根拠を見つけた！ 英文と整理を確認。'
        : 'なぞった箇所の確認ポイントを読もう。';
      body = state.match
        ? '次は、この内容と選択肢を照らし合わせよう。'
        : '確認ポイントは「次に確認」にも保存したよ。';
      action = state.match ? '次は、選択肢を選ぶ' : '本文でもう一度探す';
      break;
    case 'answer':
      title = '見つけた根拠と、選択肢を照らし合わせよう。';
      body =
        selectedOption < 0
          ? '番号か英文をタップして選ぼう。'
          : `選択肢 ${selectedOption + 1} を選択中。確定前なら選び直せるよ。`;
      action =
        selectedOption < 0
          ? '選択肢を選ぶと確定できる'
          : `選択肢 ${selectedOption + 1} で確定`;
      break;
    case 'answer-feedback':
      title = state.match
        ? '確認できた！ 選択肢の下に整理したよ。'
        : '選んだ選択肢の下で、違いを確認しよう。';
      body = state.match
        ? '根拠と選択肢を結びつけられたね。'
        : '確認ポイントは「次に確認」にも保存したよ。';
      action = state.match
        ? nextQuestion < 0
          ? '今回の整理を見る'
          : `次は、問${nextQuestion + 1}へ`
        : 'もう一度選ぶ';
      break;
    case 'done':
      title = '今回の解答と、整理した内容を見返そう。';
      body = '全訳と音声で、読みにくかったところを復習できるよ。';
      action = '全訳・音声で復習';
      break;
  }
  const LocationIcon =
    location === 'above'
      ? ArrowUp
      : location === 'below'
        ? ArrowDown
        : away
          ? ArrowRight
          : LocateFixed;
  const direction = away
    ? `${target?.page === 0 ? '本文' : '設問'}ページへ`
    : location === 'above'
      ? '上にあります'
      : location === 'below'
        ? '下にあります'
        : 'いま見る場所';
  return (
    <section
      className={`coach-card ${state.stage.endsWith('feedback') ? (state.match ? 'coach-positive' : 'coach-retry') : ''}`}
      aria-label="解き方ガイド"
    >
      <div className="coach-progress">
        <span>問{state.question + 1} / 3</span>
        <ol aria-label="読む順番">
          {['場面', '設問', '根拠', '解答'].map((label, i) => (
            <li
              key={label}
              aria-current={i + 1 === current ? 'step' : undefined}
            >
              {i + 1 < current ? (
                <Check size={12} aria-hidden="true" />
              ) : (
                <span>{i + 1}</span>
              )}
              {label}
            </li>
          ))}
        </ol>
      </div>
      {target && (
        <button
          className={`coach-destination ${location !== 'visible' ? 'destination-away' : ''}`}
          onClick={onTarget}
          aria-label={`${target.label}を表示。${direction}`}
        >
          <span className="focus-number">{target.step}</span>
          <strong>{target.label}</strong>
          <span className="destination-direction">
            <LocationIcon size={15} aria-hidden="true" />
            {direction}
          </span>
        </button>
      )}
      <div className="coach-body" aria-live="polite">
        <strong id="guide-instruction">{title}</strong>
        <p>{body}</p>
      </div>
      {state.stage === 'find' && mode === 'ink' && !away ? (
        <div className="coach-gesture">
          <PencilLine size={16} aria-hidden="true" />
          いまは、紙面をなぞる番
        </div>
      ) : (
        <div className="coach-action">
          <Button
            onClick={
              away || answerMode
                ? onTarget
                : state.stage === 'find'
                  ? onFind
                  : state.stage === 'answer'
                    ? onSubmit
                    : onNext
            }
            disabled={
              !away &&
              !answerMode &&
              state.stage === 'answer' &&
              selectedOption < 0
            }
          >
            {away
              ? `${target?.page === 0 ? '本文' : '設問'}の ${target?.step} を見る`
              : answerMode
                ? '選択肢を選ぶモードに戻る'
                : state.stage === 'find'
                  ? '線を引いて探す'
                  : action}
            <ArrowRight size={17} aria-hidden="true" />
          </Button>
        </div>
      )}
    </section>
  );
}
