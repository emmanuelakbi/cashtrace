'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

/**
 * Moves focus to the main content area after route transitions so screen
 * readers announce the new page.
 *
 * @param targetId - The id of the element to focus (defaults to `main-content`).
 *
 * Requirement: 13.4
 */
export function useFocusOnRouteChange(targetId = 'main-content'): void {
  const pathname = usePathname();
  const isFirstRender = useRef(true);

  useEffect(() => {
    // Skip the initial mount — only focus on subsequent navigations.
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    const target = document.getElementById(targetId);
    if (!target) return;

    // Make the element programmatically focusable without adding it to the
    // natural tab order.
    if (!target.hasAttribute('tabindex')) {
      target.setAttribute('tabindex', '-1');
    }

    target.focus({ preventScroll: false });
  }, [pathname, targetId]);
}
