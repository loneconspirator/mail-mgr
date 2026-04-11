import { api } from './api.js';
import type { Rule, ActivityEntry, ImapConfig, ReviewConfig, BatchStatusResponse, DryRunGroup } from './api.js';
import { renderFolderPicker } from './folder-picker.js';
import { generateBehaviorDescription } from './rule-display.js';

// --- State ---
let currentPage = 'rules';
let activityTimer: ReturnType<typeof setInterval> | null = null;
let batchPollTimer: ReturnType<typeof setInterval> | null = null;

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
  if (batchPollTimer) { clearInterval(batchPollTimer); batchPollTimer = null; }
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
  else if (page === 'batch') renderBatch();
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
      <th>Rule</th><th>Enabled</th><th></th>
    </tr></thead>`;
    const tbody = document.createElement('tbody');

    for (const rule of rules) {
      const tr = document.createElement('tr');
      tr.dataset.id = rule.id;

      const behaviorDesc = generateBehaviorDescription(rule);
      const ruleCell = h('td', { className: 'rule-description' });
      const primarySpan = h('span', { className: 'rule-behavior' }, behaviorDesc);
      ruleCell.append(primarySpan);
      if (rule.name) {
        const secondarySpan = h('span', { className: 'rule-name-secondary' }, rule.name);
        ruleCell.append(secondarySpan);
      }

      const toggleLabel = document.createElement('label');
      toggleLabel.className = 'toggle';
      const toggleInput = document.createElement('input');
      toggleInput.type = 'checkbox';
      toggleInput.checked = rule.enabled;
      toggleInput.addEventListener('change', async () => {
        try {
          await api.rules.update(rule.id, { ...rule, enabled: toggleInput.checked });
        } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); toast(msg, true); }
      });
      const slider = h('span', { className: 'slider' });
      toggleLabel.append(toggleInput, slider);

      const editBtn = h('button', { className: 'btn btn-sm' }, 'Edit');
      editBtn.addEventListener('click', () => openRuleModal(rule));

      const deleteBtn = h('button', { className: 'btn btn-sm btn-danger' }, 'Del');
      deleteBtn.addEventListener('click', async () => {
        if (!confirm(`Delete rule "${rule.name || 'unnamed'}"?`)) return;
        try {
          await api.rules.delete(rule.id);
          toast('Rule deleted');
          renderRules();
        } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); toast(msg, true); }
      });

      const actionsCell = h('td', {}, editBtn, document.createTextNode(' '), deleteBtn);

      tr.append(
        ruleCell,
        h('td', {}, toggleLabel),
        actionsCell,
      );
      tbody.append(tr);
    }

    table.append(tbody);
    app.append(table);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    app.innerHTML = '';
    app.append(h('div', { className: 'empty' }, `Failed to load rules: ${msg}`));
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
    <div class="form-group"><label>Action</label><select id="m-action-type">
      <option value="move">Archive to folder</option>
      <option value="review">Route to Review</option>
      <option value="skip">Leave in Inbox</option>
      <option value="delete">Delete</option>
    </select></div>
    <div class="form-group" id="m-folder-group"><label>Folder</label><div id="m-folder-picker"></div></div>
    <div class="form-actions">
      <button class="btn" id="m-cancel">Cancel</button>
      <button class="btn btn-primary" id="m-save">${isEdit ? 'Save' : 'Create'}</button>
    </div>
  `;

  let selectedFolder = rule?.action && 'folder' in rule.action ? rule.action.folder || '' : '';

  overlay.append(modal);
  document.body.append(overlay);

  const actionSelect = document.getElementById('m-action-type') as HTMLSelectElement;
  const folderGroup = document.getElementById('m-folder-group') as HTMLElement;

  let pickerRendered = false;
  const updateFolderVisibility = () => {
    const actionType = actionSelect.value;
    if (actionType === 'move' || actionType === 'review') {
      folderGroup.style.display = '';
      if (!pickerRendered) {
        pickerRendered = true;
        renderFolderPicker({
          container: document.getElementById('m-folder-picker')!,
          currentValue: selectedFolder,
          onSelect: (path) => { selectedFolder = path; },
        });
      }
    } else {
      folderGroup.style.display = 'none';
    }
  };

  if (rule) {
    actionSelect.value = rule.action.type;
  }
  updateFolderVisibility();
  actionSelect.addEventListener('change', updateFolderVisibility);

  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.getElementById('m-cancel')!.addEventListener('click', () => overlay.remove());
  document.getElementById('m-save')!.addEventListener('click', async () => {
    const name = (document.getElementById('m-name') as HTMLInputElement).value.trim();
    const sender = (document.getElementById('m-sender') as HTMLInputElement).value.trim();
    const subject = (document.getElementById('m-subject') as HTMLInputElement).value.trim();
    const folder = selectedFolder;
    const actionType = (document.getElementById('m-action-type') as HTMLSelectElement).value;

    if (actionType === 'move' && !folder) { toast('Folder is required for move action', true); return; }

    const match: Record<string, string> = {};
    if (sender) match.sender = sender;
    if (subject) match.subject = subject;
    if (!sender && !subject) { toast('At least one match field is required', true); return; }

    let action: Rule['action'];
    if (actionType === 'move') {
      action = { type: 'move', folder };
    } else if (actionType === 'review') {
      action = folder ? { type: 'review', folder } : { type: 'review' };
    } else if (actionType === 'delete') {
      action = { type: 'delete' };
    } else {
      action = { type: 'skip' };
    }

    const payload: Omit<Rule, 'id'> = {
      match,
      action,
      enabled: rule?.enabled ?? true,
      order: rule?.order ?? 0,
      ...(name ? { name } : {}),
    };

    try {
      if (isEdit && rule) {
        await api.rules.update(rule.id, payload);
        toast('Rule updated');
      } else {
        await api.rules.create(payload);
        toast('Rule created');
      }
      overlay.remove();
      renderRules();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast(msg, true);
    }
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

        // K6: sweep/batch badge for sourced entries
        let ruleCell: HTMLElement;
        if (e.source === 'sweep') {
          ruleCell = h('td', {}, h('span', { className: 'badge-sweep' }, '[sweep]'), e.ruleName ?? '');
        } else if (e.source === 'batch') {
          ruleCell = h('td', {}, h('span', { className: 'badge-batch' }, '[batch]'), e.ruleName ?? '');
        } else {
          ruleCell = h('td', {}, e.ruleName ?? '');
        }

        // K7: formatted action display
        let actionDisplay: string;
        switch (e.action) {
          case 'skip': actionDisplay = '— Inbox'; break;
          case 'delete': actionDisplay = '✕ Trash'; break;
          case 'review': actionDisplay = '→ Review'; break;
          default: actionDisplay = e.folder ? `→ ${e.folder}` : e.action; break;
        }

        tr.append(
          h('td', {}, time),
          h('td', {}, e.from ?? ''),
          h('td', {}, e.subject ?? ''),
          ruleCell,
          h('td', {}, actionDisplay),
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

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    app.innerHTML = '';
    app.append(h('div', { className: 'empty' }, `Failed to load activity: ${msg}`));
  }
}

// --- Settings Page ---
async function renderSettings() {
  const app = $('#app');
  app.innerHTML = '<p>Loading...</p>';

  try {
    const [imapCfg, status, reviewStatus, reviewConfig] = await Promise.all([
      api.config.getImap(),
      api.status.get(),
      api.review.status().catch(() => null),
      api.config.getReview().catch(() => null),
    ]);
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
      } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); toast(msg, true); }
    });

    // K8: Review Status panel
    if (reviewStatus) {
      const reviewCard = h('div', { className: 'settings-card' });
      const nextSweep = reviewStatus.nextSweepAt
        ? new Date(reviewStatus.nextSweepAt).toLocaleString()
        : 'Not scheduled';
      let lastSweepHtml = '<p class="sweep-info">No sweeps yet</p>';
      if (reviewStatus.lastSweep) {
        const completedAt = new Date(reviewStatus.lastSweep.completedAt).toLocaleString();
        lastSweepHtml = `<dl class="sweep-info">
          <dt>Completed:</dt><dd>${completedAt}</dd>
          <dt>Archived:</dt><dd>${reviewStatus.lastSweep.messagesArchived}</dd>
          <dt>Errors:</dt><dd>${reviewStatus.lastSweep.errors}</dd>
        </dl>`;
      }
      reviewCard.innerHTML = `
        <h2>Review Status</h2>
        <p style="margin-bottom:0.5rem">Folder: <strong>${reviewStatus.folder}</strong></p>
        <div class="review-stats">
          <div class="stat-item"><div class="stat-value">${reviewStatus.totalMessages}</div><div class="stat-label">Total</div></div>
          <div class="stat-item"><div class="stat-value">${reviewStatus.readMessages}</div><div class="stat-label">Read</div></div>
          <div class="stat-item"><div class="stat-value">${reviewStatus.unreadMessages}</div><div class="stat-label">Unread</div></div>
        </div>
        <p class="sweep-info"><dt>Next sweep:</dt><dd>${nextSweep}</dd></p>
        <h3 style="margin-top:1rem;font-size:0.95rem">Last Sweep</h3>
        ${lastSweepHtml}
      `;
      app.append(reviewCard);
    } else {
      const reviewCard = h('div', { className: 'settings-card' });
      reviewCard.innerHTML = '<h2>Review Status</h2><p class="sweep-info">Unable to load review status.</p>';
      app.append(reviewCard);
    }

    // K9: Sweep Settings (editable) — per D-01, D-02
    if (reviewConfig) {
      const sweepCard = h('div', { className: 'settings-card' });

      // Track selected folder values for tree pickers
      let reviewFolder = reviewConfig.folder;
      let archiveFolder = reviewConfig.defaultArchiveFolder;
      let trashFolder = reviewConfig.trashFolder;

      // Load cursor state for the checkbox
      const cursorState = await api.config.getCursor().catch(() => ({ enabled: true }));

      sweepCard.innerHTML = `
        <h2>Sweep Settings</h2>
        <div class="form-group"><label>Review Folder</label><div id="sw-review-picker"></div></div>
        <div class="form-group"><label>Archive Folder</label><div id="sw-archive-picker"></div></div>
        <div class="form-group"><label>Trash Folder</label><div id="sw-trash-picker"></div></div>
        <div class="form-group"><label>Sweep Interval (hours)</label><input id="sw-interval" type="number" min="1" value="${reviewConfig.sweep.intervalHours}" /></div>
        <div class="form-group"><label>Read Max Age (days)</label><input id="sw-read-age" type="number" min="1" value="${reviewConfig.sweep.readMaxAgeDays}" /></div>
        <div class="form-group"><label>Unread Max Age (days)</label><input id="sw-unread-age" type="number" min="1" value="${reviewConfig.sweep.unreadMaxAgeDays}" /></div>
        <div class="form-group">
          <label><input id="sw-cursor" type="checkbox" ${cursorState.enabled ? 'checked' : ''} /> Enable message cursor (resume from last UID)</label>
        </div>
        <div class="form-actions">
          <button class="btn btn-primary" id="sw-save">Save Sweep Settings</button>
        </div>
      `;
      app.append(sweepCard);

      // Render tree pickers for folder fields
      renderFolderPicker({
        container: document.getElementById('sw-review-picker')!,
        currentValue: reviewFolder,
        onSelect: (path) => { reviewFolder = path; },
      });
      renderFolderPicker({
        container: document.getElementById('sw-archive-picker')!,
        currentValue: archiveFolder,
        onSelect: (path) => { archiveFolder = path; },
      });
      renderFolderPicker({
        container: document.getElementById('sw-trash-picker')!,
        currentValue: trashFolder,
        onSelect: (path) => { trashFolder = path; },
      });

      // Save handler — sends complete sweep sub-object to avoid shallow merge pitfall
      document.getElementById('sw-save')!.addEventListener('click', async () => {
        const payload: Partial<ReviewConfig> = {
          folder: reviewFolder,
          defaultArchiveFolder: archiveFolder,
          trashFolder: trashFolder,
          sweep: {
            intervalHours: parseInt((document.getElementById('sw-interval') as HTMLInputElement).value, 10),
            readMaxAgeDays: parseInt((document.getElementById('sw-read-age') as HTMLInputElement).value, 10),
            unreadMaxAgeDays: parseInt((document.getElementById('sw-unread-age') as HTMLInputElement).value, 10),
          },
        };
        try {
          await api.config.updateReview(payload);
          // Save cursor toggle state
          const cursorChecked = (document.getElementById('sw-cursor') as HTMLInputElement).checked;
          await api.config.setCursor(cursorChecked);
          toast('Sweep settings saved');
          renderSettings();
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          toast(msg, true);
        }
      });
    }

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    app.innerHTML = '';
    app.append(h('div', { className: 'empty' }, `Failed to load settings: ${msg}`));
  }
}

