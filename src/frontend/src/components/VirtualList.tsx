'use client';

import { useCallback, useRef, useState, type ReactNode } from 'react';

/**
 * Props for the VirtualList component.
 *
 * @template T - The type of each item in the list.
 */
export interface VirtualListProps<T> {
  /** The full array of items to render. */
  items: readonly T[];
  /** Fixed height (in px) of each item row. */
  itemHeight: number;
  /** Height (in px) of the scrollable container. */
  containerHeight: number;
  /** Render function called for each visible item. */
  renderItem: (item: T, index: number) => ReactNode;
  /** Number of extra items to render above and below the visible area. Defaults to 3. */
  overscan?: number;
  /** Optional CSS class name applied to the outer scrollable container. */
  className?: string;
  /** Optional accessible label for the list. */
  ariaLabel?: string;
}

/**
 * Lightweight virtual scrolling component that renders only visible items
 * plus a configurable overscan buffer. Uses fixed-height rows with absolute
 * positioning for O(1) layout cost.
 *
 * Requirements: 14.6
 */
export function VirtualList<T>({
  items,
  itemHeight,
  containerHeight,
  renderItem,
  overscan = 3,
  className,
  ariaLabel,
}: VirtualListProps<T>): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);

  const totalHeight = items.length * itemHeight;
  const visibleCount = Math.ceil(containerHeight / itemHeight);

  const rawStart = Math.floor(scrollTop / itemHeight);
  const startIndex = Math.max(0, rawStart - overscan);
  const endIndex = Math.min(items.length - 1, rawStart + visibleCount + overscan - 1);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (el) {
      setScrollTop(el.scrollTop);
    }
  }, []);

  const visibleItems: ReactNode[] = [];
  for (let i = startIndex; i <= endIndex; i++) {
    visibleItems.push(
      <div
        key={i}
        role="listitem"
        style={{
          position: 'absolute',
          top: i * itemHeight,
          left: 0,
          right: 0,
          height: itemHeight,
        }}
      >
        {renderItem(items[i] as T, i)}
      </div>,
    );
  }

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      role="list"
      aria-label={ariaLabel}
      className={className}
      style={{
        overflowY: 'auto',
        height: containerHeight,
        position: 'relative',
      }}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        {visibleItems}
      </div>
    </div>
  );
}
