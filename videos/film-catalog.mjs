// Export settings shared by Studio, the renderer, and narration tools.
export const FPS = 24;
export const films = [
  { id: "mission-film", title: "Mission", duration: 48, posterSecond: 12 },
  { id: "review-film", title: "Code Review", duration: 56, posterSecond: 28 },
  {
    id: "delegation-film",
    title: "Delegation",
    duration: 46,
    posterSecond: 29,
  },
  { id: "project-film", title: "Quick Chat", duration: 43, posterSecond: 30 },
  { id: "visualize-film", title: "Visualize", duration: 31, posterSecond: 24 },
  { id: "sharing-film", title: "Sharing", duration: 54, posterSecond: 25 },
  {
    id: "project-shorts",
    title: "Quick Chat · Shorts",
    duration: 40,
    posterSecond: 29,
    width: 1080,
    height: 1920,
  },
].map((film) => ({ width: 1600, height: 900, ...film }));
