import type {
  ClientCommand,
  CommandResponse,
  PageStateResult,
  QueryElementResult,
  CaptureElementResult,
} from '../../../core/src/index.js';
import { truncate } from '../../../core/src/index.js';
import { extractElementSummary } from '../interceptors/interaction.js';
import type { ScreenshotDriver } from '../screenshot/driver.js';

export class ClientCommandHandler {
  private screenshotDriver: ScreenshotDriver;

  constructor(screenshotDriver: ScreenshotDriver) {
    this.screenshotDriver = screenshotDriver;
  }

  public async executeCommand(command: ClientCommand): Promise<CommandResponse> {
    try {
      switch (command.type) {
        case 'reload':
          return this.handleReload(command);

        case 'navigate':
          return this.handleNavigate(command);

        case 'get_page_state':
          return this.handleGetPageState(command);

        case 'query_element':
          return this.handleQueryElement(command);

        case 'capture_element':
          return await this.handleCaptureElement(command);

        case 'check_overflow':
          return this.handleCheckOverflow(command);

        case 'get_element_rect':
          return this.handleGetElementRect(command);

        case 'get_element_style':
          return this.handleGetElementStyle(command);

        default:
          return {
            id: command.id,
            ok: false,
            error: `Unsupported command type: ${(command as any).type}`,
          };
      }
    } catch (err: any) {
      return {
        id: command.id,
        ok: false,
        error: err?.message || 'Command execution failed',
      };
    }
  }

  private handleReload(command: ClientCommand): CommandResponse {
    if (typeof window !== 'undefined' && window.location) {
      setTimeout(() => {
        window.location.reload();
      }, 50);
      return { id: command.id, ok: true, result: { message: 'Reload initiated' } };
    }
    return { id: command.id, ok: false, error: 'No browser window available' };
  }

  private handleNavigate(command: ClientCommand<{ url: string }>): CommandResponse {
    const targetUrl = command.params?.url;
    if (!targetUrl) {
      return { id: command.id, ok: false, error: 'Missing target url parameter' };
    }

    if (typeof window !== 'undefined' && window.location) {
      setTimeout(() => {
        window.location.href = targetUrl;
      }, 50);
      return { id: command.id, ok: true, result: { message: `Navigating to ${targetUrl}` } };
    }
    return { id: command.id, ok: false, error: 'No browser window available' };
  }

  private handleGetPageState(command: ClientCommand): CommandResponse<PageStateResult> {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return { id: command.id, ok: false, error: 'No browser document available' };
    }

    const activeEl = document.activeElement && document.activeElement !== document.body ? extractElementSummary(document.activeElement) : undefined;

