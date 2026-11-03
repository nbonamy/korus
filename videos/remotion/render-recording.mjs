import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { recordedFilms } from "../film-catalog.mjs";

export async function renderRecording(name) {
  if (!/^[a-z0-9-]+$/.test(name ?? ""))
    throw new Error("Choose a recording name.");
  const film = recordedFilms.find((film) => film.id === name);
  if (!film) throw new Error(`Unknown recording: ${name}`);
  const videos = fileURLToPath(new URL("../", import.meta.url));
  const spec = JSON.parse(
    await readFile(resolve(videos, `${name}-recording.json`), "utf8"),
  );
  Object.assign(spec, {
    id: film.id,
    width: film.width,
    height: film.height,
    fps: film.fps,
  });
  const publicDir = resolve(videos, "local/remotion/recording-public");
  await mkdir(publicDir, { recursive: true });
  for (const key of ["video", "audio"]) {
    const source = resolve(videos, spec[key]);
    const target = `${key}-${basename(source)}`;
    await copyFile(source, resolve(publicDir, target));
    spec[key] = target;
  }
  const product = JSON.parse(
    await readFile(resolve(videos, "../core/src/product.json"), "utf8"),
  );
  spec.brand = product.name;
  spec.website = new URL(product.websiteUrl).host;
  await copyFile(
    resolve(videos, "../website/assets/app-icon.png"),
    resolve(publicDir, "app-icon.png"),
  );
  await writeFile(resolve(publicDir, "recording.json"), JSON.stringify(spec));
  const serveUrl = await bundle({
    entryPoint: fileURLToPath(
      new URL("src/recording-entry.tsx", import.meta.url),
    ),
    publicDir,
  });
  const composition = await selectComposition({
    serveUrl,
    id: `${name}-recorded`,
    inputProps: spec,
  });
  const outputLocation = resolve(videos, `local/exports/korus-${name}.mp4`);
  await mkdir(dirname(outputLocation), { recursive: true });
  await renderMedia({
    serveUrl,
    composition,
    inputProps: spec,
    outputLocation,
    codec: "h264",
    crf: 18,
    pixelFormat: "yuv420p",
    concurrency: 2,
    logLevel: "error",
  });
  console.log(outputLocation);
}
