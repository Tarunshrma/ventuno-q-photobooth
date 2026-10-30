const W = 1280;
const H = 720;

const $ = (sel) => document.querySelector(sel);
const stage = $('#stage');
const ctx = stage.getContext('2d');
const themePicker = $('#themePicker');
const shootButton = $('#shootButton');
const faceArtList = $('#faceArtList');
const settingsList = $('#settingsList');
const settingsSection = $('#settingsSection');
const promptEl = $('#prompt');
const guideEl = $('#guide');
const countdownEl = $('#countdown');
const flashEl = $('#flash');
const statusEl = $('#status');
const reviewEl = $('#review');
const reviewImage = $('#reviewImage');
const reviewDownload = $('#reviewDownload');
const gallery = $('#gallery');
const stageArea = $('#stageArea');
const stageWrap = $('#stageWrap');
const gestureMeter = $('#gestureMeter');
const gestureIcon = $('#gestureIcon');
const gestureFill = $('#gestureFill');

const GESTURE_ICONS = { victory: '✌️', namaste: '🙏' };
const propColumns = { left: $('#propLeft'), right: $('#propRight') };
const controllerBadge = $('#controllerBadge');

const cutout = new Cutout(W, H);
const faceSmoother = new FaceSmoother();

let themeDef = null;
let theme = null;
let settings = {};
let faceArt = new Set();
let busy = false;
let toast = null;
let lastTime = performance.now() / 1000;
let feedStatus = 'starting';
let lastFrameAt = 0;
let coverage = 0;
let photosTaken = 0;
let reviewTimer = null;
let gestureNow = { gesture: null, hold: 0 };
let lastEventId = null; // last gesture event handled
let reviewedPhoto = null; // photo currently shown in the review screen

// Is someone in the picture? (debounced so the prompt doesn't flicker)
const presence = { present: false, changedAt: 0 };

const store = {
  get(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(`photobooth-${key}`) ?? 'null') ?? fallback;
    } catch {
      return fallback;
    }
  },
  set: (key, value) => localStorage.setItem(`photobooth-${key}`, JSON.stringify(value)),
};

// ---------- Themes ----------

function setTheme(id) {
  themeDef = PhotoboothThemes.get(id) || PhotoboothThemes.list()[0];
  store.set('theme', themeDef.id);
  document.documentElement.style.setProperty('--accent', themeDef.accent || '#ffb300');
  for (const btn of themePicker.children) btn.classList.toggle('active', btn.dataset.theme === themeDef.id);

  settings = buildSettings(themeDef);
  theme = themeDef.create(W, H, settings);
  buildFaceArt(themeDef);
  $('#tapHint').textContent = themeDef.tapHint || '';
  $('#tapHint').hidden = !themeDef.tapHint;
  buildGestureList();
  preloadVoice(themeDef);
  applyAudioState();
}

/** The gesture cheat-sheet in the side panel, worded for the current theme. */
function buildGestureList() {
  const rows = [
    ['✌️ 🙏', 'Take a photo', 'hold it for a moment'],
    ['👍', themeDef.finaleName || 'Grand finale', 'right after a photo: print it (the agent pays)'],
    theme.onTap && ['☝️', themeDef.pointName || 'Effect', 'right where you point'],
    themeDef.faceArt?.length && ['👉', 'Add or remove a prop', 'point your fingertip into a round tile at the side and hold until its ring fills'],
    themeDef.faceArt?.length && ['👎', 'Remove all props', ''],
    PhotoboothThemes.list().length > 1 && ['🤟', 'Switch theme', ''],
  ].filter(Boolean);
  $('#gestureList').innerHTML = rows
    .map(([icon, what, note]) => `<li><span>${icon}</span><div><b>${what}</b>${note ? `<small>${note}</small>` : ''}</div></li>`)
    .join('');
}

function buildThemePicker() {
  for (const def of PhotoboothThemes.list()) {
    const btn = document.createElement('button');
    btn.dataset.theme = def.id;
    btn.textContent = `${def.emoji} ${def.name}`;
    btn.onclick = () => setTheme(def.id);
    themePicker.appendChild(btn);
  }
}

