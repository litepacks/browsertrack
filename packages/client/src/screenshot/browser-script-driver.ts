import { snapdom } from '@zumer/snapdom';
import type { ScreenshotDriver, ScreenshotResult } from './driver.js';

/**
 * Modern DOM snapshot driver using @zumer/snapdom with graceful fallbacks.
 * Converts DOM subtrees and elements into WebP / PNG data URLs.
 */
export class BrowserScriptScreenshotDriver implements ScreenshotDriver {
  public name = 'BrowserScriptScreenshotDriver';

  public async captureSelector(selector: string): Promise<ScreenshotResult> {
    try {
      if (typeof document === 'undefined') {
        return { ok: false, reason: 'NO_DOCUMENT_ENVIRONMENT' };
      }

      const el = document.querySelector(selector);
      if (!el) {
        return { ok: false, reason: `ELEMENT_NOT_FOUND: ${selector}` };
      }

      return await this.captureElement(el);
    } catch (err: any) {
      return { ok: false, reason: err?.message || 'UNKNOWN_CAPTURE_ERROR' };
    }
  }

  public async captureElement(element: HTMLElement | Element): Promise<ScreenshotResult> {
    try {
      if (typeof window === 'undefined' || typeof document === 'undefined') {
        return { ok: false, reason: 'NO_BROWSER_ENVIRONMENT' };
      }

      const rect = element.getBoundingClientRect();
      const width = Math.max(Math.round(rect.width), 10);
      const height = Math.max(Math.round(rect.height), 10);

      // Attempt capture with snapdom
      const capturePromise = (async () => {
        try {
          // Prefer WebP export if supported, otherwise fallback to PNG
          let imgElement: HTMLImageElement | undefined = undefined;
          let format: 'webp' | 'png' = 'webp';

          try {
            if (typeof snapdom === 'function') {
              const captureRes = await snapdom(element as any, { scale: 1, embedFonts: false });
              if (captureRes && typeof captureRes.toWebp === 'function') {
                imgElement = await captureRes.toWebp();
              } else if (captureRes && typeof captureRes.toPng === 'function') {
                imgElement = await captureRes.toPng();
                format = 'png';
              } else if (captureRes?.url) {
                return {
                  ok: true,
                  dataUrl: captureRes.url,
                  format: 'webp' as const,
                  width,
                  height,
                };
              }
            } else if ((snapdom as any)?.toWebp) {
              imgElement = await (snapdom as any).toWebp(element, {
                scale: 1,
                embedFonts: false,
              });
            } else if ((snapdom as any)?.toPng) {
              imgElement = await (snapdom as any).toPng(element, {
                scale: 1,
                embedFonts: false,
              });
              format = 'png';
            }
          } catch {
            // Fall through to fallback
          }

          if (imgElement && imgElement.src) {
            return {
              ok: true,
              dataUrl: imgElement.src,
              format: imgElement.src.startsWith('data:image/webp') ? ('webp' as const) : format,
              width: imgElement.naturalWidth || width,
              height: imgElement.naturalHeight || height,
            };
          }
        } catch (snapErr: any) {
          const errMsg = String(snapErr?.message || snapErr);
          if (errMsg.includes('CORS') || errMsg.includes('SecurityError') || errMsg.includes('tainted')) {
            return { ok: false, reason: 'CROSS_ORIGIN_RESOURCE' };
          }
          // Fallback to minimal canvas capture below
        }

        // Fallback: minimal inline SVG ForeignObject capture
        return await this.captureWithSvgFallback(element, width, height);
      })();

      // 3 second timeout protection
      const timeoutPromise = new Promise<ScreenshotResult>((resolve) => {
        setTimeout(() => resolve({ ok: false, reason: 'CAPTURE_TIMEOUT' }), 3000);
      });

      return await Promise.race([capturePromise, timeoutPromise]);
    } catch (err: any) {
      return { ok: false, reason: err?.message || 'CAPTURE_EXCEPTION' };
    }
  }

  private async captureWithSvgFallback(
    element: HTMLElement | Element,
    width: number,
    height: number
  ): Promise<ScreenshotResult> {
    try {
      const clone = element.cloneNode(true) as HTMLElement;
      const computed = window.getComputedStyle(element);
      let cssText = '';
      for (let i = 0; i < computed.length; i++) {
        const prop = computed[i];
        cssText += `${prop}:${computed.getPropertyValue(prop)};`;
      }
      clone.style.cssText = cssText;
      clone.style.margin = '0';
      clone.style.position = 'static';

      const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
          <foreignObject width="100%" height="100%">
            <div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;height:${height}px;">
              ${clone.outerHTML}
            </div>
          </foreignObject>
        </svg>
      `.trim();

      const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);

      return await new Promise<ScreenshotResult>((resolve) => {
        const img = new Image();
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
              URL.revokeObjectURL(url);
              resolve({ ok: false, reason: 'CANVAS_CONTEXT_UNAVAILABLE' });
              return;
            }

            ctx.drawImage(img, 0, 0);
            URL.revokeObjectURL(url);

            let dataUrl: string;
            try {
              dataUrl = canvas.toDataURL('image/webp', 0.85);
            } catch {
              dataUrl = canvas.toDataURL('image/png');
            }

            resolve({
              ok: true,
              dataUrl,
              format: dataUrl.startsWith('data:image/webp') ? 'webp' : 'png',
              width,
              height,
            });
          } catch (e: any) {
            URL.revokeObjectURL(url);
            if (e?.name === 'SecurityError' || String(e).includes('tainted')) {
              resolve({ ok: false, reason: 'CROSS_ORIGIN_RESOURCE' });
            } else {
              resolve({ ok: false, reason: e?.message || 'CANVAS_EXPORT_FAILED' });
            }
          }
        };

        img.onerror = () => {
          URL.revokeObjectURL(url);
          resolve({ ok: false, reason: 'IMAGE_LOAD_FAILED' });
        };

        img.src = url;
      });
    } catch (e: any) {
      return { ok: false, reason: e?.message || 'FALLBACK_CAPTURE_FAILED' };
    }
  }
}
