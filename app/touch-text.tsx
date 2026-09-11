'use client';
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type PointerEvent,
} from 'react';
import {
  containsToken,
  tokenize,
  traceRanges,
  wordCount,
  type TextPoint,
  type TextRange,
  type ToolMode,
} from '@/lib/study-interactions';
import type { Sentence } from '@/lib/exam-content';

type TextTools = {
  mode: ToolMode;
  marks: TextRange[];
  draft: TextRange[];
  fullTranslation: boolean;
  translated: Set<string>;
  stocked: Set<string>;
  correctUnit: string | null;
  onDraft: (ranges: TextRange[]) => void;
  onTrace: (ranges: TextRange[]) => void;
  onWord: (unit: string, index: number) => void;
  onTranslate: (unit: string) => void;
};
export const TextToolsContext = createContext<TextTools | null>(null);

export function TouchText({
  id,
  en,
  ja,
  className = '',
}: Sentence & { className?: string }) {
  const tools = useContext(TextToolsContext)!;
  const session = useRef<{
    pointer: number;
    start: TextPoint;
    last: TextPoint;
    x: number;
    y: number;
    distance: number;
    mode: ToolMode;
  } | null>(null);
  const suppressUntil = useRef(0);
  const own = useRef<HTMLDivElement>(null);
  const latest = useRef(tools);
  useEffect(() => {
    latest.current = tools;
  });
  useEffect(() => {
    session.current = null;
    tools.onDraft([]);
  }, [tools.mode]);
  function ranges(start: TextPoint, end: TextPoint) {
    const visible = [
      ...(own.current
        ?.closest('[data-paper-scroll]')
        ?.querySelectorAll<HTMLElement>('[data-unit]') ?? []),
    ].map((unit) => unit.dataset.unit!);
    return traceRanges(start, end, visible);
  }
  function point(
    element: Element | null,
    x?: number,
    y?: number,
  ): TextPoint | null {
    if (element?.closest('.translation')) return null;
    let token = element?.closest<HTMLElement>('[data-token]');
    if (!token && x !== undefined && y !== undefined) {
      const nearby = element?.closest<HTMLElement>('[data-unit]');
      let distance = 18;
      for (const candidate of nearby?.querySelectorAll<HTMLElement>(
        '[data-token]',
      ) ?? []) {
        const rect = candidate.getBoundingClientRect();
        const next = Math.hypot(
          Math.max(rect.left - x, 0, x - rect.right),
          Math.max(rect.top - y, 0, y - rect.bottom),
        );
        if (next < distance) {
          distance = next;
          token = candidate;
        }
      }
    }
    const unit = token?.closest<HTMLElement>('[data-unit]');
    return token && unit
      ? { unit: unit.dataset.unit!, index: Number(token.dataset.token) }
      : null;
  }
  function down(event: PointerEvent<HTMLDivElement>) {
    if (
      !event.isPrimary ||
      event.button !== 0 ||
      !['ink', 'stock', 'word', 'read'].includes(tools.mode)
    )
      return;
    const start = point(
      event.target instanceof Element ? event.target : null,
      event.clientX,
      event.clientY,
    );
    if (!start) return;
    session.current = {
      pointer: event.pointerId,
      start,
      last: start,
      x: event.clientX,
      y: event.clientY,
      distance: 0,
      mode: tools.mode,
    };
    if (tools.mode === 'ink' || tools.mode === 'stock') {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      tools.onDraft(ranges(start, start));
    }
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    const current = session.current;
    if (!current || current.pointer !== event.pointerId) return;
    current.distance = Math.max(
      current.distance,
      Math.hypot(event.clientX - current.x, event.clientY - current.y),
    );
    if (current.mode === 'word' || current.mode === 'read') return;
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    const next = point(hit, event.clientX, event.clientY);
    if (next && own.current?.closest('[data-paper-scroll]')?.contains(hit)) {
      current.last = next;
      tools.onDraft(ranges(current.start, next));
    }
  }
  function up(event: PointerEvent<HTMLDivElement>) {
    const current = session.current;
    if (!current || current.pointer !== event.pointerId) return;
    current.distance = Math.max(
      current.distance,
      Math.hypot(event.clientX - current.x, event.clientY - current.y),
    );
    if (current.mode === 'ink' || current.mode === 'stock') {
      const hit = document.elementFromPoint(event.clientX, event.clientY);
      const end = point(hit, event.clientX, event.clientY);
      if (end && own.current?.closest('[data-paper-scroll]')?.contains(hit))
        current.last = end;
    }
    session.current = null;
    suppressUntil.current = performance.now() + 500;
    if (current.mode !== tools.mode) {
      tools.onDraft([]);
      return;
    }
    if (current.mode === 'word' || current.mode === 'read') {
      if (current.distance < 10)
        tools.onWord(current.start.unit, current.start.index);
    } else {
      if (current.distance >= 8)
        tools.onTrace(ranges(current.start, current.last));
      tools.onDraft([]);
    }
  }
  function cancel() {
    session.current = null;
    latest.current.onDraft([]);
  }
  const canAct = tools.mode !== 'read';
  return (
    <div
      ref={own}
      className={`english-unit ${className} ${tools.stocked.has(id) ? 'unit-stocked' : ''} ${tools.correctUnit === id ? 'unit-correct' : ''}`}
      data-unit={id}
      role={
        tools.mode === 'word' || tools.mode === 'read'
          ? 'group'
          : canAct
            ? 'button'
            : undefined
      }
      tabIndex={
        tools.mode !== 'word' && tools.mode !== 'read' && canAct ? 0 : undefined
      }
      aria-label={
        tools.mode === 'ink'
          ? `${en} キーボードではEnterで文全体に線を引く`
          : tools.mode === 'stock'
            ? `${en} キーボードではEnterで文を保存`
            : undefined
      }
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={cancel}
      onClick={() => {
        if (performance.now() < suppressUntil.current) return;
        if (tools.mode === 'translate') tools.onTranslate(id);
      }}
      onKeyDown={(event) => {
        if (
          event.target !== event.currentTarget ||
          !['Enter', ' '].includes(event.key)
        )
          return;
        event.preventDefault();
        if (tools.mode === 'ink' || tools.mode === 'stock')
          tools.onTrace([{ unit: id, from: 0, to: wordCount(en) - 1 }]);
        else if (tools.mode === 'translate') tools.onTranslate(id);
      }}
    >
      {tools.correctUnit === id && (
        <span className="sentence-tag correct-tag">正解の根拠</span>
      )}
      {tools.stocked.has(id) && (
        <span className="sentence-tag stock-tag">文ストック済み</span>
      )}
      <span className="original" lang="en">
        {tokenize(en).map((token, i) => {
          if (token.index < 0) return token.text;
          const className = `text-word ${containsToken(tools.marks, id, token.index) ? 'inked' : ''} ${containsToken(tools.draft, id, token.index) ? `tracing tracing-${tools.mode}` : ''}`;
          return tools.mode === 'word' || tools.mode === 'read' ? (
            <button
              className={className}
              data-token={token.index}
              type="button"
              key={i}
              onClick={(event) => {
                if (event.detail === 0) tools.onWord(id, token.index);
              }}
            >
              {token.text}
            </button>
          ) : (
            <span className={className} data-token={token.index} key={i}>
              {token.text}
            </span>
          );
        })}
      </span>
      {(tools.fullTranslation || tools.translated.has(id)) && (
        <span className="translation" lang="ja">
          {ja}
        </span>
      )}
    </div>
  );
}
