export { ImapClient } from './client.js';
export type { ConnectionState, ImapClientEvents, ImapFlowLike, ImapFlowFactory } from './client.js';
export { parseMessage, reviewMessageToEmailMessage, parseHeaderLines, classifyVisibility } from './messages.js';
export type { EmailMessage, EmailAddress, ImapFetchResult, ReviewMessage, Visibility } from './messages.js';
