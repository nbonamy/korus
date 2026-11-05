// Public downloads follow GitHub's latest stable release, never the checkout version.
export async function resolveDownloads({
  product,
  verify = false,
  fetchImpl = fetch,
}) {
  const base = `https://github.com/${product.releaseRepository}/releases`;
  const names = {
    MACOS: `${product.slug}-macos-arm64.dmg`,
    WINDOWS: `${product.slug}-win32-x64-setup.exe`,
    WINDOWS_ZIP: `${product.slug}-win32-x64.zip`,
  };
  for (const arch of ["x64", "arm64"])
    for (const format of ["deb", "rpm", "zip"])
      names[`LINUX_${arch.toUpperCase()}_${format.toUpperCase()}`] =
        `${product.slug}-linux-${arch}.${format}`;

  async function request(url, method, allowMissing = false) {
    const response = await fetchImpl(url, {
      ...(method ? { method } : {}),
      signal: AbortSignal.timeout(30000),
    });
    if (allowMissing && response.status === 404) return null;
    if (!response.ok)
      throw new Error(`Download check failed (${response.status}): ${url}`);
    return response;
  }

  let release;
  let releaseUrl = base;
  const response = await request(
    `https://api.github.com/repos/${product.releaseRepository}/releases/latest`,
    undefined,
    true,
  );
  if (response) {
    release = await response.json();
    if (
      release.draft ||
      release.prerelease ||
      !release.published_at ||
      typeof release.tag_name !== "string" ||
      release.html_url !== `${base}/tag/${release.tag_name}`
    )
      throw new Error("Expected a published stable release from GitHub.");
    releaseUrl = `${base}/latest`;
  }

  const assets = {};
  for (const [key, name] of Object.entries(names)) {
    const url = `${base}/latest/download/${name}`;
    const published = release?.assets?.some(
      (asset) =>
        asset.name === name &&
        asset.state === "uploaded" &&
        asset.size > 0 &&
        asset.browser_download_url ===
          `${base}/download/${release.tag_name}/${name}`,
    );
    if (published) await request(url, "HEAD");
    assets[key] = {
      url: published ? url : releaseUrl,
      available: Boolean(published),
    };
  }
  if (verify) await request(releaseUrl, "HEAD");
  return { releaseUrl, assets };
}
