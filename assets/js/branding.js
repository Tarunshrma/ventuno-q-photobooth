/**
 * Event branding: small XDC Network icons hanging like ornaments in the
 * background (behind the person), independent of the theme.
 * Edit EVENT_BRANDING to change or disable it. Themes may also use `color`
 * as an occasional accent (e.g. a few firework bursts).
 */
const EVENT_BRANDING = {
  enabled: true,
  name: 'XDC Network',
  color: '#416cab',
  // Hanging icons: x as a fraction of the width, string length in px
  ornaments: [
    { x: 0.27, len: 70 },
    { x: 0.36, len: 40 },
    { x: 0.64, len: 40 },
    { x: 0.73, len: 70 },
  ],
  radius: 22,
};

// Official XDC Network icon shape (xinfin.org brand assets, primary icon), viewBox 1008x648
const XDC_ICON_PATH = new Path2D(
  'M611.5,306.7c-36.4-138.4-203.5-101-215,0c23.2,13.1,28.5,16.1,28.5,16.1s-8.9,5.8-28.5,18.1' +
    'c24.9,133.1,205.2,107.5,215-0.1c-18.1-11.4-28.9-18-28.9-18S607.2,309,611.5,306.7z M521,367.3l-19.1-32.8l-19.4,32.8l-14.7-1' +
    'l27.6-46.5l-24.9-40.2l15-1.3l17.7,29.8l17.7-28.5l14,0.3l-23.2,39.4l25.6,47.5L521,367.3z'
);
const XDC_ICON_CENTER = { x: 504, y: 323 };
const XDC_ICON_SIZE = 235; // approximate width of the icon in path units

let xdcIconSprite = null;

/** Pre-render one ornament: white disc with the blue XDC icon, plus a soft glow. */
function xdcOrnament(radius) {
  if (xdcIconSprite?.radius === radius) return xdcIconSprite.canvas;
  const pad = radius;
  const size = (radius + pad) * 2;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const mid = size / 2;

  const halo = g.createRadialGradient(mid, mid, radius * 0.8, mid, mid, mid);
  halo.addColorStop(0, 'rgba(110,160,255,0.45)');
  halo.addColorStop(1, 'rgba(110,160,255,0)');
  g.fillStyle = halo;
  g.fillRect(0, 0, size, size);

  g.fillStyle = '#f7f7f7';
  g.beginPath();
  g.arc(mid, mid, radius, 0, Math.PI * 2);
  g.fill();

  const scale = (radius * 1.55) / XDC_ICON_SIZE;
  g.translate(mid, mid);
  g.scale(scale, scale);
  g.translate(-XDC_ICON_CENTER.x, -XDC_ICON_CENTER.y);
  g.fillStyle = '#254c81';
  g.fill(XDC_ICON_PATH);

  xdcIconSprite = { radius, canvas: c };
  return c;
}

/** Draw the hanging icons. Called before the person is drawn, so they never cover anyone. */
function drawBranding(ctx, W, t) {
  if (!EVENT_BRANDING.enabled) return;
  const r = EVENT_BRANDING.radius;
  const sprite = xdcOrnament(r);

  EVENT_BRANDING.ornaments.forEach(({ x, len }, i) => {
    const sway = 0.07 * Math.sin(t * 1.2 + i * 1.3);
    ctx.save();
    ctx.translate(x * W, 0);
    ctx.rotate(sway);
    ctx.strokeStyle = 'rgba(220,200,150,0.7)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, len);
    ctx.stroke();
    // gentle spin, like a hanging ornament
    ctx.translate(0, len + r);
    ctx.scale(0.85 + 0.15 * Math.cos(t * 0.9 + i), 1);
    ctx.drawImage(sprite, -sprite.width / 2, -sprite.height / 2);
    ctx.restore();
  });
}
