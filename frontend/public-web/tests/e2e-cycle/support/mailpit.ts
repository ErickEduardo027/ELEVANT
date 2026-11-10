import { MAILPIT } from "./env";

type Summary = { ID: string; To: Array<{ Address: string }>; Subject: string; Created: string };
export type Email = { id: string; subject: string; text: string; html: string;
  attachments: Array<{ PartID: string; FileName: string; ContentType: string; Size: number }> };

/** The bytes of one attachment of an email (the signed contract PDF, a receipt…). */
export async function attachment(email: Email, fileName: RegExp): Promise<Buffer> {
  const part = email.attachments.find(item => fileName.test(item.FileName));
  if (!part) throw new Error(`The email carries no attachment matching ${fileName}.`);
  const response = await fetch(`${MAILPIT}/api/v1/message/${email.id}/part/${part.PartID}`);
  return Buffer.from(await response.arrayBuffer());
}

/** IDs of the emails to `to` whose subject matches: an email already listed is never the one a new request waits for. */
export async function emailIds(to: string, subject: RegExp): Promise<string[]> {
  const address = to.toLowerCase();
  const response = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}&limit=25`);
  const list = await response.json() as { messages?: Summary[] };
  return (list.messages ?? []).filter(item => subject.test(item.Subject) &&
    item.To.some(recipient => recipient.Address.toLowerCase() === address)).map(item => item.ID);
}

/**
 * Waits for the newest email to `to` created after `since` whose subject matches. `exclude` lists emails that already
 * existed: a login a few seconds after another one would otherwise take the previous, already used code.
 */
export async function waitForEmail(to: string, subject: RegExp, since: number, timeoutMs = 90_000,
  exclude: readonly string[] = []): Promise<Email> {
  const deadline = Date.now() + timeoutMs;
  const address = to.toLowerCase();
  while (Date.now() < deadline) {
    const response = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}&limit=25`);
    const list = await response.json() as { messages?: Summary[] };
    const match = (list.messages ?? []).find(item => subject.test(item.Subject) && Date.parse(item.Created) >= since - 2_000 &&
      !exclude.includes(item.ID) && item.To.some(recipient => recipient.Address.toLowerCase() === address));
    if (match) {
      const full = await (await fetch(`${MAILPIT}/api/v1/message/${match.ID}`)).json() as {
        Subject: string; Text?: string; HTML?: string; Attachments?: Email["attachments"] };
      return { id: match.ID, subject: full.Subject, text: full.Text ?? "", html: full.HTML ?? "", attachments: full.Attachments ?? [] };
    }
    await new Promise(resolve => setTimeout(resolve, 1_500));
  }
  throw new Error(`No email to ${to} matching ${subject} reached Mailpit.`);
}

/** The 6-digit portal login code (ADR-0022). */
export function loginCode(email: Email) {
  const code = /^\s*(\d{6})\s*$/m.exec(email.text)?.[1] ?? /\b(\d{6})\b/.exec(email.text)?.[1];
  if (!code) throw new Error("The email carries no 6-digit code.");
  return code;
}

/** The first link in the email whose path starts with `pathPrefix` (activation, recovery…). */
export function linkTo(email: Email, pathPrefix: string) {
  const links = [...email.text.matchAll(/https?:\/\/[^\s"'<>)]+/g), ...email.html.matchAll(/https?:\/\/[^\s"'<>)]+/g)]
    .map(match => match[0].replace(/&amp;/g, "&"));
  const link = links.find(item => new URL(item).pathname.startsWith(pathPrefix));
  if (!link) throw new Error(`The email carries no ${pathPrefix} link.`);
  return link;
}
