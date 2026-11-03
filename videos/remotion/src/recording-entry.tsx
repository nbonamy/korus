import { Composition, getInputProps, registerRoot } from "remotion";
import { RecordedFilm, type RecordedFilmProps } from "./recorded-film";

registerRoot(() => {
  const data = getInputProps<
    RecordedFilmProps & {
      id: string;
      duration: number;
      width: number;
      height: number;
      fps: number;
    }
  >();
  return (
    <Composition
      id={`${data.id}-recorded`}
      component={RecordedFilm}
      width={data.width}
      height={data.height}
      fps={data.fps}
      durationInFrames={Math.round(data.duration * data.fps)}
      defaultProps={data}
    />
  );
});
