/**
 * Halloween theme: full moon, haunted hill, flying bats, ghosts, fog, lightning,
 * jack-o'-lanterns and cobwebs. Everything is drawn procedurally — no image files.
 */
(() => {
  const { rand, pick, glow } = ThemeUtils;

  const BAT_COUNTS = [0, 6, 12, 24];

  // ---------- Drawing helpers ----------

  function drawBat(ctx, x, y, size, t, phase, color = '#0a0510') {
    const flap = Math.sin(t * 14 + phase);
    const wy = flap * size * 0.6;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(x, y, size * 0.18, size * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x + side * size * 0.12, y - size * 0.1);
      ctx.quadraticCurveTo(x + side * size * 0.6, y - size * 0.3 - wy, x + side * size * 1.1, y - wy * 0.8);
      ctx.quadraticCurveTo(x + side * size * 0.85, y + size * 0.05 - wy * 0.3, x + side * size * 0.7, y + size * 0.15 - wy * 0.4);
      ctx.quadraticCurveTo(x + side * size * 0.45, y + size * 0.05, x + side * size * 0.12, y + size * 0.15);
      ctx.closePath();
      ctx.fill();
    }
    // ears
    ctx.beginPath();
    ctx.moveTo(x - size * 0.12, y - size * 0.22);
    ctx.lineTo(x - size * 0.08, y - size * 0.42);
    ctx.lineTo(x - size * 0.02, y - size * 0.25);
    ctx.moveTo(x + size * 0.12, y - size * 0.22);
    ctx.lineTo(x + size * 0.08, y - size * 0.42);
    ctx.lineTo(x + size * 0.02, y - size * 0.25);
    ctx.fill();
  }

  /** Friendly bat for the guest's ☝️ swarm: purple, big eyes, rosy cheeks, glowing trail. */
  function drawCuteBat(ctx, b, t) {
    glow(ctx, b.x, b.y, b.size * 2.2, 'rgba(255,150,60,0.55)', 0.7);
    drawBat(ctx, b.x, b.y, b.size, t, b.phase, '#4a2a7a');
    const s = b.size;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(b.x - s * 0.09, b.y - s * 0.1, s * 0.09, 0, Math.PI * 2);
    ctx.arc(b.x + s * 0.09, b.y - s * 0.1, s * 0.09, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1a0d24';
    ctx.beginPath();
    ctx.arc(b.x - s * 0.08, b.y - s * 0.08, s * 0.045, 0, Math.PI * 2);
    ctx.arc(b.x + s * 0.1, b.y - s * 0.08, s * 0.045, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,140,170,0.8)';
    ctx.beginPath();
    ctx.arc(b.x - s * 0.15, b.y + s * 0.03, s * 0.04, 0, Math.PI * 2);
    ctx.arc(b.x + s * 0.15, b.y + s * 0.03, s * 0.04, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawGhost(ctx, x, y, s, t, phase) {
    ctx.save();
    ctx.globalAlpha = 0.55 + 0.15 * Math.sin(t * 1.5 + phase);
    const g = ctx.createLinearGradient(x, y - s, x, y + s);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, 'rgba(220,225,255,0.2)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y - s * 0.3, s * 0.5, Math.PI, 0);
    const wave = 4;
    ctx.lineTo(x + s * 0.5, y + s * 0.5);
    for (let i = wave; i >= 0; i--) {
      const px = x - s * 0.5 + (s * i) / wave;
      const py = y + s * 0.5 + (i % 2 ? -1 : 1) * s * 0.08 * Math.sin(t * 4 + phase + i);
      ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = '#1a0d24';
    ctx.beginPath();
    ctx.ellipse(x - s * 0.17, y - s * 0.35, s * 0.07, s * 0.1, 0, 0, Math.PI * 2);
    ctx.ellipse(x + s * 0.17, y - s * 0.35, s * 0.07, s * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x, y - s * 0.1, s * 0.07, s * 0.1 + s * 0.03 * Math.sin(t * 3 + phase), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawPumpkin(ctx, x, y, s, t, seed) {
    // y is the bottom of the pumpkin
    const cy = y - s * 0.38;
    const flicker = 0.75 + 0.25 * Math.sin(t * 11 + seed) * Math.sin(t * 7.3 + seed * 2);
    glow(ctx, x, cy, s * 1.3, 'rgba(255,140,30,0.55)', flicker);

    ctx.save();
    const body = ctx.createRadialGradient(x - s * 0.15, cy - s * 0.15, s * 0.05, x, cy, s * 0.6);
    body.addColorStop(0, '#ffb04a');
    body.addColorStop(1, '#c4510c');
    ctx.fillStyle = body;
    ctx.strokeStyle = 'rgba(120,40,0,0.6)';
    ctx.lineWidth = Math.max(1, s * 0.02);
    for (const [dx, rx] of [[-0.25, 0.28], [0.25, 0.28], [0, 0.3]]) {
      ctx.beginPath();
      ctx.ellipse(x + dx * s, cy, rx * s, s * 0.38, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    // stem
    ctx.fillStyle = '#4b6b1e';
    ctx.beginPath();
    ctx.moveTo(x - s * 0.05, cy - s * 0.34);
    ctx.quadraticCurveTo(x, cy - s * 0.55, x + s * 0.12, cy - s * 0.52);
    ctx.lineTo(x + s * 0.05, cy - s * 0.34);
    ctx.closePath();
    ctx.fill();

    // carved face lit by a candle
    ctx.fillStyle = `rgba(255, ${190 + 40 * flicker}, 60, ${0.85 + 0.15 * flicker})`;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x + side * s * 0.08, cy - s * 0.02);
      ctx.lineTo(x + side * s * 0.28, cy - s * 0.02);
      ctx.lineTo(x + side * s * 0.18, cy - s * 0.18);
      ctx.closePath();
      ctx.fill();
    }
    ctx.beginPath();
    ctx.moveTo(x - s * 0.3, cy + s * 0.08);
    const teeth = 5;
    for (let i = 0; i <= teeth; i++) {
      const px = x - s * 0.3 + (s * 0.6 * i) / teeth;
      ctx.lineTo(px, cy + s * (i % 2 ? 0.14 : 0.08));
    }
    ctx.quadraticCurveTo(x, cy + s * 0.32, x - s * 0.3, cy + s * 0.08);
    ctx.fill();
    ctx.restore();
  }

  function drawCobweb(ctx, cornerX, cornerY, size, dirX) {
    ctx.save();
    ctx.strokeStyle = 'rgba(235,235,255,0.55)';
    ctx.lineWidth = 1.2;
    const spokes = 6;
    const ends = [];
    for (let i = 0; i < spokes; i++) {
      const a = (i / (spokes - 1)) * (Math.PI / 2);
      const ex = cornerX + dirX * Math.cos(a) * size;
      const ey = cornerY + Math.sin(a) * size;
      ends.push([Math.cos(a), Math.sin(a)]);
      ctx.beginPath();
      ctx.moveTo(cornerX, cornerY);
      ctx.lineTo(ex, ey);
      ctx.stroke();
    }
    for (let ring = 1; ring <= 5; ring++) {
      const r = (ring / 5) * size * 0.95;
      ctx.beginPath();
      ends.forEach(([cx, cy], i) => {
        const px = cornerX + dirX * cx * r;
        const py = cornerY + cy * r;
        if (i === 0) ctx.moveTo(px, py);
        else {
          const [pcx, pcy] = ends[i - 1];
          const mx = cornerX + dirX * ((cx + pcx) / 2) * r * 0.85;
          const my = cornerY + ((cy + pcy) / 2) * r * 0.85;
          ctx.quadraticCurveTo(mx, my, px, py);
        }
      });
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawSpider(ctx, x, top, len, t) {
    const y = top + len + Math.sin(t * 1.4) * 25;
    ctx.save();
    ctx.strokeStyle = 'rgba(235,235,255,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.strokeStyle = '#0b0610';
    ctx.lineWidth = 2.5;
    for (const side of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const a = -0.6 + i * 0.4;
        const wiggle = 0.15 * Math.sin(t * 8 + i);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + side * 14, y + Math.sin(a) * 14 - 8, x + side * 22, y + Math.sin(a + wiggle) * 20 + 6);
        ctx.stroke();
      }
    }
    ctx.fillStyle = '#0b0610';
    ctx.beginPath();
    ctx.ellipse(x, y, 9, 11, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ff3030';
    ctx.beginPath();
    ctx.arc(x - 3, y + 4, 1.8, 0, Math.PI * 2);
    ctx.arc(x + 3, y + 4, 1.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function lightningPath(x, H) {
    const pts = [[x, 0]];
    let px = x;
    for (let y = 0; y < H * 0.55; ) {
      y += rand(25, 55);
      px += rand(-35, 35);
      pts.push([px, y]);
    }
    return pts;
  }

  // ---------- Face art ----------

  function onFace(ctx, f, point, fn) {
    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.rotate(f.angle);
    fn(f.width);
    ctx.restore();
  }

  const FACE_ART = [
    {
      id: 'witchHat',
      label: 'Witch hat',
      emoji: '🧙',
      draw(ctx, f) {
        onFace(ctx, f, f.foreheadTop, (w) => {
          const by = -w * 0.02;
          ctx.fillStyle = '#1b0f2a';
          ctx.beginPath();
          ctx.moveTo(-w * 0.42, by);
          ctx.quadraticCurveTo(-w * 0.2, by - w * 0.6, w * 0.05, by - w * 1.05);
          ctx.quadraticCurveTo(w * 0.35, by - w * 1.0, w * 0.32, by - w * 0.85); // bent tip
          ctx.quadraticCurveTo(w * 0.2, by - w * 0.5, w * 0.42, by);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = '#7b2cbf';
          ctx.fillRect(-w * 0.38, by - w * 0.16, w * 0.76, w * 0.12);
          ctx.strokeStyle = '#ffd23f';
          ctx.lineWidth = w * 0.025;
          ctx.strokeRect(-w * 0.07, by - w * 0.16, w * 0.14, w * 0.12);
          ctx.fillStyle = '#24143a';
          ctx.beginPath();
          ctx.ellipse(0, by, w * 0.78, w * 0.12, 0, 0, Math.PI * 2);
          ctx.fill();
        });
      },
    },
    {
      id: 'horns',
      label: 'Devil horns',
      emoji: '😈',
      draw(ctx, f) {
        onFace(ctx, f, f.foreheadTop, (w) => {
          for (const side of [-1, 1]) {
            const g = ctx.createLinearGradient(0, 0, 0, -w * 0.4);
            g.addColorStop(0, '#8b0000');
            g.addColorStop(1, '#ff2d2d');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.moveTo(side * w * 0.18, 0);
            ctx.quadraticCurveTo(side * w * 0.22, -w * 0.25, side * w * 0.38, -w * 0.42);
            ctx.quadraticCurveTo(side * w * 0.36, -w * 0.18, side * w * 0.34, 0);
            ctx.closePath();
            ctx.fill();
          }
        });
      },
    },
    {
      id: 'fangs',
      label: 'Vampire fangs',
      emoji: '🧛',
      draw(ctx, f) {
        // hang from the inner edge of the upper lip, sized by the mouth
        const m = f.mouthWidth;
        onFace(ctx, f, f.upperLipInner, () => {
          for (const side of [-1, 1]) {
            ctx.fillStyle = '#ffffff';
            ctx.strokeStyle = 'rgba(0,0,0,0.4)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(side * m * 0.16, -m * 0.02);
            ctx.lineTo(side * m * 0.3, -m * 0.02);
            ctx.lineTo(side * m * 0.23, m * 0.3);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = '#b00010';
            ctx.beginPath();
            ctx.arc(side * m * 0.23, m * 0.34, m * 0.03, 0, Math.PI * 2);
            ctx.fill();
          }
        });
      },
    },
    {
      id: 'skull',
      label: 'Skull paint',
      emoji: '💀',
      draw(ctx, f) {
        const w = f.width;
        ctx.fillStyle = 'rgba(10,0,15,0.75)';
        for (const eye of [f.leftEye, f.rightEye]) {
          ctx.beginPath();
          ctx.arc(eye.x, eye.y, f.eyeDistance * 0.34, 0, Math.PI * 2);
          ctx.fill();
        }
        onFace(ctx, f, f.noseTip, () => {
          ctx.beginPath();
          ctx.moveTo(0, w * 0.02);
          ctx.quadraticCurveTo(-w * 0.07, -w * 0.02, -w * 0.03, -w * 0.06);
          ctx.lineTo(0, -w * 0.03);
          ctx.lineTo(w * 0.03, -w * 0.06);
          ctx.quadraticCurveTo(w * 0.07, -w * 0.02, 0, w * 0.02);
          ctx.fill();
        });
        const m = f.mouthWidth;
        onFace(ctx, f, f.mouth, () => {
          ctx.strokeStyle = 'rgba(10,0,15,0.85)';
          ctx.lineWidth = w * 0.015;
          ctx.beginPath();
          ctx.moveTo(-m * 0.75, 0);
          ctx.quadraticCurveTo(0, m * 0.1, m * 0.75, 0);
          for (let i = -4; i <= 4; i++) {
            ctx.moveTo(i * m * 0.17, -m * 0.1);
            ctx.lineTo(i * m * 0.17, m * 0.14);
          }
          ctx.stroke();
        });
      },
    },
    {
      id: 'cat',
      label: 'Black cat',
      emoji: '🐈‍⬛',
      draw(ctx, f) {
        onFace(ctx, f, f.foreheadTop, (w) => {
          for (const side of [-1, 1]) {
            ctx.fillStyle = '#111';
            ctx.beginPath();
            ctx.moveTo(side * w * 0.1, w * 0.02);
            ctx.lineTo(side * w * 0.32, -w * 0.38);
            ctx.lineTo(side * w * 0.42, w * 0.05);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = '#ff8fb8';
            ctx.beginPath();
            ctx.moveTo(side * w * 0.17, 0);
            ctx.lineTo(side * w * 0.31, -w * 0.25);
            ctx.lineTo(side * w * 0.36, 0);
            ctx.closePath();
            ctx.fill();
          }
        });
        onFace(ctx, f, f.noseTip, (w) => {
          ctx.fillStyle = '#111';
          ctx.beginPath();
          ctx.moveTo(-w * 0.05, -w * 0.02);
          ctx.lineTo(w * 0.05, -w * 0.02);
          ctx.lineTo(0, w * 0.04);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = '#111';
          ctx.lineWidth = w * 0.01;
          for (const side of [-1, 1]) {
            for (const dy of [-0.04, 0.02, 0.08]) {
              ctx.beginPath();
              ctx.moveTo(side * w * 0.12, w * 0.04);
              ctx.lineTo(side * w * 0.42, w * (0.04 + dy * 1.5));
              ctx.stroke();
            }
          }
        });
      },
    },
    {
      id: 'scar',
      label: 'Monster scar',
      emoji: '🧟',
      draw(ctx, f) {
        onFace(ctx, f, f.forehead, (w) => {
          ctx.strokeStyle = '#5a0a14';
          ctx.lineWidth = w * 0.02;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(-w * 0.28, w * 0.03);
          ctx.quadraticCurveTo(0, -w * 0.05, w * 0.22, w * 0.02);
          ctx.stroke();
          ctx.strokeStyle = '#1a1a1a';
          ctx.lineWidth = w * 0.012;
          for (let i = -4; i <= 3; i++) {
            const x = i * w * 0.06;
            ctx.beginPath();
            ctx.moveTo(x - w * 0.015, -w * 0.04);
            ctx.lineTo(x + w * 0.015, w * 0.04);
            ctx.stroke();
          }
          // neck-bolt style rivets on the temples
          ctx.fillStyle = '#8a8f99';
          for (const side of [-1, 1]) {
            ctx.beginPath();
            ctx.arc(side * w * 0.42, w * 0.15, w * 0.04, 0, Math.PI * 2);
            ctx.fill();
          }
        });
      },
    },
  ];

  // ---------- Theme ----------

  function create(W, H, settings) {
    // Static sky with moon, rendered once
    const sky = document.createElement('canvas');
    sky.width = W;
    sky.height = H;
    const s = sky.getContext('2d');
    const g = s.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#07040f');
    g.addColorStop(0.5, '#241036');
    g.addColorStop(0.85, '#5a1e10');
    g.addColorStop(1, '#2a0d08');
    s.fillStyle = g;
    s.fillRect(0, 0, W, H);
    for (let i = 0; i < 90; i++) {
      s.fillStyle = `rgba(255,255,255,${rand(0.2, 0.7)})`;
      s.fillRect(rand(0, W), rand(0, H * 0.5), 1.5, 1.5);
    }
    const moon = { x: W * 0.86, y: 175, r: 80 };
    const halo = s.createRadialGradient(moon.x, moon.y, moon.r * 0.8, moon.x, moon.y, moon.r * 3);
    halo.addColorStop(0, 'rgba(255,240,200,0.35)');
    halo.addColorStop(1, 'rgba(255,240,200,0)');
    s.fillStyle = halo;
    s.fillRect(0, 0, W, H);
    const mg = s.createRadialGradient(moon.x - 20, moon.y - 20, 10, moon.x, moon.y, moon.r);
    mg.addColorStop(0, '#fffbe6');
    mg.addColorStop(1, '#f0d9a0');
    s.fillStyle = mg;
    s.beginPath();
    s.arc(moon.x, moon.y, moon.r, 0, Math.PI * 2);
    s.fill();
    s.fillStyle = 'rgba(190,160,110,0.35)';
    for (const [dx, dy, r] of [[-25, -10, 14], [20, 22, 10], [10, -30, 8], [-5, 30, 6]]) {
      s.beginPath();
      s.arc(moon.x + dx, moon.y + dy, r, 0, Math.PI * 2);
      s.fill();
    }

    // Static silhouettes: hills, haunted house, dead trees, tombstones
    const land = document.createElement('canvas');
    land.width = W;
    land.height = H;
    const l = land.getContext('2d');
    l.fillStyle = '#150a1f';
    l.beginPath();
    l.moveTo(0, H * 0.68);
    l.quadraticCurveTo(W * 0.18, H * 0.5, W * 0.38, H * 0.66);
    l.quadraticCurveTo(W * 0.62, H * 0.78, W * 0.85, H * 0.6);
    l.quadraticCurveTo(W * 0.95, H * 0.56, W, H * 0.6);
    l.lineTo(W, H);
    l.lineTo(0, H);
    l.fill();
    // haunted house on the left hill
    const hx = W * 0.16;
    const hy = H * 0.53;
    l.fillStyle = '#0c0614';
    l.fillRect(hx - 60, hy - 70, 120, 75);
    l.fillRect(hx + 25, hy - 120, 30, 60);
    l.beginPath();
    l.moveTo(hx - 75, hy - 68);
    l.lineTo(hx, hy - 130);
    l.lineTo(hx + 75, hy - 68);
    l.fill();
    l.beginPath();
    l.moveTo(hx + 18, hy - 118);
    l.lineTo(hx + 40, hy - 150);
    l.lineTo(hx + 62, hy - 118);
    l.fill();
    const windows = [
      [hx - 42, hy - 52],
      [hx + 22, hy - 52],
      [hx - 10, hy - 95],
      [hx + 34, hy - 105],
    ];
    // dead trees
    function tree(x, base, h, dir) {
      l.strokeStyle = '#0c0614';
      l.lineCap = 'round';
      const branch = (x0, y0, len, a, width) => {
        if (len < 8) return;
        const x1 = x0 + Math.cos(a) * len;
        const y1 = y0 + Math.sin(a) * len;
        l.lineWidth = width;
        l.beginPath();
        l.moveTo(x0, y0);
        l.lineTo(x1, y1);
        l.stroke();
        branch(x1, y1, len * 0.7, a - 0.45 * dir, width * 0.65);
        branch(x1, y1, len * 0.62, a + 0.5 * dir, width * 0.6);
      };
      branch(x, base, h, -Math.PI / 2, 12);
    }
    tree(W * 0.04, H * 0.72, 90, 1);
    tree(W * 0.95, H * 0.66, 80, -1);
    // tombstones
    l.fillStyle = '#2b2236';
    for (const [x, sz] of [[W * 0.3, 1], [W * 0.36, 0.8], [W * 0.66, 0.9], [W * 0.72, 1.1]]) {
      const y = H * 0.83;
      l.beginPath();
      l.moveTo(x - 22 * sz, y);
      l.lineTo(x - 22 * sz, y - 40 * sz);
      l.arc(x, y - 40 * sz, 22 * sz, Math.PI, 0);
      l.lineTo(x + 22 * sz, y);
      l.fill();
    }

    // Fog puff sprite
    const puff = document.createElement('canvas');
    puff.width = puff.height = 128;
    const pc = puff.getContext('2d');
    const pg = pc.createRadialGradient(64, 64, 0, 64, 64, 64);
    pg.addColorStop(0, 'rgba(210,205,235,0.35)');
    pg.addColorStop(1, 'rgba(210,205,235,0)');
    pc.fillStyle = pg;
    pc.fillRect(0, 0, 128, 128);

    const bats = Array.from({ length: BAT_COUNTS[3] }, () => ({
      x: rand(0, W),
      y: rand(40, H * 0.45),
      vx: rand(60, 140) * pick([-1, 1]),
      size: rand(14, 26),
      phase: rand(0, 6.28),
      bob: rand(0, 6.28),
    }));
    const swarm = []; // bats released by taps / finale
    const poofs = []; // magic puffs where a swarm appears
    const ghosts = Array.from({ length: 3 }, (_, i) => ({
      x: rand(0, W),
      baseY: H * (0.35 + i * 0.12),
      vx: rand(18, 35) * (i % 2 ? -1 : 1),
      size: rand(45, 70),
      phase: rand(0, 6.28),
    }));
    const fog = Array.from({ length: 10 }, () => ({ x: rand(0, W), y: rand(H * 0.68, H * 0.9), r: rand(140, 260), vx: rand(8, 20) }));
    const clouds = Array.from({ length: 3 }, () => ({ x: rand(0, W), y: rand(90, 260), w: rand(160, 260), vx: rand(6, 14) }));
    const sparkles = Array.from({ length: 25 }, () => ({ x: rand(0, W), y: rand(0, H), vy: rand(10, 30), phase: rand(0, 6.28) }));

    let lightning = null;
    let nextLightning = rand(5, 10);

    function strike() {
      lightning = { age: 0, path: lightningPath(rand(W * 0.2, W * 0.8), H) };
    }

    function releaseBats(x, y, n) {
      for (let i = 0; i < n; i++) {
        const a = rand(0, Math.PI * 2);
        const speed = rand(140, 300);
        swarm.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed - 60, size: rand(22, 36), phase: rand(0, 6.28) });
      }
      // magic "poof" where the bats appear
      poofs.push({ x, y, age: 0 });
      if (typeof Sfx !== 'undefined') Sfx.bats();
    }

    function drawPoofs(ctx, dt) {
      for (let i = poofs.length - 1; i >= 0; i--) {
        const p = poofs[i];
        p.age += dt;
        if (p.age > 0.8) {
          poofs.splice(i, 1);
          continue;
        }
        const k = p.age / 0.8;
        glow(ctx, p.x, p.y, 60 + 140 * k, 'rgba(180,90,255,0.8)', 1 - k);
        ctx.save();
        ctx.globalAlpha = 1 - k;
        for (let j = 0; j < 14; j++) {
          const a = (j / 14) * Math.PI * 2;
          const r = 20 + 120 * k;
          ctx.fillStyle = j % 2 ? '#ff9a3c' : '#c77dff';
          ctx.beginPath();
          ctx.arc(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, 5 * (1 - k) + 1, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
    }

    function update(dt) {
      const active = BAT_COUNTS[settings.bats] ?? 12;
      for (let i = 0; i < active; i++) {
        const b = bats[i];
        b.x += b.vx * dt;
        if (b.x < -40) b.x = W + 40;
        if (b.x > W + 40) b.x = -40;
      }
      for (let i = swarm.length - 1; i >= 0; i--) {
        const b = swarm[i];
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        if (b.x < -60 || b.x > W + 60 || b.y < -60 || b.y > H + 60) swarm.splice(i, 1);
      }
      for (const gh of ghosts) {
        gh.x += gh.vx * dt;
        if (gh.x < -100) gh.x = W + 100;
        if (gh.x > W + 100) gh.x = -100;
      }
      for (const f of fog) {
        f.x += f.vx * dt;
        if (f.x - f.r > W) f.x = -f.r;
      }
      for (const c of clouds) {
        c.x += c.vx * dt;
        if (c.x - c.w > W) c.x = -c.w;
      }
      if (settings.lightning) {
        nextLightning -= dt;
        if (nextLightning <= 0) {
          strike();
          nextLightning = rand(6, 14);
        }
      }
      if (lightning) {
        lightning.age += dt;
        if (lightning.age > 0.45) lightning = null;
      }
    }

    return {
      drawBackground(ctx, t, dt) {
        update(dt);
        ctx.drawImage(sky, 0, 0);

        ctx.fillStyle = 'rgba(20,10,30,0.55)';
        for (const c of clouds) {
          ctx.beginPath();
          ctx.ellipse(c.x, c.y, c.w / 2, 22, 0, 0, Math.PI * 2);
          ctx.ellipse(c.x + c.w * 0.2, c.y - 14, c.w / 3, 18, 0, 0, Math.PI * 2);
          ctx.fill();
        }

        if (lightning) {
          const a = 1 - lightning.age / 0.45;
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.strokeStyle = `rgba(200,220,255,${a})`;
          ctx.lineWidth = 3;
          ctx.shadowColor = '#bcd4ff';
          ctx.shadowBlur = 18;
          ctx.beginPath();
          lightning.path.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
          ctx.stroke();
          ctx.restore();
        }

        const active = BAT_COUNTS[settings.bats] ?? 12;
        for (let i = 0; i < active; i++) {
          const b = bats[i];
          drawBat(ctx, b.x, b.y + Math.sin(t * 2 + b.bob) * 12, b.size, t, b.phase);
        }

        if (settings.ghosts) {
          for (const gh of ghosts) drawGhost(ctx, gh.x, gh.baseY + Math.sin(t * 1.2 + gh.phase) * 18, gh.size, t, gh.phase);
        }

        ctx.drawImage(land, 0, 0);
        // flickering haunted-house windows
        windows.forEach(([x, y], i) => {
          const on = 0.5 + 0.5 * Math.sin(t * (2 + i) + i * 1.7);
          ctx.fillStyle = `rgba(255,200,80,${0.35 + 0.6 * on})`;
          ctx.fillRect(x, y, 16, 20);
        });

        if (settings.fog) {
          for (const f of fog) ctx.drawImage(puff, f.x - f.r, f.y - f.r * 0.4, f.r * 2, f.r * 0.8);
        }

        if (lightning) {
          ctx.fillStyle = `rgba(220,230,255,${0.35 * (1 - lightning.age / 0.45)})`;
          ctx.fillRect(0, 0, W, H);
        }
      },

      drawForeground(ctx, t, dt) {
        drawPoofs(ctx, dt);
        for (const b of swarm) drawCuteBat(ctx, b, t);

        if (settings.cobwebs) {
          drawCobweb(ctx, 0, 0, 170, 1);
          drawCobweb(ctx, W, 0, 140, -1);
          drawSpider(ctx, 95, 0, 110, t);
        }

        if (settings.pumpkins) {
          [
            [85, H - 8, 110],
            [205, H - 4, 80],
            [W - 215, H - 4, 80],
            [W - 95, H - 8, 110],
          ].forEach(([x, y, size], i) => drawPumpkin(ctx, x, y, size, t, i * 1.9));
        }

        // drifting orange embers
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (const sp of sparkles) {
          sp.y -= sp.vy * dt;
          if (sp.y < -10) {
            sp.y = H + 10;
            sp.x = rand(0, W);
          }
          ctx.globalAlpha = 0.3 + 0.5 * Math.abs(Math.sin(t * 3 + sp.phase));
          ctx.fillStyle = '#ff9a3c';
          ctx.beginPath();
          ctx.arc(sp.x + Math.sin(t + sp.phase) * 10, sp.y, 2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();

        const caption = String(settings.caption || '').trim();
        if (caption) {
          ctx.save();
          // small and high up, so it stays above people's heads
          const size = Math.min(42, (W * 0.26) / (caption.length * 0.5));
          const cy = 44;
          ctx.font = `bold ${size}px Chiller, "Papyrus", Georgia, serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const wobble = Math.sin(t * 2) * 2;
          const cg = ctx.createLinearGradient(0, cy - size / 2, 0, cy + size / 2);
          cg.addColorStop(0, '#ffd27a');
          cg.addColorStop(0.5, '#ff7518');
          cg.addColorStop(1, '#b33a00');
          ctx.shadowColor = 'rgba(140,255,90,0.75)';
          ctx.shadowBlur = 14;
          ctx.fillStyle = cg;
          ctx.fillText(caption, W / 2, cy + wobble);
          ctx.restore();
        }
      },

      onTap(x, y) {
        releaseBats(x, y, 8);
      },

      celebrate() {
        strike();
        if (typeof Sfx !== 'undefined') Sfx.thunder();
        releaseBats(W / 2, H * 0.45, 22);
      },
    };
  }

  PhotoboothThemes.register({
    id: 'halloween',
    name: 'Halloween',
    emoji: '🎃',
    accent: '#ff7518',
    greeting: 'Welcome, brave mortal! 🎃',
    ambient: 'halloween',
    voice: {
      welcome:
        'Welcome to the X D C Halloween photobooth! Point your finger at a circle on the side to try on a costume, or show a V sign to take a photo.',
      hints: [
        'Try a costume! Point your finger at one of the circles on the side, and hold it there.',
        'Point one finger up to release some friendly bats!',
        'Give me a thumbs up for lightning and a bat swarm!',
        'Ready for your spooky photo? Show a V sign, or fold your hands in a namaste.',
      ],
      countdown: 'Get ready! Three, two, one, say boo!',
      printPhrase: 'Happy Halloween',
      afterPhoto: 'Spooktacular! To print it, just say: Happy Halloween! Or show a thumbs up.',
      finale: 'Lightning and bats, coming up!',
      themeIntro: 'Switching to Halloween. Things are getting spooky!',
      bye: 'Thanks for visiting. Happy Halloween!',
    },
    finaleName: 'Lightning & bat swarm',
    pointName: 'Release bats',
    tapHint: 'You can also tap the picture to release bats 🦇',
    settings: [
      { id: 'caption', label: 'Caption', type: 'text', value: 'Happy Halloween' },
      { id: 'bats', label: 'Bats', type: 'range', min: 0, max: 3, value: 2, labels: ['None', 'Few', 'Spooky', 'Swarm'] },
      { id: 'ghosts', label: 'Floating ghosts', type: 'toggle', value: true },
      { id: 'lightning', label: 'Lightning', type: 'toggle', value: true },
      { id: 'fog', label: 'Graveyard fog', type: 'toggle', value: true },
      { id: 'pumpkins', label: "Jack-o'-lanterns", type: 'toggle', value: true },
      { id: 'cobwebs', label: 'Cobwebs & spider', type: 'toggle', value: true },
    ],
    faceArt: FACE_ART,
    countdown: ['Get spooky!', 'Strike a scary pose!', 'Say “BOO!”'],
    create,
  });
})();
