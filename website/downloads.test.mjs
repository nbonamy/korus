import assert from "node:assert/strict";
import test from "node:test";
import { resolveDownloads } from "./downloads.mjs";

const product = {
  repository: "private/source",
  releaseRepository: "example/app",
  slug: "app",
};
const releaseUrl = "https://github.com/example/app/releases/latest";
const assetUrl =
  "https://github.com/example/app/releases/latest/download/app-macos-arm64.dmg";
const release = () => ({
  tag_name: "v1.2.3",
  html_url: "https://github.com/example/app/releases/tag/v1.2.3",
  draft: false,
  prerelease: false,
  published_at: "2026-10-06T12:00:00Z",
  assets: [
    {
      name: "app-macos-arm64.dmg",
      state: "uploaded",
      size: 123,
      browser_download_url:
        "https://github.com/example/app/releases/download/v1.2.3/app-macos-arm64.dmg",
    },
  ],
});

test("when no stable release exists, every platform links to releases", async () => {
  const result = await resolveDownloads({
    product,
    fetchImpl: async () => ({ ok: false, status: 404 }),
  });
  assert.equal(result.releaseUrl, "https://github.com/example/app/releases");
  assert.equal(Object.keys(result.assets).length, 9);
  for (const asset of Object.values(result.assets)) {
    assert.equal(asset.available, false);
    assert.equal(asset.url, result.releaseUrl);
  }
});

test("stable releases expose unversioned aliases and fall back for missing platforms", async () => {
  const requests = [];
  const result = await resolveDownloads({
    product,
    fetchImpl: async (url, options) => {
      requests.push([url, options?.method]);
      return { ok: true, json: async () => release() };
    },
  });
  assert.equal(result.releaseUrl, releaseUrl);
  assert.deepEqual(result.assets.MACOS, { url: assetUrl, available: true });
  assert.deepEqual(result.assets.WINDOWS, {
    url: releaseUrl,
    available: false,
  });
  assert.deepEqual(result.assets.LINUX_ARM64_DEB, {
    url: releaseUrl,
    available: false,
  });
  assert.deepEqual(requests, [
    ["https://api.github.com/repos/example/app/releases/latest", undefined],
    [assetUrl, "HEAD"],
  ]);
});

test("drafts, prereleases and inconsistent metadata cannot become stable downloads", async () => {
  for (const overrides of [
    { draft: true },
    { prerelease: true },
    { tag_name: "v9.9.9" },
    { published_at: null },
    { html_url: "https://elsewhere.test" },
  ]) {
    await assert.rejects(
      resolveDownloads({
        product,
        fetchImpl: async () => ({
          ok: true,
          json: async () => ({ ...release(), ...overrides }),
        }),
      }),
      /published stable release/,
    );
  }
  await assert.rejects(
    resolveDownloads({
      product,
      fetchImpl: async () => ({ ok: false, status: 503 }),
    }),
    /503/,
  );
});

test("assets must have the exact filename, public URL and completed upload", async () => {
  for (const overrides of [
    { name: "app-darwin-arm64.zip" },
    { size: 0 },
    { state: "new" },
    {
      browser_download_url:
        "https://github.com/example/app/releases/latest/download/app-macos-arm64.dmg",
    },
  ]) {
    const data = release();
    Object.assign(data.assets[0], overrides);
    const result = await resolveDownloads({
      product,
      fetchImpl: async () => ({ ok: true, json: async () => data }),
    });
    assert.equal(result.assets.MACOS.available, false);
  }
});

test("unreachable installer or release fallback blocks deployment", async () => {
  await assert.rejects(
    resolveDownloads({
      product,
      fetchImpl: async (_url, options) =>
        options?.method === "HEAD"
          ? { ok: false, status: 404 }
          : { ok: true, json: async () => release() },
    }),
    /404/,
  );
  await assert.rejects(
    resolveDownloads({
      product,
      verify: true,
      fetchImpl: async (_url, options) => ({
        ok: false,
        status: options?.method === "HEAD" ? 503 : 404,
      }),
    }),
    /503/,
  );
});

test("each platform and Linux architecture resolves to its own published package", async () => {
  const files = {
    MACOS: "app-macos-arm64.dmg",
    WINDOWS: "app-win32-x64-setup.exe",
    WINDOWS_ZIP: "app-win32-x64.zip",
    LINUX_X64_DEB: "app-linux-x64.deb",
    LINUX_X64_RPM: "app-linux-x64.rpm",
    LINUX_X64_ZIP: "app-linux-x64.zip",
    LINUX_ARM64_DEB: "app-linux-arm64.deb",
    LINUX_ARM64_RPM: "app-linux-arm64.rpm",
    LINUX_ARM64_ZIP: "app-linux-arm64.zip",
  };
  const data = release();
  data.assets = Object.values(files).map((name) => ({
    name,
    state: "uploaded",
    size: 123,
    browser_download_url: `https://github.com/example/app/releases/download/v1.2.3/${name}`,
  }));
  const checked = [];
  const result = await resolveDownloads({
    product,
    verify: true,
    fetchImpl: async (url, options) => {
      if (options?.method === "HEAD") checked.push(url);
      return { ok: true, json: async () => data };
    },
  });
  for (const [key, file] of Object.entries(files)) {
    assert.equal(result.assets[key].available, true);
    assert.equal(
      result.assets[key].url,
      `https://github.com/example/app/releases/latest/download/${file}`,
    );
    assert.ok(checked.includes(result.assets[key].url));
  }
  assert.ok(checked.includes(releaseUrl));
});
