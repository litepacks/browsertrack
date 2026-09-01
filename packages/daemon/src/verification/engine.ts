import crypto from 'node:crypto';
import type {
  Incident,
  IncidentStatus,
  ProbeResult,
  VerificationProbe,
  VerificationRecipe,
  VerificationResult,
} from '../../../core/src/index.js';
import type { SessionManager } from '../session/manager.js';
import type { StorageDB } from '../storage/db.js';
import type { ScreenshotStore } from '../storage/screenshot-store.js';

export class VerificationEngine {
  private db: StorageDB;
  private sessionManager: SessionManager;
  private screenshotStore: ScreenshotStore;

  constructor(db: StorageDB, sessionManager: SessionManager, screenshotStore: ScreenshotStore) {
    this.db = db;
    this.sessionManager = sessionManager;
    this.screenshotStore = screenshotStore;
  }

  public async verifyIncident(incidentId: string, recipe?: VerificationRecipe): Promise<VerificationResult> {
    const incident = this.db.getIncident(incidentId);
    if (!incident) {
      return {
        incidentId,
        status: 'FAILED',
        checks: [{ type: 'no_incident', passed: false, details: `Incident ${incidentId} not found` }],
        timestamp: new Date().toISOString(),
        message: `Incident ${incidentId} not found in database`,
      };
    }

    // 1. Find active session
    let session = this.sessionManager.getActiveSessionForProject(incident.projectId);
    if (!session) {
      session = this.sessionManager.getAnyActiveSession();
    }

    if (!session) {
      const result: VerificationResult = {
        incidentId,
        status: 'INCONCLUSIVE',
        checks: [],
        timestamp: new Date().toISOString(),
        message: 'No active browser session currently connected to verify the fix.',
      };
      this.recordVerification(result, incident);
      return result;
    }

    // 2. Set status to VERIFYING and record baseline
    this.db.updateIncidentStatus(incidentId, 'VERIFYING');
    const baselineOccurrences = incident.occurrences;

    // 3. Initiate browser reload or navigation
    const targetRoute = recipe?.route || incident.route;
    const observationMs = recipe?.observationWindowMs || 2000;

    if (recipe?.route && recipe.route !== incident.route) {
      await this.sessionManager.sendCommand(session.id, {
        id: `cmd_${crypto.randomUUID().slice(0, 8)}`,
        type: 'navigate',
        params: { url: recipe.route },
      });
    } else {
      await this.sessionManager.sendCommand(session.id, {
        id: `cmd_${crypto.randomUUID().slice(0, 8)}`,
        type: 'reload',
        params: { force: true },
      });
    }

    // 4. Observation window
    await new Promise((resolve) => setTimeout(resolve, observationMs));

    // 5. Check if incident re-occurred
    const freshIncident = this.db.getIncident(incidentId);
    const hasReoccurred = freshIncident ? freshIncident.occurrences > baselineOccurrences : false;

    const checks: ProbeResult[] = [];
    checks.push({
      type: 'no_incident',
      passed: !hasReoccurred,
      details: hasReoccurred
        ? `Incident reoccurred (${freshIncident?.occurrences} occurrences vs baseline ${baselineOccurrences})`
        : 'No recurring error observed during verification window',
    });

    // 6. Run additional probes
    const probes = recipe?.expect || [];
    for (const probe of probes) {
      const probeRes = await this.evaluateProbe(session.id, probe);
      checks.push(probeRes);
    }

    // 7. Check target element or last element for after-screenshot
    let afterScreenshotPath: string | undefined;
    const targetSelector = recipe?.targetSelector || incident.lastElement?.selector;

    if (targetSelector) {
      const captureCmd = await this.sessionManager.sendCommand(session.id, {
        id: `cmd_${crypto.randomUUID().slice(0, 8)}`,
        type: 'capture_element',
        params: { selector: targetSelector },
      });

      if (captureCmd.ok && captureCmd.result?.dataUrl) {
        const saved = this.screenshotStore.saveScreenshot(
          incident.projectId,
          incident.id,
          'verified',
          captureCmd.result.dataUrl
        );
        if (saved) {
          afterScreenshotPath = saved.filePath;
        }
      }
    }

    // 8. Calculate verdict
    let verdict: IncidentStatus = 'VERIFIED';
    const anyCheckFailed = checks.some((c) => !c.passed);

    if (anyCheckFailed || hasReoccurred) {
      verdict = 'FAILED';
    } else {
      // Check if incident required an explicit interaction (like button click) that wasn't covered by probes
      const wasInteractionError = incident.breadcrumbs.some((b) => b.type === 'click' || b.type === 'submit');
      if (wasInteractionError && probes.length === 0) {
        verdict = 'INCONCLUSIVE';
      }
    }

    const verificationResult: VerificationResult = {
      incidentId,
      status: verdict,
      checks,
      screenshots: {
        before: incident.screenshots?.error,
        after: afterScreenshotPath,
      },
      timestamp: new Date().toISOString(),
      message:
        verdict === 'VERIFIED'
          ? 'Fix verified: Error did not reoccur and all checks passed.'
          : verdict === 'FAILED'
            ? 'Verification failed: Error reoccurred or probe expectation was not met.'
            : 'Verification inconclusive: Error did not appear on reload, but specific interaction may need manual verification or custom probes.',
    };

    this.recordVerification(verificationResult, incident);
    return verificationResult;
  }

