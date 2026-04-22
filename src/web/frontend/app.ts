import { api, ApiError } from './api.js';
import type { Rule, ActivityEntry, ImapConfigResponse, ReviewConfig, BatchStatusResponse, DryRunGroup, ProposedRuleCard } from './api.js';
import type { Action } from '../../shared/types.js';
import { renderFolderPicker } from './folder-picker.js';
import { generateBehaviorDescription } from './rule-display.js';

// --- State ---
let currentPage = 'rules';
let activityTimer: ReturnType<typeof setInterval> | null = null;
let batchPollTimer: ReturnType<typeof setInterval> | null = null;
let pendingProposalApproval: number | null = null;

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

/** Escape HTML special characters to prevent XSS in innerHTML templates. */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Map internal action type names to user-facing display labels. */
function actionLabel(type: string): string {
  if (type === 'skip') return 'Leave in Place';
  return type.charAt(0).toUpperCase() + type.slice(1);
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
  else if (page === 'priority') renderDispositionView('skip', 'Priority Senders');
  else if (page === 'blocked') renderDispositionView('delete', 'Blocked Senders');
  else if (page === 'reviewed') renderReviewedView();
  else if (page === 'archived') renderArchivedView();
  else if (page === 'batch') renderBatch();
  else if (page === 'proposed') renderProposed();
  updateProposedBadge();
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

    document.getElementById('add-rule-btn')!.addEventListener('click', () => {
      api.config.getEnvelopeStatus().then(status => {
        openRuleModal(undefined, status.envelopeHeader !== null);
      }).catch(() => openRuleModal(undefined, false));
    });

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

      const matchStr = generateBehaviorDescription(rule.match);
      const actionStr = 'folder' in rule.action ? `${actionLabel(rule.action.type)} \u2192 ${rule.action.folder}` : actionLabel(rule.action.type);

      const toggleLabel = document.createElement('label');
      toggleLabel.className = 'toggle';
      const toggleInput = document.createElement('input');
      toggleInput.type = 'checkbox';
      toggleInput.checked = rule.enabled;
      toggleInput.addEventListener('change', async () => {
        try {
          await api.rules.update(rule.id, { ...rule, enabled: toggleInput.checked });
        } catch (e: unknown) { toast(e instanceof Error ? e.message : String(e), true); }
      });
      const slider = h('span', { className: 'slider' });
      toggleLabel.append(toggleInput, slider);

      const editBtn = h('button', { className: 'btn btn-sm' }, 'Edit');
      editBtn.addEventListener('click', () => {
        api.config.getEnvelopeStatus().then(status => {
          openRuleModal(rule, status.envelopeHeader !== null);
        }).catch(() => openRuleModal(rule, false));
      });

      const deleteBtn = h('button', { className: 'btn btn-sm btn-danger' }, 'Del');
      deleteBtn.addEventListener('click', async () => {
        if (!confirm(`Delete rule "${rule.name}"?`)) return;
        try {
          await api.rules.delete(rule.id);
          toast('Rule deleted');
          renderRules();
        } catch (e: unknown) { toast(e instanceof Error ? e.message : String(e), true); }
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
  } catch (e: unknown) {
    app.innerHTML = '';
    app.append(h('div', { className: 'empty' }, `Failed to load rules: ${e instanceof Error ? e.message : String(e)}`));
  }
}

function openRuleModal(rule?: Rule, envelopeAvailable = true, forceCreate = false) {
  const isEdit = !!rule && !forceCreate;
  const overlay = h('div', { className: 'modal-overlay' });
  const modal = h('div', { className: 'modal' });

  let selectedFolder = rule?.action && 'folder' in rule.action ? rule.action.folder || '' : '';

  modal.innerHTML = `
    <h2>${isEdit ? 'Edit Rule' : 'New Rule'}</h2>
    <div class="form-group"><label>Name</label><input id="m-name" value="${esc(rule?.name || '')}" /></div>
    <div class="form-group"><label>Match Sender</label><input id="m-sender" value="${esc(rule?.match?.sender || '')}" placeholder="*@example.com" /></div>
    <div class="form-group"><label>Match Subject</label><input id="m-subject" value="${esc(rule?.match?.subject || '')}" placeholder="*newsletter*" /></div>
    <div class="form-group"><label>Match Recipient</label><input id="m-recipient" value="${esc(rule?.match?.recipient || '')}" placeholder="*@example.com" /></div>
    <div class="form-group">
      <label>Delivered-To${!envelopeAvailable ? ' <span class="info-icon" title="Envelope header not discovered &#8212; run discovery in IMAP settings.">&#9432;</span>' : ''}</label>
      <input id="m-deliveredTo" value="${esc(rule?.match?.deliveredTo || '')}" placeholder="*@example.com" ${!envelopeAvailable ? 'disabled' : ''} />
    </div>
    <div class="form-group">
      <label>Recipient Field${!envelopeAvailable ? ' <span class="info-icon" title="Envelope header not discovered &#8212; run discovery in IMAP settings.">&#9432;</span>' : ''}</label>
      <select id="m-visibility" ${!envelopeAvailable ? 'disabled' : ''}>
        <option value="">&mdash;</option>
        <option value="direct" ${rule?.match?.visibility === 'direct' ? 'selected' : ''}>Direct</option>
        <option value="cc" ${rule?.match?.visibility === 'cc' ? 'selected' : ''}>CC</option>
        <option value="bcc" ${rule?.match?.visibility === 'bcc' ? 'selected' : ''}>BCC</option>
        <option value="list" ${rule?.match?.visibility === 'list' ? 'selected' : ''}>List</option>
      </select>
    </div>
    <div class="form-group">
      <label>Read Status</label>
      <select id="m-readStatus">
        <option value="">&mdash;</option>
        <option value="read" ${rule?.match?.readStatus === 'read' ? 'selected' : ''}>Read</option>
        <option value="unread" ${rule?.match?.readStatus === 'unread' ? 'selected' : ''}>Unread</option>
      </select>
    </div>
    <div class="form-group"><label>Action</label><select id="m-action-type">
      <option value="move" ${rule?.action?.type === 'move' ? 'selected' : ''}>Move</option>
      <option value="review" ${rule?.action?.type === 'review' ? 'selected' : ''}>Review</option>
      <option value="skip" ${rule?.action?.type === 'skip' ? 'selected' : ''}>Leave in Place</option>
      <option value="delete" ${rule?.action?.type === 'delete' ? 'selected' : ''}>Delete</option>
    </select></div>
    <div class="form-group" id="m-folder-group"><label>Folder</label><div id="m-folder-picker"></div></div>
    <div class="form-actions">
      <button class="btn" id="m-cancel">Cancel</button>
      <button class="btn btn-primary" id="m-save">${isEdit ? 'Save' : 'Create'}</button>
    </div>
  `;

  overlay.append(modal);
  document.body.append(overlay);

  // Show/hide folder field based on action type, integrate folder picker
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
  actionSelect.addEventListener('change', updateFolderVisibility);
  updateFolderVisibility();

  overlay.addEventListener('click', (e) => { if (e.target === overlay) { pendingProposalApproval = null; overlay.remove(); } });
  document.getElementById('m-cancel')!.addEventListener('click', () => { pendingProposalApproval = null; overlay.remove(); });
  document.getElementById('m-save')!.addEventListener('click', async () => {
    const name = (document.getElementById('m-name') as HTMLInputElement).value.trim();
    const sender = (document.getElementById('m-sender') as HTMLInputElement).value.trim();
    const subject = (document.getElementById('m-subject') as HTMLInputElement).value.trim();
    const recipient = (document.getElementById('m-recipient') as HTMLInputElement).value.trim();
    const deliveredTo = (document.getElementById('m-deliveredTo') as HTMLInputElement).value.trim();
    const visibility = (document.getElementById('m-visibility') as HTMLSelectElement).value;
    const readStatus = (document.getElementById('m-readStatus') as HTMLSelectElement).value;
    const folder = selectedFolder;

    const actionType = (document.getElementById('m-action-type') as HTMLSelectElement).value;
    if (actionType === 'move' && !folder) { toast('Folder is required for Move action', true); return; }

    const match: Record<string, string> = {};
    if (sender) match.sender = sender;
    if (subject) match.subject = subject;
    if (recipient) match.recipient = recipient;
    if (deliveredTo) match.deliveredTo = deliveredTo;
    if (visibility) match.visibility = visibility;
    if (readStatus) match.readStatus = readStatus;
    if (Object.keys(match).length === 0) {
      toast('At least one match field is required', true);
      return;
    }

    let action: Action;
    if (actionType === 'move') {
      action = { type: 'move', folder };
    } else if (actionType === 'review') {
      action = folder ? { type: 'review', folder } : { type: 'review' };
    } else if (actionType === 'skip') {
      action = { type: 'skip' };
    } else {
      action = { type: 'delete' };
    }

    // For new rules, compute next order so they sort to the bottom
    let orderValue = rule?.order ?? 0;
    if (!isEdit) {
      try {
        const existingRules = await api.rules.list();
        if (existingRules.length > 0) {
          orderValue = Math.max(...existingRules.map((r: Rule) => r.order)) + 1;
        }
      } catch { /* fallback to 0 */ }
    }

    const payload = {
      name,
      match,
      action,
      enabled: rule?.enabled ?? true,
      order: orderValue,
    };

    try {
      if (isEdit) {
        await api.rules.update(rule!.id, payload);
        toast('Rule updated');
      } else {
        const createdRule = await api.rules.create(payload);
        toast('Rule created');
        // If this was a Modify from proposed rules, mark the proposal as approved.
        // CRITICAL: Use markApproved (not approve) because the rule was ALREADY created
        // by api.rules.create() above. The approve endpoint would call configRepo.addRule()
        // again, creating a duplicate rule.
        if (pendingProposalApproval !== null) {
          try {
            await api.proposed.markApproved(pendingProposalApproval, createdRule.id);
          } catch { /* proposal approval is best-effort */ }
          pendingProposalApproval = null;
          if (currentPage === 'proposed') {
            overlay.remove();
            renderProposed();
            return;
          }
        }
      }
      overlay.remove();
      navigate(currentPage);
    } catch (e: unknown) { toast(e instanceof Error ? e.message : String(e), true); }
  });
}

// --- Add Sender Modal ---
function openAddSenderModal(viewType: 'skip' | 'delete' | 'review' | 'move', viewName: string, reRender: () => void): void {
  const titles: Record<string, string> = {
    skip: 'Add Priority Sender',
    delete: 'Add Blocked Sender',
    review: 'Add Reviewed Sender',
    move: 'Add Archived Sender',
  };

  const overlay = h('div', { className: 'modal-overlay' });
  const modal = h('div', { className: 'modal' });

  let selectedFolder = '';

  modal.innerHTML = `
    <h2>${esc(titles[viewType])}</h2>
    <div class="form-group"><label>Sender Pattern</label><input id="as-sender" placeholder="*@example.com" /></div>
    ${(viewType === 'move' || viewType === 'review') ? `<div class="form-group"><label>${viewType === 'move' ? 'Destination Folder' : 'Folder (optional)'}</label><div id="as-folder-picker"></div></div>` : ''}
    <div class="form-actions">
      <button class="btn" id="as-cancel">Discard</button>
      <button class="btn btn-primary" id="as-submit">Add Sender</button>
    </div>
  `;

  overlay.append(modal);
  document.body.append(overlay);

  // Wire folder picker for Archived (move) and Reviewed (review) views
  if (viewType === 'move' || viewType === 'review') {
    renderFolderPicker({
      container: document.getElementById('as-folder-picker')!,
      currentValue: '',
      onSelect: (path) => {
        selectedFolder = path;
        updateSubmitState();
      },
    });
  }

  const submitBtn = document.getElementById('as-submit') as HTMLButtonElement;
  const senderInput = document.getElementById('as-sender') as HTMLInputElement;

  // For move type, disable submit until both sender and folder are filled
  const updateSubmitState = () => {
    if (viewType === 'move') {
      submitBtn.disabled = !senderInput.value.trim() || !selectedFolder;
    } else {
      submitBtn.disabled = !senderInput.value.trim();
    }
  };

  // Start with submit disabled
  submitBtn.disabled = true;
  senderInput.addEventListener('input', updateSubmitState);

  // Focus the sender input
  senderInput.focus();

  // Close handlers
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.getElementById('as-cancel')!.addEventListener('click', () => overlay.remove());

  // Escape key closes modal
  const escHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', escHandler); }
  };
  document.addEventListener('keydown', escHandler);

  // Submit handler
  submitBtn.addEventListener('click', async () => {
    const sender = senderInput.value.trim();
    if (!sender) return;
    if (viewType === 'move' && !selectedFolder) return;

    submitBtn.textContent = 'Adding...';
    submitBtn.disabled = true;

    // Build action based on view type
    let action: Action;
    if (viewType === 'skip') action = { type: 'skip' };
    else if (viewType === 'delete') action = { type: 'delete' };
    else if (viewType === 'review') action = selectedFolder ? { type: 'review', folder: selectedFolder } : { type: 'review' };
    else action = { type: 'move', folder: selectedFolder };

    // Compute order for new rule (append to end)
    let orderValue = 0;
    try {
      const existingRules = await api.rules.list();
      if (existingRules.length > 0) {
        orderValue = Math.max(...existingRules.map((r: Rule) => r.order)) + 1;
      }
    } catch { /* fallback to 0 */ }

    try {
      await api.rules.create({
        match: { sender },
        action,
        enabled: true,
        order: orderValue,
      });
      toast('Sender added');
      overlay.remove();
      document.removeEventListener('keydown', escHandler);
      reRender();
    } catch (e: unknown) {
      toast(`Failed to add sender: ${e instanceof Error ? e.message : String(e)}`, true);
      submitBtn.textContent = 'Add Sender';
      submitBtn.disabled = false;
    }
  });
}