/** Builds the theme's controls and returns the live settings object. */
function buildSettings(def) {
  const key = `settings-${def.id}`;
  const values = { ...Object.fromEntries((def.settings || []).map((s) => [s.id, s.value])), ...store.get(key, {}) };
  const save = () => store.set(key, values);

  settingsList.innerHTML = '';
  for (const s of def.settings || []) {
    const row = document.createElement('label');
    row.className = `setting setting-${s.type}`;
    const title = document.createElement('span');
    title.textContent = s.label;
    row.appendChild(title);

    const input = document.createElement('input');
    if (s.type === 'toggle') {
      input.type = 'checkbox';
      input.checked = !!values[s.id];
      input.onchange = () => {
        values[s.id] = input.checked;
        save();
      };
      row.prepend(input);
    } else if (s.type === 'range') {
      const out = document.createElement('em');
      const show = () => (out.textContent = s.labels?.[values[s.id]] ?? values[s.id]);
      Object.assign(input, { type: 'range', min: s.min, max: s.max, step: s.step ?? 1, value: values[s.id] });
      input.oninput = () => {
        values[s.id] = Number(input.value);
        show();
        save();
      };
      show();
      title.appendChild(out);
      row.appendChild(input);
    } else {
      Object.assign(input, { type: 'text', maxLength: s.maxLength ?? 40, value: values[s.id] ?? '' });
      input.oninput = () => {
        values[s.id] = input.value;
        save();
      };
      row.appendChild(input);
    }
    settingsList.appendChild(row);
  }
  return values;
}

function buildFaceArt(def) {
  const items = def.faceArt || [];
  faceArt = new Set(store.get(`faceart-${def.id}`, []).filter((id) => items.some((a) => a.id === id)));
  faceArtList.innerHTML = '';
  propColumns.left.innerHTML = '';
  propColumns.right.innerHTML = '';
  $('#faceArtSection').hidden = !items.length;

  items.forEach((art, i) => {
    // Side-panel chip (mouse / touch)
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.dataset.prop = art.id;
    chip.textContent = `${art.emoji} ${art.label}`;
    chip.onclick = () => toggleFaceArt(art.id);
    faceArtList.appendChild(chip);

    // On-picture tiles: 3 on the left, 3 on the right, picked by pointing a fingertip into them
    if (i >= TILES_PER_SIDE * 2) return;
    const column = i < TILES_PER_SIDE ? propColumns.left : propColumns.right;
    const tile = document.createElement('div');
    tile.className = 'prop-tile';
    tile.dataset.prop = art.id;
    tile.innerHTML = `<div class="ring"></div><span class="emoji">${art.emoji}</span><small>${art.label}</small>`;
    tile.onclick = () => toggleFaceArt(art.id);
    column.appendChild(tile);
  });
  propColumns.left.hidden = !propColumns.left.children.length;
  propColumns.right.hidden = !propColumns.right.children.length;
  syncFaceArtUI();
}

function syncFaceArtUI() {
  document.querySelectorAll('[data-prop]').forEach((el) => el.classList.toggle('active', faceArt.has(el.dataset.prop)));
  store.set(`faceart-${themeDef.id}`, [...faceArt]);
}

function toggleFaceArt(id) {
  const art = themeDef.faceArt?.find((a) => a.id === id);
  if (!art) return;
  const on = !faceArt.has(id);
  on ? faceArt.add(id) : faceArt.delete(id);
  syncFaceArtUI();
  showToast(`${art.emoji} ${art.label} ${on ? 'on' : 'off'}`, 1200);
  if (on) Sfx.chime();
  Narrator.activity();
  Narrator.say(on ? `${art.label} on! Looking great.` : `${art.label} removed.`);
}

function clearFaceArt() {
  if (!faceArt.size) return;
  faceArt.clear();
  syncFaceArtUI();
  showToast('👎 All props removed', 1500);
  Narrator.activity();
  Narrator.say('All props removed.');
}

// ---------- Pointing: hold the controller's fingertip inside a round tile ----------

const TILES_PER_SIDE = 3;
const DWELL_MS = 2000; // the tile's ring fills over this time, then the prop toggles
const JITTER_GRACE_MS = 150; // tolerate a single shaky frame outside the circle
const handCursors = [];
// tile being filled; `locked` = tile just toggled, until the fingertip leaves it
const dwell = { tile: null, since: 0, seenAt: 0, locked: null };

