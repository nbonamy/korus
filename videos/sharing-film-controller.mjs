const DURATION = 54;
const SCENES = [
  [0, 3, "opening", "", ""],
  [
    3,
    10,
    "invite",
    "Bring someone into the work.",
    "Create an invitation for this conversation.",
  ],
  [
    10,
    17,
    "join",
    "The context comes with it.",
    "Your teammate sees the history and follows live updates.",
  ],
  [
    17,
    24,
    "suggest",
    "A fresh pair of eyes.",
    "Your teammate can suggest the next prompt.",
  ],
  [
    24,
    31,
    "draft",
    "Their idea. Your draft.",
    "Move the suggestion into your composer.",
  ],
  [
    31,
    37,
    "send",
    "Make it your request.",
    "Edit the draft, then send it yourself.",
  ],
  [
    37,
    44,
    "work",
    "Follow the result together.",
    "The same conversation updates on both sides.",
  ],
  [44, 49, "stop", "Share on your terms.", "Stop sharing to end guest access."],
  [49, DURATION, "ending", "", ""],
];
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const ease = (value) => 1 - (1 - clamp(value)) ** 3;
const mix = (a, b, value) => a + (b - a) * value;
const icon = (paths) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
const share = icon(
  '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4"/>',
);
const pencil = icon('<path d="m16 3 5 5-12 12-6 1 1-6L16 3Zm-3 3 5 5"/>');
const trash = icon(
  '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6m4-6v6"/>',
);
const arrow = icon('<path d="M12 19V5m-6 6 6-6 6 6"/>');
const check = icon('<path d="m5 12 4 4 10-10"/>');
const lock = icon(
  '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
);
const PROPOSAL = "What if the payment times out, then succeeds?";
const ADDITION = " Add a regression test.";
const invitation = "korus://share/demo-invitation";
const user = (text) =>
  `<div class="sharing-message sharing-message--user"><p>${text}</p></div>`;
const agent = (text) =>
  `<div class="sharing-message sharing-message--agent"><strong>Codex</strong><p>${text}</p></div>`;
const tool = (text) =>
  `<div class="sharing-tool">${check}<span>${text}</span><small>Done</small></div>`;
const HISTORY =
  user("Make checkout retries safe.") +
  agent("I’ll review payment retries and check the existing tests.");