// --- Disposition Views (Priority / Blocked) ---
async function renderDispositionView(type: 'skip' | 'delete', heading: string) {
  const app = $('#app');
  app.innerHTML = '<p>Loading...</p>';

  const emptyConfig: Record<string, { heading: string; body: string }> = {
    skip: {
      heading: 'No priority senders',
      body: 'Sender-only rules with "Leave in Place" action will appear here. Create a rule with a single sender match and Leave in Place action to add one.',
    },
    delete: {
      heading: 'No blocked senders',
      body: 'Sender-only rules with "delete" action will appear here. Create a rule with a single sender match and Delete action to add one.',
    },
  };

  try {
    const rules = await api.dispositions.list(type);
    app.innerHTML = '';

    const addBtn = h('button', { className: 'btn btn-primary' }, '+ Add Sender');
    addBtn.addEventListener('click', () => openAddSenderModal(type, heading, () => renderDispositionView(type, heading)));
    const toolbar = h('div', { className: 'toolbar' },
      h('h2', {}, heading),
      addBtn,
    );
    app.append(toolbar);

    if (rules.length === 0) {
      const empty = emptyConfig[type];
      const emptyLabel = type === 'skip' ? '+ Add Priority Sender' : '+ Add Blocked Sender';
      const emptyAddBtn = h('button', { className: 'btn btn-primary' }, emptyLabel);
      emptyAddBtn.addEventListener('click', () => openAddSenderModal(type, heading, () => renderDispositionView(type, heading)));
      app.append(h('div', { className: 'empty' },
        h('h3', {}, empty.heading),
        h('p', {}, empty.body),
        emptyAddBtn,
      ));
      return;
    }

    const table = document.createElement('table');
    table.innerHTML = `<thead><tr>
      <th>Sender</th><th>Rule Name</th><th>Actions</th>
    </tr></thead>`;
    const tbody = document.createElement('tbody');

    for (const rule of rules) {
      const tr = document.createElement('tr');

      const editLink = h('button', { className: 'disposition-edit-link' }, 'Edit Rule');
      editLink.setAttribute('aria-label', `Edit rule for ${rule.match.sender ?? ''}`);
      editLink.addEventListener('click', () => {
        api.config.getEnvelopeStatus().then(status => {
          openRuleModal(rule, status.envelopeHeader !== null);
        }).catch(() => openRuleModal(rule, false));
      });

      const removeBtn = h('button', { className: 'btn btn-sm btn-danger' }, 'Remove');
      removeBtn.addEventListener('click', async () => {
        if (!confirm(`Remove sender "${rule.match.sender}"? This will delete the underlying rule.`)) return;
        removeBtn.textContent = '...';
        (removeBtn as HTMLButtonElement).disabled = true;
        try {
          await api.rules.delete(rule.id);
          toast('Sender removed');
          renderDispositionView(type, heading);
        } catch (e: unknown) {
          toast(`Failed to remove sender: ${e instanceof Error ? e.message : String(e)}`, true);
          removeBtn.textContent = 'Remove';
          (removeBtn as HTMLButtonElement).disabled = false;
        }
      });

      const actionsCell = h('td', { className: 'disposition-actions' }, editLink, removeBtn);

      tr.append(
        h('td', {}, rule.match.sender ?? ''),
        h('td', { className: 'disposition-rule-name' }, rule.name ?? ''),
        actionsCell,
      );
      tbody.append(tr);
    }

    table.append(tbody);
    app.append(table);
  } catch (e: unknown) {
    app.innerHTML = '';
    const viewName = type === 'skip' ? 'priority senders' : 'blocked senders';
    app.append(h('div', { className: 'empty' }, `Failed to load ${viewName}: ${e instanceof Error ? e.message : String(e)}`));
  }
}

