/** Reading back the Content-Security-Policy the page ships with (shown on the Privacy screen). */

export function pagePolicy(): string | null {
  const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
  return meta?.getAttribute("content") ?? null;
}

/** True when the policy blocks every kind of outbound connection. */
export function blocksNetwork(policy: string | null): boolean {
  return policy !== null && /(^|;)\s*connect-src 'none'/.test(policy) && /(^|;)\s*default-src 'none'/.test(policy);
}
