import { api } from './api.js'
import type { FolderNode } from '../../shared/types.js'

// --- Types ---

export interface FolderPickerOptions {
  container: HTMLElement
  currentValue: string
  onSelect: (folderPath: string) => void
}

interface PickerState {
  expanded: Set<string>
  selected: string
  onSelect: (path: string) => void
  container: HTMLElement
}

// --- Cache ---

let cachedFolders: FolderNode[] | null = null
let cachedRecent: string[] | null = null
let cachedAt = 0
const CACHE_TTL = 60_000

/** Clear cached folder data. Exported for testing. */
export function clearFolderCache(): void {
  cachedFolders = null
  cachedRecent = null
  cachedAt = 0
}

// --- DOM Helper ---

function h(tag: string, attrs: Record<string, string> = {}, ...children: (string | Node)[]): HTMLElement {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('data-')) el.setAttribute(k, v)
    else (el as any)[k] = v
  }
  for (const c of children) {
    el.append(typeof c === 'string' ? document.createTextNode(c) : c)
  }
  return el
}

// --- Public API ---

/** Render an interactive folder picker into the given container. */
export async function renderFolderPicker(opts: FolderPickerOptions): Promise<void> {
  const container = opts.container
  container.innerHTML = ''
  container.append(h('span', { style: 'color:#888;font-size:0.85rem' }, 'Loading folders...'))

  const state: PickerState = {
    expanded: new Set<string>(),
    selected: opts.currentValue,
    onSelect: (path: string): void => {
      state.selected = path
      opts.onSelect(path)
      renderPickerContent(state, folders, recentFolders)
    },
    container,
  }

  let folders: FolderNode[] = []
  let recentFolders: string[] = []

  try {
    if (cachedFolders && cachedRecent && Date.now() - cachedAt < CACHE_TTL) {
      folders = cachedFolders
      recentFolders = cachedRecent
    } else {
      const [treeRes, recent] = await Promise.all([
        api.folders.list(),
        api.activity.recentFolders(),
      ])
      folders = treeRes.folders
      recentFolders = recent
      cachedFolders = folders
      cachedRecent = recentFolders
      cachedAt = Date.now()
    }

    if (state.selected) {
      expandPathTo(folders, state.selected, state.expanded)
    }

    renderPickerContent(state, folders, recentFolders)
  } catch {
    container.innerHTML = ''
    const retryBtn = h('button', { className: 'btn btn-sm' }, 'Retry')
    retryBtn.addEventListener('click', () => renderFolderPicker(opts))
    container.append(h('div', { className: 'folder-picker' },
      h('div', { style: 'padding:1rem;color:#888;text-align:center' },
        'Unable to load folders. ',
        retryBtn,
      ),
    ))
  }
}

// --- Internal Rendering ---

function renderPickerContent(state: PickerState, folders: FolderNode[], recentFolders: string[]): void {
  const container = state.container
  container.innerHTML = ''

  const picker = h('div', { className: 'folder-picker' })

  if (state.selected) {
    const selectedBar = h('div', { className: 'folder-picker-selected' })
    selectedBar.append(
      document.createTextNode('Selected: '),
      h('strong', {}, state.selected),
    )
    picker.append(selectedBar)
  }

  if (recentFolders.length > 0) {
    picker.append(h('div', { className: 'folder-picker-heading' }, 'Recent'))
    const section = h('div', { className: 'folder-picker-section' })
    for (const path of recentFolders) {
      const name = path.split('/').pop() || path
      const row = h('div', { className: `tree-node${path === state.selected ? ' selected' : ''}` })
      row.append(h('span', { className: 'tree-label' }, name))
      row.addEventListener('click', () => state.onSelect(path))
      section.append(row)
    }
    picker.append(section)
  }

  picker.append(h('div', { className: 'folder-picker-heading' }, 'All Folders'))
  const allSection = h('div', { className: 'folder-picker-section' })
  for (const node of folders) {
    allSection.append(renderTreeNode(node, 0, state))
  }
  picker.append(allSection)

  container.append(picker)
}

function renderTreeNode(node: FolderNode, depth: number, state: PickerState): HTMLElement {
  if (depth > 10) return h('div')

  const wrapper = h('div')

  const row = h('div', { className: `tree-node${node.path === state.selected ? ' selected' : ''}` })
  row.style.paddingLeft = `${depth * 16}px`

  if (node.children.length > 0) {
    const isExpanded = state.expanded.has(node.path)
    const toggle = h('span', { className: 'tree-toggle' }, isExpanded ? '\u25BE' : '\u25B8')
    toggle.addEventListener('click', (e: Event) => {
      e.stopPropagation()
      if (state.expanded.has(node.path)) {
        state.expanded.delete(node.path)
      } else {
        state.expanded.add(node.path)
      }
      renderPickerContent(state, cachedFolders || [], cachedRecent || [])
    })
    row.append(toggle)
  } else {
    row.append(h('span', { className: 'tree-toggle tree-leaf' }))
  }

  row.append(h('span', { className: 'tree-label' }, node.name))
  row.addEventListener('click', () => state.onSelect(node.path))

  wrapper.append(row)

  if (node.children.length > 0 && state.expanded.has(node.path)) {
    for (const child of node.children) {
      wrapper.append(renderTreeNode(child, depth + 1, state))
    }
  }

  return wrapper
}

// --- Helpers ---

/** Expand all ancestor nodes of the target path so it's visible in the tree. */
export function expandPathTo(folders: FolderNode[], targetPath: string, expanded: Set<string>): void {
  for (const node of folders) {
    if (targetPath.startsWith(node.path + node.delimiter) || targetPath === node.path) {
      if (node.children.length > 0 && targetPath !== node.path) {
        expanded.add(node.path)
        expandPathTo(node.children, targetPath, expanded)
      }
    }
  }
}
