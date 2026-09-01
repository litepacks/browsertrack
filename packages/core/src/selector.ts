/**
 * Semantic element selector generation and inspection
 */

export interface SelectorOptions {
  maxClasses?: number;
  maxOuterHTMLLength?: number;
  maxInnerTextLength?: number;
}

/**
 * Builds a clean, human-readable semantic selector for a DOM element.
 * Prioritizes data-testid/data-test, id, semantic tag + specific class, or concise parent path.
 */
export function getSemanticSelector(element: HTMLElement | Element, options: SelectorOptions = {}): string {
  if (!element || !element.tagName) return 'unknown';

  const maxClasses = options.maxClasses ?? 2;

  // 1. Check for standard test attributes
  const testId =
    element.getAttribute('data-testid') ||
    element.getAttribute('data-test') ||
    element.getAttribute('data-cy') ||
    element.getAttribute('data-qa');

  if (testId) {
    return `[data-testid="${testId}"]`;
  }

  // 2. Check for meaningful ID (skip dynamic UUID/numeric IDs)
  const id = element.id;
  if (id && !/^[0-9]+$/.test(id) && !/[0-9a-f]{8}-[0-9a-f]{4}/i.test(id)) {
    return `#${id}`;
  }

  // 3. Check for aria-label or name on buttons/inputs
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel && ariaLabel.length < 30) {
    return `${element.tagName.toLowerCase()}[aria-label="${ariaLabel}"]`;
  }

  const nameAttr = element.getAttribute('name');
  if (nameAttr) {
    return `${element.tagName.toLowerCase()}[name="${nameAttr}"]`;
  }

  // 4. Tag + curated classes
  const tag = element.tagName.toLowerCase();
  const classList = Array.from(element.classList || [])
    .filter((c) => !c.startsWith('css-') && !c.startsWith('_') && !/^[a-z0-9]{5,}$/i.test(c)) // filter hashed utility classes
    .slice(0, maxClasses);

  if (classList.length > 0) {
    const classStr = classList.map((c) => `.${c}`).join('');
    return `${tag}${classStr}`;
  }

  // 5. If generic element (div, span, p) without attributes, try parent context
  if (element.parentElement && element.parentElement !== document.body && element.parentElement !== document.documentElement) {
    const parentSelector = getSemanticSelector(element.parentElement, { maxClasses: 1 });
    if (parentSelector && parentSelector !== 'unknown' && !parentSelector.includes('>')) {
      return `${parentSelector} > ${tag}`;
    }
  }

  return tag;
}

/**
 * Truncates string to specified max length with ellipsis
 */
export function truncate(str: string | undefined | null, maxLength = 200): string {
  if (!str) return '';
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength) + '...';
}
