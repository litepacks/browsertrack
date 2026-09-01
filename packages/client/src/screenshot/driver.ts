export interface ScreenshotResult {
  ok: boolean;
  dataUrl?: string;
  format?: 'webp' | 'png' | 'jpeg';
  width?: number;
  height?: number;
  reason?: string;
}

export interface ScreenshotDriver {
  name: string;
  captureElement(element: HTMLElement | Element): Promise<ScreenshotResult>;
  captureSelector(selector: string): Promise<ScreenshotResult>;
}
