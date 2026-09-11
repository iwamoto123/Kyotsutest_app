'use client';

import type { ReactNode } from 'react';
import type { GuideTarget } from '@/lib/study-interactions';

export type GuideAnnotation = {
  title: string;
  text: string;
  expression?: string;
  tone: 'note' | 'success' | 'retry';
};

export function GuideRegion({
  anchor,
  target,
  annotation,
  className = '',
  children,
}: {
  anchor: string;
  target: GuideTarget | null;
  annotation?: GuideAnnotation;
  className?: string;
  children: ReactNode;
}) {
  const active = target?.anchor === anchor;
  return (
    <div
      className={`guide-region ${active ? 'is-guide-focus' : ''} ${className}`}
      data-guide-anchor={anchor}
      aria-describedby={active ? 'guide-instruction' : undefined}
    >
      {active && (
        <div className="paper-focus-label">
          <span className="focus-number">{target.step}</span>
          <span>{target.label}</span>
        </div>
      )}
      {children}
      {active && annotation && (
        <aside className={`focus-annotation annotation-${annotation.tone}`}>
          <strong>{annotation.title}</strong>
          {annotation.expression && (
            <span lang="en">{annotation.expression}</span>
          )}
          <p>{annotation.text}</p>
        </aside>
      )}
    </div>
  );
}
