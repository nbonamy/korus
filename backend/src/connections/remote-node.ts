import { product } from '@workspace/core/product';
import release from '../../../node-runtime-release.json';

/** SSH does not load interactive shell profiles. Keep Korus and user-installed CLIs discoverable. */
export function remoteEnvironmentCommand(command: string): string {
  return `export PATH="$HOME/${product.homeDirectory}/bin:$HOME/.local/bin:$HOME/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"\n${command}`;
}

/** Installs the same checksum-pinned runtime as desktop packaging, without changing system Node. */
export function remoteNodeInstallCommand(config: { version: string; checksums: Record<string, string> } = release): string {
  const targets = Object.entries(config.checksums).filter(([target]) => /^(linux|darwin)-(x64|arm64)$/.test(target))
    .map(([target, checksum]) => `${target}) checksum='${checksum}';;`).join('\n');
  return `set -eu
umask 077
root="$HOME/${product.homeDirectory}"
mkdir -p "$root"
chmod 700 "$root"
if [ -x "$root/bin/node" ] && [ "$("$root/bin/node" --version)" = 'v${config.version}' ]; then exit 0; fi
case "$(uname -s)" in Linux) platform=linux;; Darwin) platform=darwin;; *) echo 'SSH setup supports Linux and macOS hosts.' >&2; exit 1;; esac
case "$(uname -m)" in x86_64|amd64) arch=x64;; aarch64|arm64) arch=arm64;; *) echo 'SSH setup requires an x64 or arm64 host.' >&2; exit 1;; esac
case "$platform-$arch" in
${targets}
*) echo 'No verified Node runtime is available for this host.' >&2; exit 1;;
esac
mkdir -p "$root/bin" "$root/runtimes"
stage=$(mktemp -d "$root/runtimes/.setup.XXXXXX")
trap 'rm -rf "$stage"' EXIT HUP INT TERM
package="node-v${config.version}-$platform-$arch"
url="https://nodejs.org/dist/v${config.version}/$package.tar.gz"
if command -v curl >/dev/null 2>&1; then
  curl --fail --location --silent --show-error --connect-timeout 10 --max-time 180 "$url" -o "$stage/node.tar.gz"
elif command -v wget >/dev/null 2>&1; then
  wget --quiet --timeout=180 -O "$stage/node.tar.gz" "$url"
else echo 'Install curl or wget on this host, then retry setup.' >&2; exit 1; fi
if command -v sha256sum >/dev/null 2>&1; then actual=$(sha256sum "$stage/node.tar.gz");
else actual=$(shasum -a 256 "$stage/node.tar.gz"); fi
if [ "\${actual%% *}" != "$checksum" ]; then echo 'Node runtime checksum verification failed. Retry setup.' >&2; exit 1; fi
tar -xzf "$stage/node.tar.gz" -C "$stage"
[ "$("$stage/$package/bin/node" --version)" = 'v${config.version}' ] || { echo 'Node runtime verification failed.' >&2; exit 1; }
# A unique directory keeps concurrent installations from overwriting a runtime in use.
runtime="$root/runtimes/$package-\${stage##*.}"
mv "$stage/$package" "$runtime"
for command in node npm npx; do
  if [ -e "$runtime/bin/$command" ]; then
    ln -s "$runtime/bin/$command" "$stage/$command"
    mv -f "$stage/$command" "$root/bin/$command"
  fi
done`;
}