// --- Batch Page ---
async function renderBatch(): Promise<void> {
  const app = $('#app');
  app.innerHTML = '<p>Loading batch...</p>';
  try {
    const state = await api.batch.status();
    if (state.status === 'executing') {
      renderBatchExecuting(app, state);
    } else if (state.status === 'previewing' && state.dryRunResults) {
      renderBatchPreview(app, state.sourceFolder!, state.dryRunResults, state.totalMessages);
    } else if (state.status === 'completed' || state.status === 'cancelled' || state.status === 'error') {
      renderBatchResults(app, state);
    } else {
      renderBatchIdle(app);
    }
  } catch {
    renderBatchIdle(app);
  }
}

function renderBatchIdle(app: HTMLElement): void {
  app.innerHTML = '';
  let selectedFolder = '';

  const card = h('div', { className: 'settings-card' });
  card.append(
    h('h2', {}, 'Batch Filing'),
    h('p', { style: 'color:#444;margin-bottom:1rem' }, 'Select a source folder to apply all rules against its messages.'),
  );

  const pickerDiv = document.createElement('div');
  card.append(pickerDiv);

  const btn = document.createElement('button');
  btn.className = 'btn btn-primary';
  btn.textContent = 'Preview Dry Run';
  btn.disabled = true;
  btn.style.marginTop = '1rem';
  card.append(btn);

  renderFolderPicker({
    container: pickerDiv,
    currentValue: '',
    onSelect: (folder: string) => {
      selectedFolder = folder;
      btn.disabled = !folder;
    },
  });

  btn.addEventListener('click', () => {
    if (selectedFolder) startDryRun(app, selectedFolder);
  });

  // Check if batch is already running
  api.batch.status().then((state) => {
    if (state.status === 'executing' || state.status === 'dry-running') {
      const info = h('p', { style: 'color:#888;margin-top:0.5rem;font-size:0.9rem' }, 'A batch is already running.');
      card.insertBefore(info, btn);
      btn.disabled = true;
    }
  }).catch(() => { /* ignore */ });

  app.append(card);
}

