import { describe, expect, it } from 'vitest';
import { resolveComponentSource } from '../../packages/client/src/source/resolver.js';

describe('Component & Source-Map Resolver', () => {
  it('should resolve React component name, source file, line number, and hierarchy from Fiber', () => {
    const parentFiber = {
      type: { name: 'ShopLayout', displayName: 'ShopLayout' },
      return: {
        type: { name: 'App' },
        return: null,
      },
    };

    const ownerFiber = {
      type: { name: 'CheckoutButton' },
      _debugSource: {
        fileName: 'src/components/CheckoutButton.tsx',
        lineNumber: 42,
        columnNumber: 8,
      },
    };

    const hostFiber = {
      type: 'button',
      _debugSource: {
        fileName: 'src/components/CheckoutButton.tsx',
        lineNumber: 42,
        columnNumber: 8,
      },
      _debugOwner: ownerFiber,
      return: {
        type: { name: 'CheckoutButton' },
        memoizedProps: { label: 'Complete Purchase', amount: 49.99 },
        return: parentFiber,
      },
    };

    const fakeButton = {
      tagName: 'BUTTON',
      __reactFiber$abc123: hostFiber,
    } as any;

    const resolved = resolveComponentSource(fakeButton);
    expect(resolved).toBeDefined();
    expect(resolved?.framework).toBe('react');
    expect(resolved?.componentName).toBe('CheckoutButton');
    expect(resolved?.sourceFile).toBe('src/components/CheckoutButton.tsx');
    expect(resolved?.sourceLine).toBe(42);
    expect(resolved?.sourceColumn).toBe(8);
    expect(resolved?.hierarchy).toContain('CheckoutButton');
    expect(resolved?.hierarchy).toContain('ShopLayout');
    expect(resolved?.hierarchy).toContain('App');
    expect(resolved?.props?.label).toBe('Complete Purchase');
    expect(resolved?.props?.amount).toBe(49.99);
  });

  it('should resolve Vue 3 component name and source file from __vueParentComponent', () => {
    const fakeVueElement = {
      tagName: 'DIV',
      __vueParentComponent: {
        type: {
          __name: 'UserProfileCard',
          __file: 'src/components/UserProfileCard.vue?t=12345',
        },
        props: {
          username: 'alice',
          isAdmin: false,
        },
        parent: {
          type: { name: 'DashboardView' },
          parent: null,
        },
      },
    } as any;

    const resolved = resolveComponentSource(fakeVueElement);
    expect(resolved).toBeDefined();
    expect(resolved?.framework).toBe('vue');
    expect(resolved?.componentName).toBe('UserProfileCard');
    expect(resolved?.sourceFile).toBe('src/components/UserProfileCard.vue');
    expect(resolved?.hierarchy).toEqual(['DashboardView', 'UserProfileCard']);
    expect(resolved?.props?.username).toBe('alice');
  });

  it('should resolve Svelte component source location from __svelte_meta', () => {
    const fakeSvelteElement = {
      tagName: 'DIV',
      __svelte_meta: {
        loc: {
          file: 'src/routes/Counter.svelte',
          line: 18,
          column: 4,
        },
      },
    } as any;

    const resolved = resolveComponentSource(fakeSvelteElement);
    expect(resolved).toBeDefined();
    expect(resolved?.framework).toBe('svelte');
    expect(resolved?.sourceFile).toBe('src/routes/Counter.svelte');
    expect(resolved?.sourceLine).toBe(18);
    expect(resolved?.componentName).toBe('Counter');
  });

  it('should identify Custom Elements / Web Components by hyphenated tag name', () => {
    const fakeCustomElement = {
      tagName: 'USER-BADGE',
    } as any;

    const resolved = resolveComponentSource(fakeCustomElement);
    expect(resolved).toBeDefined();
    expect(resolved?.framework).toBe('web-component');
    expect(resolved?.componentName).toBe('user-badge');
  });

  it('should fallback to data-component and data-source-file attributes', () => {
    const fakeElement = {
      tagName: 'DIV',
      closest: (selector: string) => {
        if (selector.includes('data-component')) {
          return {
            getAttribute: (attr: string) => {
              if (attr === 'data-component') return 'MarketingBanner';
              if (attr === 'data-source-file') return 'src/components/Banner.tsx';
              if (attr === 'data-source-line') return '88';
              return null;
            },
          };
        }
        return null;
      },
    } as any;

    const resolved = resolveComponentSource(fakeElement);
    expect(resolved).toBeDefined();
    expect(resolved?.framework).toBe('vanilla');
    expect(resolved?.componentName).toBe('MarketingBanner');
    expect(resolved?.sourceFile).toBe('src/components/Banner.tsx');
    expect(resolved?.sourceLine).toBe(88);
  });
});