function updateHands(hands, mapPoint) {
  const wrap = stageWrap.getBoundingClientRect();
  const scale = wrap.width / W;
  const tiles = [...document.querySelectorAll('.prop-column:not([hidden]) .prop-tile')];
  const now = performance.now();
  let target = null;

  hands.forEach((hand, i) => {
    const p = mapPoint({ x: hand.pos[0], y: hand.pos[1] });
    const x = p.x * scale;
    const y = p.y * scale;

    // Fingertip cursor
    let cursor = handCursors[i];
    if (!cursor) {
      cursor = document.createElement('div');
      cursor.className = 'hand-cursor';
      stageWrap.appendChild(cursor);
      handCursors[i] = cursor;
    }
    cursor.hidden = false;
    cursor.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;

    // Inside a round tile? (a tile that is already popped out is bigger, which gives some hysteresis)
    const hit = tiles.find((t) => {
      const r = t.getBoundingClientRect();
      const cx = r.left + r.width / 2 - wrap.left;
      const cy = r.top + r.height / 2 - wrap.top;
      return Math.hypot(x - cx, y - cy) <= r.width / 2;
    });
    if (hit && !target) target = hit;
  });
  handCursors.slice(hands.length).forEach((c) => (c.hidden = true));

  // One shaky frame outside the circle shouldn't cancel the fill; leaving for longer resets it
  if (target) dwell.seenAt = now;
  else if (dwell.tile && now - dwell.seenAt < JITTER_GRACE_MS) target = dwell.tile;
  if (target && target !== dwell.tile) {
    dwell.tile = target;
    dwell.since = now;
  }
  if (!target) dwell.tile = null;
  if (dwell.locked && dwell.locked !== target) dwell.locked = null;

  for (const t of document.querySelectorAll('.prop-tile')) {
    const filling = t === target && t !== dwell.locked && !busy;
    t.classList.toggle('hover', filling);
    t.style.setProperty('--progress', filling ? Math.min(1, (now - dwell.since) / DWELL_MS).toFixed(3) : '0');
  }
  if (target && target !== dwell.locked && !busy && now - dwell.since >= DWELL_MS) {
    dwell.locked = target;
    toggleFaceArt(target.dataset.prop);
  }
}

/** "In control" badge above the controller's head, shown when more than one person is in view. */
function updateControllerBadge(index) {
  const faces = faceSmoother.faces;
  const face = index !== null && index !== undefined ? faces[index] : null;
  controllerBadge.hidden = !face || faces.length < 2;
  if (controllerBadge.hidden) return;
  const scale = stageWrap.getBoundingClientRect().width / W;
  const top = face.foreheadTop;
  controllerBadge.style.transform = `translate(${top.x * scale}px, ${(top.y - face.width * 0.55) * scale}px) translate(-50%, -100%)`;
}

// ---------- Frames from the board ----------

function onFrame(bitmap, meta) {
  cutout.update(bitmap, meta);
  bitmap.close();

  const [rx, ry, rw, rh] = cutout.rect;
  const mapPoint = (p) => ({ x: W - (rx + p.x * rw), y: ry + p.y * rh }); // mirrored like the picture
  faceSmoother.update(meta.faces || [], mapPoint);

  coverage = meta.coverage;
  feedStatus = 'ok';
  lastFrameAt = performance.now();

  // Gesture recognition runs on the board's NPU and reports held gestures as events
  gestureNow = { gesture: meta.gesture, hold: meta.hold || 0 };
  if (lastEventId === null) lastEventId = meta.eventId; // ignore events from before the page loaded
  for (const ev of meta.events || []) {
    if (ev.id <= lastEventId) continue;
    lastEventId = ev.id;
    handleGesture(ev, mapPoint);
  }
  updateHands(meta.hands || [], mapPoint);
  updateControllerBadge(meta.controller);
  updateVoice(meta.voice);
}

// ---------- Booth voice (on-board Piper speech + Whisper listening) ----------

const voiceSubtitle = $('#voiceSubtitle');
const voiceStatus = $('#voiceStatus');
const voiceToggle = $('#voiceToggle');
const SUBTITLE_MS = 7000;

function say(text, low = false) {
  fetch('/voice/say', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, low }),
  }).catch(() => {});
}

