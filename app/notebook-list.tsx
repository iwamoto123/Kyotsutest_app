'use client';
import { ArrowRight, BookMarked } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { NotebookEntry } from '@/lib/study-interactions';
export function NotebookList({
  entries,
  filter,
  onView,
}: {
  entries: NotebookEntry[];
  filter: NotebookEntry['kind'];
  onView: (unit: string) => void;
}) {
  const items = entries.filter((entry) => entry.kind === filter);
  if (!items.length)
    return (
      <div className="empty-notebook">
        <BookMarked size={30} />
        <p>
          {filter === 'word'
            ? '英文の単語をタップすると、意味を調べて保存できます。'
            : filter === 'sentence'
              ? '「書き込む → 文を保存」で、なぞった文と日本語訳がここに残ります。'
              : filter === 'knowledge'
                ? '迷ったところ・取り違えた情報が、次に確認することとして残ります。'
                : 'ガイドで解き進めると、場面・探すこと・根拠が日本語でまとまります。'}
        </p>
      </div>
    );
  return (
    <>
      {items.map((entry) => (
        <article
          className={`notebook-entry entry-${entry.kind}`}
          key={entry.id}
        >
          <small>{entry.title}</small>
          {entry.en && <p lang="en">{entry.en}</p>}
          <strong>{entry.ja}</strong>
          {entry.excerpt && (
            <div className="saved-excerpt">
              なぞった部分：<span lang="en">{entry.excerpt}</span>
            </div>
          )}
          {entry.detail && <p className="entry-detail">{entry.detail}</p>}
          {entry.unit && (
            <Button variant="ghost" onClick={() => onView(entry.unit!)}>
              冊子で見る
              <ArrowRight size={14} />
            </Button>
          )}
        </article>
      ))}
    </>
  );
}
