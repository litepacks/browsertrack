export type EventType =
  | 'runtime_error'
  | 'unhandled_rejection'
  | 'console'
  | 'fetch'
  | 'xhr'
  | 'navigation'
  | 'interaction';

export type ConsoleLevel = 'error' | 'warn' | 'info' | 'log' | 'debug';

export interface ElementSummary {
  selector: string;
  tag: string;
  id?: string;
  classes?: string[];
  attributes?: Record<string, string>;
  outerHTML?: string;
  innerText?: string;
  boundingRect?: {
    x: number;
    y: number;
    width: number;
    height: number;
    top: number;
    left: number;
    bottom: number;
    right: number;
  };
  visible: boolean;
}

export interface Breadcrumb {
  id?: string;
  type: 'navigation' | 'click' | 'submit' | 'fetch' | 'xhr' | 'console' | 'error';
  category?: string;
  message: string;
  timestamp: number;
  level?: 'info' | 'warn' | 'error';
  data?: Record<string, any>;
  element?: ElementSummary;
}

export interface NetworkEvent {
  id?: string;
  url: string;
  method: string;
  status?: number;
  statusText?: string;
  durationMs: number;
  error?: string;
  aborted?: boolean;
  timestamp: number;
  requestHeaders?: Record<string, string>;
}

export interface RuntimeErrorEvent {
  message: string;
  stack?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  errorType: string;
  timestamp: number;
}

export interface ConsoleEvent {
  level: ConsoleLevel;
  message: string;
  args?: any[];
  stack?: string;
  timestamp: number;
}

export interface NavigationEvent {
  from?: string;
  to: string;
  type: 'pushState' | 'replaceState' | 'popstate' | 'hashchange' | 'initial';
  timestamp: number;
}

export interface HelloMessage {
  type: 'hello';
  origin: string;
  url: string;
  title: string;
  userAgent: string;
  timestamp: number;
  projectId?: string;
}

export interface ClientEventMessage {
  type: 'event';
  sessionId: string;
  eventType: EventType;
  payload:
    | RuntimeErrorEvent
    | ConsoleEvent
    | NetworkEvent
    | NavigationEvent
    | Breadcrumb;
  breadcrumbs?: Breadcrumb[];
  lastElement?: ElementSummary;
  route?: string;
  url: string;
  title?: string;
  timestamp: number;
}
