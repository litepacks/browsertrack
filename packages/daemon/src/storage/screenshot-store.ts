import fs from 'node:fs';
import path from 'node:path';

export class ScreenshotStore {
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
    fs.mkdirSync(this.baseDir, { recursive: true });
  }

  public saveScreenshot(projectId: string, incidentId: string, name: string, dataUrl: string): { filePath: string; format: string } | null {
    try {
      if (!dataUrl || !dataUrl.startsWith('data:image/')) return null;

      const match = dataUrl.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
      if (!match) return null;

      let format = match[1].toLowerCase();
      if (format === 'jpeg') format = 'jpg';
      const base64Data = match[2];
      const buffer = Buffer.from(base64Data, 'base64');

      const targetDir = path.join(this.baseDir, projectId || 'default', 'incidents', incidentId);
      fs.mkdirSync(targetDir, { recursive: true });

      const fileName = `${name}.${format}`;
      const filePath = path.join(targetDir, fileName);

      fs.writeFileSync(filePath, buffer);

      return { filePath, format };
    } catch {
      return null;
    }
  }

  public getScreenshotPath(projectId: string, incidentId: string, name: string): string | null {
    const targetDir = path.join(this.baseDir, projectId || 'default', 'incidents', incidentId);
    if (!fs.existsSync(targetDir)) return null;

    const files = fs.readdirSync(targetDir);
    const match = files.find((f) => f.startsWith(`${name}.`));
    if (match) {
      return path.join(targetDir, match);
    }
    return null;
  }
}
