import type { IncidentStatus } from './incidents.js';

export type ProbeType =
  | 'element_exists'
  | 'element_visible'
  | 'text_contains'
  | 'route_is'
  | 'network_request_succeeded'
  | 'no_incident';

export interface VerificationProbe {
  type: ProbeType;
  selector?: string;
  text?: string;
  route?: string;
  fingerprint?: string;
  urlPattern?: string;
  timeoutMs?: number;
}

export interface VerificationRecipe {
  route?: string;
  targetSelector?: string;
  expect?: VerificationProbe[];
  observationWindowMs?: number;
}

export interface ProbeResult {
  type: ProbeType;
  passed: boolean;
  details?: string;
}

export interface VerificationResult {
  incidentId: string;
  status: IncidentStatus;
  checks: ProbeResult[];
  screenshots?: {
    before?: string;
    after?: string;
  };
  timestamp: string;
  message?: string;
}
