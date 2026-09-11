export type StudyView = 'study' | 'summary' | 'review';
export type ReviewKind = 'answers' | 'translation' | 'audio' | 'notebook';
export const BOOK_PAGES = ['本文', '問1', '問2', '問3'];

export function adjacentPage(page: number, direction: number) {
  return Math.max(0, Math.min(BOOK_PAGES.length - 1, page + direction));
}
export function swipeDirection(dx: number, dy: number) {
  return Math.abs(dx) >= 60 && Math.abs(dx) > Math.abs(dy) * 1.5
    ? dx < 0
      ? 1
      : -1
    : 0;
}
export function nextUnanswered(grades: (boolean | null)[], current: number) {
  for (let offset = 1; offset < grades.length; offset++) {
    const index = (current + offset) % grades.length;
    if (grades[index] === null) return index;
  }
  return -1;
}
