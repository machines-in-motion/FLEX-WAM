// FLEX-WAM project page: lazy video playback and BibTeX copy. The live demo is in demo.js.

document.addEventListener("DOMContentLoaded", () => {
  setupVideos();
  setupCopy();
});

// videos marked data-autoplay-visible play only while on screen; respect reduced motion
function setupVideos() {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const auto = document.querySelectorAll("video[autoplay], video[data-autoplay-visible]");
  if (reduce) {
    auto.forEach((v) => { v.removeAttribute("autoplay"); v.pause(); v.controls = true; });
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach(({ target, isIntersecting }) => {
      if (isIntersecting) { target.preload = "auto"; target.play().catch(() => { target.controls = true; }); }
      else target.pause();
    });
  }, { threshold: 0.25 });
  auto.forEach((v) => io.observe(v));
}

function setupCopy() {
  document.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const text = document.querySelector(btn.dataset.copy).innerText;
      try { await navigator.clipboard.writeText(text); btn.textContent = "Copied"; }
      catch { btn.textContent = "Select and copy the text"; }
      setTimeout(() => (btn.textContent = "Copy BibTeX"), 2000);
    });
  });
}
