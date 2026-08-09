/**
 * Defence in depth for configured LLM endpoints.
 *
 * The client can no longer choose a URL (see providers.ts) — this guard exists
 * so a typo or a hostile value in the server configuration still cannot turn
 * the app into an SSRF proxy for cloud metadata or the internal network.
 */

export interface EndpointPolicy {
  /** Allow http://127.0.0.1, ::1, localhost — needed for local Ollama / LM Studio. */
  allowLoopback: boolean;
  /** Allow RFC1918 / CGNAT hosts, e.g. an LLM server elsewhere in the corporate LAN. */
  allowPrivateNetwork: boolean;
}

export const DEFAULT_ENDPOINT_POLICY: EndpointPolicy = {
  allowLoopback: true,
  allowPrivateNetwork: false,
};

export class EndpointNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EndpointNotAllowedError";
  }
}

function isLoopbackHost(host: string): boolean {
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "::1" || host === "[::1]") return true;
  return /^127\./.test(host);
}

/** 169.254.0.0/16 and fe80::/10 — includes the 169.254.169.254 cloud metadata service. */
function isLinkLocalHost(host: string): boolean {
  if (/^169\.254\./.test(host)) return true;
  return /^\[?fe[89ab][0-9a-f]:/i.test(host);
}

function isPrivateHost(host: string): boolean {
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  // 100.64.0.0/10 — carrier-grade NAT, also used by container/mesh networks
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host)) return true;
  // Unique local IPv6 fc00::/7
  if (/^\[?f[cd][0-9a-f]{2}:/i.test(host)) return true;
  return false;
}

/**
 * Throws EndpointNotAllowedError when the URL must not be fetched server-side.
 * Returns the normalized endpoint (no trailing slash) when it is acceptable.
 */
export function assertAllowedEndpoint(
  rawEndpoint: string,
  policy: EndpointPolicy = DEFAULT_ENDPOINT_POLICY,
): string {
  let url: URL;
  try {
    url = new URL(rawEndpoint);
  } catch {
    throw new EndpointNotAllowedError(
      `Некорректный адрес LLM-провайдера: ${rawEndpoint}`,
    );
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new EndpointNotAllowedError(
      `Недопустимый протокол ${url.protocol} в адресе LLM-провайдера.`,
    );
  }

  if (url.username || url.password) {
    throw new EndpointNotAllowedError(
      "Учётные данные в URL LLM-провайдера не допускаются.",
    );
  }

  const host = url.hostname.toLowerCase();

  if (isLinkLocalHost(host)) {
    throw new EndpointNotAllowedError(`Link-local адрес ${host} запрещён.`);
  }

  const loopback = isLoopbackHost(host);
  if (loopback && !policy.allowLoopback) {
    throw new EndpointNotAllowedError(
      `Обращение к loopback-адресу ${host} запрещено конфигурацией.`,
    );
  }

  if (!loopback && isPrivateHost(host) && !policy.allowPrivateNetwork) {
    throw new EndpointNotAllowedError(
      `Обращение к адресу внутренней сети ${host} запрещено конфигурацией.`,
    );
  }

  // Plain http is only tolerated for a local model; anything remote must be TLS.
  if (url.protocol === "http:" && !loopback && !isPrivateHost(host)) {
    throw new EndpointNotAllowedError(
      "Удалённые LLM-провайдеры допускаются только по HTTPS.",
    );
  }

  return rawEndpoint.replace(/\/+$/, "");
}

export function isAllowedEndpoint(
  rawEndpoint: string,
  policy?: EndpointPolicy,
): boolean {
  try {
    assertAllowedEndpoint(rawEndpoint, policy);
    return true;
  } catch {
    return false;
  }
}