// --- Folder-Grouped Disposition Views (Reviewed / Archived) ---
async function renderReviewedView() {
  const app = $('#app');
  app.innerHTML = '<p>Loading...</p>';

  try {
    const [rules, reviewConfig] = await Promise.all([
      api.dispositions.list('review'),
      api.config.getReview(),
    ]);
    const defaultFolder = reviewConfig.folder; // e.g. "Review"
    renderFolderGroupedView(rules, 'Reviewed Senders', {
      heading: 'No reviewed senders',
      body: 'Sender-only rules with "review" action will appear here. Create a rule with a single sender match and Review action to add one.',
    }, defaultFolder, renderReviewedView, 'review');
  } catch (e: unknown) {
    app.innerHTML = '';
    app.append(h('div', { className: 'empty' }, `Failed to load reviewed senders: ${e instanceof Error ? e.message : String(e)}`));
  }
}

async function renderArchivedView() {
  const app = $('#app');
  app.innerHTML = '<p>Loading...</p>';

  try {
    const rules = await api.dispositions.list('move');
    renderFolderGroupedView(rules, 'Archived Senders', {
      heading: 'No archived senders',
      body: 'Sender-only rules with "move" action will appear here. Create a rule with a single sender match and Move action to add one.',
    }, undefined, renderArchivedView, 'move');
  } catch (e: unknown) {
    app.innerHTML = '';
    app.append(h('div', { className: 'empty' }, `Failed to load archived senders: ${e instanceof Error ? e.message : String(e)}`));
  }
}

