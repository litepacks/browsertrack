import type { Breadcrumb } from '@browserdiag/core';

export class BreadcrumbBuffer {
  private capacity: number;
  private buffer: Breadcrumb[] = [];

  constructor(capacity = 50) {
    this.capacity = capacity;
  }

  public add(breadcrumb: Omit<Breadcrumb, 'timestamp'> & { timestamp?: number }): void {
    const item: Breadcrumb = {
      ...breadcrumb,
      timestamp: breadcrumb.timestamp || Date.now(),
    };

    this.buffer.push(item);
    if (this.buffer.length > this.capacity) {
      this.buffer.shift();
    }
  }

  public getRecent(): Breadcrumb[] {
    return [...this.buffer];
  }

  public clear(): void {
    this.buffer = [];
  }
}