    return {
      id: command.id,
      ok: true,
      result: {
        url: window.location.href,
        route: window.location.pathname + window.location.search + window.location.hash,
        title: document.title,
        readyState: document.readyState,
        activeElement: activeEl,
      },
    };
  }

  private handleQueryElement(command: ClientCommand<{ selector: string }>): CommandResponse<QueryElementResult> {
    if (typeof document === 'undefined') {
      return { id: command.id, ok: false, error: 'No browser document available' };
    }

    const selector = command.params?.selector;
    if (!selector) {
      return { id: command.id, ok: false, error: 'Missing selector parameter' };
    }

    const element = document.querySelector(selector);
    if (!element) {
      return {
        id: command.id,
        ok: true,
        result: { exists: false },
      };
    }

    const summary = extractElementSummary(element);

    return {
      id: command.id,
      ok: true,
      result: {
        exists: true,
        visible: summary.visible,
        tag: summary.tag,
        id: summary.id,
        classes: summary.classes,
        boundingRect: summary.boundingRect,
        innerText: summary.innerText,
        outerHTML: summary.outerHTML,
      },
    };
  }

  private async handleCaptureElement(command: ClientCommand<{ selector?: string }>): Promise<CommandResponse<CaptureElementResult>> {
    const selector = command.params?.selector;
    let targetEl: Element | null = null;

    if (selector) {
      targetEl = document.querySelector(selector);
      if (!targetEl) {
        return {
          id: command.id,
          ok: false,
          reason: `ELEMENT_NOT_FOUND: ${selector}`,
          error: `Element not found for selector: ${selector}`,
        };
      }
    } else {
      targetEl = document.body || document.documentElement;
    }

    const captureRes = await this.screenshotDriver.captureElement(targetEl);
    if (!captureRes.ok) {
      return {
        id: command.id,
        ok: false,
        reason: captureRes.reason || 'CAPTURE_FAILED',
        error: captureRes.reason || 'Failed to capture element screenshot',
      };
    }

    return {
      id: command.id,
      ok: true,
      result: {
        dataUrl: captureRes.dataUrl,
        format: captureRes.format,
        width: captureRes.width,
        height: captureRes.height,
      },
    };
  }

  private handleCheckOverflow(command: ClientCommand<{ selector: string }>): CommandResponse {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return { id: command.id, ok: false, error: 'No browser window available' };
    }

    const selector = command.params?.selector;
    if (!selector) {
      return { id: command.id, ok: false, error: 'Missing selector parameter' };
    }

    const el = document.querySelector(selector);
    if (!el) {
      return { id: command.id, ok: false, error: `Element not found: ${selector}` };
    }

    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const overflowRightPx = Math.max(0, Math.round(rect.right - vw));
    const overflowBottomPx = Math.max(0, Math.round(rect.bottom - vh));
    const isViewportOverflow = overflowRightPx > 0 || rect.left < 0;

    let parentOverflow = false;
    if (el.parentElement) {
      parentOverflow = el.parentElement.scrollWidth > el.parentElement.clientWidth;
    }

    return {
      id: command.id,
      ok: true,
      result: {
        selector,
        overflow: isViewportOverflow || parentOverflow,
        viewportWidth: vw,
        viewportHeight: vh,
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          top: Math.round(rect.top),
          left: Math.round(rect.left),
          bottom: Math.round(rect.bottom),
          right: Math.round(rect.right),
        },
        overflowRightPx,
        overflowBottomPx,
        parentOverflow,
      },
    };
  }

  private handleGetElementRect(command: ClientCommand<{ selector: string }>): CommandResponse {
    if (typeof document === 'undefined') {
      return { id: command.id, ok: false, error: 'No browser document available' };
    }

    const selector = command.params?.selector;
    if (!selector) {
      return { id: command.id, ok: false, error: 'Missing selector parameter' };
    }

    const el = document.querySelector(selector);
    if (!el) {
      return { id: command.id, ok: false, error: `Element not found: ${selector}` };
    }

    const rect = el.getBoundingClientRect();
    return {
      id: command.id,
      ok: true,
      result: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        top: Math.round(rect.top),
        left: Math.round(rect.left),
        bottom: Math.round(rect.bottom),
        right: Math.round(rect.right),
      },
    };
  }

  private handleGetElementStyle(command: ClientCommand<{ selector: string; properties?: string[] }>): CommandResponse {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return { id: command.id, ok: false, error: 'No browser window available' };
    }

    const selector = command.params?.selector;
    if (!selector) {
      return { id: command.id, ok: false, error: 'Missing selector parameter' };
    }

    const el = document.querySelector(selector);
    if (!el) {
      return { id: command.id, ok: false, error: `Element not found: ${selector}` };
    }

    const computed = window.getComputedStyle(el);
    const properties = command.params?.properties || ['overflow', 'overflowX', 'overflowY', 'width', 'maxWidth', 'display', 'position'];
    const styles: Record<string, string> = {};

    for (const prop of properties) {
      styles[prop] = computed.getPropertyValue(prop) || (computed as any)[prop] || '';
    }

    return {
      id: command.id,
      ok: true,
      result: {
        selector,
        styles,
      },
    };
  }
}
