const POSTCARDS = [
  { image: 'city', title: ['One city.', 'Endless drives.'], description: "From the old city's tight corners to the open boulevard. Find your own rhythm on the streets of Baku.", fact: '6.003 KM OF CITY STREETS', mood: 'YOUR ROUTE. YOUR PACE.', label: 'THE CITY COLLECTION', name: 'Baku, behind the wheel.' },
  { image: 'night', title: ['After dark.', 'A new perspective.'], description: 'The city changes when the sun goes down. Switch on your headlights and see familiar streets in a different light.', fact: 'DAY & NIGHT DRIVING', mood: 'FOLLOW THE LIGHT.', label: 'THE NIGHT COLLECTION', name: 'The boulevard after hours.' },
  { image: 'weather', title: ['Feel the road.', 'Read the weather.'], description: 'Clear skies, wet asphalt, falling rain or snow. Change the atmosphere and find a new way to experience the city.', fact: 'FIVE WEATHER SETTINGS', mood: 'EVERY DRIVE FEELS DIFFERENT.', label: 'THE ATMOSPHERE COLLECTION', name: 'A change in the air.' },
  { image: 'garage', title: ['Your car.', 'Your character.'], description: 'A high-revving supercar, a city sedan, an AMG or a Prado. Choose your ride, pick your paint, and make the drive your own.', fact: 'FOUR DISTINCT RIDES', mood: 'MAKE IT YOURS.', label: 'THE GARAGE COLLECTION', name: 'A different kind of presence.' },
];
const TIPS = [
  'Smooth steering. Clean exits. Let the city come to you.',
  'Press C to switch between the follow camera and a view over the hood.',
  'Choose your car and paint finish in the garage before heading out.',
  'Press L to cycle low beams, high beams, and lights off.',
  'Ease off before the old city’s tighter corners. Look ahead to the exit.',
  'Press T for a manual gearbox, then shift with Q and E.',
  'Explore sunny, overcast, wet, rainy, and snowy conditions in the weather menu.',
  'Press R to recover your car where you are. Shift + R returns to the start.',
  'Move the mouse to look around. Hold the middle button to look behind.',
  'Press Escape to pause and adjust the graphics, weather, or engine volume.',
  'ABS, traction control, and stability control can be toggled with 1, 2, and 3.',
  'There is no rush. Pick a direction and discover your own favourite stretch.',
];
const mib = bytes => (bytes / 1048576).toFixed(1);
const SLIDE_DURATION = 7000;

class LoadingScreen {
  constructor() {
    this.root = document.getElementById('loading');
    this.el = Object.fromEntries(['copy', 'detail', 'phase', 'progress', 'progress-value', 'title', 'description', 'chapter', 'fact', 'mood', 'scene-label', 'scene-name', 'story', 'motion', 'tip', 'retry'].map(name => [name, document.getElementById(`loading-${name}`)]));
    this.bar = document.getElementById('progress-bar');
    this.scenes = [...this.root.querySelectorAll('.loading-scene')];
    this.chapters = [...this.root.querySelectorAll('[data-chapter]')];
    this.assets = new Map();
    this.active = false;
    this.failed = false;
    this.postcard = 0;
    this.sceneSlot = 0;
    this.tip = 0;
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    this.paused = false;
    this.sequence = 0;
    this.detail = this.el.detail.textContent;
    this.lastByteAt = performance.now();
  }

  begin() {
    this.active = true;
    this.scenes[0].classList.add('is-moving');
    this.el.motion.addEventListener('click', () => {
      this.paused = !this.paused;
      this.syncMotion();
      this.schedule();
    });
    this.el.retry.addEventListener('click', () => location.reload());
    this.onVisibility = () => this.schedule();
    this.onConnection = () => this.render();
    this.onStartupError = event => { if (event.error) this.fail(event.error); };
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('online', this.onConnection);
    window.addEventListener('offline', this.onConnection);
    window.addEventListener('error', this.onStartupError);
    this.syncMotion();
    this.schedule();
    this.tipTimer = setInterval(() => this.nextTip(), 10000);
    this.heartbeat = setInterval(() => this.render(), 2000);
  }

