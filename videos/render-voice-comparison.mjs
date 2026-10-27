import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { alignFilmToNarration } from "./film-timing.mjs";

const run = promisify(execFile);
const root = dirname(fileURLToPath(import.meta.url));
const fps = 24;

async function probe(path) {
  const { stdout } = await run("ffprobe", [
    "-v",
    "error",
    "-show_streams",
    "-show_format",
    "-of",
    "json",
    path,
  ]);
  return JSON.parse(stdout);
}

// Insert silence into the approved take without dropping or resynthesizing speech.
export async function paceNarration({
  film,
  narration,
  inputPath,
  outputPath,
}) {
  if (resolve(inputPath) === resolve(outputPath))
    throw new Error(
      "Keep the approved narration separate from the paced edit.",
    );
  const source = await probe(inputPath);
  const sampleRate = Number(
    source.streams.find((s) => s.codec_type === "audio")?.sample_rate,
  );
  if (
    !sampleRate ||
    Math.abs(Number(source.format.duration) - narration.duration) > 0.01 ||
    narration.cues?.length !== film.cues.length ||
    !film.cues.length
  )
    throw new Error("Pacing requires the complete aligned take.");
  const sceneScale = 0.97;
  const minPause = 0.9;
  const pauseScale = 0.74;
  const speechSpeed = 0.96;
  const samples = (seconds) => Math.round(seconds * sampleRate);
  const totalSamples = samples(narration.duration);
  const cuts = [0];
  const shifts = [];
  const cues = narration.cues.map((cue, index) => {
    const previous = narration.cues[index - 1];
    if (
      cue.text !== film.cues[index].text ||
      !Number.isFinite(cue.start) ||
      !Number.isFinite(cue.spokenEnd) ||
      cue.start < 0 ||
      cue.spokenEnd <= cue.start ||
      cue.spokenEnd > narration.duration ||
      (previous && cue.start < previous.spokenEnd)
    )
      throw new Error(
        "Invalid or stale aligned cue; recheck the continuous take.",
      );
    let shift = samples(0.7);
    if (previous) {
      cuts.push(samples((previous.spokenEnd + cue.start) / 2));
      const originalGap = cue.start - previous.spokenEnd;
      const baselineGap = Math.max(
        originalGap,
        minPause,
        (film.cues[index].start - film.cues[index - 1].start) * sceneScale -
          (previous.spokenEnd - previous.start),
      );
      // Shorten only the pauses; never trim speech or its natural breaths.
      shift =
        shifts[index - 1] +
        samples(Math.max(0, baselineGap * pauseScale - originalGap));
    }
    shifts.push(shift);
    return {
      ...cue,
      start: cue.start + shift / sampleRate,
      spokenEnd: cue.spokenEnd + shift / sampleRate,
    };
  });
  cuts.push(totalSamples);
  const last = cues.at(-1);
  const duration =
    Math.ceil(
      Math.max(
        narration.duration + shifts.at(-1) / sampleRate,
        last.spokenEnd + 1.5,
        last.start + (film.duration - film.cues.at(-1).start) * sceneScale,
      ) * fps,
    ) / fps;
  const slowedDuration = Math.ceil((duration / speechSpeed) * fps) / fps;
  const filters = [
    `[0:a]asplit=${cues.length}${cues.map((_, i) => `[in${i}]`).join("")}`,
    ...cues.map((_, i) => {
      const padding =
        i + 1 < cues.length
          ? shifts[i + 1] - shifts[i]
          : samples(duration) - totalSamples - shifts[i];
      return `[in${i}]atrim=start_sample=${cuts[i]}:end_sample=${cuts[i + 1]},asetpts=PTS-STARTPTS,apad=pad_len=${padding}[a${i}]`;
    }),
    `${cues.map((_, i) => `[a${i}]`).join("")}concat=n=${cues.length}:v=0:a=1,adelay=${shifts[0]}S:all=1,atempo=${speechSpeed},apad,atrim=end_sample=${samples(slowedDuration)}[out]`,
  ];
  await run("ffmpeg", [
    "-y",
    "-v",
    "error",
    "-i",
    inputPath,
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[out]",
    "-c:a",
    "pcm_f32le",
    outputPath,
  ]);
  return {
    duration: slowedDuration,
    cues: cues.map((cue) => ({
      ...cue,
      start: cue.start / speechSpeed,
      spokenEnd: cue.spokenEnd / speechSpeed,
    })),
  };
}

