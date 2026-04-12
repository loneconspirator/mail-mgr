export interface EmailAddress {
  name: string;
  address: string;
}

export type Visibility = 'list' | 'direct' | 'cc' | 'bcc';

export interface EmailMessage {
  uid: number;
  messageId: string;
  from: EmailAddress;
  to: EmailAddress[];
  cc: EmailAddress[];
  subject: string;
  date: Date;
  flags: Set<string>;
  envelopeRecipient?: string;
  visibility?: Visibility;
}

interface ImapAddressObject {
  name?: string;
  address?: string;
}

interface ImapEnvelopeObject {
  date?: Date;
  subject?: string;
  messageId?: string;
  from?: ImapAddressObject[];
  to?: ImapAddressObject[];
  cc?: ImapAddressObject[];
}

export interface ImapFetchResult {
  uid: number;
  flags?: Set<string>;
  envelope?: ImapEnvelopeObject;
}

function parseAddress(raw: ImapAddressObject | undefined): EmailAddress {
  return {
    name: raw?.name ?? '',
    address: raw?.address ?? '',
  };
}

function parseAddressList(raw: ImapAddressObject[] | undefined): EmailAddress[] {
  if (!raw || raw.length === 0) return [];
  return raw.map(parseAddress);
}

export interface ReviewMessage {
  uid: number;
  flags: Set<string>;
  internalDate: Date;
  envelope: {
    from: EmailAddress;
    to: EmailAddress[];
    cc: EmailAddress[];
    subject: string;
    messageId: string;
  };
}

export function reviewMessageToEmailMessage(rm: ReviewMessage): EmailMessage {
  return {
    uid: rm.uid,
    messageId: rm.envelope.messageId,
    from: rm.envelope.from,
    to: rm.envelope.to,
    cc: rm.envelope.cc,
    subject: rm.envelope.subject,
    date: rm.internalDate,
    flags: rm.flags,
  };
}

export function parseHeaderLines(buf: Buffer | undefined): Map<string, string> {
  const headers = new Map<string, string>();
  if (!buf || buf.length === 0) return headers;
  const text = buf.toString('utf-8');
  const lines = text.split(/\r?\n/);
  let currentKey = '';
  let currentValue = '';
  for (const line of lines) {
    if (line === '') continue;
    if (/^\s/.test(line)) {
      currentValue += ' ' + line.trim();
    } else {
      if (currentKey) {
        headers.set(currentKey.toLowerCase(), currentValue.trim());
      }
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        currentKey = line.substring(0, colonIdx);
        currentValue = line.substring(colonIdx + 1);
      }
    }
  }
  if (currentKey) {
    headers.set(currentKey.toLowerCase(), currentValue.trim());
  }
  return headers;
}

export function parseMessage(fetched: ImapFetchResult): EmailMessage {
  const envelope = fetched.envelope;

  const fromList = envelope?.from;
  const from = fromList && fromList.length > 0
    ? parseAddress(fromList[0])
    : { name: '', address: '' };

  return {
    uid: fetched.uid,
    messageId: envelope?.messageId ?? '',
    from,
    to: parseAddressList(envelope?.to),
    cc: parseAddressList(envelope?.cc),
    subject: envelope?.subject ?? '',
    date: envelope?.date ?? new Date(0),
    flags: fetched.flags ?? new Set(),
  };
}
