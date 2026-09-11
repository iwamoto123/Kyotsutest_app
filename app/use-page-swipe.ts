'use client';
import { useRef, useState, type PointerEvent, type MouseEvent } from 'react';
import { swipeDirection } from '@/lib/study-navigation';

export function usePageSwipe(
  enabled: boolean,
  onTurn: (direction: number) => void,
) {
  const [drag, setDrag] = useState(0);
  const gesture = useRef<{
    id: number;
    x: number;
    y: number;
    axis: 'pending' | 'x' | 'y';
  } | null>(null);
  const suppress = useRef(0);
  return {
    drag,
    handlers: {
      onPointerDownCapture(event: PointerEvent<HTMLDivElement>) {
        gesture.current = null;
        if (!enabled || !event.isPrimary || event.button !== 0) return;
        const target = event.target as HTMLElement;
        if (
          target.closest('button, input, a, [role="radio"]') &&
          !target.closest('[data-token]')
        )
          return;
        gesture.current = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          axis: 'pending',
        };
      },
      onPointerMoveCapture(event: PointerEvent<HTMLDivElement>) {
        const current = gesture.current;
        if (!current || current.id !== event.pointerId) return;
        const dx = event.clientX - current.x,
          dy = event.clientY - current.y;
        if (current.axis === 'pending' && Math.hypot(dx, dy) >= 12) {
          current.axis = Math.abs(dx) > Math.abs(dy) * 1.5 ? 'x' : 'y';
          if (current.axis === 'x')
            event.currentTarget.setPointerCapture(event.pointerId);
        }
        if (current.axis === 'x') {
          event.preventDefault();
          setDrag(Math.max(-90, Math.min(90, dx * 0.45)));
        }
      },
      onPointerUpCapture(event: PointerEvent<HTMLDivElement>) {
        const current = gesture.current;
        gesture.current = null;
        setDrag(0);
        if (!current || current.id !== event.pointerId) return;
        const dx = event.clientX - current.x,
          dy = event.clientY - current.y;
        if (Math.hypot(dx, dy) >= 10) {
          suppress.current = performance.now() + 500;
          event.preventDefault();
          event.stopPropagation();
        }
        const direction = current.axis !== 'y' ? swipeDirection(dx, dy) : 0;
        if (direction) onTurn(direction);
      },
      onPointerCancelCapture() {
        gesture.current = null;
        setDrag(0);
      },
      onClickCapture(event: MouseEvent<HTMLDivElement>) {
        if (performance.now() < suppress.current) {
          event.preventDefault();
          event.stopPropagation();
        }
      },
    },
  };
}
