// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { FolderNode, FolderTreeResponse } from '../../../src/shared/types.js'

vi.mock('../../../src/web/frontend/api.js', () => ({
  api: {
    folders: { list: vi.fn() },
    activity: { recentFolders: vi.fn() },
  },
}))

import { renderFolderPicker, expandPathTo, clearFolderCache } from '../../../src/web/frontend/folder-picker.js'
import { api } from '../../../src/web/frontend/api.js'

const mockTree: FolderNode[] = [
  { path: 'INBOX', name: 'INBOX', delimiter: '/', flags: [], children: [] },
  {
    path: 'Archive', name: 'Archive', delimiter: '/', flags: [], children: [
      { path: 'Archive/2024', name: '2024', delimiter: '/', flags: [], children: [] },
      {
        path: 'Archive/2025', name: '2025', delimiter: '/', flags: [], children: [
          { path: 'Archive/2025/Receipts', name: 'Receipts', delimiter: '/', flags: [], children: [] },
        ],
      },
    ],
  },
]

const mockTreeResponse: FolderTreeResponse = {
  folders: mockTree,
  cachedAt: new Date().toISOString(),
  stale: false,
}

describe('expandPathTo', () => {
  it('adds ancestor paths to the expanded set', () => {
    const expanded = new Set<string>()
    expandPathTo(mockTree, 'Archive/2025/Receipts', expanded)
    expect(expanded.has('Archive')).toBe(true)
    expect(expanded.has('Archive/2025')).toBe(true)
    expect(expanded.has('Archive/2025/Receipts')).toBe(false)
  })

  it('does not expand unrelated branches', () => {
    const expanded = new Set<string>()
    expandPathTo(mockTree, 'Archive/2024', expanded)
    expect(expanded.has('Archive')).toBe(true)
    expect(expanded.has('Archive/2025')).toBe(false)
  })

  it('handles root-level target without expanding anything', () => {
    const expanded = new Set<string>()
    expandPathTo(mockTree, 'INBOX', expanded)
    expect(expanded.size).toBe(0)
  })
})

describe('renderFolderPicker', () => {
  let container: HTMLElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.append(container)
    vi.mocked(api.folders.list).mockReset()
    vi.mocked(api.activity.recentFolders).mockReset()
    clearFolderCache()
  })

  it('renders tree with expected DOM structure', async () => {
    vi.mocked(api.folders.list).mockResolvedValue(mockTreeResponse)
    vi.mocked(api.activity.recentFolders).mockResolvedValue([])

    await renderFolderPicker({
      container,
      currentValue: '',
      onSelect: vi.fn(),
    })

    const picker = container.querySelector('.folder-picker')
    expect(picker).not.toBeNull()

    const treeNodes = container.querySelectorAll('.tree-node')
    expect(treeNodes.length).toBeGreaterThanOrEqual(2) // At least INBOX and Archive
  })

  it('renders recent folders section when recent folders are non-empty', async () => {
    vi.mocked(api.folders.list).mockResolvedValue(mockTreeResponse)
    vi.mocked(api.activity.recentFolders).mockResolvedValue(['Archive/2024', 'Archive/2025'])

    await renderFolderPicker({
      container,
      currentValue: '',
      onSelect: vi.fn(),
    })

    const headings = container.querySelectorAll('.folder-picker-heading')
    const headingTexts = Array.from(headings).map(h => h.textContent)
    expect(headingTexts).toContain('Recent')
    expect(headingTexts).toContain('All Folders')
  })

  it('does not render recent section when array is empty', async () => {
    vi.mocked(api.folders.list).mockResolvedValue(mockTreeResponse)
    vi.mocked(api.activity.recentFolders).mockResolvedValue([])

    await renderFolderPicker({
      container,
      currentValue: '',
      onSelect: vi.fn(),
    })

    const headings = container.querySelectorAll('.folder-picker-heading')
    const headingTexts = Array.from(headings).map(h => h.textContent)
    expect(headingTexts).not.toContain('Recent')
    expect(headingTexts).toContain('All Folders')
  })

  it('calls onSelect with correct path when folder is clicked', async () => {
    vi.mocked(api.folders.list).mockResolvedValue(mockTreeResponse)
    vi.mocked(api.activity.recentFolders).mockResolvedValue([])

    const onSelect = vi.fn()
    await renderFolderPicker({
      container,
      currentValue: '',
      onSelect,
    })

    const treeNodes = container.querySelectorAll('.tree-node')
    // Find the INBOX node by its label text
    const inboxNode = Array.from(treeNodes).find(
      n => n.querySelector('.tree-label')?.textContent === 'INBOX'
    )
    expect(inboxNode).not.toBeUndefined()
    ;(inboxNode as HTMLElement).click()
    expect(onSelect).toHaveBeenCalledWith('INBOX')
  })

  it('applies selected class to currently selected folder', async () => {
    vi.mocked(api.folders.list).mockResolvedValue(mockTreeResponse)
    vi.mocked(api.activity.recentFolders).mockResolvedValue([])

    await renderFolderPicker({
      container,
      currentValue: 'INBOX',
      onSelect: vi.fn(),
    })

    const selectedNodes = container.querySelectorAll('.tree-node.selected')
    expect(selectedNodes.length).toBeGreaterThanOrEqual(1)
    const labels = Array.from(selectedNodes).map(n => n.querySelector('.tree-label')?.textContent)
    expect(labels).toContain('INBOX')
  })

  it('expands children when toggle is clicked', async () => {
    vi.mocked(api.folders.list).mockResolvedValue(mockTreeResponse)
    vi.mocked(api.activity.recentFolders).mockResolvedValue([])

    await renderFolderPicker({
      container,
      currentValue: '',
      onSelect: vi.fn(),
    })

    // Archive should have a toggle (it has children)
    const toggles = container.querySelectorAll('.tree-toggle:not(.tree-leaf)')
    expect(toggles.length).toBeGreaterThanOrEqual(1)

    // Initially Archive children should not be visible (not expanded)
    let allLabels = Array.from(container.querySelectorAll('.tree-label')).map(l => l.textContent)
    expect(allLabels).not.toContain('2024')

    // Click the toggle to expand Archive
    ;(toggles[0] as HTMLElement).click()

    // Now children should be visible
    allLabels = Array.from(container.querySelectorAll('.tree-label')).map(l => l.textContent)
    expect(allLabels).toContain('2024')
    expect(allLabels).toContain('2025')
  })

  it('renders error state with retry button on fetch failure', async () => {
    vi.mocked(api.folders.list).mockRejectedValue(new Error('Network error'))
    vi.mocked(api.activity.recentFolders).mockRejectedValue(new Error('Network error'))

    await renderFolderPicker({
      container,
      currentValue: '',
      onSelect: vi.fn(),
    })

    expect(container.textContent).toContain('Unable to load folders')
    const retryBtn = container.querySelector('.btn.btn-sm')
    expect(retryBtn).not.toBeNull()
    expect(retryBtn?.textContent).toBe('Retry')
  })

  it('auto-expands ancestors of currently selected folder', async () => {
    vi.mocked(api.folders.list).mockResolvedValue(mockTreeResponse)
    vi.mocked(api.activity.recentFolders).mockResolvedValue([])

    await renderFolderPicker({
      container,
      currentValue: 'Archive/2025/Receipts',
      onSelect: vi.fn(),
    })

    // Archive and Archive/2025 should be expanded, so Receipts should be visible
    const allLabels = Array.from(container.querySelectorAll('.tree-label')).map(l => l.textContent)
    expect(allLabels).toContain('Receipts')
    expect(allLabels).toContain('2025')
  })
})