async function startDryRun(app: HTMLElement, folder: string): Promise<void> {
  app.innerHTML = '';
  const card = h('div', { className: 'settings-card' });
  const loadingText = h('div', { className: 'loading-pulse' });
  loadingText.append(document.createTextNode('Evaluating rules against '), h('strong', {}, folder), document.createTextNode('...'));
  card.append(loadingText);
  app.append(card);

  try {
    const response = await api.batch.dryRun(folder);
    const totalMessages = response.results.reduce((sum, g) => sum + g.count, 0);
    renderBatchPreview(app, folder, response.results, totalMessages);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    toast('Dry run failed: ' + message + '. Check your IMAP connection and try again.', true);
    renderBatchIdle(app);
  }
}

function renderBatchPreview(app: HTMLElement, folder: string, groups: DryRunGroup[], totalMessages: number): void {
  app.innerHTML = '';

  const card = h('div', { className: 'settings-card' });
  card.append(h('h2', {}, 'Dry Run Preview'));

  // Separate no-match group
  const matchGroups = groups.filter(g => g.action !== 'no-match');
  const noMatchGroup = groups.find(g => g.action === 'no-match');
  const matchedCount = matchGroups.reduce((sum, g) => sum + g.count, 0);

  const summary = h('p', { style: 'margin:0.5rem 0 1rem;font-size:0.9rem;color:#444' });
  summary.textContent = matchedCount + ' of ' + totalMessages + ' messages matched';
  card.append(summary);

  // Render match groups
  for (const group of matchGroups) {
    card.append(buildDryRunGroup(group, false));
  }

  // Render no-match group last
  if (noMatchGroup) {
    card.append(buildDryRunGroup(noMatchGroup, true));
  }

  // Action bar
  const actionBar = h('div', { style: 'display:flex;justify-content:space-between;margin-top:1rem' });

  const backBtn = h('button', { className: 'btn' }, 'Back');
  backBtn.addEventListener('click', () => renderBatchIdle(app));

  const runBtn = h('button', { className: 'btn btn-primary' }, 'Run Batch');
  runBtn.addEventListener('click', () => startExecute(app, folder));

  actionBar.append(backBtn, runBtn);
  card.append(actionBar);

  app.append(card);
}

