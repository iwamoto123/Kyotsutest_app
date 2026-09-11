'use client';
import {
  ArrowRight,
  BookOpen,
  Headphones,
  Languages,
  RotateCcw,
  Check,
  Minus,
  BookMarked,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QUESTIONS } from '@/lib/exam-content';
import { scoreRun, type RunState } from '@/lib/exam-engine';
import type { ReviewKind } from '@/lib/study-navigation';

export function SessionSummary({
  run,
  onResume,
  onRestart,
  onReview,
}: {
  run: RunState;
  onResume: () => void;
  onRestart: () => void;
  onReview: (kind: ReviewKind, question?: number) => void;
}) {
  const complete = run.phase === 'finished';
  const answered = run.grades.filter((grade) => grade !== null).length;
  const timedOut = complete && answered < QUESTIONS.length;
  return (
    <section className="session-summary" aria-label="結果と次の進み方">
      <div className="summary-heading">
        <span>
          {complete
            ? timedOut
              ? '時間になりました'
              : 'おつかれさま！'
            : 'いったん、ここでひと区切り'}
        </span>
        <h1>{complete ? '今回の結果' : 'ここまでの記録'}</h1>
        <p>
          {complete
            ? '気になった問題から、復習してみよう。'
            : '時計を止めています。ここから復習も、続きの再開もできます。'}
        </p>
      </div>
      <div className="summary-score">
        <strong>
          {scoreRun(run)}
          <small> / 6 点</small>
        </strong>
        <span>
          {answered} / 3 問に解答・未回答 {3 - answered} 問
        </span>
      </div>
      <p className="summary-score-note">
        最初の解答の得点。解き直しても記録は変わりません。
      </p>
      <div className="summary-question-list">
        {QUESTIONS.map((q, i) => (
          <button key={i} onClick={() => onReview('answers', i)}>
            <span
              className={`summary-status ${run.grades[i] === null ? 'pending' : run.grades[i] ? 'correct' : 'incorrect'}`}
            >
              {run.grades[i] === null ? (
                <Minus size={20} />
              ) : run.grades[i] ? (
                <Check size={20} />
              ) : (
                '×'
              )}
            </span>
            <span>
              <strong>
                問{i + 1}　{q.skill}
              </strong>
              <small>
                {run.grades[i] === null
                  ? '未回答'
                  : run.grades[i]
                    ? '正解'
                    : '見直そう'}{' '}
                · 解説を見る
              </small>
            </span>
            <ArrowRight size={17} />
          </button>
        ))}
      </div>
      <h2>復習のしかたを選ぶ</h2>
      <div className="review-choices">
        {[
          {
            id: 'answers',
            icon: BookOpen,
            label: '解説',
            detail: '根拠と答えを照合',
          },
          {
            id: 'translation',
            icon: Languages,
            label: '全訳',
            detail: '英文と日本語を読む',
          },
          {
            id: 'audio',
            icon: Headphones,
            label: '音声・音読',
            detail: '聴く・シャドーイング',
          },
          {
            id: 'notebook',
            icon: BookMarked,
            label: 'ノート',
            detail: '保存した単語や文',
          },
        ].map((item) => (
          <button key={item.id} onClick={() => onReview(item.id as ReviewKind)}>
            <item.icon size={22} />
            <strong>{item.label}</strong>
            <span>{item.detail}</span>
          </button>
        ))}
      </div>
      <div className="summary-primary">
        <Button onClick={complete ? onRestart : onResume}>
          {complete ? <RotateCcw size={18} /> : <ArrowRight size={18} />}
          {complete ? 'もう一度挑戦する' : '中断したところから再開'}
        </Button>
        {!complete && <p>この画面から、元のページと残り時間で再開できます。</p>}
      </div>
    </section>
  );
}
