import type { ElementSummary } from './events.js';

export type CommandType =
  | 'reload'
  | 'navigate'
  | 'get_page_state'
  | 'query_element'
  | 'capture_element'
  | 'check_overflow'
  | 'get_element_rect'
  | 'get_element_style';

export interface ClientCommand<T = any> {
  id: string;
  type: CommandType;
  params?: T;
}

export interface ReloadParams {
  force?: boolean;
}

export interface NavigateParams {
  url: string;
}

export interface QueryElementParams {
  selector: string;
}

export interface CaptureElementParams {
  selector?: string;
}

export interface QueryElementResult {
  exists: boolean;
  visible?: boolean;
  tag?: string;
  id?: string;
  classes?: string[];
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
  innerText?: string;
  outerHTML?: string;
}

export interface PageStateResult {
  url: string;
  route: string;
  title: string;
  readyState: string;
  activeElement?: ElementSummary;
}

export interface CaptureElementResult {
  dataUrl?: string;
  format?: string;
  width?: number;
  height?: number;
}

export interface OverflowCheckResult {
  selector: string;
  overflow: boolean;
  viewportWidth: number;
  viewportHeight: number;
  rect?: {
    x: number;
    y: number;
    width: number;
    height: number;
    top: number;
    left: number;
    bottom: number;
    right: number;
  };
  overflowRightPx: number;
  overflowBottomPx: number;
  parentOverflow?: boolean;
}

export interface ElementStyleResult {
  selector: string;
  styles: Record<string, string>;
}

export interface CommandResponse<T = any> {
  id: string;
  ok: boolean;
  result?: T;
  error?: string;
  reason?: string;
}
