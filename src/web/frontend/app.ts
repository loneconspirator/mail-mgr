import { api } from './api.js';
import type { Rule, ActivityEntry, ImapConfig } from './api.js';

// --- State ---
let currentPage = 'rules';
let activityTimer: ReturnType<typeof setInterval> | null = null;

// --- Helpers ---
function $(sel: string): HTMLElement { return document.querySelector(sel)!; }
function h(tag: string, attrs: Record<string, string> = {}, ...children: (string | Node)[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('data-')) el.setAttribute(k, v);
    else (el as any)[k] = v;
  }
  for (const c of children) {
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

function toast(msg: string, isError = false) {
  const el = h('div', { className: `toast${isError ? ' error' : ''}` }, msg);
  document.body.append(el);
  setTimeout(() => el.remove(), 3000);
}

function clearApp() {
  $('#app').innerHTML = '';
  if (activityTimer) { clearInterval(activityTimer); activityTimer = null; }
}

// --- Navigation ---
function initNav() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const page = (btn as HTMLElement).dataset.page!;
      navigate(page);
    });
  });
}

function navigate(page: string) {
  currentPage = page;
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', (b as HTMLElement).dataset.page === page));
  clearApp();
  if (page === 'rules') renderRules();
  else if (page === 'activity') renderActivity();
  else if (page === 'settings') renderSettings();
}

// --- Rules Page ---
async function renderRules() {
  const app = $('#app');
  app.innerHTML = '<p>Loading...</p>';

  try {
    const rules = await api.rules.list();
    app.innerHTML = '';

    const toolbar = h('div', { className: 'toolbar' },
      h('h2', {}, 'Email Rules'),
      h('button', { className: 'btn btn-primary', id: 'add-rule-btn' }, '+ Add Rule'),
    );
    app.append(toolbar);

    document.getElementById('add-rule-btn')!.addEventListener('click', () => openRuleModal());

    if (rules.length === 0) {
      app.append(h('div', { className: 'empty' }, 'No rules yet. Create one to get started.'));
      return;
    }

    const table = document.createElement('table');
    table.innerHTML = `<thead><tr>
      <th>Name</th><th>Match</th><th>Action</th><th>Enabled</th><th></th>
    </tr></thead>`;
    const tbody = document.createElement('tbody');

    for (const rule of rules) {
      const tr = document.createElement('tr');
      tr.dataset.id = rule.id;

      const matchStr = Object.entries(rule.match).map(([k, v]) => `${k}: ${v}`).join(', ');
      const actionStr = 'folder' in rule.action ? `${rule.action.type} → ${rule.action.folder}` : rule.action.type;

      const toggleLabel = document.createElement('label');
      toggleLabel.className = 'toggle';
      const toggleInput = document.createElement('input');
      toggleInput.type = 'checkbox';
      toggleInput.checked = rule.enabled;
      toggleInput.addEventListener('change', async () => {
        try {
          await api.rules.update(rule.id, { ...rule, enabled: toggleInput.checked });
        } catch (e: any) { toast(e.message, true); }
      });
      const slider = h('span', { className: 'slider' });
      toggleLabel.append(toggleInput, slider);

      const editBtn = h('button', { className: 'btn btn-sm' }, 'Edit');
      editBtn.addEventListener('click', () => openRuleModal(rule));

      const deleteBtn = h('button', { className: 'btn btn-sm btn-danger' }, 'Del');
      deleteBtn.addEventListener('click', async () => {
        if (!confirm(`Delete rule "${rule.name}"?`)) return;
        try {
          await api.rules.delete(rule.id);
          toast('Rule deleted');
          renderRules();
        } catch (e: any) { toast(e.message, true); }
      });

      const actionsCell = h('td', {}, editBtn, document.createTextNode(' '), deleteBtn);

      tr.append(
        h('td', {}, rule.name ?? ''),
        h('td', {}, matchStr),
        h('td', {}, actionStr),
        h('td', {}, toggleLabel),
        actionsCell,
      );
      tbody.append(tr);
    }

    table.append(tbody);
    app.append(table);
  } catch (e: any) {
    app.innerHTML = '';
    app.append(h('div', { className: 'empty' }, `Failed to load rules: ${e.message}`));
  }
}

