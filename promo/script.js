const scenes = Array.from(document.querySelectorAll(".scene"));
const dots = Array.from(document.querySelectorAll(".scene-dot"));
const previousButton = document.querySelector(".previous-button");
const nextButton = document.querySelector(".next-button");
const playButton = document.querySelector(".play-button");
const sceneStatus = document.querySelector(".scene-status");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const sceneNames = [
  "Introducing Algebrium",
  "Ask naturally",
  "Tools in motion",
  "Understand deeply",
  "See mathematics come alive",
  "Agent with Computer Algebra System",
  "Learn from mistakes",
  "Agent for Mathematics",
];

const typingOutput = document.querySelector(".typing-output");
const typingCaret = document.querySelector(".typing-caret");
const typingText = "Solve ∫x eˣ dx and verify each step. Plot y = x eˣ, draw a circle centered at the origin with radius 3, and visualize z = x² + y².";
const typingDelay = 28;
const exitDuration = 420;

let currentScene = 0;
let timerId = null;
let exitTimerId = null;
let sceneStartedAt = performance.now();
let remainingTime = Number(scenes[0].dataset.duration);
let isPaused = reduceMotion.matches;
let hasEnded = false;
let wheelLocked = false;
let touchStartY = null;
let typingTimerId = null;
let typedCharacters = 0;

function stopTyping() {
  window.clearTimeout(typingTimerId);
  typingTimerId = null;
}

function typeNextCharacter() {
  if (isPaused || currentScene !== 1 || typedCharacters >= typingText.length) return;
  const character = document.createElement("span");
  character.className = "typing-char";
  character.textContent = typingText[typedCharacters];
  typingOutput.append(character);
  typedCharacters += 1;
  typingCaret.classList.remove("is-stepping");
  void typingCaret.offsetWidth;
  typingCaret.classList.add("is-stepping");
  typingTimerId = window.setTimeout(typeNextCharacter, typingDelay);
}

function startTyping({ restart = false } = {}) {
  stopTyping();
  if (restart) {
    typedCharacters = 0;
    typingOutput.replaceChildren();
  }
  if (reduceMotion.matches) {
    typedCharacters = typingText.length;
    typingOutput.textContent = typingText;
    return;
  }
  if (!isPaused && currentScene === 1) {
    typingTimerId = window.setTimeout(typeNextCharacter, restart ? 500 : typingDelay);
  }
}

function durationFor(index) {
  return Number(scenes[index].dataset.duration) || 7000;
}

function restartSceneAnimation(scene) {
  scene.classList.remove("is-active");
  void scene.offsetWidth;
  scene.classList.add("is-active");
}

function updatePlaybackState() {
  document.body.classList.toggle("is-paused", isPaused);
  document.body.classList.toggle("has-ended", hasEnded);

  if (hasEnded) {
    playButton.setAttribute("aria-label", "Replay animation");
  } else if (isPaused) {
    playButton.setAttribute("aria-label", "Play animation");
  } else {
    playButton.setAttribute("aria-label", "Pause animation");
  }
}

function announceScene() {
  sceneStatus.textContent = `Scene ${currentScene + 1} of ${scenes.length}: ${sceneNames[currentScene]}`;
}

function clearSceneTimers() {
  window.clearTimeout(timerId);
  window.clearTimeout(exitTimerId);
  timerId = null;
  exitTimerId = null;
}

function scheduleAdvance(duration = durationFor(currentScene)) {
  clearSceneTimers();
  remainingTime = duration;
  sceneStartedAt = performance.now();

  if (isPaused || reduceMotion.matches) {
    return;
  }

  if (currentScene < scenes.length - 1) {
    exitTimerId = window.setTimeout(() => {
      scenes[currentScene].classList.add("is-exiting");
    }, Math.max(0, duration - exitDuration));
  }

  timerId = window.setTimeout(() => {
    if (currentScene === scenes.length - 1) {
      hasEnded = true;
      isPaused = true;
      updatePlaybackState();
    } else {
      showScene(currentScene + 1);
    }
  }, duration);
}

