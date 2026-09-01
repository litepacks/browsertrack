import type { Breadcrumb, ElementSummary } from '../../../core/src/index.js';
import { getSemanticSelector, truncate } from '../../../core/src/index.js';

export type InteractionCallback = (breadcrumb: Breadcrumb, elementSummary?: ElementSummary) => void;

/**
 * Extracts a concise ElementSummary from a DOM element.
 * Never collects sensitive user input values.
 */
export function extractElementSummary(el: HTMLElement | Element): ElementSummary {
  const selector = getSemanticSelector(el);
  const tag = el.tagName.toLowerCase();
  const id = el.id || undefined;
  const classes = Array.from(el.classList || []);

  let boundingRect: ElementSummary['boundingRect'] = undefined;
  let visible = true;

  try {
    const rect = el.getBoundingClientRect();
    boundingRect = {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      top: Math.round(rect.top),
      left: Math.round(rect.left),
      bottom: Math.round(rect.bottom),
      right: Math.round(rect.right),
    };

    const style = window.getComputedStyle(el);
    visible = style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && rect.width > 0 && rect.height > 0;
  } catch {
    // Defensive
  }

  // Safe innerText (truncate to 80 chars, ignore password/sensitive elements)
  let innerText: string | undefined;
  if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') {
    innerText = truncate(el.textContent?.trim(), 80);
  }

  // Safe outerHTML (truncate to 200 chars)
  const outerHTML = truncate(el.outerHTML?.trim(), 200);

  return {
    selector,
    tag,
    id,
    classes,
    boundingRect,
    visible,
    innerText,
    outerHTML,
  };
}

/**
 * Sets up global click and submit event tracking.
 */
export function setupInteractionInterceptors(onInteraction: InteractionCallback): () => void {
  if (typeof document === 'undefined') return () => {};

  const onClick = (event: MouseEvent) => {
    try {
      const target = event.target as HTMLElement | null;
      if (!target || !(target instanceof Element)) return;

      const summary = extractElementSummary(target);
      const message = `click ${summary.selector}${summary.innerText ? ` ("${summary.innerText}")` : ''}`;

      onInteraction(
        {
          type: 'click',
          category: 'ui',
          message,
          timestamp: Date.now(),
          element: summary,
        },
        summary
      );
    } catch {
      // Defensive
    }
  };

  const onSubmit = (event: SubmitEvent) => {
    try {
      const target = event.target as HTMLFormElement | null;
      if (!target || !(target instanceof Element)) return;

      const summary = extractElementSummary(target);
      const formAction = target.getAttribute('action') || '';
      const message = `submit form ${summary.selector}${formAction ? ` (action: ${formAction})` : ''}`;

      onInteraction(
        {
          type: 'submit',
          category: 'ui',
          message,
          timestamp: Date.now(),
          element: summary,
        },
        summary
      );
    } catch {
      // Defensive
    }
  };

  document.addEventListener('click', onClick, { capture: true, passive: true });
  document.addEventListener('submit', onSubmit, { capture: true, passive: true });

  return () => {
    document.removeEventListener('click', onClick, { capture: true });
    document.removeEventListener('submit', onSubmit, { capture: true });
  };
}
