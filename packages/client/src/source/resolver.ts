import type { ComponentSourceInfo } from '../../../core/src/index.js';

/**
 * Resolves framework component metadata, source file paths, line numbers,
 * and component hierarchy directly from a live DOM element.
 * Supports React (Fiber), Vue 2 & 3, Svelte, Custom Elements, and standard data attributes.
 */
export function resolveComponentSource(el: HTMLElement): ComponentSourceInfo | undefined {
  if (!el || typeof el !== 'object') return undefined;

  // 1. Try React Fiber Resolution
  const reactInfo = resolveReactComponent(el);
  if (reactInfo) return reactInfo;

  // 2. Try Vue (Vue 3 / Vue 2) Resolution
  const vueInfo = resolveVueComponent(el);
  if (vueInfo) return vueInfo;

  // 3. Try Svelte Resolution
  const svelteInfo = resolveSvelteComponent(el);
  if (svelteInfo) return svelteInfo;

  // 4. Try Web Component / Custom Element
  if (el.tagName && el.tagName.includes('-')) {
    return {
      framework: 'web-component',
      componentName: el.tagName.toLowerCase(),
      hierarchy: [el.tagName.toLowerCase()],
    };
  }

  // 5. Try Data Attribute Annotations (e.g. data-component, data-source-file)
  const attrInfo = resolveDataAttributeComponent(el);
  if (attrInfo) return attrInfo;

  return undefined;
}

/**
 * Extracts React Fiber debug source, owner, and hierarchy
 */
function resolveReactComponent(el: HTMLElement): ComponentSourceInfo | undefined {
  try {
    const fiberKey = Object.keys(el).find(
      (key) => key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$')
    );
    if (!fiberKey) return undefined;

    const hostFiber = (el as any)[fiberKey];
    if (!hostFiber) return undefined;

    let sourceFile: string | undefined;
    let sourceLine: number | undefined;
    let sourceColumn: number | undefined;
    let componentName: string | undefined;
    const hierarchy: string[] = [];
    let props: Record<string, any> | undefined;

    // Check host fiber debugSource first (often populated by JSX transform)
    if (hostFiber._debugSource) {
      sourceFile = hostFiber._debugSource.fileName;
      sourceLine = hostFiber._debugSource.lineNumber;
      sourceColumn = hostFiber._debugSource.columnNumber;
    }

    // Check _debugOwner if available
    if (hostFiber._debugOwner) {
      const ownerType = hostFiber._debugOwner.type;
      componentName = getReactComponentName(ownerType);
      if (!sourceFile && hostFiber._debugOwner._debugSource) {
        sourceFile = hostFiber._debugOwner._debugSource.fileName;
        sourceLine = hostFiber._debugOwner._debugSource.lineNumber;
        sourceColumn = hostFiber._debugOwner._debugSource.columnNumber;
      }
    }

    // Walk up fiber return tree to discover composite components and hierarchy
    let curr = hostFiber;
    while (curr) {
      const type = curr.type;
      const name = getReactComponentName(type);

      if (name && !name.startsWith('html:') && name !== 'Fragment') {
        if (!componentName) {
          componentName = name;
        }
        if (!hierarchy.includes(name)) {
          hierarchy.unshift(name);
        }

        // Check if composite component has debug source
        if (!sourceFile && curr._debugSource) {
          sourceFile = curr._debugSource.fileName;
          sourceLine = curr._debugSource.lineNumber;
          sourceColumn = curr._debugSource.columnNumber;
        }

        // Capture safe props from the nearest custom component
        if (!props && curr.memoizedProps && typeof curr.memoizedProps === 'object') {
          props = sanitizeProps(curr.memoizedProps);
        }
      }

      curr = curr.return;
    }

    if (!componentName && !sourceFile) {
      return undefined;
    }

    return {
      framework: 'react',
      componentName,
      sourceFile: normalizeFilePath(sourceFile),
      sourceLine,
      sourceColumn,
      hierarchy: hierarchy.length > 0 ? hierarchy : componentName ? [componentName] : undefined,
      props,
    };
  } catch {
    return undefined;
  }
}

function getReactComponentName(type: any): string | undefined {
  if (!type) return undefined;
  if (typeof type === 'string') return undefined; // Host DOM tag (div, span, button)
  if (type.displayName) return type.displayName;
  if (type.name) return type.name;
  if (type.render?.displayName) return type.render.displayName;
  if (type.render?.name) return type.render.name;
  return undefined;
}

