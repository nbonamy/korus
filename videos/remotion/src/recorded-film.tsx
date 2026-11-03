import {
  AbsoluteFill,
  Freeze,
  Html5Audio,
  Img,
  OffthreadVideo,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export type RecordedScene = {
  start: number;
  duration: number;
  sourceStart?: number;
  freeze?: boolean;
  card?: "opening" | "ending";
};
export type RecordedFilmProps = {
  title: string[];
  endingTitle?: string[];
  subtitle: string;
  brand: string;
  website: string;
  scenes: RecordedScene[];
  timeMap?: {
    start: number;
    duration: number;
    sourceStart: number;
    freeze?: boolean;
  }[];
  clicks: {
    time: number;
    x: number;
    y: number;
    label?: string;
    focus?: { x: number; y: number; width: number; height: number };
  }[];
  focusAreas?: {
    start: number;
    duration: number;
    bounds: { x: number; y: number; width: number; height: number };
  }[];
  drags?: {
    time: number;
    duration: number;
    from: { x: number; y: number };
    to: { x: number; y: number };
  }[];
  video: string;
  audio: string;
};

const RecordedVisuals = (
  props: RecordedFilmProps & { hidePointer?: boolean; pausePoints?: number[] },
) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const time = frame / fps;
  return (
    <AbsoluteFill
      style={{
        background: "#18232e",
        color: "#f5f8fc",
        fontFamily: "-apple-system, BlinkMacSystemFont, Arial, sans-serif",
      }}
    >
      {props.scenes.map((scene, index) => (
        <Sequence
          key={index}
          from={Math.round(scene.start * fps)}
          durationInFrames={Math.round(scene.duration * fps)}
        >
          {scene.card ? (
            <AbsoluteFill
              style={{
                justifyContent: "center",
                padding: "80px 120px",
                background:
                  "radial-gradient(ellipse at 85% 15%, #254c6b 0, transparent 55%), linear-gradient(140deg, #151d27, #203342)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 22,
                  marginBottom: 60,
                }}
              >
                <Img
                  src={staticFile("app-icon.png")}
                  style={{ width: 80, height: 80, borderRadius: 18 }}
                />
                <b style={{ fontSize: 38, letterSpacing: 2 }}>{props.brand}</b>
              </div>
              <h1
                style={{
                  fontSize: 92,
                  lineHeight: 1.05,
                  letterSpacing: -4,
                  margin: 0,
                  maxWidth: 1420,
                }}
              >
                {(scene.card === "ending"
                  ? (props.endingTitle ?? props.title)
                  : props.title
                ).map((line, i) => (
                  <span
                    key={line}
                    style={{
                      display: "block",
                      color: i ? "#a9d8fb" : "#f5f8fc",
                    }}
                  >
                    {line}
                  </span>
                ))}
              </h1>
              <p style={{ marginTop: 36, fontSize: 28, color: "#d5e1ed" }}>
                {scene.card === "ending" ? props.website : props.subtitle}
              </p>
            </AbsoluteFill>
          ) : scene.freeze ? (
            <Freeze frame={0}>
              <OffthreadVideo
                src={staticFile(props.video)}
                startFrom={Math.round((scene.sourceStart ?? 0) * fps)}
                muted
                style={{ width, height, objectFit: "contain" }}
              />
            </Freeze>
          ) : (
            <OffthreadVideo
              src={staticFile(props.video)}
              startFrom={Math.round((scene.sourceStart ?? 0) * fps)}
              muted
              style={{ width, height, objectFit: "contain" }}
            />
          )}
        </Sequence>
      ))}
      {props.clicks.map((click, index) => {
        if (props.hidePointer) return null;
        const delta = time - click.time;
        if (delta < -0.8 || delta > 0.6) return null;
        if (
          props.pausePoints?.some(
            (point) =>
              point >= click.time && point < click.time + 0.6 && time >= point,
          )
        )
          return null;
        const previous = props.clicks[index - 1];
        const next = props.clicks[index + 1];
        if (previous && time < (previous.time + click.time) / 2) return null;
        if (next && time >= (click.time + next.time) / 2) return null;
        const x = click.x * width;
        const y = click.y * height;
        const progress = Math.min(1, Math.max(0, (delta + 0.65) / 0.5));
        const ease = 1 - Math.pow(1 - progress, 3);
        const pointerX = x - 58 * (1 - ease);
        const pointerY = y + 36 * (1 - ease);
        const radius = 10 + 28 * Math.min(1, Math.max(0, delta / 0.35));
        return (
          <AbsoluteFill key={index} style={{ pointerEvents: "none" }}>
            {delta >= 0 && delta < 0.35 ? (
              <div
                style={{
                  position: "absolute",
                  left: x - radius,
                  top: y - radius,
                  width: radius * 2,
                  height: radius * 2,
                  borderRadius: "50%",
                  border: "4px solid #ef4444",
                  boxShadow: "0 0 0 2px white",
                  opacity: 1 - delta / 0.35,
                }}
              />
            ) : null}
            <svg
              width="30"
              height="38"
              viewBox="0 0 30 38"
              style={{
                position: "absolute",
                left: pointerX - 2,
                top: pointerY - 2,
                filter: "drop-shadow(0 2px 3px #0006)",
                transform: `scale(${delta >= 0 && delta < 0.12 ? 0.86 : 1})`,
                transformOrigin: "2px 2px",
                opacity: delta > 0.35 ? (0.6 - delta) / 0.25 : 1,
              }}
            >
              <path
                d="M2 2L2 30L10 23L17 36L23 33L16 21L27 20Z"
                fill="#17212e"
                stroke="white"
                strokeWidth="2"
                strokeLinejoin="round"
              />
            </svg>
          </AbsoluteFill>
        );
      })}
      {(props.drags ?? []).map((drag, index) => {
        if (props.hidePointer) return null;
        const delta = time - drag.time;
        if (delta < -0.65 || delta > drag.duration + 0.4) return null;
        if (
          props.pausePoints?.some(
            (point) =>
              point >= drag.time + drag.duration &&
              point < drag.time + drag.duration + 0.4 &&
              time >= point,
          )
        )
          return null;
        const approach = Math.min(1, Math.max(0, (delta + 0.65) / 0.5));
        const progress = Math.min(1, Math.max(0, delta / drag.duration));
        const x =
          (drag.from.x + (drag.to.x - drag.from.x) * progress) * width -
          42 * Math.pow(1 - approach, 3);
        const y =
          (drag.from.y + (drag.to.y - drag.from.y) * progress) * height +
          24 * Math.pow(1 - approach, 3);
        const ripple =
          delta >= 0 && delta < 0.28
            ? delta / 0.28
            : delta >= drag.duration && delta < drag.duration + 0.28
              ? (delta - drag.duration) / 0.28
              : null;
        const radius = 10 + 28 * (ripple ?? 0);
        return (
          <AbsoluteFill key={`drag-${index}`} style={{ pointerEvents: "none" }}>
            {ripple !== null ? (
              <div
                style={{
                  position: "absolute",
                  left: x - radius,
                  top: y - radius,
                  width: radius * 2,
                  height: radius * 2,
                  borderRadius: "50%",
                  border: "4px solid #ef4444",
                  opacity: 1 - ripple,
                }}
              />
            ) : null}
            <svg
              width="30"
              height="38"
              viewBox="0 0 30 38"
              style={{
                position: "absolute",
                left: x - 2,
                top: y - 2,
                filter: "drop-shadow(0 2px 3px #0006)",
              }}
            >
              <path
                d="M2 2L2 30L10 23L17 36L23 33L16 21L27 20Z"
                fill="#17212e"
                stroke="white"
                strokeWidth="2"
                strokeLinejoin="round"
              />
            </svg>
          </AbsoluteFill>
        );
      })}
    </AbsoluteFill>
  );
};

