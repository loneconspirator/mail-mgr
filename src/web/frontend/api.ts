// API wrapper — all fetch calls to the backend

import type { Rule, ImapConfig, ImapConfigResponse, ReviewConfig } from '../../shared/types.js';
import type { ActivityEntry, StatusResponse, ReviewStatusResponse, FolderTreeResponse, MoveTrackerStatusResponse, DeepScanResponse } from '../../shared/types.js';
import type { BatchStatusResponse, DryRunResponse, DryRunGroup } from '../../shared/types.js';

// Re-export for frontend consumers
export type { Rule, ImapConfig, ImapConfigResponse, ReviewConfig, ActivityEntry, StatusResponse, ReviewStatusResponse, FolderTreeResponse, MoveTrackerStatusResponse, DeepScanResponse };
export type { BatchStatusResponse, DryRunResponse, DryRunGroup };

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
    recentFolders: (limit = 5) => request<string[]>(`/api/activity/recent-folders?limit=${limit}`),
  },
  status: {
    get: () => request<StatusResponse>('/api/status'),
  },
  review: {
    status: () => request<ReviewStatusResponse>('/api/review/status'),
  },
  config: {
    getImap: () => request<ImapConfigResponse>('/api/config/imap'),
    updateImap: (cfg: ImapConfigResponse) => request<ImapConfigResponse>('/api/config/imap', { method: 'PUT', body: JSON.stringify(cfg) }),
    getEnvelopeStatus: () => request<{ envelopeHeader: string | null }>('/api/config/envelope'),
    triggerDiscovery: () => request<{ envelopeHeader: string | null }>('/api/config/envelope/discover', { method: 'POST' }),
    getReview: () => request<ReviewConfig>('/api/config/review'),
    updateReview: (cfg: Partial<ReviewConfig>) => request<ReviewConfig>('/api/config/review', { method: 'PUT', body: JSON.stringify(cfg) }),
    getCursor: () => request<{ enabled: boolean }>('/api/settings/cursor'),
    setCursor: (enabled: boolean) => request<void>('/api/settings/cursor', { method: 'PUT', body: JSON.stringify({ enabled }) }),
  },
  folders: {
    list: () => request<FolderTreeResponse>('/api/folders'),
  },
  batch: {
    dryRun: (sourceFolder: string) => request<DryRunResponse>('/api/batch/dry-run', { method: 'POST', body: JSON.stringify({ sourceFolder }) }),
    execute: (sourceFolder: string) => request<{ status: string }>('/api/batch/execute', { method: 'POST', body: JSON.stringify({ sourceFolder }) }),
    cancel: () => request<{ status: string }>('/api/batch/cancel', { method: 'POST' }),
    status: () => request<BatchStatusResponse>('/api/batch/status'),
  },
  tracking: {
    status: () => request<MoveTrackerStatusResponse>('/api/tracking/status'),
    triggerDeepScan: () => request<DeepScanResponse>('/api/tracking/deep-scan', { method: 'POST' }),
  },
};