/** Ask the board to pre-generate everything this theme may say, so it plays instantly. */
function preloadVoice(def) {
  const v = def.voice || {};
  const lines = [v.welcome, ...(v.hints || []), v.countdown, v.afterPhoto, v.finale, v.themeIntro, v.bye];
  for (const art of def.faceArt || []) lines.push(`${art.label} on! Looking great.`, `${art.label} removed.`);
  lines.push(
    'All props removed.',
    'Take a photo first. Show a V sign, or say: booth, take a photo.',
    'Great choice! Scan the QR code on the screen with your Rabby wallet, and approve the payment. No gas needed.',
    'Great choice! My booth agent is now buying your print from the printer agent, paid in U S D C on the X D C network.',
    'Wallet connected! Please approve the payment on your phone.',
    'Payment confirmed on the X D C network!',
    'Your print is ready! Collect it at the printer.',
    "Hmm, the payment didn't go through. Let's try again.",
    'Sorry, I could not start the print. Please try again.'
  );
  for (const other of PhotoboothThemes.list()) if (other.voice?.themeIntro) lines.push(other.voice.themeIntro);
  fetch('/voice/preload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ texts: lines.filter(Boolean) }),
  }).catch(() => {});
}

// The board synthesizes each sentence as a WAV clip; this page plays them in order, so the
// voice comes out of this screen's audio (HDMI monitor, Bluetooth speaker, laptop speakers).
const voiceHere = $('#voiceHere');
voiceHere.checked = store.get('voice-here', true);
voiceHere.onchange = () => store.set('voice-here', voiceHere.checked);
const clipQueue = [];
let lastClipId = null;
let clipPlaying = false;

function queueClips(clips) {
  if (lastClipId === null) {
    lastClipId = clips.at(-1)?.id ?? 0; // don't replay what was said before this page opened
    return;
  }
  for (const clip of clips) {
    if (clip.id > lastClipId) {
      lastClipId = clip.id;
      if (voiceHere.checked) clipQueue.push(clip.id);
    }
  }
  playNextClip();
}

function playNextClip() {
  if (clipPlaying || !clipQueue.length) return;
  clipPlaying = true;
  const audio = new Audio(`/voice/clip/${clipQueue.shift()}`);
  const next = () => {
    clipPlaying = false;
    playNextClip();
  };
  audio.onended = next;
  audio.onerror = next;
  audio.play().catch((err) => {
    if (err.name === 'NotAllowedError') showToast('🔇 Click anywhere on this page to let the booth talk.', 4000);
    next();
  });
}

/** Subtitles of what the booth says and hears, plus the status line in the panel. */
function updateVoice(v) {
  if (!v) return;
  if (voiceToggle.checked !== v.enabled) {
    voiceToggle.checked = v.enabled; // muted/unmuted from another screen
    applyAudioState();
  }
  Narrator.voiceBusy = !!v.speaking || clipPlaying || clipQueue.length > 0;
  Sfx.duck(Narrator.voiceBusy);
  if (v.clips) queueClips(v.clips);
  const parts = [
    v.speaker ? (voiceHere.checked ? '🔊 voice plays on this screen' : '🔊 voice on (muted on this screen)') : '🔇 voice starting…',
    v.mic ? '🎤 listening (say “booth, …”)' : '🎙️ no microphone',
  ];
  voiceStatus.textContent = v.enabled ? parts.join(' · ') : 'Voice is off.';

  const now = Date.now() / 1000;
  const said = v.said?.t && now - v.said.t < SUBTITLE_MS / 1000 ? v.said.text : '';
  const heard = v.heard?.t && now - v.heard.t < 4 ? v.heard.text : '';
  let html = '';
  if (said) html += `<div class="said">🔊 ${escapeHtml(said)}</div>`;
  if (heard) html += `<div class="heard">🎤 “${escapeHtml(heard)}”${v.heard.command ? ' ✓' : ''}</div>`;
  voiceSubtitle.innerHTML = html;
  voiceSubtitle.hidden = !html || !v.enabled;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

// Sound effects follow the same "play on this screen" switch as the voice
Sfx.setEnabled(() => voiceHere.checked && voiceToggle.checked);

// ---------- Mute: silences voice, effects and ambience, and hides spoken-instruction overlays ----------

const muteButton = $('#muteButton');

/** Bring ambience, the mute button and overlays in line with the voice switches. */
function applyAudioState() {
  const on = voiceToggle.checked;
  muteButton.textContent = on ? '🔊' : '🔇';
  muteButton.classList.toggle('muted', !on);
  document.body.classList.toggle('muted', !on);
  Sfx.ambient(on && voiceHere.checked ? themeDef?.ambient : null);
  if (!on) {
    clipQueue.length = 0; // drop anything still waiting to be played
  }
}

function setVoiceEnabled(on) {
  voiceToggle.checked = on;
  applyAudioState();
  fetch('/voice/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: on }),
  }).catch(() => {});
}

