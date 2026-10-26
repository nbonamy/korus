import "./product.mjs";
import { createFilm } from "./sharing-film-controller.mjs";
export { createFilm } from "./sharing-film-controller.mjs";

if (typeof window !== "undefined" && document.querySelector("#film")) {
  const params = new URLSearchParams(window.location.search);
  if (params.has("export")) document.body.classList.add("exporting");
  const controller = createFilm(document, window);
  window.seekFilm = controller.seek;
  window.filmController = controller;
  if (params.has("t")) controller.seek(Number(params.get("t")));
  if (!params.has("export")) controller.play();
}
