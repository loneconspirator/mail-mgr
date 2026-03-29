// API wrapper — all fetch calls to the backend

export interface Rule {
  id: string;
  name: string;
  match: { sender?: string; subject?: string; from?: string };
  action: { type: string; folder: string };
  enabled: boolean;
  order: number;
}

export interface ActivityEntry {
  id: number;
  timestamp: string;
  from: string;
  subject: string;
  ruleName: string;
  action: string;
  folder: string;
}

export interface ImapConfig {
  host: string;
  port: number;
  tls: boolean;
  auth: { user: string; pass: string };
  idleTimeout: number;
  pollInterval: number;
}

export interface Status {
  connectionStatus: string;
  lastProcessedAt: string | null;
  messagesProcessed: number;
}

async function request<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  rules: {
    list: () => request<Rule[]>('/api/rules'),
    create: (rule: Omit<Rule, 'id'>) => request<Rule>('/api/rules', { method: 'POST', body: JSON.stringify(rule) }),
    update: (id: string, rule: Omit<Rule, 'id'>) => request<Rule>(`/api/rules/${id}`, { method: 'PUT', body: JSON.stringify(rule) }),
    delete: (id: string) => request<void>(`/api/rules/${id}`, { method: 'DELETE' }),
    reorder: (items: { id: string; order: number }[]) => request<Rule[]>('/api/rules/reorder', { method: 'PUT', body: JSON.stringify(items) }),
  },
  activity: {
    list: (limit = 25, offset = 0) => request<ActivityEntry[]>(`/api/activity?limit=${limit}&offset=${offset}`),
  },
  status: {
    get: () => request<Status>('/api/status'),
  },
  config: {
    getImap: () => request<ImapConfig>('/api/config/imap'),
    updateImap: (cfg: ImapConfig) => request<ImapConfig>('/api/config/imap', { method: 'PUT', body: JSON.stringify(cfg) }),
  },
};