export async function readApprovedNarration({ folder, film, voice, settings }) {
  const stem = join(folder, "narration");
  const provenance = JSON.parse(await readFile(`${stem}.json`, "utf8"));
  const narration = JSON.parse(await readFile(`${stem}-aligned.json`, "utf8"));
  const hash = createHash("sha256")
    .update(await readFile(`${stem}.wav`))
    .digest("hex");
  if (
    provenance.mode !== "continuous" ||
    provenance.film !== film.id ||
    provenance.model !== settings.model ||
    provenance.revision !== settings.revision ||
    provenance.voice.id !== voice.id ||
    provenance.voice.direction !== voice.direction ||
    provenance.audioSha256 !== hash ||
    narration.audioSha256 !== hash ||
    narration.speakerCheck?.passed !== true ||
    JSON.stringify(provenance.cueTexts) !==
      JSON.stringify(film.cues.map((cue) => cue.text))
  )
    throw new Error(
      `Regenerate stale or mismatched continuous narration: ${stem}`,
    );
  return { narrationPath: `${stem}.wav`, narration };
}

export async function exportNarrated(args = process.argv.slice(2)) {
  const all = args.includes("--all");
  const requested = args.find((arg) => arg.startsWith("--film="))?.slice(7);
  const output = resolve(
    args.find((arg) => !arg.startsWith("--")) ??
      join(root, "local", all || requested ? "narrated" : "voice-comparison"),
  );
  const script = JSON.parse(
    await readFile(join(root, "narration.json"), "utf8"),
  );
  const settings = JSON.parse(
    await readFile(join(root, "local-voices.json"), "utf8"),
  );
  const selectedFilms = all
    ? script.films
    : script.films.filter(
        (film) => film.id === (requested ?? "delegation-film"),
      );
  if (!selectedFilms.length)
    throw new Error(`Unknown narrated film: ${requested}`);
  const selectedVoices =
    all || requested
      ? settings.voices.filter((voice) => voice.id === "american-male")
      : settings.voices;
  const jobs = selectedFilms.flatMap((film) =>
    selectedVoices.map((voice) => ({
      film,
      voice,
      folder:
        all || requested
          ? join(output, film.id, voice.id)
          : join(output, voice.id),
      id: all || requested ? film.id : `delegation-${voice.id}`,
      title: all || requested ? film.title : voice.title,
    })),
  );
  // Validate every cached clip before replacing any exported film.
  for (const job of jobs) {
    const { film, voice, folder } = job;
    Object.assign(
      job,
      await readApprovedNarration({ film, voice, folder, settings }),
    );
  }
  const renderJobs = [];
  for (const job of jobs) {
    const { film, voice, folder, id, title } = job;
    const narrationPath = join(folder, "narration-paced.wav");
    const paced = await paceNarration({
      film,
      narration: job.narration,
      inputPath: job.narrationPath,
      outputPath: narrationPath,
    });
    const timed = alignFilmToNarration({
      film,
      narration: paced,
      narrationOffset: 0,
      outro: 0,
    });
    renderJobs.push({
      film,
      timed,
      id,
      title,
      voice: voice.title,
      narrationPath,
    });
  }
  const { renderFilms } = await import("./remotion/render.mjs");
  const films = await renderFilms({
    jobs: renderJobs,
    sourceIds: all ? ["project-shorts"] : [],
    outputDirectory: output,
  });
  let existing = [];
  if (requested) {
    try {
      existing = JSON.parse(
        await readFile(join(output, "narration.json"), "utf8"),
      ).films;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const merged = requested
    ? script.films
        .map(
          (film) =>
            films.find((item) => item.id === film.id) ??
            existing.find((item) => item.id === film.id),
        )
        .filter(Boolean)
    : films;
  await writeFile(
    join(output, "narration.json"),
    JSON.stringify(
      {
        title:
          all || requested
            ? "Korus · Workflows, one voice"
            : "Korus · Two voices, one workflow",
        description:
          all || requested
            ? "Workflow films narrated by Calm American, with the approved pauses and speech speed. Optional captions; click a line to replay it."
            : "The same approved voices, with breathing room between lines and calmer scene pacing. Optional captions; click a line to replay it.",
        films: merged,
      },
      null,
      2,
    ),
  );
  await copyFile(
    join(root, "narration-review.html"),
    join(output, "index.html"),
  );
  console.log(
    `Review: npx vite "${output}" --host 127.0.0.1 --port ${all ? 4190 : 4189} --strictPort`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  exportNarrated().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
