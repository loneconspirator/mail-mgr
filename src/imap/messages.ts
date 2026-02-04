export interface EmailAddress {
  name: string;
  address: string;
}

export interface EmailMessage {
  uid: number;
  messageId: string;
  from: EmailAddress;
  to: EmailAddress[];
  cc: EmailAddress[];
  subject: string;
  date: Date;
  flags: Set<string>;
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
