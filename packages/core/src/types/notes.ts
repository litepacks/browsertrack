export type NoteType = 'element' | 'region' | 'page';

export type NoteStatus =
  | 'OPEN'
  | 'IN_PROGRESS'
  | 'VERIFYING'
  | 'READY_FOR_REVIEW'
  | 'VERIFIED'
  | 'RESOLVED'
  | 'FAILED'
  | 'INCONCLUSIVE';

export interface ViewportContext {
  width: number;
  height: number;
  devicePixelRatio: number;
}

export interface ScrollContext {
  scrollX: number;
  scrollY: number;
}

export interface DOMRectJson {
  x: number;
  y: number;
  width: number;
  height: number;
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export interface NoteTarget {
  selector: string;
  boundingRect: DOMRectJson;
  visible: boolean;
  confidence?: 'high' | 'medium' | 'low';
}

export interface ElementContext {
  selector: string;
  tag: string;
  attributes?: Record<string, string>;
  outerHTML?: string;
  innerText?: string;
  parent?: {
    selector: string;
    tag: string;
  };
}

export interface RegionContext {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VisualNote {
  id: string;
  projectId: string;
  sessionId: string;
  type: NoteType;
  message: string;
  route: string;
  url: string;
  viewport: ViewportContext;
  scroll: ScrollContext;
  target?: NoteTarget;
  elementContext?: ElementContext;
  region?: RegionContext;
  status: NoteStatus;
  incidentId?: string;
  scenarioId?: string;
  stepNumber?: number;
  scenarioTitle?: string;
  screenshots?: {
    original?: string;
    after?: string;
  };
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
}

export interface ScenarioOverview {
  id: string;
  projectId: string;
  title: string;
  stepsCount: number;
  status: NoteStatus;
  route: string;
  firstStepAt: string;
  lastStepAt: string;
}

export interface ScenarioDetail {
  id: string;
  projectId: string;
  title: string;
  stepsCount: number;
  status: NoteStatus;
  steps: VisualNote[];
  createdAt: string;
  updatedAt: string;
}

export interface NoteVerificationResult {
  noteId: string;
  status: NoteStatus;
  checks: Array<{
    type: string;
    passed: boolean;
    details?: string;
  }>;
  geometryDiff?: {
    before?: DOMRectJson;
    current?: DOMRectJson;
    viewportWidth?: number;
    overflowFixed?: boolean;
    overflowPx?: number;
  };
  screenshots?: {
    before?: string;
    after?: string;
  };
  timestamp: string;
  message?: string;
}