export const RecordedFilm = (props: RecordedFilmProps) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const segment = props.timeMap?.find(
    (segment) =>
      frame >= Math.round(segment.start * fps) &&
      frame < Math.round((segment.start + segment.duration) * fps),
  );
  const sourceFrame = segment
    ? Math.round(segment.sourceStart * fps) +
      (segment.freeze ? 0 : frame - Math.round(segment.start * fps))
    : frame;
  const pausePoints = props.timeMap
    ?.filter((segment) => segment.freeze)
    .map((segment) => segment.sourceStart);
  const clickFocus = props.clicks
    .flatMap((click) => {
      if (!click.focus) return [];
      const clickFrame = Math.round(click.time * fps);
      const movingSegment = props.timeMap?.find(
        (part) =>
          !part.freeze &&
          clickFrame >= Math.round(part.sourceStart * fps) &&
          clickFrame < Math.round((part.sourceStart + part.duration) * fps),
      );
      if (props.timeMap && !movingSegment) return [];
      const actionFrame = movingSegment
        ? Math.round(movingSegment.start * fps) +
          clickFrame -
          Math.round(movingSegment.sourceStart * fps)
        : clickFrame;
      const delta = (frame - actionFrame) / fps;
      return delta >= -1.4 && delta < 0.25
        ? [{ bounds: click.focus, elapsed: delta + 1.4, duration: 1.65 }]
        : [];
    })
    .at(-1);
  const areaFocus = props.focusAreas?.find(
    (area) =>
      frame / fps >= area.start && frame / fps < area.start + area.duration,
  );
  const focus = areaFocus
    ? {
        bounds: areaFocus.bounds,
        elapsed: frame / fps - areaFocus.start,
        duration: areaFocus.duration,
      }
    : clickFocus;
  const focusOpacity = focus
    ? 1 -
      Math.pow(
        1 -
          Math.max(
            0,
            Math.min(
              1,
              focus.elapsed / 0.24,
              (focus.duration - focus.elapsed) / 0.18,
            ),
          ),
        3,
      )
    : 0;
  return (
    <AbsoluteFill>
      <Freeze frame={sourceFrame}>
        <RecordedVisuals
          {...props}
          hidePointer={segment?.freeze}
          pausePoints={pausePoints}
        />
      </Freeze>
      {focus ? (
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            opacity: focusOpacity,
          }}
        >
          <defs>
            <filter id="focus-feather">
              <feGaussianBlur stdDeviation="3" />
            </filter>
            <mask id="action-focus">
              <rect width={width} height={height} fill="white" />
              <rect
                x={focus.bounds.x * width - 8}
                y={focus.bounds.y * height - 7}
                width={focus.bounds.width * width + 16}
                height={focus.bounds.height * height + 14}
                rx="9"
                fill="black"
                filter="url(#focus-feather)"
              />
            </mask>
          </defs>
          <rect
            width={width}
            height={height}
            fill="#070c15"
            fillOpacity="0.27"
            mask="url(#action-focus)"
          />
          <rect
            x={focus.bounds.x * width - 8}
            y={focus.bounds.y * height - 7}
            width={focus.bounds.width * width + 16}
            height={focus.bounds.height * height + 14}
            rx="9"
            fill="none"
            stroke="#ffffff"
            strokeOpacity="0.75"
            strokeWidth="2"
          />
        </svg>
      ) : null}
      <Html5Audio src={staticFile(props.audio)} />
    </AbsoluteFill>
  );
};