function buildDryRunGroup(group: DryRunGroup, isNoMatch: boolean): HTMLElement {
  const wrapper = h('div', { className: isNoMatch ? 'dry-run-group no-match' : 'dry-run-group' });

  const header = h('div', { className: 'dry-run-group-header' });
  const toggle = h('span', { className: 'dry-run-group-toggle' }, '\u25B6');

  const name = h('span', { className: 'dry-run-group-name' });
  name.textContent = isNoMatch ? 'No match (stay in folder)' : group.destination;

  const count = h('span', { className: 'dry-run-group-count' });
  count.textContent = '(' + group.count + ')';

  header.append(toggle, name, count);

  const messagesDiv = h('div', { className: 'dry-run-group-messages' });
  messagesDiv.style.display = 'none';

  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  headRow.append(h('th', {}, 'From'), h('th', {}, 'Subject'), h('th', {}, 'Rule'));
  thead.append(headRow);
  table.append(thead);

  const tbody = document.createElement('tbody');
  for (const msg of group.messages) {
    const tr = document.createElement('tr');
    const fromCell = h('td', {});
    fromCell.textContent = msg.from;
    const subjectCell = h('td', { style: 'max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' });
    subjectCell.textContent = msg.subject;
    const ruleCell = h('td', {});
    ruleCell.textContent = msg.ruleName;
    tr.append(fromCell, subjectCell, ruleCell);
    tbody.append(tr);
  }
  table.append(tbody);
  messagesDiv.append(table);

  let expanded = false;
  header.addEventListener('click', () => {
    expanded = !expanded;
    toggle.textContent = expanded ? '\u25BC' : '\u25B6';
    messagesDiv.style.display = expanded ? '' : 'none';
  });

  wrapper.append(header, messagesDiv);
  return wrapper;
}

