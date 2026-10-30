/**
 * Builds the person cut-out from a board frame: the camera image with
 * everything except people made transparent. Done once per received frame,
 * not once per animation frame, so it stays cheap.
 */
class Cutout {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d');
    this.maskCanvas = document.createElement('canvas');
    this.maskCtx = this.maskCanvas.getContext('2d', { willReadFrequently: true });
    this.rect = [0, 0, width, height]; // where the camera image lands on the stage
    this.ready = false;
  }

  /** Camera image is drawn to "cover" the stage, like CSS object-fit: cover. */
  static coverRect(sw, sh, dw, dh) {
    const scale = Math.max(dw / sw, dh / sh);
    const w = sw * scale;
    const h = sh * scale;
    return [(dw - w) / 2, (dh - h) / 2, w, h];
  }

  update(bitmap, meta) {
    const { width: fw, height: fh, maskWidth: mw, maskHeight: mh } = meta;
    this.rect = Cutout.coverRect(fw, fh, this.width, this.height);

    // Mask: grey levels in the strip under the image -> alpha channel
    if (this.maskCanvas.width !== mw || this.maskCanvas.height !== mh) {
      this.maskCanvas.width = mw;
      this.maskCanvas.height = mh;
    }
    this.maskCtx.clearRect(0, 0, mw, mh);
    this.maskCtx.drawImage(bitmap, 0, fh, mw, mh, 0, 0, mw, mh);
    const img = this.maskCtx.getImageData(0, 0, mw, mh);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      // sharpen the soft model output a little so edges look clean
      const a = Math.min(255, Math.max(0, (d[i] - 70) * 1.9));
      d[i + 3] = a;
      d[i] = d[i + 1] = d[i + 2] = 255;
    }
    this.maskCtx.putImageData(img, 0, 0);

    const c = this.ctx;
    c.globalCompositeOperation = 'source-over';
    c.clearRect(0, 0, this.width, this.height);
    c.drawImage(bitmap, 0, 0, fw, fh, ...this.rect);
    c.globalCompositeOperation = 'destination-in';
    c.drawImage(this.maskCanvas, ...this.rect);
    c.globalCompositeOperation = 'source-over';
    this.ready = true;
  }
}