/**
 * Extracts Vue 3 and Vue 2 component instances and file paths
 */
function resolveVueComponent(el: HTMLElement): ComponentSourceInfo | undefined {
  try {
    // Vue 3
    const vueParent = (el as any).__vueParentComponent || (el as any).__vnode?.ctx;
    if (vueParent) {
      const type = vueParent.type || {};
      const componentName = type.name || type.__name || type.displayName || 'AnonymousComponent';
      const sourceFile = type.__file;
      const hierarchy: string[] = [];

      let curr = vueParent;
      while (curr) {
        const cType = curr.type || {};
        const cName = cType.name || cType.__name || cType.displayName;
        if (cName && !hierarchy.includes(cName)) {
          hierarchy.unshift(cName);
        }
        curr = curr.parent;
      }

      return {
        framework: 'vue',
        componentName,
        sourceFile: normalizeFilePath(sourceFile),
        hierarchy: hierarchy.length > 0 ? hierarchy : [componentName],
        props: vueParent.props ? sanitizeProps(vueParent.props) : undefined,
      };
    }

    // Vue 2
    const vue2Instance = (el as any).__vue__;
    if (vue2Instance) {
      const options = vue2Instance.$options || {};
      const componentName = options.name || options._componentTag || 'VueComponent';
      const sourceFile = options.__file;

      return {
        framework: 'vue',
        componentName,
        sourceFile: normalizeFilePath(sourceFile),
        hierarchy: [componentName],
        props: vue2Instance.$props ? sanitizeProps(vue2Instance.$props) : undefined,
      };
    }

    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Extracts Svelte __svelte_meta debug locations
 */
function resolveSvelteComponent(el: HTMLElement): ComponentSourceInfo | undefined {
  try {
    let curr: HTMLElement | null = el;
    while (curr) {
      const meta = (curr as any).__svelte_meta;
      if (meta && meta.loc) {
        return {
          framework: 'svelte',
          sourceFile: normalizeFilePath(meta.loc.file),
          sourceLine: meta.loc.line,
          sourceColumn: meta.loc.column,
          componentName: meta.loc.file ? getBaseNameWithoutExt(meta.loc.file) : undefined,
          hierarchy: meta.loc.file ? [getBaseNameWithoutExt(meta.loc.file)] : undefined,
        };
      }
      curr = curr.parentElement;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolves components from standard data attributes (e.g. data-component="UserCard")
 */
function resolveDataAttributeComponent(el: HTMLElement): ComponentSourceInfo | undefined {
  try {
    const compEl = el.closest('[data-component], [data-component-name], [data-source-file]');
    if (!compEl) return undefined;

    const componentName =
      compEl.getAttribute('data-component') || compEl.getAttribute('data-component-name') || undefined;
    const sourceFile = compEl.getAttribute('data-source-file') || undefined;
    const lineAttr = compEl.getAttribute('data-source-line');
    const sourceLine = lineAttr ? parseInt(lineAttr, 10) : undefined;

    if (!componentName && !sourceFile) return undefined;

    return {
      framework: 'vanilla',
      componentName,
      sourceFile: normalizeFilePath(sourceFile),
      sourceLine: isNaN(sourceLine as number) ? undefined : sourceLine,
      hierarchy: componentName ? [componentName] : undefined,
    };
  } catch {
    return undefined;
  }
}

function normalizeFilePath(filePath?: string): string | undefined {
  if (!filePath) return undefined;
  // Strip query strings or vite bundle hashes (e.g. /App.tsx?t=123)
  const cleaned = filePath.split('?')[0];
  return cleaned;
}

function getBaseNameWithoutExt(filePath: string): string {
  const parts = filePath.split('/');
  const last = parts[parts.length - 1] || filePath;
  return last.split('.')[0] || last;
}

function sanitizeProps(props: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith('__') || typeof value === 'function') continue;

    if (value === null || value === undefined) {
      result[key] = value;
    } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      result[key] = value;
    } else if (Array.isArray(value)) {
      result[key] = `Array(${value.length})`;
    } else if (typeof value === 'object') {
      result[key] = '[Object]';
    }
  }
  return result;
}
