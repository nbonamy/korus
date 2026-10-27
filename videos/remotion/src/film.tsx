import { useLayoutEffect, useRef, useState } from "react";
import {
  AbsoluteFill,
  Html5Audio,
  staticFile,
  useCurrentFrame,
  useDelayRender,
} from "remotion";
import { createFilm as mission } from "../../mission-film-controller.mjs";
import { createFilm as review } from "../../review-film-controller.mjs";
import { createFilm as delegation } from "../../delegation-film-controller.mjs";
import { createFilm as project } from "../../project-film-controller.mjs";
import { createFilm as visualize } from "../../visualize-film-controller.mjs";
import { createFilm as sharing } from "../../sharing-film-controller.mjs";
import { createFilm as shorts } from "../../project-shorts-controller.mjs";
import { sourceFrameAt } from "../../film-timing.mjs";
import { manifest } from "./manifest";

const controllers = {
  "mission-film": mission,
  "review-film": review,
  "delegation-film": delegation,
  "project-film": project,
  "visualize-film": visualize,
  "sharing-film": sharing,
  "project-shorts": shorts,
};
type Controller = { seek: (time: number) => unknown; pause: () => void };
export type FilmProps = { sourceId: string; narrationId: string | null };

// Authored DOM/CSS and choreography; Remotion owns the clock, audio and export.
export const Film = ({ sourceId, narrationId }: FilmProps) => {
  const root = useRef<HTMLDivElement>(null);
  const controller = useRef<Controller | null>(null);
  const frame = useCurrentFrame();
  const { delayRender, continueRender, cancelRender } = useDelayRender();
  const [handle] = useState(() => delayRender(`Loading ${sourceId} artwork`));
  const source = manifest.sources.find((film) => film.id === sourceId)!;
  const narration = manifest.narrated.find((film) => film.id === narrationId);
  useLayoutEffect(() => {
    const element = root.current!;
    const createFilm = controllers[sourceId as keyof typeof controllers];
    controller.current = createFilm(element as unknown as Document, undefined);
    Promise.all([
      document.fonts.ready,
      ...Array.from(element.querySelectorAll("img")).map((image) =>
        image.decode(),
      ),
    ])
      .then(() => continueRender(handle))
      .catch(cancelRender);
    return () => {
      controller.current?.pause();
      controller.current = null;
    };
  }, [sourceId, handle, continueRender, cancelRender]);
  useLayoutEffect(() => {
    const sourceFrame = narration ? sourceFrameAt(frame, narration) : frame;
    controller.current?.seek(sourceFrame / manifest.fps);
  }, [frame, narration, sourceId]);
  return (
    <AbsoluteFill>
      <style>
        {source.css +
          `
        .remotion-film { width: ${source.width}px; height: ${source.height}px; overflow: hidden; }
        .remotion-film .film-viewport { width: ${source.width}px; height: ${source.height}px; border: 0; border-radius: 0; box-shadow: none; margin: 0; }
        .remotion-film .film { transform: none !important; }
        .remotion-film .controls { display: none; }
      `}
      </style>
      <div
        ref={root}
        className="remotion-film"
        dangerouslySetInnerHTML={{
          __html: source.markup.replaceAll(
            "__FILM_ICON__",
            staticFile("app-icon.png"),
          ),
        }}
      />
      {narration && <Html5Audio src={staticFile(narration.audio)} />}
    </AbsoluteFill>
  );
};
