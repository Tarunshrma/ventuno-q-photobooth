/**
 * Receives processed frames from the board. All AI (person cut-out, face
 * detection) runs on the VENTUNO Q; the browser only draws.
 *
 * Each /frame response is a JPEG with the camera image on top and the person
 * mask in a strip below it, plus AI results in the X-Frame-Meta header.
 */
class BoardFeed {
  #after = 0;
  #running = false;

  /** onFrame(bitmap, meta) gets every new frame; onStatus('missing'|'starting'|'offline') when there is none. */
  constructor(onFrame, onStatus) {
    this.onFrame = onFrame;
    this.onStatus = onStatus;
  }

  start() {
    if (this.#running) return;
    this.#running = true;
    this.#loop();
  }

  async #loop() {
    while (this.#running) {
      try {
        const res = await fetch(`/frame?after=${this.#after}`, { cache: 'no-store' });
        if (res.status !== 200) {
          this.onStatus(res.headers.get('X-Camera') || 'starting');
          await sleep(300);
          continue;
        }
        const meta = JSON.parse(res.headers.get('X-Frame-Meta'));
        const bitmap = await createImageBitmap(await res.blob());
        this.#after = meta.id;
        this.onFrame(bitmap, meta);
      } catch (err) {
        console.warn('Frame fetch failed', err);
        this.onStatus('offline');
        await sleep(1000);
      }
    }
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
