// FLEX-WAM live PushT demo. Talks to src/scripts/demo/serve_pusht.py.
// The backend address is the player's data-api attribute ("" = same origin as the page).
// Nothing runs until the visitor presses Play: page views never take a GPU session.
// Keys are captured only while the player has focus, so arrows still scroll the page otherwise.
(() => {
  const root = document.getElementById("player");
  if (!root) return;
  const API = (root.dataset.api || "").replace(/\/$/, "");
  const DT = 0.2;                                   // pushT corpus step: 5 Hz = real time
  const $ = (id) => document.getElementById(id);
  const screen = $("screen"), view = $("view"), poster = $("poster"), veil = $("veil");
  const ctx = view.getContext("2d");
  const LABEL = { wm: "You Drive · World Model", joint: "Model Drives · World Action Model",
                  real: "Real PushT frame" };
  const KEYMAP = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down",
                   a: "left", d: "right", w: "up", s: "down" };

  let sid = null, n = 0, mode = "wm", paused = false, beat = null, lastAction = [0, 0];
  const held = new Set();

  // ------------------------------------------------------------------ transport
  const get = (path) => fetch(API + path, { cache: "no-store" });
  const post = (path, body) => fetch(API + path, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}),
  }).then((r) => r.json()).catch(() => ({}));

  function setStatus(live, text) {
    $("status").dataset.live = live ? "yes" : "no";
    $("status-text").textContent = text;
  }
  async function health() {
    try {
      const h = await (await get("/api/health")).json();
      const free = h.players - h.busy;
      setStatus(true, free > 0 ? `Live · ${free} of ${h.players} player slot${h.players > 1 ? "s" : ""} free`
                               : `Live · all slots busy · ${h.queue} waiting`);
      return h;
    } catch {
      setStatus(false, "The live demo is offline right now");
      return null;
    }
  }

  // ------------------------------------------------------------------ UI state
  function showVeil(html, button) {
    veil.hidden = false;
    veil.innerHTML = (button ? `<button type="button" class="btn" id="start">${button}</button>` : "") +
                     `<small>${html}</small>`;
    const b = $("start");
    if (b) b.onclick = start;
  }
  function setKind(kind) {
    screen.dataset.kind = kind;
    $("tag").textContent = LABEL[kind] || "";
  }
  function setMode(m, send = true) {
    mode = m;
    document.querySelectorAll(".mode").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === m)));
    if (send && sid) post("/api/control", { sid, mode: m });
  }
  function setPlaying(on) {
    $("reset").disabled = !on; $("pause").disabled = !on;
  }

  function dir() {
    return [(held.has("right") ? 1 : 0) - (held.has("left") ? 1 : 0),
            (held.has("down") ? 1 : 0) - (held.has("up") ? 1 : 0)];
  }
  function sendKeys() { if (sid) post("/api/control", { sid, keys: dir() }); }
  function press(k) {
    if (held.has(k)) return;
    held.add(k);
    if (mode !== "wm") setMode("wm");
    sendKeys();
  }
  function release(k) { if (held.delete(k)) sendKeys(); }
  function releaseAll() { if (held.size) { held.clear(); sendKeys(); } }

  function drawDial(a) {
    const c = $("dial"), g = c.getContext("2d"), W = c.width, s = W / 2 / 1.4;
    const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
    g.clearRect(0, 0, W, W);
    g.strokeStyle = css("--rule"); g.lineWidth = 3;
    g.beginPath(); g.arc(W / 2, W / 2, s, 0, 2 * Math.PI); g.stroke();
    g.beginPath(); g.moveTo(W / 2, 10); g.lineTo(W / 2, W - 10); g.moveTo(10, W / 2); g.lineTo(W - 10, W / 2); g.stroke();
    const col = css(mode === "joint" ? "--wam" : "--wm"), x = W / 2 + a[0] * s, y = W / 2 + a[1] * s;
    g.strokeStyle = g.fillStyle = col; g.lineWidth = 8; g.lineCap = "round";
    g.beginPath(); g.moveTo(W / 2, W / 2); g.lineTo(x, y); g.stroke();
    g.beginPath(); g.arc(x, y, 9, 0, 2 * Math.PI); g.fill();
  }

  // ------------------------------------------------------------------ session
  async function start() {
    showVeil("Connecting…");
    if (!(await health())) {
      showVeil("The live demo is offline right now. The code to run it on your own GPU is coming with the release.", "Try again");
      return;
    }
    const j = await post("/api/join");
    if (!j.sid) { showVeil("Could not join. Please try again.", "Try again"); return; }
    sid = j.sid; n = 0;
    setMode("wm", false);
    for (;;) {
      let st;
      try { st = await (await get(`/api/status?sid=${sid}`)).json(); } catch { st = { state: "ended" }; }
      if (st.state === "playing") break;
      if (st.state === "ended") { return end("Lost the connection."); }
      showVeil(`In the queue: position ${st.position}. One player per GPU; sessions last up to ${Math.round(st.max_session_s / 60)} minutes.`);
      await new Promise((t) => setTimeout(t, 1000));
    }
    veil.hidden = true; poster.hidden = true; view.hidden = false;
    setPlaying(true);
    root.focus({ preventScroll: true });
    post("/api/control", { sid, mode });
    beat = setInterval(heartbeat, 2000);
    frameLoop(sid);
  }

  async function heartbeat() {
    if (!sid) return;
    try {
      const st = await (await get(`/api/status?sid=${sid}`)).json();
      if (st.state === "ended") return end("Session over.");
      if (st.seconds_left != null) setStatus(true, `Live · ${Math.ceil(st.seconds_left)} s left in your session`);
    } catch { /* transient */ }
  }

  async function frameLoop(mySid) {
    while (sid === mySid) {
      let r;
      try { r = await get(`/api/frame?sid=${mySid}&after=${n}`); }
      catch { await new Promise((t) => setTimeout(t, 500)); continue; }
      if (r.status === 410) return end("Session over.");
      if (r.status !== 200) continue;
      const meta = JSON.parse(r.headers.get("X-Meta"));
      const bmp = await createImageBitmap(await r.blob());
      if (sid !== mySid) return;
      ctx.drawImage(bmp, 0, 0, view.width, view.height);
      n = meta.n;
      setKind(meta.kind === "real" ? "real" : meta.mode);
      $("dream").textContent = meta.dream.toLocaleString();
      $("dreamt").textContent = `${(meta.dream * DT).toFixed(1)} s of imagined time`;
      $("lat").textContent = meta.model_ms ? `${Math.round(meta.model_ms + meta.decode_ms)} ms per frame` : " ";
      lastAction = meta.action || [0, 0];
      drawDial(lastAction);
    }
  }

  function end(msg) {
    if (beat) clearInterval(beat);
    beat = null;
    if (sid) navigator.sendBeacon?.(API + "/api/leave", JSON.stringify({ sid }));
    sid = null; held.clear(); setPlaying(false);
    showVeil(msg, "Play again");
    health();
  }

  // ------------------------------------------------------------------ input
  root.addEventListener("keydown", (e) => {
    if (!sid) return;
    const k = KEYMAP[e.key] || KEYMAP[e.key.toLowerCase()];
    if (k) { e.preventDefault(); press(k); return; }
    if (e.repeat) return;
    const c = e.key.toLowerCase();
    if (c === "m") setMode("joint");
    else if (c === "r") post("/api/control", { sid, cmd: "reset" });
    else if (c === " ") { e.preventDefault(); togglePause(); }
  });
  root.addEventListener("keyup", (e) => {
    const k = KEYMAP[e.key] || KEYMAP[e.key.toLowerCase()];
    if (k) release(k);
  });
  root.addEventListener("focusout", (e) => { if (!root.contains(e.relatedTarget)) releaseAll(); });
  document.querySelectorAll(".pad button").forEach((b) => {
    const k = b.dataset.dir;
    b.addEventListener("pointerdown", (e) => { e.preventDefault(); b.setPointerCapture(e.pointerId); b.classList.add("held"); press(k); });
    const up = () => { b.classList.remove("held"); release(k); };
    b.addEventListener("pointerup", up); b.addEventListener("pointercancel", up); b.addEventListener("lostpointercapture", up);
  });
  document.querySelectorAll(".mode").forEach((b) => b.addEventListener("click", () => { setMode(b.dataset.mode); root.focus({ preventScroll: true }); }));
  $("reset").addEventListener("click", () => { post("/api/control", { sid, cmd: "reset" }); root.focus({ preventScroll: true }); });
  function togglePause() {
    paused = !paused;
    $("pause").textContent = paused ? "Resume" : "Pause";
    post("/api/control", { sid, cmd: paused ? "pause" : "resume" });
  }
  $("pause").addEventListener("click", () => { togglePause(); root.focus({ preventScroll: true }); });
  $("start").addEventListener("click", start);
  addEventListener("pagehide", () => { if (sid) navigator.sendBeacon?.(API + "/api/leave", JSON.stringify({ sid })); });

  drawDial([0, 0]);
  health();
})();
