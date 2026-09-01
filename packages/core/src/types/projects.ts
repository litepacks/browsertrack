export interface Project {
  id: string;
  name: string;
  origin: string;
  path?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Session {
  id: string;
  projectId: string;
  origin: string;
  url: string;
  title: string;
  userAgent: string;
  connectedAt: string;
  lastSeenAt: string;
  active: boolean;
}
