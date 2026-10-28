document.querySelector("#year").textContent = String(new Date().getFullYear());
document.documentElement.classList.add("js");

// OS is a convenience, not CPU detection: keep architecture choices explicit.
const userAgent = navigator.userAgent;
const mobile =
  /Android|iPhone|iPad|iPod|CrOS/i.test(userAgent) ||
  (/Macintosh/i.test(userAgent) && navigator.maxTouchPoints > 1);
const platform = /iPhone/i.test(userAgent)
  ? "ios"
  : mobile
    ? null
    : /Windows/i.test(userAgent)
      ? "windows"
      : /Macintosh|Mac OS X/i.test(userAgent)
        ? "macos"
        : /Linux/i.test(userAgent)
          ? "linux"
          : null;
if (platform) {
  const option = document.querySelector(`[data-platform="${platform}"]`);
  option?.setAttribute("data-detected", "");
  const installer =
    platform === "ios"
      ? option?.querySelector("a")
      : platform !== "linux" && option?.querySelector("a[data-installer]");
  for (const link of document.querySelectorAll("[data-platform-download]")) {
    link.href = installer ? installer.href : `#download-${platform}`;
    const label = {
      macos: "macOS",
      windows: "Windows",
      linux: "Linux",
      ios: "iPhone",
    }[platform];
    link.querySelector("[data-platform-label]").textContent = ` for ${label}`;
    link.setAttribute("aria-label", `Download for ${label}`);
  }
}

const reveals = document.querySelectorAll(".reveal");
if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries, instance) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          instance.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12 },
  );
  reveals.forEach((element) => observer.observe(element));
} else {
  reveals.forEach((element) => element.classList.add("is-visible"));
}

// The hero plays its films muted, one after another, so visitors see the
// product on arrival. Only the selected film loads; reduced motion keeps posters.
const showcase = document.querySelector(".showcase");
const showcaseTabs = [...showcase.querySelectorAll('[role="tab"]')];
const showcaseVideos = [...showcase.querySelectorAll("video")];
const watch = showcase.querySelector(".showcase-watch");
const autoplay = !matchMedia("(prefers-reduced-motion: reduce)").matches;
let showcaseIndex = 0;
const pauseShowcase = () => showcaseVideos[showcaseIndex].pause();
const loadShowcase = (video) => {
  if (!video.hasAttribute("src")) video.src = video.dataset.src;
};
const pauseFilms = () => {
  for (const video of document.querySelectorAll(".product-film video"))
    video.pause();
};
const selectShowcase = (index) => {
  pauseShowcase();
  pauseFilms();
  showcaseIndex = index;
  showcaseTabs.forEach((tab, position) => {
    const selected = position === index;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
    tab.style.removeProperty("--progress");
  });
  showcaseVideos.forEach((video, position) =>
    video.classList.toggle("is-active", position === index),
  );
  const video = showcaseVideos[index];
  watch.href = video.dataset.src;
  watch.hidden = false;
  video.muted = true;
  video.controls = false;
  if (video.readyState) video.currentTime = 0;
  if (!autoplay) return;
  loadShowcase(video);
  video.play().catch(() => {});
};
showcaseVideos.forEach((video, index) => {
  video.addEventListener("timeupdate", () => {
    if (index === showcaseIndex && video.duration)
      showcaseTabs[index].style.setProperty(
        "--progress",
        String(video.currentTime / video.duration),
      );
  });
  // Advance only while previewing; a film watched with sound stays put.
  video.addEventListener("ended", () => {
    if (index === showcaseIndex && video.muted && autoplay)
      selectShowcase((index + 1) % showcaseVideos.length);
  });
});
showcaseTabs.forEach((tab, index) => {
  tab.addEventListener("click", () => selectShowcase(index));
  tab.addEventListener("keydown", (event) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const next = (index + step + showcaseTabs.length) % showcaseTabs.length;
    selectShowcase(next);
    showcaseTabs[next].focus();
  });
});
watch.addEventListener("click", (event) => {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  const video = showcaseVideos[showcaseIndex];
  const track = video.querySelector("track");
  pauseFilms();
  loadShowcase(video);
  if (!track.hasAttribute("src")) track.src = track.dataset.src;
  track.track.mode = "showing";
  video.muted = false;
  video.controls = true;
  video.currentTime = 0;
  watch.hidden = true;
  video.focus({ preventScroll: true });
  video.play().catch(() => {});
});
selectShowcase(0);

// Keep MP4s off the network until a visitor chooses a film. The cover is a
// direct media link so the walkthroughs remain available without JavaScript.
const films = [...document.querySelectorAll(".product-film")];
let captionsEnabled = true;
const setCaptions = (enabled) => {
  captionsEnabled = enabled;
  for (const film of films) {
    const button = film.querySelector(".film-captions");
    if (button.disabled) continue;
    button.setAttribute("aria-pressed", String(enabled));
    button.textContent = enabled ? "Captions on" : "Captions off";
    const track = film.querySelector("track");
    // Leave unopened tracks dormant: enabling an empty URL fires a load error.
    const mode = enabled ? "showing" : "disabled";
    if (track.hasAttribute("src") && track.track.mode !== mode)
      track.track.mode = mode;
  }
};
setCaptions(captionsEnabled);
for (const film of films) {
  const video = film.querySelector("video");
  const cover = film.querySelector(".film-cover");
  const track = video.querySelector("track");
  const captions = film.querySelector(".film-captions");
  captions.hidden = false;
  captions.addEventListener("click", () => {
    setCaptions(!captionsEnabled);
  });
  video.textTracks.addEventListener("change", () => {
    if (!track.hasAttribute("src") || captions.disabled) return;
    const enabled = track.track.mode === "showing";
    if (enabled !== captionsEnabled) setCaptions(enabled);
  });
  const positionCaptions = () => {
    if (!video.clientHeight || !track.track.cues) return;
    for (const cue of track.track.cues) {
      cue.snapToLines = false;
      // Keep captions low, with room for the native controls even on phones.
      cue.line = Math.max(50, 100 - (64 / video.clientHeight) * 100);
      cue.lineAlign = "end";
    }
  };
  track.addEventListener("load", positionCaptions);
  new ResizeObserver(positionCaptions).observe(video);
  video.addEventListener("volumechange", () => {
    for (const other of films) {
      const player = other.querySelector("video");
      if (player.muted !== video.muted) player.muted = video.muted;
      if (player.volume !== video.volume) player.volume = video.volume;
    }
  });
  track.addEventListener("error", () => {
    captions.disabled = true;
    captions.textContent = "Captions unavailable";
  });
  const showError = () => {
    if (film.querySelector(".film-status")) return;
    const status = document.createElement("p");
    status.className = "film-status";
    status.setAttribute("role", "status");
    status.append("Couldn’t play inline. ");
    const link = document.createElement("a");
    link.href = cover.href;
    link.textContent = "Open video";
    status.append(link);
    film.append(status);
  };
  video.addEventListener("error", showError);
  video.addEventListener("play", () => {
    pauseShowcase();
    for (const other of films) {
      if (other !== film) other.querySelector("video").pause();
    }
  });
  cover.addEventListener("click", (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    video.poster = cover.querySelector("img").src;
    video.src = cover.href;
    track.src = track.dataset.src;
    track.track.mode = captionsEnabled ? "showing" : "disabled";
    video.hidden = false;
    cover.hidden = true;
    video.focus({ preventScroll: true });
    video.play().catch(showError);
  });
}