muteButton.onclick = () => setVoiceEnabled(!voiceToggle.checked);
voiceHere.addEventListener('change', applyAudioState);
// Browsers only allow sound after the first interaction: start the ambience then
document.addEventListener('pointerdown', () => applyAudioState(), { once: true });

// Speak the payment progress (the Claude voice mode is narrated on the board itself)
Agent.onStep((ev, mode) => {
  if (mode === 'claude') return;
  if (ev.phase === 'error') Narrator.say("Hmm, the payment didn't go through. Let's try again.");
  else if (ev.step === 'connect' && ev.phase === 'done') Narrator.say('Wallet connected! Please approve the payment on your phone.');
  else if (ev.step === 'settle' && ev.phase === 'done') Narrator.say('Payment confirmed on the X D C network!');
  else if (ev.step === 'print' && ev.phase === 'done') Narrator.say('Your print is ready! Collect it at the printer.');
});

voiceToggle.onchange = () => setVoiceEnabled(voiceToggle.checked);

function handleGesture(ev, mapPoint) {
  Narrator.activity();
  if (ev.action === 'finale' && Agent.awaitingReady) {
    Agent.signal('ready'); // 👍 = "my Claude is listening"
  } else if (ev.action === 'photo') {
    takePhoto();
  } else if (ev.action === 'print') {
    if (!reviewEl.hidden) printReviewedPhoto();
    else if (!ev.greeting) Narrator.say('Take a photo first. Show a V sign, or say: booth, take a photo.');
    // a festive greeting with no photo waiting is just someone saying Happy Diwali: ignore it
  } else if (ev.action === 'theme' && ev.value && !busy) {
    const def = PhotoboothThemes.get(ev.value);
    if (def) switchTheme(def, '🎤');
  } else if (ev.action === 'finale' && !reviewEl.hidden) {
    printReviewedPhoto(); // 👍 while looking at the photo = "yes, print it"
  } else if (ev.action === 'finale' && !busy) {
    theme.celebrate?.();
    showToast(`👍 ${themeDef.finaleName || 'Grand finale'}!`, 2000);
    Narrator.say(themeDef.voice?.finale, { low: true });
  } else if (ev.action === 'clear') {
    clearFaceArt();
  } else if (ev.action === 'spark' && ev.pos) {
    const p = mapPoint({ x: ev.pos[0], y: ev.pos[1] });
    theme.onTap?.(p.x, Math.max(0, p.y - 20));
  } else if (ev.action === 'theme' && !busy) {
    const all = PhotoboothThemes.list();
    switchTheme(all[(all.indexOf(themeDef) + 1) % all.length], '🤟');
  }
}

function switchTheme(def, icon) {
  setTheme(def.id);
  showToast(`${icon} Switched to ${def.emoji} ${def.name}`, 2000);
  Narrator.say(def.voice?.themeIntro || `Switching to ${def.name}!`);
}

function updatePresence(now) {
  const seen = feedStatus === 'ok' && (coverage > 0.04 || faceSmoother.faces.length > 0);
  if (seen !== presence.present) {
    // appear quickly, disappear slowly
    if (now - presence.changedAt > (seen ? 0.4 : 2.5)) {
      presence.present = seen;
      presence.changedAt = now;
      seen ? Narrator.arrived() : Narrator.left();
    }
  } else {
    presence.changedAt = now;
  }
  Narrator.tick(presence.present);
}

// ---------- Narrator: keeps the guest guided with short spoken lines ----------

