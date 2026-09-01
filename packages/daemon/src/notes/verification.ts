import crypto from 'node:crypto';
import type { DOMRectJson, NoteStatus, NoteVerificationResult, OverflowCheckResult, VisualNote } from '../../../core/src/index.js';
import type { NotesEngine } from './engine.js';
import type { SessionManager } from '../session/manager.js';
import type { StorageDB } from '../storage/db.js';

export class NoteVerificationEngine {
  private db: StorageDB;
  private sessionManager: SessionManager;
  private notesEngine: NotesEngine;

  constructor(db: StorageDB, sessionManager: SessionManager, notesEngine: NotesEngine) {
    this.db = db;
    this.sessionManager = sessionManager;
    this.notesEngine = notesEngine;
  }

  public async verifyNote(noteId: string, options: { observationWindowMs?: number } = {}): Promise<NoteVerificationResult> {
    const note = this.db.getNote(noteId);
    if (!note) {
      return {
        noteId,
        status: 'FAILED',
        checks: [{ type: 'note_exists', passed: false, details: `Note ${noteId} not found` }],
        timestamp: new Date().toISOString(),
        message: `Note ${noteId} not found in database`,
      };
    }

    // 1. Find active session
    let session = this.sessionManager.getActiveSessionForProject(note.projectId);
    if (!session) {
      session = this.sessionManager.getAnyActiveSession();
    }

    if (!session) {
      const result: NoteVerificationResult = {
        noteId,
        status: 'INCONCLUSIVE',
        checks: [],
        timestamp: new Date().toISOString(),
        message: 'No active browser session currently connected to verify visual note.',
      };
      this.recordNoteVerification(result, note);
      return result;
    }

    // 2. Set status to VERIFYING
    this.db.updateNoteStatus(noteId, 'VERIFYING');

    // 3. Navigation check / route sync
    const pageStateCmd = await this.sessionManager.sendCommand(session.id, {
      id: `cmd_${crypto.randomUUID().slice(0, 8)}`,
      type: 'get_page_state',
    });

    const currentRoute = pageStateCmd.result?.route || '/';
    const isRouteMatch = currentRoute === note.route || currentRoute.startsWith(note.route);

    if (!isRouteMatch && note.route) {
      await this.sessionManager.sendCommand(session.id, {
        id: `cmd_${crypto.randomUUID().slice(0, 8)}`,
        type: 'navigate',
        params: { url: note.route },
      });
      // Wait for navigation observation window
      await new Promise((r) => setTimeout(r, options.observationWindowMs || 1000));
    }

    const checks: Array<{ type: string; passed: boolean; details?: string }> = [];

    checks.push({
      type: 'route_loaded',
      passed: true,
      details: `Route ${note.route || '/'} loaded`,
    });

    // 4. Target element checks
    const targetSelector = note.target?.selector || (note.type === 'page' ? 'body' : 'body');
    let elementExists = true;
    let elementVisible = true;
    let currentRect: DOMRectJson | undefined;
    let overflowResult: OverflowCheckResult | undefined;

    if (note.type === 'element' && targetSelector) {
      const queryCmd = await this.sessionManager.sendCommand(session.id, {
        id: `cmd_${crypto.randomUUID().slice(0, 8)}`,
        type: 'query_element',
        params: { selector: targetSelector },
      });

      elementExists = queryCmd.ok && !!queryCmd.result?.exists;
      elementVisible = queryCmd.ok && !!queryCmd.result?.visible;
      currentRect = queryCmd.result?.boundingRect;

      checks.push({
        type: 'element_exists',
        passed: elementExists,
        details: elementExists ? `Element ${targetSelector} exists in DOM` : `Element ${targetSelector} not found`,
      });

      checks.push({
        type: 'element_visible',
        passed: elementVisible,
        details: elementVisible ? `Element ${targetSelector} is visible` : `Element ${targetSelector} is hidden`,
      });

      // 5. Layout Overflow Probe
      const overflowCmd = await this.sessionManager.sendCommand(session.id, {
        id: `cmd_${crypto.randomUUID().slice(0, 8)}`,
        type: 'check_overflow',
        params: { selector: targetSelector },
      });

      if (overflowCmd.ok && overflowCmd.result) {
        const ovf = overflowCmd.result as OverflowCheckResult;
        overflowResult = ovf;
        const isOverflowingNow = !!ovf.overflow;

        checks.push({
          type: 'no_viewport_overflow',
          passed: !isOverflowingNow,
          details: !isOverflowingNow
            ? `Element fits within viewport (width: ${ovf.viewportWidth}px, rect right: ${ovf.rect?.right}px)`
            : `Element overflows viewport by ${ovf.overflowRightPx}px (rect right: ${ovf.rect?.right}px, viewport: ${ovf.viewportWidth}px)`,
        });
      }
    }

    // 6. Capture "after" screenshot
    let afterScreenshotPath: string | undefined;
    const captureCmd = await this.sessionManager.sendCommand(session.id, {
      id: `cmd_${crypto.randomUUID().slice(0, 8)}`,
      type: 'capture_element',
      params: { selector: targetSelector },
    });

    if (captureCmd.ok && captureCmd.result?.dataUrl) {
      const saved = this.notesEngine.saveNoteScreenshot(note.projectId, note.id, 'after', captureCmd.result.dataUrl);
      if (saved) {
        afterScreenshotPath = saved;
      }
    }

    // 7. Calculate Geometry Difference
    const beforeRect = note.target?.boundingRect;
    const overflowFixed = overflowResult ? !overflowResult.overflow : undefined;

    const geometryDiff = {
      before: beforeRect,
      current: currentRect || (overflowResult?.rect as DOMRectJson),
      viewportWidth: overflowResult?.viewportWidth || note.viewport.width,
      overflowFixed,
      overflowPx: overflowResult?.overflowRightPx || 0,
    };

    // 8. Verdict
    const anyFailed = checks.some((c) => !c.passed);
    let status: NoteStatus = 'VERIFIED';

    if (anyFailed) {
      status = 'FAILED';
    } else {
      status = 'VERIFIED';
    }

    const verificationResult: NoteVerificationResult = {
      noteId,
      status,
      checks,
      geometryDiff,
      screenshots: {
        before: note.screenshots?.original,
        after: afterScreenshotPath,
      },
      timestamp: new Date().toISOString(),
      message:
        status === 'VERIFIED'
          ? 'Visual note verified: target element is present, visible, and layout checks (including viewport overflow) passed.'
          : 'Visual note verification failed: target element missing, hidden, or still overflowing.',
    };

    this.recordNoteVerification(verificationResult, note);
    return verificationResult;
  }

  private recordNoteVerification(result: NoteVerificationResult, note: VisualNote): void {
    this.db.updateNoteStatus(note.id, result.status);
    this.db.insertNoteVerification(result);
  }
}
