import type { Breadcrumb, ElementSummary, NetworkEvent } from './events.js';

export type IncidentStatus =
  | 'OPEN'
  | 'FIX_ATTEMPTED'
  | 'VERIFYING'
  | 'VERIFIED'
  | 'FAILED'
  | 'INCONCLUSIVE';

export type IncidentSeverity = 'error' | 'warn' | 'fatal';

export interface IncidentSource {
  file: string;
  line: number;
  column?: number;
}

export interface Incident {
  id: string;
  projectId: string;
  sessionId: string;
  type: string;
  severity: IncidentSeverity;
  message: string;
  source: IncidentSource;
  fingerprint: string;
  route: string;
  firstSeen: string;
  lastSeen: string;
  occurrences: number;
  status: IncidentStatus;
  stack?: string;
  breadcrumbs: Breadcrumb[];
  networkFailures: NetworkEvent[];
  lastElement?: ElementSummary;
  screenshots?: {
    error?: string;
    before?: string;
    after?: string;
  };
}

export interface IncidentOccurrence {
  id: string;
  incidentId: string;
  sessionId: string;
  timestamp: string;
  route: string;
  url: string;
  stack?: string;
  breadcrumbs: Breadcrumb[];
  lastElement?: ElementSummary;
}