  private async evaluateProbe(sessionId: string, probe: VerificationProbe): Promise<ProbeResult> {
    try {
      switch (probe.type) {
        case 'element_exists': {
          if (!probe.selector) {
            return { type: probe.type, passed: false, details: 'Missing selector in probe' };
          }
          const res = await this.sessionManager.sendCommand(sessionId, {
            id: `cmd_${crypto.randomUUID().slice(0, 8)}`,
            type: 'query_element',
            params: { selector: probe.selector },
          });
          const exists = res.ok && !!res.result?.exists;
          return {
            type: probe.type,
            passed: exists,
            details: exists ? `Element ${probe.selector} exists in DOM` : `Element ${probe.selector} does not exist`,
          };
        }

        case 'element_visible': {
          if (!probe.selector) {
            return { type: probe.type, passed: false, details: 'Missing selector in probe' };
          }
          const res = await this.sessionManager.sendCommand(sessionId, {
            id: `cmd_${crypto.randomUUID().slice(0, 8)}`,
            type: 'query_element',
            params: { selector: probe.selector },
          });
          const visible = res.ok && !!res.result?.exists && !!res.result?.visible;
          return {
            type: probe.type,
            passed: visible,
            details: visible ? `Element ${probe.selector} is visible` : `Element ${probe.selector} is not visible`,
          };
        }

        case 'text_contains': {
          if (!probe.selector || !probe.text) {
            return { type: probe.type, passed: false, details: 'Missing selector or text in probe' };
          }
          const res = await this.sessionManager.sendCommand(sessionId, {
            id: `cmd_${crypto.randomUUID().slice(0, 8)}`,
            type: 'query_element',
            params: { selector: probe.selector },
          });
          const innerText = res.result?.innerText || '';
          const contains = res.ok && innerText.includes(probe.text);
          return {
            type: probe.type,
            passed: contains,
            details: contains
              ? `Element ${probe.selector} contains text "${probe.text}"`
              : `Element text "${innerText}" did not contain "${probe.text}"`,
          };
        }

        case 'route_is': {
          if (!probe.route) {
            return { type: probe.type, passed: false, details: 'Missing route in probe' };
          }
          const res = await this.sessionManager.sendCommand(sessionId, {
            id: `cmd_${crypto.randomUUID().slice(0, 8)}`,
            type: 'get_page_state',
          });
          const currentRoute = res.result?.route || '';
          const matches = res.ok && (currentRoute === probe.route || currentRoute.startsWith(probe.route));
          return {
            type: probe.type,
            passed: matches,
            details: matches
              ? `Current route matches ${probe.route}`
              : `Current route is "${currentRoute}", expected "${probe.route}"`,
          };
        }

        default:
          return {
            type: probe.type,
            passed: true,
            details: `Probe ${probe.type} evaluated`,
          };
      }
    } catch (err: any) {
      return {
        type: probe.type,
        passed: false,
        details: err?.message || 'Probe execution error',
      };
    }
  }

  private recordVerification(result: VerificationResult, incident: Incident): void {
    this.db.updateIncidentStatus(incident.id, result.status);
    this.db.insertVerification({
      id: `ver_${crypto.randomUUID().slice(0, 8)}`,
      incidentId: incident.id,
      status: result.status,
      checks: result.checks,
      beforeScreenshot: result.screenshots?.before,
      afterScreenshot: result.screenshots?.after,
      message: result.message,
      createdAt: result.timestamp,
    });
  }
}
