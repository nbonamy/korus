/** Only app-authored, credential-free diagnostics may be displayed verbatim. */
export class RelayStartupError extends Error {}

export function relayStartupMessage(error: unknown): string {
  const pending = [error];
  const seen = new Set<unknown>();
  while (pending.length && seen.size < 32) {
    const current = pending.shift();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    if (current instanceof RelayStartupError) return `Relay startup failed: ${current.message}`;
    let failure = current as { code?: unknown; port?: unknown; cause?: unknown; errors?: unknown[] };
    // libp2p flattens listener failures into text, discarding the original cause.
    // Extract only known OS codes and a numeric port; never print that raw text.
    if (current instanceof Error && current.name === 'UnsupportedListenAddressesError') {
      const code = /\b(EADDRINUSE|EADDRNOTAVAIL|EACCES|EPERM)\b/.exec(current.message)?.[1];
      if (!code) return 'Relay startup failed: the configured listen address could not be opened. Check that its address and transport are supported on this machine.';
      failure = { code, port: Number(/\/tcp\/(\d+)\//.exec(current.message)?.[1]) };
    }
    switch (failure.code) {
      case 'EADDRINUSE': {
        const port = typeof failure.port === 'number' && Number.isInteger(failure.port) && failure.port > 0 && failure.port <= 65535
          ? `port ${failure.port}` : 'the configured port';
        return `Relay startup failed: ${port} is already in use. Use the running relay, or stop the process using that port before starting another.`;
      }
      case 'EADDRNOTAVAIL':
        return 'Relay startup failed: the configured listen address is not available on this machine. Check the listen address in the operator configuration.';
      case 'EACCES':
      case 'EPERM':
        return 'Relay startup failed: permission denied. Check access to the operator configuration, identity directory and TLS files, and permission to bind the listen port.';
      case 'ENOENT':
        return 'Relay startup failed: a required file is missing. Check the operator configuration path and any TLS certificate or private key paths it references.';
    }
    if (typeof failure.code === 'string' && /^(ERR_OSSL_|ERR_SSL_|ERR_TLS_)/.test(failure.code)) {
      return 'Relay startup failed: the TLS certificate or private key could not be loaded. Check their format, validity and that they belong together.';
    }
    pending.push(failure.cause);
    if (Array.isArray(failure.errors)) pending.push(...failure.errors.slice(0, 32));
  }
  return 'Relay startup failed unexpectedly. No safe diagnostic is available; inspect the startup failure locally before changing configuration or replacing the persistent identity.';
}
