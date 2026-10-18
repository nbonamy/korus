import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import product from "../core/src/product.json" with { type: "json" };
import { resolveDownloads } from "./downloads.mjs";

const downloads = await resolveDownloads({
  product,
  verify: process.env.APP_WEBSITE_VERIFY_DOWNLOADS === "1",
});

function downloadLinks(formats) {
  const available = formats.filter(([key]) => downloads.assets[key].available);
  if (!available.length)
    return `<a href="${downloads.releaseUrl}">View releases <span aria-hidden="true">↗</span></a>`;
  return available
    .map(
      ([key, label]) =>
        `<a data-installer href="${downloads.assets[key].url}">${label} <span aria-hidden="true">↓</span></a>`,
    )
    .join(" ");
}

const source = new URL("./", import.meta.url);
const output = new URL("../dist/website/", import.meta.url);
const narratedDirectory = resolve(
  process.env.APP_NARRATED_FILMS ??
    fileURLToPath(new URL("../videos/local/narrated/", import.meta.url)),
);
const narration = JSON.parse(
  await readFile(join(narratedDirectory, "narration.json"), "utf8").catch(
    () => {
      throw new Error(
        "Missing narrated films. Follow website/README.md's Calm American export steps, then run: node videos/render-voice-comparison.mjs --all. Set APP_NARRATED_FILMS for another export directory.",
      );
    },
  ),
);

// Rendered films stay out of Git. Require them before replacing the last build.
const media = [];
for (const film of [
  "mission",
  "review",
  "delegation",
  "project",
  "visualize",
]) {
  const record = narration.films.find((entry) => entry.id === `${film}-film`);
  if (
    !record ||
    record.voice !== "Calm American" ||
    !Number.isFinite(record.duration) ||
    record.duration <= 0
  )
    throw new Error(`Missing approved Calm American export for ${film}-film.`);
  for (const [kind, name, location] of [
    ["VIDEO", `${film}-film-paced.mp4`, narratedDirectory],
    ["CAPTIONS", `${film}-film-paced.vtt`, narratedDirectory],
    ["POSTER", `${film}-film-poster.png`, new URL("../videos/assets/", source)],
  ]) {
    if (
      (kind === "VIDEO" && record.video !== name) ||
      (kind === "CAPTIONS" && record.subtitles !== name)
    )
      throw new Error(
        `Unexpected ${kind.toLowerCase()} export for ${film}-film.`,
      );
    const bytes = await readFile(
      typeof location === "string"
        ? join(location, name)
        : new URL(name, location),
    ).catch(() => {
      throw new Error(
        `Missing ${name}. Run: npm run render --prefix videos/remotion -- ${film}-film`,
      );
    });
    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
    media.push({
      token: `__FILM_${film.toUpperCase()}_${kind}__`,
      path: `media/${hash}-${name}`,
      bytes,
    });
  }
}

// Publish a static artifact rather than the website's source directory.
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await mkdir(new URL("media/", output));
for (const asset of media)
  await writeFile(new URL(asset.path, output), asset.bytes);
for (const path of ["styles.css", "script.js", "assets"]) {
  await cp(new URL(path, source), new URL(path, output), { recursive: true });
}
let landing = await readFile(new URL("index.html", source), "utf8");
for (const [platform, formats] of Object.entries({
  MACOS: [["MACOS", "DMG"]],
  WINDOWS: [
    ["WINDOWS", "Installer"],
    ["WINDOWS_ZIP", "ZIP"],
  ],
  LINUX_X64: ["DEB", "RPM", "ZIP"].map((format) => [
    `LINUX_X64_${format}`,
    format,
  ]),
  LINUX_ARM64: ["DEB", "RPM", "ZIP"].map((format) => [
    `LINUX_ARM64_${format}`,
    format,
  ]),
}))
  landing = landing.replaceAll(
    `__DOWNLOAD_${platform}__`,
    downloadLinks(formats),
  );
for (const asset of media)
  landing = landing.replaceAll(asset.token, asset.path);
await writeFile(
  new URL("index.html", output),
  landing
    .replaceAll("__PRODUCT_NAME__", product.name)
    .replaceAll("__PRODUCT_WEBSITE_URL__", product.websiteUrl)
    .replaceAll("__PRODUCT_REPOSITORY_URL__", product.repositoryUrl)
    .replaceAll("__PRODUCT_RELEASE_URL__", downloads.releaseUrl),
);
await cp(new URL("docs/.vitepress/dist/", source), new URL("docs/", output), {
  recursive: true,
});
await mkdir(new URL("privacy/", output));
await writeFile(
  new URL("privacy/index.html", output),
  (await readFile(new URL("privacy/index.html", source), "utf8"))
    .replaceAll("__PRODUCT_NAME__", product.name)
    .replaceAll("__PRODUCT_COMPANION_NAME__", product.companionName)
    .replaceAll("__PRODUCT_WEBSITE_URL__", product.websiteUrl),
);
console.log("Website and documentation built in dist/website");