async function startExecute(app: HTMLElement, folder: string): Promise<void> {
  try {
    await api.batch.execute(folder);
    const state = await api.batch.status();
    renderBatchExecuting(app, state);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('409') || message.toLowerCase().includes('already')) {
      toast('A batch is already running. Wait for it to complete or cancel it first.', true);
    } else {
      toast('Batch error: ' + message, true);
    }
  }
}

function renderBatchExecuting(app: HTMLElement, state: BatchStatusResponse): void {
  app.innerHTML = '';

  const card = h('div', { className: 'settings-card' });
  card.append(h('h2', {}, 'Batch Running'));

  const progressText = h('p', { style: 'font-size:0.9rem;color:#444' });
  progressText.textContent = state.processed + ' of ' + state.totalMessages + ' messages processed';
  card.append(progressText);

  const progressBar = h('div', { className: 'progress-bar' });
  const progressFill = h('div', { className: 'progress-bar-fill' });
  const pct = state.totalMessages > 0 ? (state.processed / state.totalMessages * 100) : 0;
  progressFill.style.width = pct + '%';
  progressBar.append(progressFill);
  card.append(progressBar);

  const counts = h('div', { className: 'batch-counts' });
  const movedSpan = h('span', {});
  movedSpan.textContent = 'Moved: ' + state.moved;
  const skippedSpan = h('span', {});
  skippedSpan.textContent = 'Skipped: ' + state.skipped;
  const errorsSpan = h('span', { className: state.errors > 0 ? 'error-count' : '' });
  errorsSpan.textContent = 'Errors: ' + state.errors;
  counts.append(movedSpan, skippedSpan, errorsSpan);
  card.append(counts);

  const cancelBtn = h('button', { className: 'btn btn-danger' }, 'Cancel Batch');
  cancelBtn.style.marginTop = '1rem';
  cancelBtn.addEventListener('click', async () => {
    cancelBtn.textContent = 'Cancelling...';
    cancelBtn.setAttribute('disabled', 'true');
    try {
      await api.batch.cancel();
    } catch { /* ignore */ }
  });
  card.append(cancelBtn);

  app.append(card);

  // Start polling
  batchPollTimer = setInterval(async () => {
    try {
      const s = await api.batch.status();
      if (s.status === 'executing') {
        // Update progress in place
        progressText.textContent = s.processed + ' of ' + s.totalMessages + ' messages processed';
        const newPct = s.totalMessages > 0 ? (s.processed / s.totalMessages * 100) : 0;
        progressFill.style.width = newPct + '%';
        movedSpan.textContent = 'Moved: ' + s.moved;
        skippedSpan.textContent = 'Skipped: ' + s.skipped;
        errorsSpan.textContent = 'Errors: ' + s.errors;
        errorsSpan.className = s.errors > 0 ? 'error-count' : '';
      } else {
        if (batchPollTimer) { clearInterval(batchPollTimer); batchPollTimer = null; }
        renderBatchResults(app, s);
      }
    } catch {
      // Poll error — keep trying
    }
  }, 2000);
}