  syncMotion() {
    this.root.classList.toggle('is-paused', this.paused);
    this.el.motion.setAttribute('aria-pressed', String(this.paused));
    this.el.motion.setAttribute('aria-label', this.paused ? 'Resume slideshow' : 'Pause slideshow');
    this.el.motion.firstElementChild.textContent = this.paused ? '▷' : 'Ⅱ';
  }

  schedule() {
    clearTimeout(this.sceneTimer);
    if (!this.active || this.failed || this.paused || document.hidden) return;
    this.sceneTimer = setTimeout(async () => {
      await this.showPostcard((this.postcard + 1) % POSTCARDS.length);
      this.schedule();
    }, SLIDE_DURATION);
  }

  async showPostcard(index) {
    if (!this.active || this.failed) return;
    if (this.switching) { this.pendingPostcard = index; return; }
    if (index === this.postcard) return;
    this.switching = true;
    const sequence = ++this.sequence;
    const card = POSTCARDS[index];
    const slot = 1 - this.sceneSlot;
    const image = this.scenes[slot];
    image.classList.remove('is-moving');
    image.src = `/assets/loading/${card.image}.webp`;
    image.fetchPriority = 'low';
    try { await image.decode(); } catch { this.settlePostcard(); return; } // Keep the current scene if artwork is unavailable.
    if (!this.active || this.failed || sequence !== this.sequence) return;
    this.postcard = index;
    this.scenes[this.sceneSlot].classList.remove('is-active');
    image.classList.add('is-active', 'is-moving');
    this.sceneSlot = slot;
    this.chapters.forEach((chapter, i) => {
      chapter.classList.toggle('is-current', i === index);
      if (i === index) chapter.setAttribute('aria-current', 'true');
      else chapter.removeAttribute('aria-current');
    });
    this.el.story.classList.add('is-changing');
    clearTimeout(this.copyTimer);
    this.copyTimer = setTimeout(() => {
      if (!this.active || this.failed || sequence !== this.sequence) return;
      this.el.title.replaceChildren(document.createTextNode(card.title[0]), document.createElement('br'));
      const second = document.createElement('span');
      second.textContent = card.title[1];
      this.el.title.append(second);
      this.el.description.textContent = card.description;
      this.el.chapter.textContent = `/ ${String(index + 1).padStart(2, '0')}`;
      this.el.fact.textContent = card.fact;
      this.el.mood.textContent = card.mood;
      this.el['scene-label'].textContent = card.label;
      this.el['scene-name'].textContent = card.name;
      this.el.story.classList.remove('is-changing');
    }, this.reducedMotion.matches ? 0 : 430);
    this.switchTimer = setTimeout(() => this.settlePostcard(), this.reducedMotion.matches ? 0 : 1700);
  }

  settlePostcard() {
    this.switching = false;
    const pending = this.pendingPostcard;
    this.pendingPostcard = null;
    if (pending != null) this.showPostcard(pending);
  }

  nextTip() {
    if (!this.active || this.failed || this.paused || document.hidden) return;
    this.tip = (this.tip + 1) % TIPS.length;
    const label = document.createElement('span');
    label.textContent = "DRIVER'S NOTE";
    this.el.tip.replaceChildren(label, document.createTextNode(` ${TIPS[this.tip]}`));
  }

  plan(files) {
    for (const [key, total] of Object.entries(files)) this.assets.set(key, { loaded: 0, total: Number(total) || 0, complete: false });
    this.render();
  }

  bytes(key, loaded, total = 0) {
    if (!this.active || this.failed) return;
    const asset = this.assets.get(key) ?? { loaded: 0, total: 0, complete: false };
    if (loaded > asset.loaded) this.lastByteAt = performance.now();
    asset.loaded = Math.max(asset.loaded, loaded);
    if (total > 0) asset.total = total;
    this.assets.set(key, asset);
    // Stream chunks can arrive very quickly; avoid reflowing the loader on every chunk.
    if (!this.renderFrame) this.renderFrame = requestAnimationFrame(() => { this.renderFrame = 0; this.render(); });
  }