function openRuleModal(rule?: Rule) {
  const isEdit = !!rule;
  const overlay = h('div', { className: 'modal-overlay' });
  const modal = h('div', { className: 'modal' });

  modal.innerHTML = `
    <h2>${isEdit ? 'Edit Rule' : 'New Rule'}</h2>
    <div class="form-group"><label>Name</label><input id="m-name" value="${rule?.name || ''}" /></div>
    <div class="form-group"><label>Match Sender</label><input id="m-sender" value="${rule?.match?.sender || ''}" placeholder="*@example.com" /></div>
    <div class="form-group"><label>Match Subject</label><input id="m-subject" value="${rule?.match?.subject || ''}" placeholder="*newsletter*" /></div>
    <div class="form-group"><label>Action</label><select id="m-action-type"><option value="move">Move</option></select></div>
    <div class="form-group"><label>Folder</label><input id="m-folder" value="${rule?.action && 'folder' in rule.action ? rule.action.folder || '' : ''}" placeholder="Archive" /></div>
    <div class="form-actions">
      <button class="btn" id="m-cancel">Cancel</button>
      <button class="btn btn-primary" id="m-save">${isEdit ? 'Save' : 'Create'}</button>
    </div>
  `;

  overlay.append(modal);
  document.body.append(overlay);

  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.getElementById('m-cancel')!.addEventListener('click', () => overlay.remove());
  document.getElementById('m-save')!.addEventListener('click', async () => {
    const name = (document.getElementById('m-name') as HTMLInputElement).value.trim();
    const sender = (document.getElementById('m-sender') as HTMLInputElement).value.trim();
    const subject = (document.getElementById('m-subject') as HTMLInputElement).value.trim();
    const folder = (document.getElementById('m-folder') as HTMLInputElement).value.trim();

    if (!name || !folder) { toast('Name and folder are required', true); return; }

    const match: Record<string, string> = {};
    if (sender) match.sender = sender;
    if (subject) match.subject = subject;
    if (!sender && !subject) { toast('At least one match field is required', true); return; }

    const payload = {
      name,
      match,
      action: { type: 'move' as const, folder },
      enabled: rule?.enabled ?? true,
      order: rule?.order ?? 0,
    };

    try {
      if (isEdit) {
        await api.rules.update(rule!.id, payload);
        toast('Rule updated');
      } else {
        await api.rules.create(payload);
        toast('Rule created');
      }
      overlay.remove();
      renderRules();
    } catch (e: any) { toast(e.message, true); }
  });
}

// --- Activity Page ---
let activityOffset = 0;
const ACTIVITY_LIMIT = 25;