function renderFolderGroupedView(rules: Rule[], heading: string, emptyConfig: { heading: string; body: string }, defaultFolder?: string, reRender?: () => void, viewType?: 'review' | 'move'): void {
  const app = $('#app');
  app.innerHTML = '';

  const toolbar = h('div', { className: 'toolbar' }, h('h2', {}, heading));
  if (viewType && reRender) {
    const addBtn = h('button', { className: 'btn btn-primary' }, '+ Add Sender');
    addBtn.addEventListener('click', () => openAddSenderModal(viewType, heading, reRender));
    toolbar.append(addBtn);
  }
  app.append(toolbar);

  if (rules.length === 0) {
    const emptyLabel = viewType === 'review' ? '+ Add Reviewed Sender' : '+ Add Archived Sender';
    const emptyAddBtn = h('button', { className: 'btn btn-primary' }, emptyLabel);
    emptyAddBtn.addEventListener('click', () => { if (viewType && reRender) openAddSenderModal(viewType, heading, reRender); });
    app.append(h('div', { className: 'empty' },
      h('h3', {}, emptyConfig.heading),
      h('p', {}, emptyConfig.body),
      emptyAddBtn,
    ));
    return;
  }

  // Group rules by destination folder
  const groups = new Map<string, Rule[]>();
  for (const rule of rules) {
    const folder = ('folder' in rule.action && rule.action.folder) ? rule.action.folder : (defaultFolder ?? 'Unknown');
    if (!groups.has(folder)) groups.set(folder, []);
    groups.get(folder)!.push(rule);
  }

  // Sort groups alphabetically by folder name
  const sortedFolders = [...groups.keys()].sort((a, b) => a.localeCompare(b));

  for (const folderName of sortedFolders) {
    const folderRules = groups.get(folderName)!;
    // Sort senders within group alphabetically
    folderRules.sort((a, b) => (a.match.sender ?? '').localeCompare(b.match.sender ?? ''));

    const countText = folderRules.length === 1 ? '(1 sender)' : `(${folderRules.length} senders)`;

    const wrapper = h('div', { className: 'folder-group' });

    const toggle = h('span', { className: 'folder-group-toggle' }, '\u25BC');
    const header = h('div', { className: 'folder-group-header' },
      toggle,
      h('span', { className: 'folder-group-name' }, folderName),
      h('span', { className: 'folder-group-count' }, countText),
    );

    // Set aria-expanded for accessibility
    header.setAttribute('role', 'button');
    header.setAttribute('tabindex', '0');
    header.setAttribute('aria-expanded', 'true');

    const sendersDiv = h('div', { className: 'folder-group-senders' });

    const table = document.createElement('table');
    table.innerHTML = `<thead><tr><th>Sender</th><th>Rule Name</th><th>Actions</th></tr></thead>`;
    const tbody = document.createElement('tbody');

    for (const rule of folderRules) {
      const tr = document.createElement('tr');

      const editLink = h('button', { className: 'disposition-edit-link' }, 'Edit Rule');
      editLink.setAttribute('aria-label', `Edit rule for ${rule.match.sender ?? ''}`);
      editLink.addEventListener('click', () => {
        api.config.getEnvelopeStatus().then(status => {
          openRuleModal(rule, status.envelopeHeader !== null);
        }).catch(() => openRuleModal(rule, false));
      });

      const removeBtn = h('button', { className: 'btn btn-sm btn-danger' }, 'Remove');
      removeBtn.addEventListener('click', async () => {
        if (!confirm(`Remove sender "${rule.match.sender}"? This will delete the underlying rule.`)) return;
        removeBtn.textContent = '...';
        (removeBtn as HTMLButtonElement).disabled = true;
        try {
          await api.rules.delete(rule.id);
          toast('Sender removed');
          if (reRender) { reRender(); } else { navigate(currentPage); }
        } catch (e: unknown) {
          toast(`Failed to remove sender: ${e instanceof Error ? e.message : String(e)}`, true);
          removeBtn.textContent = 'Remove';
          (removeBtn as HTMLButtonElement).disabled = false;
        }
      });

      const actionsCell = h('td', { className: 'disposition-actions' }, editLink, removeBtn);

      tr.append(
        h('td', {}, rule.match.sender ?? ''),
        h('td', { className: 'disposition-rule-name' }, rule.name ?? ''),
        actionsCell,
      );
      tbody.append(tr);
    }

    table.append(tbody);
    sendersDiv.append(table);

    // Collapse/expand toggle — starts expanded
    let expanded = true;
    const toggleCollapse = () => {
      expanded = !expanded;
      toggle.textContent = expanded ? '\u25BC' : '\u25B6';
      sendersDiv.style.display = expanded ? '' : 'none';
      header.setAttribute('aria-expanded', String(expanded));
    };
    header.addEventListener('click', toggleCollapse);
    header.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleCollapse(); }
    });

    wrapper.append(header, sendersDiv);
    app.append(wrapper);
  }
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

        // Activity source badges (sweep/batch)
        let ruleCell: HTMLElement;
        if (e.source === 'sweep') {
          ruleCell = h('td', {}, h('span', { className: 'badge-sweep' }, '[sweep]'), e.ruleName ?? '');
        } else if (e.source === 'batch') {
          ruleCell = h('td', {}, h('span', { className: 'badge-batch' }, '[batch]'), e.ruleName ?? '');
        } else {
          ruleCell = h('td', {}, e.ruleName ?? '');
        }

        // Formatted action display
        let actionDisplay: string;
        switch (e.action) {
          case 'skip': actionDisplay = '\u2014 Inbox'; break;
          case 'delete': actionDisplay = '\u2715 Trash'; break;
          case 'review': actionDisplay = '\u2192 Review'; break;
          default: actionDisplay = e.folder ? `\u2192 ${e.folder}` : e.action; break;
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
    if (activityTimer) { clearInterval(activityTimer); activityTimer = null; }
    activityTimer = setInterval(() => {
      if (currentPage === 'activity') renderActivity();
    }, 30000);

  } catch (e: unknown) {
    app.innerHTML = '';
    app.append(h('div', { className: 'empty' }, `Failed to load activity: ${e instanceof Error ? e.message : String(e)}`));
  }
}

