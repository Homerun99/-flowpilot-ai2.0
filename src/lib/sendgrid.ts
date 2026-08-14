/**
 * SendGrid v3 API client for domain authentication (whitelabel).
 *
 * Endpoints used:
 *   POST /v3/whitelabel/domains — register a new domain for authentication
 *   GET  /v3/whitelabel/domains/{id}/validate — check DNS verification status
 */

const SENDGRID_BASE = "https://api.sendgrid.com/v3";

function getApiKey(): string | null {
  return process.env.SENDGRID_API_KEY || null;
}

interface SendgridDomainResponse {
  id: number;
  domain: string;
  subdomain: string;
  username: string;
  user_id: number;
  ips: unknown[];
  custom_spf: boolean;
  default: boolean;
  legacy: boolean;
  automatic_security: boolean;
  valid: boolean;
  dns: {
    mail_cname: { valid: boolean; type: string; host: string; data: string };
    dkim1: { valid: boolean; type: string; host: string; data: string };
    dkim2: { valid: boolean; type: string; host: string; data: string };
    mail_server?: { valid: boolean; type: string; host: string; data: string };
    subdomain_spf?: { valid: boolean; type: string; host: string; data: string };
  };
}

export interface DnsRecord {
  type: string;
  host: string;
  data: string;
  validated: boolean;
}

export interface StartVerificationResult {
  domainId: number;
  domain: string;
  subdomain: string;
  dnsRecords: DnsRecord[];
  verified: boolean;
}

/**
 * Start domain authentication with SendGrid.
 * Registers a new domain whitelabel and returns the DNS records to add.
 */
export async function startDomainVerification(
  domain: string,
  subdomain: string = "mail"
): Promise<StartVerificationResult> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("SENDGRID_API_KEY is not configured");
  }

  const res = await fetch(`${SENDGRID_BASE}/whitelabel/domains`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      domain,
      subdomain,
      automatic_security: true,
      custom_spf: false,
      default: false,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`SendGrid API error (${res.status}): ${err}`);
  }

  const data = (await res.json()) as SendgridDomainResponse;
  const dns = data.dns;

  // Extract all DNS records from the response
  const dnsRecords: DnsRecord[] = [];
  for (const [key, record] of Object.entries(dns)) {
    if (record && record.host && record.data) {
      dnsRecords.push({
        type: record.type || "CNAME",
        host: record.host,
        data: record.data,
        validated: record.valid,
      });
    }
  }

  return {
    domainId: data.id,
    domain: data.domain,
    subdomain: data.subdomain,
    dnsRecords,
    verified: data.valid,
  };
}

export interface CheckVerificationResult {
  domainId: number;
  verified: boolean;
  dnsRecords: DnsRecord[];
}

/**
 * Check if a domain's DNS records have been verified by SendGrid.
 */
export async function checkDomainVerification(
  domainId: number
): Promise<CheckVerificationResult> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("SENDGRID_API_KEY is not configured");
  }

  // First get the domain to check current state
  const res = await fetch(`${SENDGRID_BASE}/whitelabel/domains/${domainId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`SendGrid API error (${res.status}): ${err}`);
  }

  const data = (await res.json()) as SendgridDomainResponse;
  const dns = data.dns;

  const dnsRecords: DnsRecord[] = [];
  for (const [, record] of Object.entries(dns)) {
    if (record && record.host && record.data) {
      dnsRecords.push({
        type: record.type || "CNAME",
        host: record.host,
        data: record.data,
        validated: record.valid,
      });
    }
  }

  return {
    domainId: data.id,
    verified: data.valid,
    dnsRecords,
  };
}
