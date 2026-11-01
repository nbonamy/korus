import { product } from '@workspace/core/product';
import { privateBinEngines } from '@workspace/core/runtime-discovery';

/**
 * Links the engines a host already has into the private bin, which the remote PATH puts first. The daemon
 * then finds them with one file check instead of starting login shells. An engine that is gone loses its
 * link, and a link that goes stale is ignored by the daemon, which falls back to full discovery.
 */
export function remoteEngineLinkCommand(): string {
  const bin = `"$HOME/${product.homeDirectory}/bin"`;
  return `set -eu
bin=${bin}
mkdir -p "$bin"
# Look past the private bin, or a link would resolve to itself and never be refreshed.
PATH=$(printf %s "$PATH" | tr ':' '\\n' | grep -vxF "$bin" | paste -sd: -)
for engine in ${privateBinEngines.join(' ')}; do
  target=$(command -v "$engine" 2>/dev/null || true)
  if [ -n "$target" ]; then ln -sfn "$target" "$bin/$engine"; else rm -f "$bin/$engine"; fi
done`;
}