async function renderActivity() {
  const app = $('#app');
  app.innerHTML = '<p>Loading...</p>';

  try {
    const entries = await api.activity.list(ACTIVITY_LIMIT, activityOffset);
    app.innerHTML = '';

    const toolbar = h('div', { className: 'toolbar' },
      h('h2', {}, 'Recent Activity'),
    );
    app.append(toolbar);

    if (entries.length === 0 && activityOffset === 0) {
      app.append(h('div', { className: 'empty' }, 'No activity recorded yet.'));
    } else {
      const table = document.createElement('table');
      table.innerHTML = `<thead><tr>
        <th>Time</th><th>From</th><th>Subject</th><th>Rule</th><th>Action</th><th>Folder</th>
      </tr></thead>`;
      const tbody = document.createElement('tbody');

      for (const e of entries) {
        const tr = document.createElement('tr');
        const time = new Date(e.timestamp).toLocaleString();
        tr.append(
          h('td', {}, time),
          h('td', {}, e.from ?? ''),
          h('td', {}, e.subject ?? ''),
          h('td', {}, e.ruleName ?? ''),
          h('td', {}, e.action),
          h('td', {}, e.folder ?? ''),
        );
        tbody.append(tr);
      }
      table.append(tbody);
      app.append(table);

      // Pagination
      const pag = h('div', { className: 'pagination' });
      if (activityOffset > 0) {
        const prev = h('button', { className: 'btn btn-sm' }, 'Previous');
        prev.addEventListener('click', () => { activityOffset = Math.max(0, activityOffset - ACTIVITY_LIMIT); renderActivity(); });
        pag.append(prev);
      }
      if (entries.length === ACTIVITY_LIMIT) {
        const next = h('button', { className: 'btn btn-sm' }, 'Next');
        next.addEventListener('click', () => { activityOffset += ACTIVITY_LIMIT; renderActivity(); });
        pag.append(next);
      }
      if (pag.children.length > 0) app.append(pag);
    }

    // Auto-refresh every 30s
    activityTimer = setInterval(() => {
      if (currentPage === 'activity') renderActivity();
    }, 30000);

  } catch (e: any) {
    app.innerHTML = '';
    app.append(h('div', { className: 'empty' }, `Failed to load activity: ${e.message}`));
  }
}

// --- Settings Page ---
async function renderSettings() {
  const app = $('#app');
  app.innerHTML = '<p>Loading...</p>';

  try {
    const [imapCfg, status] = await Promise.all([api.config.getImap(), api.status.get()]);
    app.innerHTML = '';

    const card = h('div', { className: 'settings-card' });
    const statusClass = status.connectionStatus === 'connected' ? 'connected'
      : status.connectionStatus === 'connecting' ? 'connecting' : 'disconnected';

    card.innerHTML = `
      <h2>IMAP Connection</h2>
      <p style="margin-bottom:1rem">Status: <span class="status-badge ${statusClass}">${status.connectionStatus}</span>
        &mdash; ${status.messagesProcessed} messages processed</p>
      <div class="form-group"><label>Host</label><input id="s-host" value="${imapCfg.host}" /></div>
      <div class="form-group"><label>Port</label><input id="s-port" type="number" value="${imapCfg.port}" /></div>
      <div class="form-group">
        <label><input id="s-tls" type="checkbox" ${imapCfg.tls ? 'checked' : ''} /> Use TLS</label>
      </div>
      <div class="form-group"><label>Username</label><input id="s-user" value="${imapCfg.auth.user}" /></div>
      <div class="form-group"><label>Password</label><input id="s-pass" type="password" value="${imapCfg.auth.pass}" /></div>
      <div class="form-actions">
        <button class="btn btn-primary" id="s-save">Save Settings</button>
      </div>
    `;

    app.append(card);

    document.getElementById('s-save')!.addEventListener('click', async () => {
      const cfg: ImapConfig = {
        host: (document.getElementById('s-host') as HTMLInputElement).value,
        port: parseInt((document.getElementById('s-port') as HTMLInputElement).value),
        tls: (document.getElementById('s-tls') as HTMLInputElement).checked,
        auth: {
          user: (document.getElementById('s-user') as HTMLInputElement).value,
          pass: (document.getElementById('s-pass') as HTMLInputElement).value,
        },
        idleTimeout: imapCfg.idleTimeout,
        pollInterval: imapCfg.pollInterval,
      };

      try {
        await api.config.updateImap(cfg);
        toast('Settings saved');
        renderSettings();
      } catch (e: any) { toast(e.message, true); }
    });

  } catch (e: any) {
    app.innerHTML = '';
    app.append(h('div', { className: 'empty' }, `Failed to load settings: ${e.message}`));
  }
}

// --- Init ---
document.addEventListener('DOMContentLoaded', () => {
  initNav();
  navigate('rules');

  // Refresh on focus
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && currentPage === 'activity') renderActivity();
  });
});
