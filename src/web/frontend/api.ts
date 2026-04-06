// API wrapper — all fetch calls to the backend

import type { Rule, ImapConfig, ReviewConfig } from '../../shared/types.js';
import type { ActivityEntry, StatusResponse, ReviewStatusResponse } from '../../shared/types.js';

// Re-export for frontend consumers
export type { Rule, ImapConfig, ReviewConfig, ActivityEntry, StatusResponse, ReviewStatusResponse };

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
    get: () => request<StatusResponse>('/api/status'),
  },
  review: {
    status: () => request<ReviewStatusResponse>('/api/review/status'),
  },
  config: {
    getImap: () => request<ImapConfig>('/api/config/imap'),
    updateImap: (cfg: ImapConfig) => request<ImapConfig>('/api/config/imap', { method: 'PUT', body: JSON.stringify(cfg) }),
    getReview: () => request<ReviewConfig>('/api/config/review'),
    updateReview: (cfg: Partial<ReviewConfig>) => request<ReviewConfig>('/api/config/review', { method: 'PUT', body: JSON.stringify(cfg) }),
  },
};
