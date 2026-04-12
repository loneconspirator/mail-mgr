// API wrapper — all fetch calls to the backend

import type { Rule, ImapConfig, ImapConfigResponse } from '../../shared/types.js';
import type { ActivityEntry, StatusResponse } from '../../shared/types.js';

// Re-export for frontend consumers
export type { Rule, ImapConfig, ImapConfigResponse, ActivityEntry, StatusResponse };

async function request<T>(url: string, opts?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts?.body) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(url, {
    ...opts,
    headers: { ...headers, ...opts?.headers as Record<string, string> },
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
    get: () => request<StatusResponse>('/api/status'),
  },
  config: {
    getImap: () => request<ImapConfigResponse>('/api/config/imap'),
    updateImap: (cfg: ImapConfigResponse) => request<ImapConfigResponse>('/api/config/imap', { method: 'PUT', body: JSON.stringify(cfg) }),
    getEnvelopeStatus: () => request<{ envelopeHeader: string | null }>('/api/config/envelope'),
    triggerDiscovery: () => request<{ envelopeHeader: string | null }>('/api/config/envelope/discover', { method: 'POST' }),
  },
};