function renderBatchResults(app: HTMLElement, state: BatchStatusResponse): void {
  app.innerHTML = '';
  if (batchPollTimer) { clearInterval(batchPollTimer); batchPollTimer = null; }

  const card = h('div', { className: 'settings-card' });

  let headingText: string;
  let badgeClass: string;
  if (state.status === 'completed') {
    headingText = 'Batch Complete';
    badgeClass = 'status-badge connected';
  } else if (state.status === 'cancelled') {
    headingText = 'Batch Cancelled';
    badgeClass = 'status-badge connecting';
  } else {
    headingText = 'Batch Error';
    badgeClass = 'status-badge disconnected';
  }

  const heading = h('h2', {});
  heading.append(document.createTextNode(headingText + ' '), h('span', { className: badgeClass }, state.status));
  card.append(heading);

  // Stats grid
  const stats = h('div', { className: 'review-stats' });

  const movedItem = h('div', { className: 'stat-item' });
  movedItem.append(h('div', { className: 'stat-value' }, String(state.moved)), h('div', { className: 'stat-label' }, 'MOVED'));

  const skippedItem = h('div', { className: 'stat-item' });
  skippedItem.append(h('div', { className: 'stat-value' }, String(state.skipped)), h('div', { className: 'stat-label' }, 'SKIPPED'));

  const errorsItem = h('div', { className: 'stat-item' });
  const errorsValue = h('div', { className: 'stat-value' }, String(state.errors));
  if (state.errors > 0) errorsValue.style.color = '#dc2626';
  errorsItem.append(errorsValue, h('div', { className: 'stat-label' }, 'ERRORS'));

  stats.append(movedItem, skippedItem, errorsItem);
  card.append(stats);

  // Remaining count for cancelled
  if (state.status === 'cancelled') {
    const remaining = state.totalMessages - state.processed;
    const remainingText = h('p', { style: 'font-size:0.9rem;color:#888;margin-top:0.5rem' });
    remainingText.textContent = 'Remaining: ' + remaining + ' messages not processed';
    card.append(remainingText);
  }

  const newBatchBtn = h('button', { className: 'btn btn-primary' }, 'New Batch');
  newBatchBtn.style.marginTop = '1rem';
  newBatchBtn.addEventListener('click', () => renderBatchIdle(app));
  card.append(newBatchBtn);

  app.append(card);
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
