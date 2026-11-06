/**
 * Pages that describe an airline without being its own site: AVIAM's client list, Wikipedia and
 * Wikidata. They never count as the official site the representative's email is compared with.
 */
const NOT_OFFICIAL_SITES = ['aviamltd.com', 'wikipedia.org', 'wikidata.org'];

const within = (host, domain) => host === domain || host.endsWith(`.${domain}`);

function hostOf(url) {
  if (typeof url !== 'string' || !url.trim()) return null;
  try {
    const parsed = new URL(url.trim());
    if (!['https:', 'http:'].includes(parsed.protocol)) return null;
    return parsed.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * Compares the representative's email domain with the airline's official site (1-N18). It only
 * warns: what authorizes the approval is the confirmation Contratos records through an official
 * channel of the airline.
 *
 * @param {string} email
 * @param {Array<string | null | undefined>} siteUrls Candidate sites, the first usable one wins.
 * @returns {{ kind: 'match' | 'mismatch' | 'unknown', emailDomain: string | null, site: string | null }}
 */
export function representativeDomainCheck(email, siteUrls = []) {
  const at = typeof email === 'string' ? email.lastIndexOf('@') : -1;
  const emailDomain = at > 0 ? email.slice(at + 1).trim().toLowerCase() || null : null;
  const site = siteUrls.map(hostOf)
    .find(host => host && !NOT_OFFICIAL_SITES.some(domain => within(host, domain))) ?? null;
  if (!emailDomain || !site) return { kind: 'unknown', emailDomain, site };
  return { kind: within(emailDomain, site) || within(site, emailDomain) ? 'match' : 'mismatch', emailDomain, site };
}
