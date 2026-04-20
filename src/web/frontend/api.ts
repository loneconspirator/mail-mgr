// API wrapper — all fetch calls to the backend

import type { Rule, ImapConfig, ImapConfigResponse, ReviewConfig } from '../../shared/types.js';
import type { ActivityEntry, StatusResponse, ReviewStatusResponse, FolderTreeResponse, MoveTrackerStatusResponse, DeepScanResponse } from '../../shared/types.js';
import type { BatchStatusResponse, DryRunResponse, DryRunGroup } from '../../shared/types.js';
import type { ProposedRuleCard } from '../../shared/types.js';

// Re-export for frontend consumers
export type { Rule, ImapConfig, ImapConfigResponse, ReviewConfig, ActivityEntry, StatusResponse, ReviewStatusResponse, FolderTreeResponse, MoveTrackerStatusResponse, DeepScanResponse };
export type { BatchStatusResponse, DryRunResponse, DryRunGroup };
export type { ProposedRuleCard };
export { ApiError };

class ApiError extends Error {
  conflict?: { type: 'exact' | 'shadow'; rule: { id: string; name?: string; match: Record<string, string | undefined>; order: number; action: { type: string; folder?: string } } };

  constructor(message: string, conflict?: ApiError['conflict']) {
    super(message);
    this.name = 'ApiError';
    this.conflict = conflict;
  }
}

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
    if (res.status === 409 && body.conflict) {
      throw new ApiError(body.error || 'Conflict', body.conflict);
    }
    throw new ApiError(body.error || `HTTP ${res.status}`);
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
  proposed: {
    list: () => request<ProposedRuleCard[]>('/api/proposed-rules'),
    approve: (id: number) => request<Rule>(`/api/proposed-rules/${id}/approve`, { method: 'POST' }),
    approveInsertBefore: (id: number, beforeRuleId: string) => request<Rule>(`/api/proposed-rules/${id}/approve?insertBefore=${beforeRuleId}`, { method: 'POST' }),
    approveAsReview: (id: number) => request<Rule>(`/api/proposed-rules/${id}/approve?asReview=true`, { method: 'POST' }),
    approveAsReviewInsertBefore: (id: number, beforeRuleId: string) => request<Rule>(`/api/proposed-rules/${id}/approve?asReview=true&insertBefore=${beforeRuleId}`, { method: 'POST' }),
    dismiss: (id: number) => request<void>(`/api/proposed-rules/${id}/dismiss`, { method: 'POST' }),
    getModifyData: (id: number) => request<{ proposalId: number; sender: string; envelopeRecipient: string | null; destinationFolder: string; sourceFolder: string }>(`/api/proposed-rules/${id}/modify`, { method: 'POST' }),
    markApproved: (id: number, ruleId: string) => request<void>(`/api/proposed-rules/${id}/mark-approved`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ruleId }) }),
  },
};