  downloaded(key, bytes) {
    if (!this.active || this.failed) return;
    this.bytes(key, bytes, bytes);
    this.assets.get(key).complete = true;
    this.render();
  }

  omit(key) { this.assets.delete(key); this.render(); }

  stage(copy, phase, detail, transferring = false) {
    if (!this.active || this.failed) return;
    this.el.copy.textContent = copy;
    this.el.phase.textContent = phase;
    this.detail = detail;
    this.transferring = transferring;
    this.lastByteAt = performance.now();
    this.render();
  }

  render() {
    if (!this.active || this.failed) return;
    const assets = [...this.assets.values()];
    const loaded = assets.reduce((sum, asset) => sum + asset.loaded, 0);
    const total = assets.reduce((sum, asset) => sum + asset.total, 0);
    const measurable = assets.length > 0 && assets.every(asset => asset.total > 0);
    const downloaded = assets.length > 0 && assets.every(asset => asset.complete);
    if (measurable) {
      const percentage = Math.min(100, Math.floor(loaded / total * 100));
      this.bar.style.width = `${loaded / total * 100}%`;
      this.el.progress.setAttribute('aria-valuenow', String(percentage));
      this.el.progress.setAttribute('aria-valuetext', `${percentage}% of game assets downloaded. ${this.el.copy.textContent}`);
      this.el['progress-value'].textContent = downloaded ? 'ASSETS READY' : `ASSETS / ${percentage}%`;
    } else {
      this.el.progress.removeAttribute('aria-valuenow');
      this.el.progress.setAttribute('aria-valuetext', this.el.copy.textContent);
      this.el['progress-value'].textContent = 'GETTING READY';
    }
    if (!navigator.onLine) this.el.detail.textContent = 'Connection interrupted. Waiting for the network…';
    else if (this.transferring && performance.now() - this.lastByteAt > 12000) this.el.detail.textContent = 'Still downloading the city. Larger assets can take a moment.';
    else if (this.transferring && loaded > 0) this.el.detail.textContent = measurable ? `${mib(loaded)} / ${mib(total)} MB downloaded` : `${mib(loaded)} MB downloaded`;
    else this.el.detail.textContent = this.detail;
  }

  stop() {
    this.active = false;
    ++this.sequence;
    for (const timer of [this.sceneTimer, this.copyTimer, this.switchTimer]) clearTimeout(timer);
    clearInterval(this.tipTimer);
    clearInterval(this.heartbeat);
    cancelAnimationFrame(this.renderFrame);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('online', this.onConnection);
    window.removeEventListener('offline', this.onConnection);
    window.removeEventListener('error', this.onStartupError);
  }

  fail(error) {
    if (!this.active) return;
    this.stop();
    this.failed = true;
    this.root.classList.add('has-error', 'is-paused');
    this.root.setAttribute('aria-busy', 'false');
    this.el.copy.textContent = /webgl|graphics context/i.test(error?.message ?? '') ? 'Your browser couldn’t start the graphics.' : 'The city couldn’t finish loading.';
    this.el.detail.textContent = navigator.onLine ? 'Check your connection or refresh your browser, then try again.' : 'Reconnect to the internet, then try again.';
    this.el.phase.textContent = 'LOAD INTERRUPTED';
    this.el['progress-value'].textContent = 'PLEASE RETRY';
    this.el.progress.setAttribute('aria-valuetext', 'Loading interrupted');
    this.el.retry.hidden = false;
    this.el.story.classList.remove('is-changing');
    this.el.motion.disabled = true;
  }

  async finish() {
    if (this.failed || !this.active) return;
    this.stage('Your city is ready.', 'WELCOME TO BAKU', 'Choose your car. Find your road.');
    this.stop();
    this.root.setAttribute('aria-busy', 'false');
    this.el['progress-value'].textContent = 'READY TO DRIVE';
    this.root.classList.add('is-leaving');
    await new Promise(resolve => setTimeout(resolve, this.reducedMotion.matches ? 0 : 1150));
    this.root.classList.add('hidden');
    this.scenes.forEach(image => { image.removeAttribute('src'); image.classList.remove('is-moving'); });
  }
}

export const loadingScreen = new LoadingScreen();
