import type { ActionFolderConfig } from '../config/schema.js';

export type ActionType = 'vip' | 'block' | 'undoVip' | 'unblock';
export type FolderConfigKey = keyof ActionFolderConfig['folders'];

export interface ActionDefinition {
  /** Whether this action creates or removes a rule */
  operation: 'create' | 'remove';
  /** The rule action type this operates on */
  ruleAction: 'skip' | 'delete';
  /** Abstract destination — resolved to real folder path from config at runtime */
  destination: 'inbox' | 'trash';
  /** Key into actionFolders.folders config for the IMAP folder name */
  folderConfigKey: FolderConfigKey;
}

export const ACTION_REGISTRY: Record<ActionType, ActionDefinition> = {
  vip:     { operation: 'create', ruleAction: 'skip',   destination: 'inbox', folderConfigKey: 'vip' },
  block:   { operation: 'create', ruleAction: 'delete', destination: 'trash', folderConfigKey: 'block' },
  undoVip: { operation: 'remove', ruleAction: 'skip',   destination: 'inbox', folderConfigKey: 'undoVip' },
  unblock: { operation: 'remove', ruleAction: 'delete', destination: 'inbox', folderConfigKey: 'unblock' },
};