const Narrator = {
  lastSaid: 0,
  lastActivity: 0,
  hintIndex: 0,
  greetedAt: -Infinity,
  interacted: false,
  voiceBusy: false,
  IDLE_HINT_MS: 18000, // speak a hint after this long without anything happening
  MIN_GAP_MS: 9000, // low-priority lines need this much quiet first

  /** Speak a line; low-priority lines are skipped if the booth is talking or spoke recently. */
  say(text, { low = false } = {}) {
    if (!text) return;
    const now = performance.now();
    if (low && (this.voiceBusy || now - this.lastSaid < this.MIN_GAP_MS)) return;
    this.lastSaid = now;
    say(text, low);
  },

  activity() {
    this.lastActivity = performance.now();
    this.interacted = true;
  },

  arrived() {
    const now = performance.now();
    this.lastActivity = now;
    if (now - this.greetedAt > 60000) {
      this.greetedAt = now;
      this.interacted = false;
      this.say(themeDef.voice?.welcome || 'Welcome to the photobooth!');
    }
  },

  left() {
    if (this.interacted && !busy && !Agent.busy) this.say(themeDef.voice?.bye, { low: true });
    this.interacted = false;
  },

  /** Idle hints, rotating, while someone is in view and nothing is happening. */
  tick(present) {
    const now = performance.now();
    if (!present || busy || !reviewEl.hidden || Agent.busy || this.voiceBusy) return;
    if (now - this.lastActivity < this.IDLE_HINT_MS || now - this.lastSaid < this.IDLE_HINT_MS) return;
    const hints = themeDef.voice?.hints || [];
    if (!hints.length) return;
    this.say(hints[this.hintIndex++ % hints.length], { low: true });
    this.lastActivity = now;
  },
};

// ---------- Rendering ----------