export function createFilm(document, browserWindow) {
  const $ = (selector) => document.querySelector(selector);
  const film = $("#film"),
    viewport = $(".film-viewport"),
    scrubber = $("#scrubber"),
    toggle = $("#play-toggle");
  let time = 0,
    playing = false,
    lastFrame = 0;
  const historyCache = new Map();
  $("#owner-share").innerHTML = share;
  $("#move-suggestion").innerHTML = pencil;
  $("#dismiss-suggestion").innerHTML = trash;
  $("#owner-send").innerHTML = arrow;
  $("#guest-send").innerHTML = arrow;
  $("#ended-icon").innerHTML = lock;
  $("#transfer-icon").innerHTML = share;
  $("#suggestion-copy").textContent = PROPOSAL;
  const show = (selector, visible) => {
    const el = $(selector);
    el.style.opacity = visible ? "1" : "0";
    el.style.visibility = visible ? "visible" : "hidden";
  };
  function center(selector) {
    const target = $(selector).getBoundingClientRect(),
      outer = film.getBoundingClientRect();
    const scale = outer.width / 1600;
    return {
      x: (target.left + target.width / 2 - outer.left) / scale,
      y: (target.top + target.height / 2 - outer.top) / scale,
    };
  }
  const clicks = [
    [3.1, 3.95, "#owner-share"],
    [7.5, 8.6, "#create-share"],
    [12.2, 13.15, "#guest-join"],
    [21.1, 22, "#guest-send"],
    [27.4, 28.5, "#move-suggestion"],
    [34.7, 35.7, "#owner-send"],
    [44, 44.7, "#owner-share"],
    [46.25, 47.2, "#stop-sharing"],
  ];
  function pointer(t) {
    const active = clicks.find(
      ([start, click]) => t >= start && t <= click + 0.28,
    );
    show("#film-pointer", Boolean(active));
    show("#pointer-ring", Boolean(active));
    if (!active) return;
    const [start, click, selector] = active,
      target = center(selector),
      travel = ease((t - start) / (click - start));
    $("#film-pointer").style.opacity = String(clamp((t - start) / 0.18));
    $("#film-pointer").style.transform =
      `translate(${mix(target.x + 100, target.x - 7, travel)}px, ${mix(target.y + 70, target.y - 4, travel)}px) scale(${t >= click ? 0.88 : 1})`;
    const ripple = (t - click) / 0.28;
    $("#pointer-ring").style.opacity =
      ripple >= 0 && ripple <= 1 ? String(1 - ripple) : "0";
    $("#pointer-ring").style.transform =
      `translate(${target.x - 20}px, ${target.y - 20}px) scale(${0.5 + Math.max(0, ripple) * 1.5})`;
  }
  function history(selector, html, scroll) {
    const el = $(selector);
    if (historyCache.get(selector) !== html) {
      el.innerHTML = html;
      historyCache.set(selector, html);
    }
    el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight) * scroll;
  }
  function seek(nextTime) {
    time = clamp(Number(nextTime) || 0, 0, DURATION);
    const scene = SCENES.find(([, end]) => time < end) || SCENES.at(-1);
    const [start, , name, title, detail] = scene;
    const intro = ease((time - 2.1) / 0.9),
      outro = ease((time - 48.8) / 0.8);
    $(".opening").style.opacity = String(1 - intro);
    $(".opening").style.transform =
      `translateX(${-100 * intro}px) scale(${1 - 0.035 * intro})`;
    $(".walkthrough").style.opacity = String(intro * (1 - outro));
    $(".walkthrough").style.transform =
      `translateX(${55 * (1 - intro)}px) scale(${0.97 + 0.03 * intro})`;
    $(".ending").style.opacity = String(outro);
    $(".ending").style.transform = `translateY(${28 * (1 - outro)}px)`;
    const chapter =
      name === "opening" ? SCENES[1] : name === "ending" ? SCENES[7] : scene;
    $("#chapter-index").textContent =
      `${String(SCENES.indexOf(chapter)).padStart(2, "0")} / 07`;
    $("#chapter-title").textContent = chapter[3];
    $("#chapter-detail").textContent = chapter[4];
    $("#film-footer-stage").textContent =
      `SHARING / ${chapter[2].toUpperCase()}`;
    $("#film-progress").style.width = `${clamp((time - 3) / 46) * 100}%`;
    const joined = time >= 14.1,
      submitted = time >= 35.7,
      revoked = time >= 47.3;
    const ownerDialog =
      (time >= 4.05 && time < 9.05) || (time >= 44.8 && time < 47.3);
    show("#owner-overlay", ownerDialog);
    show("#guest-overlay", !joined);
    show("#guest-connected", joined && !revoked);
    show("#guest-ended", revoked);
    $("#owner-share").classList.toggle("is-active", time >= 9.05 && !revoked);
    $("#create-share").textContent = time >= 44 ? "Copy link" : "Share";
    $("#stop-sharing").style.display = time >= 44 ? "inline-block" : "none";
    $("#share-status").textContent = time >= 44 ? "1 guest connected" : "";
    show("#share-toast", time >= 9.05 && time < 10.8);
    $("#share-toast").style.transform =
      `translate(-50%, ${-8 * (1 - ease((time - 9.05) / 0.2))}px)`;
    $("#guest-invite").textContent =
      time >= 10.4
        ? invitation.slice(
            0,
            Math.floor(clamp((time - 10.4) / 1.35) * invitation.length),
          )
        : "Invitation or share link";
    const proposed = time >= 22,
      moved = time >= 28.6;
    const row = $("#owner-suggestion"),
      rowVisible = time >= 23 && time < 28.9;
    row.style.display = rowVisible ? "block" : "none";
    row.style.opacity = String(
      ease((time - 22.9) / 0.3) * (1 - ease((time - 28.6) / 0.3)),
    );
    const pending = $("#guest-pending");
    pending.style.display = proposed && !moved ? "grid" : "none";
    $("#guest-draft").textContent =
      !proposed && time >= 17.8
        ? PROPOSAL.slice(
            0,
            Math.floor(clamp((time - 17.8) / 2.9) * PROPOSAL.length),
          ) || "Propose a message…"
        : "Propose a message…";
    $("#guest-composer").classList.toggle(
      "is-typing",
      time >= 17.8 && !proposed,
    );
    const edited = ADDITION.slice(
      0,
      Math.floor(clamp((time - 31.4) / 2.6) * ADDITION.length),
    );
    $("#owner-draft").textContent =
      moved && !submitted ? PROPOSAL + edited : "Ask a follow-up";
    $("#owner-composer").classList.toggle("is-typing", moved && !submitted);
    let transcript = HISTORY;
    if (time >= 15) transcript += tool("Inspect checkout retry handling");
    if (submitted) transcript += user(PROPOSAL + ADDITION);
    if (time >= 37.8)
      transcript += agent(
        "I’ll cover the timeout, then success, with a regression test.",
      );
    if (time >= 39.2) transcript += tool("Run checkout retry tests");
    if (time >= 41)
      transcript += agent(
        "Retries reuse the payment ID. The regression test passes.",
      );
    history("#owner-history", transcript, ease((time - 35.7) / 0.8));
    history(
      "#guest-history",
      joined && !revoked ? transcript : "",
      ease((time - 35.7) / 0.8),
    );
    const flying = time >= 22.15 && time < 23;
    show("#transfer-chip", flying);
    if (flying) {
      const from = center("#guest-composer"),
        to = center("#owner-composer"),
        p = ease((time - 22.15) / 0.85);
      $("#transfer-chip").style.left = `${mix(from.x, to.x, p) - 64 - 180}px`;
      $("#transfer-chip").style.top =
        `${mix(from.y - 80, to.y - 112, p) - 155 - Math.sin(Math.PI * p) * 42}px`;
      $("#transfer-chip").style.opacity = String(
        Math.min(clamp((time - 22.15) / 0.12), clamp((23 - time) / 0.12)),
      );
    }
    pointer(time);
    scrubber.value = String(time);
    $("#timecode").textContent =
      `00:${String(Math.floor(time)).padStart(2, "0")} / 00:54`;
    return { scene: name, time, joined, submitted, revoked };
  }
  function fit() {
    film.style.transform = `scale(${(viewport.clientWidth || 1600) / 1600})`;
  }
  function frame(now) {
    if (!playing) return;
    if (lastFrame) seek(time + (now - lastFrame) / 1000);
    lastFrame = now;
    if (time >= DURATION) {
      pause();
      return;
    }
    browserWindow.requestAnimationFrame(frame);
  }
  function play() {
    if (playing || !browserWindow) return;
    if (time >= DURATION) seek(0);
    playing = true;
    lastFrame = 0;
    toggle.textContent = "Pause";
    browserWindow.requestAnimationFrame(frame);
  }
  function pause() {
    playing = false;
    lastFrame = 0;
    toggle.textContent = "Play";
  }
  toggle.addEventListener("click", () => (playing ? pause() : play()));
  $("#restart").addEventListener("click", () => {
    pause();
    seek(0);
  });
  scrubber.addEventListener("input", () => {
    pause();
    seek(scrubber.value);
  });
  browserWindow?.addEventListener?.("resize", fit);
  fit();
  seek(0);
  return {
    seek,
    play,
    pause,
    get time() {
      return time;
    },
    get duration() {
      return DURATION;
    },
  };
}
