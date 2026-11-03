import { bundle } from "@remotion/bundler";
import { getCompositions, renderMedia, renderStill } from "@remotion/renderer";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { films, FPS } from "../film-catalog.mjs";
import { prepareAssets, publicDirectory, videos } from "./assets.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const timestamp = (seconds) =>
  new Date(Math.round(seconds * 1000)).toISOString().slice(11, 23);

// Every export uses the same native Remotion compositions as Studio.
export async function renderFilms({
  jobs = [],
  sourceIds = [],
  outputDirectory,
}) {
  await prepareAssets(jobs);
  const build = await mkdtemp(
    fileURLToPath(new URL("local/remotion/bundle-", videos)),
  );
  try {
    const serveUrl = await bundle({
      entryPoint: join(root, "src/index.tsx"),
      publicDir: fileURLToPath(publicDirectory),
      outDir: build,
    });
    const compositions = await getCompositions(serveUrl);
    const results = [];
    const exports = [
      ...jobs.map((job) => ({
        ...job,
        compositionId: `${job.id}-narrated`,
        outputPath: join(outputDirectory, `${job.id}-paced.mp4`),
      })),
      ...sourceIds.map((id) => ({
        id,
        film: films.find((film) => film.id === id),
        compositionId: `${id}-source`,
        outputPath: fileURLToPath(new URL(`assets/${id}.mp4`, videos)),
      })),
    ];
    for (const job of exports) {
      const source = films.find((film) => film.id === job.film?.id);
      const composition = compositions.find(
        (item) => item.id === job.compositionId,
      );
      if (!source || !composition) throw new Error(`Unknown film: ${job.id}`);
      await mkdir(dirname(job.outputPath), { recursive: true });
      const scratch = await mkdtemp(
        join(dirname(job.outputPath), ".remotion-"),
      );
      try {
        await renderMedia({
          serveUrl,
          composition,
          codec: "h264",
          crf: 19,
          imageFormat: "png",
          pixelFormat: "yuv420p",
          concurrency: 4,
          outputLocation: join(scratch, "film.mp4"),
          logLevel: "error",
        });
        const poster = compositions.find(
          (item) => item.id === `${source.id}-source`,
        );
        await renderStill({
          serveUrl,
          composition: poster,
          imageFormat: "png",
          frame: Math.round(source.posterSecond * FPS),
          output: join(scratch, "poster.png"),
          logLevel: "error",
        });
        if (job.timed) {
          const subtitles = `WEBVTT\n\n${job.timed.cues.map((cue, i) => `${i + 1}\n${timestamp(cue.start)} --> ${timestamp(cue.spokenEnd)}\n${cue.text}\n`).join("\n")}`;
          await writeFile(join(scratch, "film.vtt"), subtitles);
          await rename(
            join(scratch, "film.vtt"),
            job.outputPath.replace(/\.mp4$/, ".vtt"),
          );
          results.push({
            ...job.timed,
            id: job.id,
            title: job.title,
            voice: job.voice,
            rate: null,
            video: basename(job.outputPath),
            subtitles: basename(job.outputPath).replace(/\.mp4$/, ".vtt"),
          });
        }
        await rename(
          join(scratch, "poster.png"),
          fileURLToPath(new URL(`assets/${source.id}-poster.png`, videos)),
        );
        await rename(join(scratch, "film.mp4"), job.outputPath);
        console.log(
          `${job.id}: ${composition.width}×${composition.height} · ${(composition.durationInFrames / FPS).toFixed(2)}s → ${job.outputPath}`,
        );
      } finally {
        await rm(scratch, { recursive: true, force: true });
      }
    }
    return results;
  } finally {
    await rm(build, { recursive: true, force: true });
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--recording" && args.length === 2) {
    const { renderRecording } = await import("./render-recording.mjs");
    await renderRecording(args[1]);
    return;
  }
  const requested = args.find((arg) => !arg.startsWith("--")) ?? "review-film";
  if (
    args.some(
      (arg) => arg.startsWith("--") && !["--all", "--silent"].includes(arg),
    )
  )
    throw new Error(
      "Usage: npm run render --prefix videos/remotion -- [film-id | --all] [--silent]",
    );
  if (!args.includes("--all") && !films.some((film) => film.id === requested))
    throw new Error(`Unknown film: ${requested}`);
  if (args.includes("--silent") || requested === "project-shorts") {
    await renderFilms({
      sourceIds: args.includes("--all")
        ? films.map((film) => film.id)
        : [requested],
    });
  } else {
    const { exportNarrated } = await import("../render-voice-comparison.mjs");
    await exportNarrated(
      args.includes("--all") ? ["--all"] : [`--film=${requested}`],
    );
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
