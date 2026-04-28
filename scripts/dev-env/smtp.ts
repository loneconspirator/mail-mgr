import { createTransport } from 'nodemailer';

const SMTP_PORT = 3025;
const HOST = 'localhost';

/**
 * Send an email to the local GreenMail SMTP server. Used by the dev-env seed
 * script and integration test helpers.
 */
export async function sendTestEmail(opts: {
  from: string;
  to: string;
  subject: string;
  body: string;
}): Promise<void> {
  const transport = createTransport({
    host: HOST,
    port: SMTP_PORT,
    secure: false,
    tls: { rejectUnauthorized: false },
  });

  await transport.sendMail({
    from: opts.from,
    to: opts.to,
    subject: opts.subject,
    text: opts.body,
  });

  transport.close();
}
