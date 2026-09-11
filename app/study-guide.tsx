'use client';
import { Check, Compass, ArrowRight, PencilLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  GUIDE_CONTENT,
  type GuideState,
  type ToolMode,
} from '@/lib/study-interactions';

export function StudyGuide({
  state,
  mode,
  selected,
  onNext,
  onSubmit,
  onFind,
}: {
  state: GuideState;
  mode: ToolMode;
  selected: boolean;
  onNext: () => void;
  onSubmit: () => void;
  onFind: () => void;
}) {
  const content = GUIDE_CONTENT[state.question];
  const stages = ['場面', '設問', '根拠', '解答'];
  const current = state.stage.startsWith('intro')
    ? 0
    : state.stage.startsWith('question')
      ? 1
      : ['find', 'evidence-feedback'].includes(state.stage)
        ? 2
        : 3;
  const intro = state.stage === 'intro-summary';
  let title = '',
    body = '',
    action = '';
  switch (state.stage) {
    case 'intro':
      title = 'まず、冒頭の1文で場面をつかもう。';
      body = '何について、どんな文章を読むのかな？';
      action = '導入を確認した';
      break;
    case 'intro-summary':
      title = '読むのは、夜の博物館のイベント案内。';
      body = '場面をつかめたね。次は、何を探すか決めよう。';
      action = '設問を見よう';
      break;
    case 'question':
      title = `問${state.question + 1}は、何を聞いている？`;
      body = '設問を先に読んで、本文で探す情報を決めよう。';
      action = '設問を確認した';
      break;
    case 'question-summary':
      title = content.search;
      body = 'これが今回、本文で探すこと。整理メモに残したよ。';
      action = '本文で探す';
      break;
    case 'find':
      title = content.instruction;
      body = '文の途中からでもOK。指を離すと確定するよ。';
      break;
    case 'evidence-feedback':
      title = state.match
        ? 'そこだね！ 根拠を見つけた。'
        : '探す情報と照らし合わせよう。';
      body = state.message;
      action = state.match ? '選択肢を見よう' : 'もう一度探す';
      break;
    case 'answer':
      title = '根拠の内容と合う選択肢を選ぼう。';
      body = '番号か選択肢をタップ。選んだら解答を確定しよう。';
      action = 'この解答にする';
      break;
    case 'answer-feedback':
      title = state.match ? '確認できたね！' : 'この違いを確認しておこう。';
      body = state.message;
      action = state.match
        ? state.question === 2
          ? '今回の整理を見る'
          : '次の設問へ'
        : 'もう一度選ぶ';
      break;
    case 'done':
      title = '解き方の順番を、ひと通りつかんだね。';
      body = '場面 → 設問 → 根拠 → 選択肢。整理メモを見返そう。';
      action = '全訳・音声で復習';
      break;
  }
  return (
    <section
      className={`coach-card ${state.stage.endsWith('feedback') ? (state.match ? 'coach-positive' : 'coach-retry') : ''}`}
      aria-label="解き方ガイド"
    >
      <div className="coach-top">
        <span>
          <Compass size={15} />
          解き方ガイド
        </span>
        <ol aria-label="読む順番">
          {stages.map((stage, i) => (
            <li key={stage} aria-current={current === i ? 'step' : undefined}>
              {i < current ? <Check size={11} /> : <span>{i + 1}</span>}
              {stage}
            </li>
          ))}
        </ol>
      </div>
      <div className="coach-body" aria-live="polite">
        <strong>{title}</strong>
        <p>{body}</p>
        {state.stage.endsWith('feedback') && !state.match && (
          <div className="coach-save">「次に確認」に記録したよ。</div>
        )}
        {(intro || (state.stage === 'evidence-feedback' && state.match)) && (
          <div className="expression-pair">
            <span lang="en">
              {intro ? 'a notice about an evening event' : content.expression}
            </span>
            <span>
              {intro ? '夜のイベントについてのお知らせ' : content.meaning}
            </span>
          </div>
        )}
      </div>
      <div className="coach-action">
        {state.stage === 'find' ? (
          <Button variant="outline" onClick={onFind}>
            <PencilLine size={16} />
            {mode === 'ink' ? '根拠をなぞる位置へ' : '線を引くモードへ'}
          </Button>
        ) : (
          <Button
            onClick={state.stage === 'answer' ? onSubmit : onNext}
            disabled={state.stage === 'answer' && !selected}
          >
            {action}
            <ArrowRight size={16} />
          </Button>
        )}
      </div>
    </section>
  );
}
