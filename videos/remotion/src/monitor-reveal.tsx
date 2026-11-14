import {
  AbsoluteFill,
  Freeze,
  OffthreadVideo,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export type MonitorRevealSpec = {
  start: number;
  settle: number;
  end: number;
  leftSource: number;
  rightSource: number;
};

// An authored camera move around two real desktop captures, not a product UI.
export const MonitorReveal = ({
  video,
  reveal,
}: {
  video: string;
  reveal: MonitorRevealSpec;
}) => {
  const { fps } = useVideoConfig();
  const time = useCurrentFrame() / fps;
  const progress = Math.min(
    1,
    Math.max(0, (time - reveal.start) / reveal.settle),
  );
  const eased = progress * progress * (3 - 2 * progress);
  const initialScale = 1600 / 700;
  const scale = initialScale + (1 - initialScale) * eased;
  const x = -850 * initialScale * (1 - eased);
  const y = -190 * initialScale * (1 - eased);
  return (
    <AbsoluteFill style={{ overflow: "hidden", background: "#101b28" }}>
      <AbsoluteFill
        style={{
          transformOrigin: "0 0",
          transform: `translate(${x}px, ${y}px) scale(${scale})`,
          background:
            "radial-gradient(ellipse at 50% 38%, #30485d, #142231 63%, #101b28)",
          overflow: "visible",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 684,
            height: 216,
            background: "linear-gradient(#263b4b, #172735 12%, #101b28)",
            borderTop: "1px solid #54708555",
          }}
        />
        {[reveal.leftSource, reveal.rightSource].map((source, index) => (
          <div
            key={index}
            style={{
              position: "absolute",
              left: index ? 850 : 50,
              top: 190,
              width: 700,
              height: 394,
            }}
          >
            <div
              style={{
                position: "absolute",
                left: 289,
                top: 391,
                width: 122,
                height: 90,
                background:
                  "linear-gradient(90deg, #15202a, #607484 48%, #263642)",
                clipPath: "polygon(30% 0,70% 0,90% 100%,10% 100%)",
              }}
            />
            <div
              style={{
                position: "absolute",
                left: 218,
                top: 475,
                width: 264,
                height: 16,
                borderRadius: "50%",
                background: "linear-gradient(#667d8e, #1c2c3a)",
                boxShadow: "0 14px 20px #0009",
              }}
            />
            <div
              style={{
                position: "absolute",
                inset: -12,
                bottom: -24,
                borderRadius: 19,
                background:
                  "linear-gradient(140deg, #6d8394, #111b25 35%, #334654)",
                boxShadow: "0 25px 55px #0008, inset 0 0 0 1px #9aafbd88",
              }}
            />
            <div
              style={{
                position: "absolute",
                inset: -4,
                background: "#0a1119",
                borderRadius: 8,
              }}
            />
            <div
              style={{
                position: "absolute",
                inset: 0,
                overflow: "hidden",
                borderRadius: 5,
                background: "white",
              }}
            >
              <Freeze frame={0}>
                <OffthreadVideo
                  src={staticFile(video)}
                  startFrom={Math.round(source * fps)}
                  muted
                  style={{ width: 700, height: 393.75, display: "block" }}
                />
              </Freeze>
            </div>
            <div
              style={{
                position: "absolute",
                left: 347,
                top: 403,
                width: 5,
                height: 3,
                borderRadius: 2,
                background: "#9cc6dd",
                opacity: 0.75,
              }}
            />
          </div>
        ))}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
