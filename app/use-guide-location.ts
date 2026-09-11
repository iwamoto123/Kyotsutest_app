'use client';

import { useLayoutEffect, useState, type RefObject } from 'react';
import type { GuideTarget } from '@/lib/study-interactions';

export type GuideLocation = 'visible' | 'above' | 'below' | 'other-page';

export function useGuideLocation(
  paper: RefObject<HTMLDivElement | null>,
  target: GuideTarget | null,
  page: number,
) {
  const [location, setLocation] = useState<GuideLocation>('visible');
  const anchor = target?.anchor;
  const targetPage = target?.page;
  useLayoutEffect(() => {
    if (!anchor) return;
    if (targetPage !== page) {
      setLocation('other-page');
      return;
    }
    const container = paper.current;
    const region = container?.querySelector<HTMLElement>(
      `[data-guide-anchor="${anchor}"]`,
    );
    if (!container || !region) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const viewport = container.getBoundingClientRect();
        const bounds = region.getBoundingClientRect();
        // A tall passage remains the active destination while any useful
        // portion of it is visible. Scrolling never pulls the reader back.
        const margin = Math.min(56, viewport.height / 4);
        setLocation(
          bounds.bottom <= viewport.top + margin
            ? 'above'
            : bounds.top >= viewport.bottom - margin
              ? 'below'
              : 'visible',
        );
      });
    };
    const observer = new ResizeObserver(update);
    observer.observe(container);
    observer.observe(region);
    container.addEventListener('scroll', update, { passive: true });
    update();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      container.removeEventListener('scroll', update);
    };
  }, [anchor, targetPage, page, paper]);
  return !target ? 'visible' : targetPage !== page ? 'other-page' : location;
}