function showScene(index, { announce = true, restart = true } = {}) {
  const nextIndex = Math.max(0, Math.min(index, scenes.length - 1));
  clearSceneTimers();
  currentScene = nextIndex;
  hasEnded = false;
  stopTyping();

  scenes.forEach((scene, sceneIndex) => {
    scene.classList.remove("is-before", "is-after", "is-active", "is-exiting");
    if (sceneIndex < currentScene) scene.classList.add("is-before");
    if (sceneIndex > currentScene) scene.classList.add("is-after");
  });

  if (restart) {
    restartSceneAnimation(scenes[currentScene]);
  } else {
    scenes[currentScene].classList.add("is-active");
  }

  dots.forEach((dot, dotIndex) => {
    const active = dotIndex === currentScene;
    dot.classList.toggle("is-current", active);
    dot.setAttribute("aria-selected", String(active));
    dot.toggleAttribute("aria-current", active);
  });

  document.body.dataset.scene = String(currentScene);
  remainingTime = durationFor(currentScene);
  sceneStartedAt = performance.now();

  scheduleAdvance(remainingTime);

  updatePlaybackState();
  if (currentScene === 1) startTyping({ restart: true });
  if (announce) announceScene();
}

function pause() {
  if (isPaused) return;
  const elapsed = performance.now() - sceneStartedAt;
  remainingTime = Math.max(0, remainingTime - elapsed);
  clearSceneTimers();
  stopTyping();
  isPaused = true;
  updatePlaybackState();
}

function play() {
  if (hasEnded) {
    isPaused = false;
    hasEnded = false;
    showScene(0);
    return;
  }

  if (!isPaused) return;
  isPaused = false;
  updatePlaybackState();

  if (currentScene === 1) startTyping();

  if (currentScene === scenes.length - 1) {
    showScene(currentScene);
    return;
  }

  scheduleAdvance(remainingTime || durationFor(currentScene));
}

function togglePlayback() {
  if (isPaused || hasEnded) play();
  else pause();
}

function moveScene(delta) {
  const target = currentScene + delta;
  if (target < 0) {
    showScene(0);
    return;
  }

  if (target >= scenes.length) {
    hasEnded = true;
    isPaused = true;
    updatePlaybackState();
    return;
  }

  showScene(target);
}

previousButton.addEventListener("click", () => moveScene(-1));
nextButton.addEventListener("click", () => moveScene(1));
playButton.addEventListener("click", togglePlayback);

dots.forEach((dot, index) => {
  dot.addEventListener("click", () => showScene(index));
});

document.addEventListener("keydown", (event) => {
  if (event.key === "ArrowRight" || event.key === "PageDown") {
    event.preventDefault();
    moveScene(1);
  }

  if (event.key === "ArrowLeft" || event.key === "PageUp") {
    event.preventDefault();
    moveScene(-1);
  }

  if (event.code === "Space") {
    event.preventDefault();
    togglePlayback();
  }

  if (event.key === "Home") {
    event.preventDefault();
    showScene(0);
  }

  if (event.key === "End") {
    event.preventDefault();
    showScene(scenes.length - 1);
  }
});

document.addEventListener(
  "wheel",
  (event) => {
    if (wheelLocked || Math.abs(event.deltaY) < 18) return;
    wheelLocked = true;
    moveScene(event.deltaY > 0 ? 1 : -1);
    window.setTimeout(() => {
      wheelLocked = false;
    }, 950);
  },
  { passive: true },
);

document.addEventListener(
  "touchstart",
  (event) => {
    touchStartY = event.touches[0]?.clientY ?? null;
  },
  { passive: true },
);

document.addEventListener(
  "touchend",
  (event) => {
    if (touchStartY === null) return;
    const endY = event.changedTouches[0]?.clientY ?? touchStartY;
    const distance = touchStartY - endY;
    touchStartY = null;
    if (Math.abs(distance) > 48) moveScene(distance > 0 ? 1 : -1);
  },
  { passive: true },
);

document.addEventListener("visibilitychange", () => {
  if (document.hidden) pause();
});

reduceMotion.addEventListener("change", (event) => {
  if (event.matches) {
    pause();
  }
});

document.body.dataset.scene = "0";
updatePlaybackState();
showScene(0, { announce: false });