function render(nowMs) {
  const now = nowMs / 1000;
  const dt = Math.min(0.05, Math.max(0, now - lastTime));
  lastTime = now;

  theme.drawBackground(ctx, now, dt);
  drawBranding(ctx, W, now);

  if (cutout.ready) {
    // Mirror the picture like a real mirror
    ctx.save();
    ctx.translate(W, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(cutout.canvas, 0, 0);
    ctx.restore();
    drawFaceArt(now);
  }

  theme.drawForeground(ctx, now, dt);

  if (feedStatus === 'ok' && performance.now() - lastFrameAt > 3000) feedStatus = 'starting';
  updatePresence(now);
  updateOverlays();
  requestAnimationFrame(render);
}

function drawFaceArt(now) {
  if (!faceArt.size) return;
  const arts = (themeDef.faceArt || []).filter((a) => faceArt.has(a.id));
  for (const face of faceSmoother.faces) {
    for (const art of arts) {
      ctx.save();
      art.draw(ctx, face, now);
      ctx.restore();
    }
  }
}

function updateOverlays() {
  const reviewing = !reviewEl.hidden;
  const live = feedStatus === 'ok';

  promptEl.hidden = !live || busy || reviewing || presence.present;

  const holding = live && !busy && GESTURE_ICONS[gestureNow.gesture];
  gestureMeter.hidden = !holding;
  if (holding) {
    gestureIcon.textContent = GESTURE_ICONS[gestureNow.gesture];
    gestureFill.style.width = `${Math.round(gestureNow.hold * 100)}%`;
  }

  let guide = '';
  if (live && !busy && !reviewing && !holding && presence.present) {
    guide =
      photosTaken === 0
        ? '✅ We can see you! Show ✌️ or 🙏 to the camera to take a photo.'
        : '📸 Another one? Show ✌️ or 🙏 again — try new face art on the right!';
  }
  guideEl.textContent = guide;
  guideEl.hidden = !guide;

  let status = '';
  if (toast && performance.now() < toast.until) status = toast.text;
  else if (feedStatus === 'missing') status = '📷 No camera found. Plug the USB camera into the board.';
  else if (feedStatus === 'offline') status = 'Lost connection to the board. Retrying…';
  else if (feedStatus === 'starting') status = 'Starting the camera…';
  statusEl.textContent = status;
  statusEl.hidden = !status;
}

function showToast(text, ms) {
  toast = { text, until: performance.now() + ms };
}

function showCountdown(value, label = '') {
  countdownEl.innerHTML = `<span>${value}</span>${label ? `<small>${label}</small>` : ''}`;
  countdownEl.classList.remove('pop');
  void countdownEl.offsetWidth; // restart animation
  countdownEl.classList.add('pop');
  countdownEl.hidden = false;
}

// ---------- Taking photos ----------

async function takePhoto() {
  if (busy) return;
  closeReview();
  busy = true;
  shootButton.disabled = true;

  const phrases = themeDef.countdown || ['Get ready!', 'Strike a pose!', 'Smile!'];
  Narrator.activity();
  Narrator.say(themeDef.voice?.countdown || 'Get ready! Three, two, one!');
  for (let i = 3; i > 0; i--) {
    showCountdown(i, phrases[3 - i] ?? '');
    if (i === 1) theme.celebrate?.(); // bursts land right as the photo is taken
    await sleep(1000);
  }
  countdownEl.hidden = true;

  const dataUrl = stage.toDataURL('image/jpeg', 0.9);
  Sfx.shutter();
  flashEl.classList.remove('flash');
  void flashEl.offsetWidth;
  flashEl.classList.add('flash');

  const filename = `${themeDef.id}_${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`;
  addToGallery(dataUrl, filename);
  photosTaken++;
  openReview(dataUrl, filename);
  Narrator.say(themeDef.voice?.afterPhoto || 'Lovely photo! Show a thumbs up to print it.');

  shootButton.disabled = false;
  busy = false;

  try {
    const res = await fetch('/photo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: dataUrl, theme: themeDef.id }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    console.error(err);
    showToast('Saving the photo on the board failed — use Download to keep it.', 4000);
  }
}

async function printReviewedPhoto() {
  if (!reviewedPhoto || Agent.busy) return;
  const photo = reviewedPhoto;
  closeReview();
  Narrator.activity();
  if (await Agent.print(photo, themeDef.id)) {
    showToast('🖨️ The Booth Agent is buying your print…', 2500);
    // The voice (Claude) mode narrates on the board itself; the other modes are narrated here
    const lines = {
      guest: 'Great choice! Scan the QR code on the screen with your Rabby wallet, and approve the payment. No gas needed.',
      booth: 'Great choice! My booth agent is now buying your print from the printer agent, paid in U S D C on the X D C network.',
    };
    Narrator.say(lines[Agent.paymentMode]);
  } else {
    showToast('Could not start the print. Please try again.', 3000);
    Narrator.say('Sorry, I could not start the print. Please try again.');
  }
}

function openReview(dataUrl, filename) {
  reviewedPhoto = dataUrl;
  const phrase = themeDef.voice?.printPhrase;
  $('#reviewPrint').textContent = phrase ? `🖨️ Print: say “${phrase}!” or 👍` : '🖨️ Print it: show 👍';
  reviewImage.src = dataUrl;
  reviewDownload.href = dataUrl;
  reviewDownload.download = filename;
  reviewEl.hidden = false;
  clearTimeout(reviewTimer);
  reviewTimer = setTimeout(closeReview, 15000);
}

function closeReview() {
  clearTimeout(reviewTimer);
  reviewEl.hidden = true;
}

function addToGallery(dataUrl, filename) {
  gallery.querySelector('.empty')?.remove();
  const item = document.createElement('a');
  item.href = dataUrl;
  item.download = filename;
  item.title = 'Click to download';
  item.innerHTML = `<img src="${dataUrl}" alt="Photo" /><span>⬇</span>`;
  gallery.prepend(item);
}

// ---------- Start ----------

/** Size the picture to fit the space next to the panel, keeping 16:9. */
function fitStage() {
  const aw = stageArea.clientWidth;
  const ah = stageArea.clientHeight;
  let w = aw;
  let h = (aw * 9) / 16;
  if (h > ah) {
    h = ah;
    w = (ah * 16) / 9;
  }
  stageWrap.style.width = `${Math.floor(w)}px`;
  stageWrap.style.height = `${Math.floor(h)}px`;
}
new ResizeObserver(fitStage).observe(stageArea);
fitStage();

stage.addEventListener('pointerdown', (e) => {
  const r = stage.getBoundingClientRect();
  theme.onTap?.(((e.clientX - r.left) * W) / r.width, ((e.clientY - r.top) * H) / r.height);
});
const brandingToggle = $('#brandingToggle');
$('#brandingLabel').textContent = `${EVENT_BRANDING.name} badge`;
brandingToggle.checked = EVENT_BRANDING.enabled = store.get('branding', EVENT_BRANDING.enabled);
brandingToggle.onchange = () => store.set('branding', (EVENT_BRANDING.enabled = brandingToggle.checked));
shootButton.onclick = takePhoto;
$('#reviewAgain').onclick = takePhoto;
$('#reviewPrint').onclick = printReviewedPhoto;
reviewDownload.addEventListener('click', () => setTimeout(closeReview, 300));
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !['INPUT', 'BUTTON', 'SELECT'].includes(e.target.tagName)) {
    e.preventDefault();
    takePhoto();
  }
});

buildThemePicker();
setTheme(store.get('theme', null));
new BoardFeed(onFrame, (status) => (feedStatus = status)).start();
requestAnimationFrame(render);
