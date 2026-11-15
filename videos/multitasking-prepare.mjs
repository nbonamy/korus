import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Rebuild the edit from the checked continuous take; never synthesize on export.
const videos = fileURLToPath(new URL("./", import.meta.url));
const spec = JSON.parse(
  await readFile(new URL("multitasking-recording.json", import.meta.url)),
);
const folder = `${videos}local/multitasking`;
const voice = `${videos}${spec.voiceDirectory}`;
const audio = await readFile(`${voice}/narration.wav`);
const provenance = JSON.parse(await readFile(`${voice}/narration.json`));
const alignment = JSON.parse(await readFile(`${voice}/narration-aligned.json`));
const transcript = JSON.parse(
  await readFile(`${voice}/narration-transcript.json`),
);
const script = JSON.parse(await readFile(`${videos}narration.json`));
const film = script.films.find((film) => film.id === spec.id);
const hash = createHash("sha256").update(audio).digest("hex");
if (
  hash !== provenance.audioSha256 ||
  hash !== alignment.audioSha256 ||
  provenance.film !== spec.id ||
  JSON.stringify(provenance.cueTexts) !==
    JSON.stringify(film.cues.map((cue) => cue.text)) ||
  !alignment.speakerCheck.passed ||
  alignment.cues.length !== spec.narrationStarts.length
) {
  throw new Error("Missing or mismatched checked narration.");
}
// Targets are measured in the 1600×900 source capture. Mapping their source clock
// through the edit keeps click cues aligned when scenes or narration move.
const normalizeBounds = (bounds) => ({
  x: bounds.x / 1600,
  y: bounds.y / 900,
  width: bounds.width / 1600,
  height: bounds.height / 900,
});
spec.clicks = [];
spec.focusAreas = [];
for (const cue of spec.actionCues) {
  const scene = spec.scenes.find(
    (scene) =>
      !scene.card &&
      !scene.freeze &&
      cue.sourceTime >= scene.sourceStart &&
      cue.sourceTime < scene.sourceStart + scene.duration,
  );
  if (!scene) throw new Error(`Action ${cue.id} has no moving source segment.`);
  const time = scene.start + cue.sourceTime - scene.sourceStart;
  const bounds = normalizeBounds(cue.bounds);
  spec.clicks.push({
    time,
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  });
  if (cue.lead)
    spec.focusAreas.push({
      start: time - cue.lead,
      duration: cue.lead - 0.12,
      bounds,
    });
}
for (const cue of spec.regionCues)
  spec.focusAreas.push({
    start: cue.start,
    duration: cue.duration,
    bounds: normalizeBounds(cue.bounds),
  });
await writeFile(
  `${videos}multitasking-recording.json`,
  JSON.stringify(spec, null, 2) + "\n",
);
await mkdir(`${videos}local/exports`, { recursive: true });
const sampleRate = 24000;
const pcm = Buffer.alloc(spec.duration * sampleRate * 2);
let previousEnd = 0;
for (const [i, cue] of alignment.cues.entries()) {
  const part = execFileSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-ss",
      String(cue.start),
      "-t",
      String(cue.spokenEnd - cue.start + 0.07),
      "-i",
      `${voice}/narration.wav`,
      "-af",
      `atempo=${spec.narrationSpeed}`,
      "-ar",
      String(sampleRate),
      "-ac",
      "1",
      "-f",
      "s16le",
      "pipe:1",
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  const offset = Math.round(spec.narrationStarts[i] * sampleRate) * 2;
  if (offset < previousEnd || offset + part.length > pcm.length)
    throw new Error("Narration cues overlap or exceed the edit.");
  part.copy(pcm, offset);
  previousEnd = offset + part.length;
}
execFileSync(
  "ffmpeg",
  [
    "-v",
    "error",
    "-f",
    "s16le",
    "-ar",
    String(sampleRate),
    "-ac",
    "1",
    "-i",
    "pipe:0",
    "-c:a",
    "pcm_s16le",
    "-y",
    `${folder}/narration.wav`,
  ],
  { input: pcm },
);
const timestamp = (seconds) => {
  const ms = Math.round(seconds * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
};
const words = transcript.segments.flatMap((segment) => segment.words);
const captions = [];
for (const [i, cue] of alignment.cues.entries()) {
  const selected = words.filter(
    (word) =>
      (word.start + word.end) / 2 >= cue.start &&
      (word.start + word.end) / 2 <= cue.spokenEnd,
  );
  for (let j = 0; j < selected.length; j += 7) {
    const group = selected.slice(j, j + 7);
    const start =
      spec.narrationStarts[i] +
      Math.max(0, group[0].start - cue.start) / spec.narrationSpeed;
    const end =
      spec.narrationStarts[i] +
      (Math.min(cue.spokenEnd, group.at(-1).end) - cue.start) /
        spec.narrationSpeed;
    const text = group
      .map((word) => word.word.trim())
      .join(" ")
      .replace(/\bChorus\b/g, "Korus");
    captions.push(`${timestamp(start)} --> ${timestamp(end)}\n${text}`);
  }
}
await writeFile(
  `${videos}${spec.captions}`,
  `WEBVTT\n\n${captions.join("\n\n")}\n`,
);
await writeFile(
  `${folder}/edit-provenance.json`,
  JSON.stringify(
    {
      sourceAudioSha256: hash,
      voice: provenance.voice,
      narrationStarts: spec.narrationStarts,
      narrationSpeed: spec.narrationSpeed,
      captureCrop: spec.captureCrop,
    },
    null,
    2,
  ),
);
console.log("Prepared paced narration and measured English captions.");