// --- Settings Page ---
async function renderSettings() {
  const app = $('#app');
  app.innerHTML = '<p>Loading...</p>';

  try {
    const [imapCfg, status, envelopeStatus, reviewStatus, reviewConfig, trackingStatus] = await Promise.all([
      api.config.getImap(),
      api.status.get(),
      api.config.getEnvelopeStatus(),
      api.review.status().catch(() => null),
      api.config.getReview().catch(() => null),
      api.tracking.status().catch(() => null),
    ]);
    app.innerHTML = '';

    const card = h('div', { className: 'settings-card' });
    const statusClass = status.connectionStatus === 'connected' ? 'connected'
      : status.connectionStatus === 'connecting' ? 'connecting' : 'disconnected';

    card.innerHTML = `
      <h2>IMAP Connection</h2>
      <p style="margin-bottom:1rem">Status: <span class="status-badge ${statusClass}">${esc(status.connectionStatus)}</span>
        &mdash; ${status.messagesProcessed} messages processed</p>
      <div class="form-group"><label>Host</label><input id="s-host" value="${esc(imapCfg.host)}" /></div>
      <div class="form-group"><label>Port</label><input id="s-port" type="number" value="${esc(String(imapCfg.port))}" /></div>
      <div class="form-group">
        <label><input id="s-tls" type="checkbox" ${imapCfg.tls ? 'checked' : ''} /> Use TLS</label>
      </div>
      <div class="form-group"><label>Username</label><input id="s-user" value="${esc(imapCfg.auth.user)}" /></div>
      <div class="form-group"><label>Password</label><input id="s-pass" type="password" value="${esc(imapCfg.auth.pass)}" /></div>
      <div class="form-actions">
        <button class="btn btn-primary" id="s-save">Save Settings</button>
      </div>
      <hr class="discovery-divider" />
      <h3 class="discovery-heading">Envelope Discovery</h3>
      ${envelopeStatus.envelopeHeader
        ? `<p><span class="status-badge connected">${esc(envelopeStatus.envelopeHeader)}</span> detected</p>
           <button class="btn" id="s-rediscover">Re-run Discovery</button>`
        : `<p class="discovery-warning">&#9888; No envelope header detected. Rules using Delivered-To and Recipient Field will be skipped.</p>
           <button class="btn btn-primary" id="s-rediscover">Run Discovery</button>`}
    `;

    app.append(card);

    document.getElementById('s-save')!.addEventListener('click', async () => {
      const cfg: ImapConfigResponse = {
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
      } catch (e: unknown) { toast(e instanceof Error ? e.message : String(e), true); }
    });

    document.getElementById('s-rediscover')?.addEventListener('click', async (e) => {
      const btn = e.target as HTMLButtonElement;
      const originalText = btn.textContent;
      btn.disabled = true;
      btn.classList.add('discovering');
      btn.innerHTML = '<span class="spinner"></span> Discovering...';
      try {
        const result = await api.config.triggerDiscovery();
        if (result.envelopeHeader) {
          toast(`Discovered: ${result.envelopeHeader}`);
        } else {
          toast('No envelope header found', true);
        }
        renderSettings();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        toast(message, true);
        btn.disabled = false;
        btn.classList.remove('discovering');
        btn.innerHTML = originalText || 'Run Discovery';
      }
    });

    // Move Tracking card
    if (trackingStatus) {
      const trackingCard = h('div', { className: 'settings-card' });
      const pendingCount = trackingStatus.pendingDeepScan;
      const btnLabel = pendingCount > 0
        ? `Run Deep Scan (${pendingCount} pending)`
        : 'Run Deep Scan';
      const btnDisabled = !trackingStatus.enabled || pendingCount === 0;
      trackingCard.innerHTML = `
        <h2>Move Tracking</h2>
        <div class="review-stats">
          <div class="stat-item"><div class="stat-value">${trackingStatus.messagesTracked}</div><div class="stat-label">Tracked</div></div>
          <div class="stat-item"><div class="stat-value">${trackingStatus.signalsLogged}</div><div class="stat-label">Signals</div></div>
          <div class="stat-item"><div class="stat-value">${pendingCount}</div><div class="stat-label">Pending Deep Scan</div></div>
        </div>
        ${trackingStatus.lastScanAt ? `<p class="sweep-info">Last scan: ${new Date(trackingStatus.lastScanAt).toLocaleString()}</p>` : ''}
        <div class="form-actions">
          <button class="btn${btnDisabled ? '' : ' btn-primary'}" id="t-deep-scan" ${btnDisabled ? 'disabled' : ''}>${btnLabel}</button>
        </div>
      `;
      app.append(trackingCard);

      document.getElementById('t-deep-scan')?.addEventListener('click', async (e) => {
        const btn = e.target as HTMLButtonElement;
        const originalText = btn.textContent;
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> Scanning...';
        try {
          const result = await api.tracking.triggerDeepScan();
          toast(`Deep scan complete: ${result.resolved} message(s) resolved`);
          renderSettings();
        } catch (err: unknown) {
          toast(err instanceof Error ? err.message : String(err), true);
          btn.disabled = false;
          btn.innerHTML = originalText || 'Run Deep Scan';
        }
      });
    }

    // Review Status panel
    if (reviewStatus) {
      const reviewCard = h('div', { className: 'settings-card' });
      const nextSweep = reviewStatus.nextSweepAt
        ? new Date(reviewStatus.nextSweepAt).toLocaleString()
        : 'Not scheduled';
      let lastSweepHtml = '<p class="sweep-info">No sweeps yet</p>';
      if (reviewStatus.lastSweep) {
        const completedAt = new Date(reviewStatus.lastSweep.completedAt).toLocaleString();
        lastSweepHtml = `<dl class="sweep-info">
          <dt>Completed:</dt><dd>${esc(completedAt)}</dd>
          <dt>Archived:</dt><dd>${reviewStatus.lastSweep.messagesArchived}</dd>
          <dt>Errors:</dt><dd>${reviewStatus.lastSweep.errors}</dd>
        </dl>`;
      }
      reviewCard.innerHTML = `
        <h2>Review Status</h2>
        <p style="margin-bottom:0.5rem">Folder: <strong>${esc(reviewStatus.folder)}</strong></p>
        <div class="review-stats">
          <div class="stat-item"><div class="stat-value">${reviewStatus.totalMessages}</div><div class="stat-label">Total</div></div>
          <div class="stat-item"><div class="stat-value">${reviewStatus.readMessages}</div><div class="stat-label">Read</div></div>
          <div class="stat-item"><div class="stat-value">${reviewStatus.unreadMessages}</div><div class="stat-label">Unread</div></div>
        </div>
        <p class="sweep-info"><dt>Next sweep:</dt><dd>${esc(nextSweep)}</dd></p>
        <h3 style="margin-top:1rem;font-size:0.95rem">Last Sweep</h3>
        ${lastSweepHtml}
      `;
      app.append(reviewCard);
    } else {
      const reviewCard = h('div', { className: 'settings-card' });
      reviewCard.innerHTML = '<h2>Review Status</h2><p class="sweep-info">Unable to load review status.</p>';
      app.append(reviewCard);
    }

    // Sweep Settings (editable)
    if (reviewConfig) {
      const sweepCard = h('div', { className: 'settings-card' });

      let reviewFolder = reviewConfig.folder;
      let archiveFolder = reviewConfig.defaultArchiveFolder;
      let trashFolder = reviewConfig.trashFolder;

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
    app.innerHTML = '';
    app.append(h('div', { className: 'empty' }, `Failed to load settings: ${e instanceof Error ? e.message : String(e)}`));
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

  const matchGroups = groups.filter(g => g.action !== 'no-match');
  const noMatchGroup = groups.find(g => g.action === 'no-match');
  const matchedCount = matchGroups.reduce((sum, g) => sum + g.count, 0);

  const summary = h('p', { style: 'margin:0.5rem 0 1rem;font-size:0.9rem;color:#444' });
  summary.textContent = matchedCount + ' of ' + totalMessages + ' messages matched';
  card.append(summary);

  for (const group of matchGroups) {
    card.append(buildDryRunGroup(group, false));
  }

  if (noMatchGroup) {
    card.append(buildDryRunGroup(noMatchGroup, true));
  }

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
  skippedSpan.textContent = 'Left in Place: ' + state.skipped;
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
        progressText.textContent = s.processed + ' of ' + s.totalMessages + ' messages processed';
        const newPct = s.totalMessages > 0 ? (s.processed / s.totalMessages * 100) : 0;
        progressFill.style.width = newPct + '%';
        movedSpan.textContent = 'Moved: ' + s.moved;
        skippedSpan.textContent = 'Left in Place: ' + s.skipped;
        errorsSpan.textContent = 'Errors: ' + s.errors;
        errorsSpan.className = s.errors > 0 ? 'error-count' : '';
      } else {
        if (batchPollTimer) { clearInterval(batchPollTimer); batchPollTimer = null; }
        renderBatchResults(app, s);
      }
    } catch {
      // Poll error -- keep trying
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

  const stats = h('div', { className: 'review-stats' });

  const movedItem = h('div', { className: 'stat-item' });
  movedItem.append(h('div', { className: 'stat-value' }, String(state.moved)), h('div', { className: 'stat-label' }, 'MOVED'));

  const skippedItem = h('div', { className: 'stat-item' });
  skippedItem.append(h('div', { className: 'stat-value' }, String(state.skipped)), h('div', { className: 'stat-label' }, 'LEFT IN PLACE'));

  const errorsItem = h('div', { className: 'stat-item' });
  const errorsValue = h('div', { className: 'stat-value' }, String(state.errors));
  if (state.errors > 0) errorsValue.style.color = '#dc2626';
  errorsItem.append(errorsValue, h('div', { className: 'stat-label' }, 'ERRORS'));

  stats.append(movedItem, skippedItem, errorsItem);
  card.append(stats);

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

// --- Proposed Rules Page ---

async function updateProposedBadge(): Promise<void> {
  try {
    const proposals = await api.proposed.list();
    const badge = document.getElementById('proposed-badge');
    if (!badge) return;
    const count = proposals.length;
    if (count > 0) {
      badge.textContent = String(count);
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }
  } catch {
    // Silently ignore badge update failures
  }
}

async function renderProposed(): Promise<void> {
  const app = $('#app');
  app.innerHTML = '<p class="loading-pulse">Loading...</p>';

  try {
    const proposals = await api.proposed.list();
    app.innerHTML = '';

    const toolbar = h('div', { className: 'toolbar' },
      h('h2', {}, 'Proposed Rules'),
    );
    app.append(toolbar);

    if (proposals.length === 0) {
      app.append(h('div', { className: 'empty' },
        h('h3', {}, 'No proposed rules yet'),
        h('p', {}, 'As you move messages manually, Mail Manager will detect patterns and suggest rules here.'),
      ));
      return;
    }

    const cardList = h('div', { className: 'proposal-list' });

    for (const p of proposals) {
      const card = renderProposalCard(p);
      cardList.append(card);
    }

    app.append(cardList);
  } catch {
    toast('Failed to load proposals. Check your connection and refresh.', true);
    app.innerHTML = '';
  }
}

function renderProposalCard(p: ProposedRuleCard): HTMLElement {
  const card = h('div', { className: 'proposal-card' });

  // Header row: strength badge + source folder
  const strengthClass = getStrengthClass(p.strength);
  const header = h('div', { className: 'proposal-header' },
    h('span', { className: `strength-badge ${strengthClass}` }, p.strengthLabel),
    h('span', { className: 'proposal-source' }, p.sourceFolder),
  );
  card.append(header);

  // Route: sender -> destination
  const route = h('div', { className: 'proposal-route' },
    h('span', {}, p.sender),
    h('span', { className: 'proposal-route-arrow' }, ' \u2192 '),
    h('span', { className: 'proposal-route-dest' }, p.destinationFolder),
  );
  card.append(route);

  // Envelope recipient (if present)
  if (p.envelopeRecipient) {
    card.append(h('div', { className: 'proposal-envelope' }, `Envelope: ${p.envelopeRecipient}`));
  }

  // Example subjects
  if (p.examples.length > 0) {
    const exList = h('div', { className: 'proposal-examples' },
      h('div', { className: 'proposal-examples-label' }, 'Recent examples:'),
    );
    for (const ex of p.examples) {
      const subjectText = ex.subject.length > 60 ? ex.subject.slice(0, 60) + '\u2026' : ex.subject;
      const dateStr = formatShortDate(ex.date);
      exList.append(h('div', { className: 'proposal-example' },
        h('span', {}, `\u201C${subjectText}\u201D`),
        h('span', { className: 'proposal-example-date' }, ` (${dateStr})`),
      ));
    }
    card.append(exList);
  }

  // Conflict annotation (D-06)
  if (p.conflictAnnotation) {
    card.append(h('div', { className: 'proposal-conflict' }, p.conflictAnnotation));
  }

  // Resurfaced notice (D-09)
  if (p.resurfacedNotice) {
    card.append(h('div', { className: 'proposal-resurfaced' }, p.resurfacedNotice));
  }

  // Action buttons
  const actions = h('div', { className: 'proposal-actions' });

  const approveBtn = h('button', { className: 'btn btn-primary' }, 'Approve Rule');
  approveBtn.addEventListener('click', async () => {
    approveBtn.innerHTML = '<span class="spinner"></span>';
    actions.querySelectorAll('button').forEach(b => (b as HTMLButtonElement).disabled = true);
    try {
      await api.proposed.approve(p.id);
      toast('Rule created and active.');
      card.style.opacity = '0';
      card.style.transition = 'opacity 200ms';
      setTimeout(() => { card.remove(); updateProposedBadge(); }, 200);
    } catch (err: any) {
      // Remove any existing conflict notice
      card.querySelector('.proposal-conflict-notice')?.remove();

      if (err instanceof ApiError && err.conflict) {
        const conflict = err.conflict;
        const ruleName = conflict.rule.name || `Rule: ${conflict.rule.match.sender || '?'} → ${conflict.rule.action.folder || actionLabel(conflict.rule.action.type)}`;
        const notice = h('div', { className: 'proposal-conflict-notice' });

        if (conflict.type === 'exact') {
          notice.innerHTML = `<strong>Duplicate rule exists:</strong> "${esc(ruleName)}" already matches the same criteria. Use <em>Modify</em> to change the criteria, or <em>Dismiss</em> this proposal.`;
          approveBtn.textContent = 'Approve Rule';
          (approveBtn as HTMLButtonElement).disabled = true;
          (approveReviewBtn as HTMLButtonElement).disabled = true;
          // Re-enable modify and dismiss
          (modifyBtn as HTMLButtonElement).disabled = false;
          (dismissBtn as HTMLButtonElement).disabled = false;
        } else {
          notice.innerHTML = `<strong>Shadowed by existing rule:</strong> "${esc(ruleName)}" (priority #${conflict.rule.order}) already catches these messages. This rule would never fire.`;
          approveBtn.textContent = 'Approve Rule';
          (approveBtn as HTMLButtonElement).disabled = true;
          (approveReviewBtn as HTMLButtonElement).disabled = true;

          // Add "Save Ahead" button
          const saveAheadBtn = h('button', { className: 'btn btn-primary' }, 'Save Ahead');
          saveAheadBtn.addEventListener('click', async () => {
            saveAheadBtn.innerHTML = '<span class="spinner"></span>';
            card.querySelectorAll('button').forEach(b => (b as HTMLButtonElement).disabled = true);
            try {
              await api.proposed.approveInsertBefore(p.id, conflict.rule.id);
              toast('Rule created ahead of shadowing rule.');
              card.style.opacity = '0';
              card.style.transition = 'opacity 200ms';
              setTimeout(() => { card.remove(); updateProposedBadge(); }, 200);
            } catch (e: any) {
              toast(e.message || 'Failed to save ahead', true);
              saveAheadBtn.textContent = 'Save Ahead';
              card.querySelectorAll('button').forEach(b => (b as HTMLButtonElement).disabled = false);
              (approveBtn as HTMLButtonElement).disabled = true;
              (approveReviewBtn as HTMLButtonElement).disabled = true;
            }
          });
          notice.append(document.createElement('br'), saveAheadBtn);
          (modifyBtn as HTMLButtonElement).disabled = false;
          (dismissBtn as HTMLButtonElement).disabled = false;
        }
        // Insert notice before the actions bar
        card.insertBefore(notice, actions);
      } else {
        toast(err.message || 'Failed to approve', true);
        approveBtn.textContent = 'Approve Rule';
        actions.querySelectorAll('button').forEach(b => (b as HTMLButtonElement).disabled = false);
      }
    }
  });

  const approveReviewBtn = h('button', { className: 'btn btn-secondary' }, 'Approve as Review');
  approveReviewBtn.addEventListener('click', async () => {
    approveReviewBtn.innerHTML = '<span class="spinner"></span>';
    actions.querySelectorAll('button').forEach(b => (b as HTMLButtonElement).disabled = true);
    try {
      await api.proposed.approveAsReview(p.id);
      toast('Review rule created and active.');
      card.style.opacity = '0';
      card.style.transition = 'opacity 200ms';
      setTimeout(() => { card.remove(); updateProposedBadge(); }, 200);
    } catch (err: any) {
      // Remove any existing conflict notice
      card.querySelector('.proposal-conflict-notice')?.remove();

      if (err instanceof ApiError && err.conflict) {
        const conflict = err.conflict;
        const ruleName = conflict.rule.name || `Rule: ${conflict.rule.match.sender || '?'} → ${conflict.rule.action.folder || actionLabel(conflict.rule.action.type)}`;
        const notice = h('div', { className: 'proposal-conflict-notice' });

        if (conflict.type === 'exact') {
          notice.innerHTML = `<strong>Duplicate rule exists:</strong> "${esc(ruleName)}" already matches the same criteria. Use <em>Modify</em> to change the criteria, or <em>Dismiss</em> this proposal.`;
          approveReviewBtn.textContent = 'Approve as Review';
          (approveReviewBtn as HTMLButtonElement).disabled = true;
          (approveBtn as HTMLButtonElement).disabled = true;
          // Re-enable modify and dismiss
          (modifyBtn as HTMLButtonElement).disabled = false;
          (dismissBtn as HTMLButtonElement).disabled = false;
        } else {
          notice.innerHTML = `<strong>Shadowed by existing rule:</strong> "${esc(ruleName)}" (priority #${conflict.rule.order}) already catches these messages. This rule would never fire.`;
          approveReviewBtn.textContent = 'Approve as Review';
          (approveReviewBtn as HTMLButtonElement).disabled = true;
          (approveBtn as HTMLButtonElement).disabled = true;

          // Add "Save Ahead" button for review variant
          const saveAheadReviewBtn = h('button', { className: 'btn btn-secondary' }, 'Save Ahead (Review)');
          saveAheadReviewBtn.addEventListener('click', async () => {
            saveAheadReviewBtn.innerHTML = '<span class="spinner"></span>';
            card.querySelectorAll('button').forEach(b => (b as HTMLButtonElement).disabled = true);
            try {
              await api.proposed.approveAsReviewInsertBefore(p.id, conflict.rule.id);
              toast('Review rule created ahead of shadowing rule.');
              card.style.opacity = '0';
              card.style.transition = 'opacity 200ms';
              setTimeout(() => { card.remove(); updateProposedBadge(); }, 200);
            } catch (e: any) {
              toast(e.message || 'Failed to save ahead', true);
              saveAheadReviewBtn.textContent = 'Save Ahead (Review)';
              card.querySelectorAll('button').forEach(b => (b as HTMLButtonElement).disabled = false);
              (approveBtn as HTMLButtonElement).disabled = true;
              (approveReviewBtn as HTMLButtonElement).disabled = true;
            }
          });
          notice.append(document.createElement('br'), saveAheadReviewBtn);
          (modifyBtn as HTMLButtonElement).disabled = false;
          (dismissBtn as HTMLButtonElement).disabled = false;
        }
        // Insert notice before the actions bar
        card.insertBefore(notice, actions);
      } else {
        toast(err.message || 'Failed to approve', true);
        approveReviewBtn.textContent = 'Approve as Review';
        actions.querySelectorAll('button').forEach(b => (b as HTMLButtonElement).disabled = false);
      }
    }
  });

  const modifyBtn = h('button', { className: 'btn' }, 'Modify');
  modifyBtn.addEventListener('click', async () => {
    try {
      const data = await api.proposed.getModifyData(p.id);
      // Check envelope availability before opening modal
      const envStatus = await api.config.getEnvelopeStatus().catch(() => ({ envelopeHeader: null }));
      const envelopeAvailable = envStatus.envelopeHeader !== null;

      // Build a pseudo-Rule to pre-fill the modal
      const prefill: Rule = {
        id: '',
        name: `Auto: ${data.sender}`,
        match: {
          sender: data.sender,
          ...(data.envelopeRecipient ? { deliveredTo: data.envelopeRecipient } : {}),
        },
        action: { type: 'move' as const, folder: data.destinationFolder },
        enabled: true,
        order: 0,
      };

      // Store the proposal ID so after save we can call mark-approved.
      // CRITICAL: We use markApproved (not approve) because openRuleModal already
      // creates the rule via api.rules.create(). Calling approve would create a
      // duplicate rule via configRepo.addRule().
      pendingProposalApproval = data.proposalId;
      openRuleModal(prefill, envelopeAvailable, true);
    } catch (err: any) {
      toast(err.message || 'Failed to load proposal data', true);
    }
  });

  const dismissBtn = h('button', { className: 'btn btn-dismiss' }, 'Dismiss');
  dismissBtn.addEventListener('click', async () => {
    dismissBtn.innerHTML = '<span class="spinner"></span>';
    actions.querySelectorAll('button').forEach(b => (b as HTMLButtonElement).disabled = true);
    try {
      await api.proposed.dismiss(p.id);
      toast('Proposal dismissed.');
      card.style.opacity = '0';
      card.style.transition = 'opacity 200ms';
      setTimeout(() => { card.remove(); updateProposedBadge(); }, 200);
    } catch (err: any) {
      toast(err.message || 'Failed to dismiss', true);
      dismissBtn.textContent = 'Dismiss';
      actions.querySelectorAll('button').forEach(b => (b as HTMLButtonElement).disabled = false);
    }
  });

  actions.append(approveBtn, approveReviewBtn, modifyBtn, dismissBtn);
  card.append(actions);

  return card;
}

function getStrengthClass(strength: number): string {
  if (strength >= 5) return 'strength-strong';
  if (strength >= 2) return 'strength-moderate';
  if (strength >= 1) return 'strength-weak';
  return 'strength-ambiguous';
}

function formatShortDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

// --- Init ---
document.addEventListener('DOMContentLoaded', () => {
  initNav();
  navigate('rules');
  updateProposedBadge();

  // Refresh on focus
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && currentPage === 'activity') renderActivity();
  });
});
