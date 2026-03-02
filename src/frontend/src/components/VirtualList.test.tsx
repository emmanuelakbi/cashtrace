import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { VirtualList } from './VirtualList';

/** Helper to generate a list of numbered items. */
function makeItems(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `Item ${i}`);
}

const ITEM_HEIGHT = 40;
const CONTAINER_HEIGHT = 200;
const DEFAULT_OVERSCAN = 3;

describe('VirtualList', () => {
  describe('rendering', () => {
    it('renders only visible items plus overscan', () => {
      const items = makeItems(100);
      const visibleCount = Math.ceil(CONTAINER_HEIGHT / ITEM_HEIGHT); // 5

      render(
        <VirtualList
          items={items}
          itemHeight={ITEM_HEIGHT}
          containerHeight={CONTAINER_HEIGHT}
          renderItem={(item) => <span>{item}</span>}
        />,
      );

      const rendered = screen.getAllByRole('listitem');
      // startIndex = max(0, 0 - 3) = 0
      // endIndex = min(99, 0 + 5 + 3 - 1) = 7
      expect(rendered).toHaveLength(visibleCount + DEFAULT_OVERSCAN);
    });

    it('renders all items when list is shorter than container', () => {
      const items = makeItems(3);

      render(
        <VirtualList
          items={items}
          itemHeight={ITEM_HEIGHT}
          containerHeight={CONTAINER_HEIGHT}
          renderItem={(item) => <span>{item}</span>}
        />,
      );

      const rendered = screen.getAllByRole('listitem');
      expect(rendered).toHaveLength(3);
    });

    it('renders nothing for an empty list', () => {
      render(
        <VirtualList
          items={[]}
          itemHeight={ITEM_HEIGHT}
          containerHeight={CONTAINER_HEIGHT}
          renderItem={(item: string) => <span>{item}</span>}
        />,
      );

      expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    });
  });

  describe('scroll behaviour', () => {
    it('updates visible items when scrolled', () => {
      const items = makeItems(100);

      render(
        <VirtualList
          items={items}
          itemHeight={ITEM_HEIGHT}
          containerHeight={CONTAINER_HEIGHT}
          renderItem={(item) => <span>{item}</span>}
        />,
      );

      const container = screen.getByRole('list');

      // Scroll down so that item 10 is the first visible row
      Object.defineProperty(container, 'scrollTop', { value: 400, writable: true });
      fireEvent.scroll(container);

      // After scroll: rawStart = 10, startIndex = max(0, 10-3) = 7
      expect(screen.getByText('Item 7')).toBeInTheDocument();
      expect(screen.getByText('Item 10')).toBeInTheDocument();

      // Items far above the viewport should not be rendered
      expect(screen.queryByText('Item 0')).not.toBeInTheDocument();
    });
  });

  describe('positioning', () => {
    it('positions items absolutely at the correct top offset', () => {
      const items = makeItems(20);

      render(
        <VirtualList
          items={items}
          itemHeight={ITEM_HEIGHT}
          containerHeight={CONTAINER_HEIGHT}
          renderItem={(item) => <span>{item}</span>}
        />,
      );

      const listItems = screen.getAllByRole('listitem');
      listItems.forEach((el) => {
        expect(el.style.position).toBe('absolute');
      });

      // First rendered item (index 0) should be at top: 0
      expect(listItems[0].style.top).toBe('0px');
      // Second rendered item (index 1) should be at top: 40px
      expect(listItems[1].style.top).toBe(`${ITEM_HEIGHT}px`);
    });

    it('sets inner container height to total content height', () => {
      const items = makeItems(50);

      const { container } = render(
        <VirtualList
          items={items}
          itemHeight={ITEM_HEIGHT}
          containerHeight={CONTAINER_HEIGHT}
          renderItem={(item) => <span>{item}</span>}
        />,
      );

      const inner = container.querySelector('[role="list"] > div') as HTMLElement;
      expect(inner.style.height).toBe(`${50 * ITEM_HEIGHT}px`);
    });
  });

  describe('overscan', () => {
    it('respects custom overscan value', () => {
      const items = makeItems(100);
      const customOverscan = 5;
      const visibleCount = Math.ceil(CONTAINER_HEIGHT / ITEM_HEIGHT); // 5

      render(
        <VirtualList
          items={items}
          itemHeight={ITEM_HEIGHT}
          containerHeight={CONTAINER_HEIGHT}
          overscan={customOverscan}
          renderItem={(item) => <span>{item}</span>}
        />,
      );

      const rendered = screen.getAllByRole('listitem');
      // startIndex = max(0, 0 - 5) = 0
      // endIndex = min(99, 0 + 5 + 5 - 1) = 9
      expect(rendered).toHaveLength(visibleCount + customOverscan);
    });
  });

  describe('accessibility', () => {
    it('applies role="list" to the container', () => {
      render(
        <VirtualList
          items={makeItems(5)}
          itemHeight={ITEM_HEIGHT}
          containerHeight={CONTAINER_HEIGHT}
          renderItem={(item) => <span>{item}</span>}
        />,
      );

      expect(screen.getByRole('list')).toBeInTheDocument();
    });

    it('applies role="listitem" to each rendered item', () => {
      render(
        <VirtualList
          items={makeItems(5)}
          itemHeight={ITEM_HEIGHT}
          containerHeight={CONTAINER_HEIGHT}
          renderItem={(item) => <span>{item}</span>}
        />,
      );

      const listItems = screen.getAllByRole('listitem');
      expect(listItems.length).toBeGreaterThan(0);
    });

    it('forwards aria-label to the list container', () => {
      render(
        <VirtualList
          items={makeItems(5)}
          itemHeight={ITEM_HEIGHT}
          containerHeight={CONTAINER_HEIGHT}
          ariaLabel="Transaction list"
          renderItem={(item) => <span>{item}</span>}
        />,
      );

      expect(screen.getByRole('list')).toHaveAttribute('aria-label', 'Transaction list');
    });
  });

  describe('container styling', () => {
    it('sets overflow-y auto and fixed height on the container', () => {
      render(
        <VirtualList
          items={makeItems(10)}
          itemHeight={ITEM_HEIGHT}
          containerHeight={CONTAINER_HEIGHT}
          renderItem={(item) => <span>{item}</span>}
        />,
      );

      const container = screen.getByRole('list');
      expect(container.style.overflowY).toBe('auto');
      expect(container.style.height).toBe(`${CONTAINER_HEIGHT}px`);
    });

    it('applies custom className to the container', () => {
      render(
        <VirtualList
          items={makeItems(5)}
          itemHeight={ITEM_HEIGHT}
          containerHeight={CONTAINER_HEIGHT}
          className="my-custom-class"
          renderItem={(item) => <span>{item}</span>}
        />,
      );

      expect(screen.getByRole('list')).toHaveClass('my-custom-class');
    });
  });
});
