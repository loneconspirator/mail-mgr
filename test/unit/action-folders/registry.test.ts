import { describe, it, expect } from 'vitest';
import { ACTION_REGISTRY } from '../../../src/action-folders/registry.js';
import type { ActionDefinition } from '../../../src/action-folders/registry.js';
import { actionFolderConfigSchema } from '../../../src/config/schema.js';

describe('ACTION_REGISTRY', () => {
  it('has exactly 4 action types', () => {
    const keys = Object.keys(ACTION_REGISTRY);
    expect(keys).toHaveLength(4);
    expect(new Set(keys)).toEqual(new Set(['vip', 'block', 'undoVip', 'unblock']));
  });

  it('keys match config schema folder keys', () => {
    const parsed = actionFolderConfigSchema.parse({});
    const schemaKeys = new Set(Object.keys(parsed.folders));
    const registryKeys = new Set(Object.keys(ACTION_REGISTRY));
    expect(registryKeys).toEqual(schemaKeys);
  });

  it('vip entry has correct shape', () => {
    expect(ACTION_REGISTRY.vip).toEqual({
      operation: 'create',
      ruleAction: 'skip',
      destination: 'inbox',
      folderConfigKey: 'vip',
    });
  });

  it('block entry has correct shape', () => {
    expect(ACTION_REGISTRY.block).toEqual({
      operation: 'create',
      ruleAction: 'delete',
      destination: 'trash',
      folderConfigKey: 'block',
    });
  });

  it('undoVip entry has correct shape', () => {
    expect(ACTION_REGISTRY.undoVip).toEqual({
      operation: 'remove',
      ruleAction: 'skip',
      destination: 'inbox',
      folderConfigKey: 'undoVip',
    });
  });

  it('unblock entry has correct shape', () => {
    expect(ACTION_REGISTRY.unblock).toEqual({
      operation: 'remove',
      ruleAction: 'delete',
      destination: 'inbox',
      folderConfigKey: 'unblock',
    });
  });

  it('all create operations have correct destinations', () => {
    const creates = Object.values(ACTION_REGISTRY).filter(
      (d: ActionDefinition) => d.operation === 'create',
    );
    expect(creates).toHaveLength(2);
    // vip -> inbox, block -> trash
    const vip = ACTION_REGISTRY.vip;
    const block = ACTION_REGISTRY.block;
    expect(vip.ruleAction).toBe('skip');
    expect(vip.destination).toBe('inbox');
    expect(block.ruleAction).toBe('delete');
    expect(block.destination).toBe('trash');
  });

  it('all remove operations target inbox destination', () => {
    const removes = Object.values(ACTION_REGISTRY).filter(
      (d: ActionDefinition) => d.operation === 'remove',
    );
    expect(removes).toHaveLength(2);
    for (const def of removes) {
      expect(def.destination).toBe('inbox');
    }
  });
});
