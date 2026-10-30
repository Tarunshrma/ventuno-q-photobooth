/**
 * Diwali theme: night sky with fireworks, string lights, sky lanterns,
 * anar fountains and diyas. Everything is drawn procedurally — no image files.
 */
(() => {
  const { rand, pick, glow } = ThemeUtils;

  const FIREWORK_COLORS = ['#ffd23f', '#ff3d6e', '#ff8c1a', '#3ddcff', '#b56bff', '#7dff6a', '#ffffff'];
  const LIGHT_COLORS = ['#ff3d6e', '#ffd23f', '#3ddcff', '#7dff6a', '#ff8c1a'];
  const MAX_PARTICLES = 1000;

  function drawDiya(ctx, x, y, s, t, seed) {
    // Clay bowl
    ctx.save();
    const bowl = ctx.createLinearGradient(x, y - s * 0.1, x, y + s * 0.5);
    bowl.addColorStop(0, '#d9581a');
    bowl.addColorStop(1, '#6e2205');
    ctx.fillStyle = bowl;
    ctx.beginPath();
    ctx.moveTo(x - s / 2, y);
    ctx.quadraticCurveTo(x - s * 0.45, y + s * 0.5, x, y + s * 0.48);
    ctx.quadraticCurveTo(x + s * 0.45, y + s * 0.5, x + s * 0.62, y - s * 0.06); // spout
    ctx.lineTo(x + s / 2, y);
    ctx.closePath();
    ctx.fill();

    // Rim and oil
    ctx.fillStyle = '#3a1203';
    ctx.beginPath();
    ctx.ellipse(x, y, s / 2, s * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#f6a21a';
    ctx.lineWidth = Math.max(1, s * 0.03);
    ctx.stroke();

    // Gold dots decoration
    ctx.fillStyle = '#ffd23f';
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.arc(x + i * s * 0.14, y + s * 0.22 + Math.abs(i) * -s * 0.03, s * 0.03, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Flickering flame on the spout
    const fx = x + s * 0.5;
    const fy = y - s * 0.06;
    const h = s * 0.6 * (1 + 0.1 * Math.sin(t * 13 + seed) + 0.06 * Math.sin(t * 23 + seed * 2));
    const w = s * 0.13;
    const sway = s * 0.05 * Math.sin(t * 7 + seed);

    glow(ctx, fx, fy - h * 0.4, s * 1.2, 'rgba(255,170,60,0.55)');

    const flame = ctx.createRadialGradient(fx, fy - h * 0.25, 0, fx, fy - h * 0.4, h * 0.8);
    flame.addColorStop(0, '#ffffff');
    flame.addColorStop(0.25, '#fff3a0');
    flame.addColorStop(0.6, '#ffae1a');
    flame.addColorStop(1, 'rgba(255,60,0,0.2)');
    ctx.fillStyle = flame;
    ctx.beginPath();
    ctx.moveTo(fx, fy);
    ctx.bezierCurveTo(fx - w, fy - h * 0.3, fx - w * 0.3 + sway, fy - h * 0.8, fx + sway, fy - h);
    ctx.bezierCurveTo(fx + w * 0.3 + sway, fy - h * 0.8, fx + w, fy - h * 0.3, fx, fy);
    ctx.fill();
  }

  function drawLantern(ctx, x, len, t, phase) {
    const angle = 0.06 * Math.sin(t * 1.3 + phase);
    ctx.save();
    ctx.translate(x, 0);
    ctx.rotate(angle);

    ctx.strokeStyle = '#c9a25a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, len);
    ctx.stroke();

    const cy = len + 45;
    glow(ctx, 0, cy, 110, 'rgba(255,120,40,0.5)');

    const body = ctx.createLinearGradient(0, len, 0, len + 90);
    body.addColorStop(0, '#ffcf4a');
    body.addColorStop(0.5, '#ff5a1f');
    body.addColorStop(1, '#b3122e');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(0, len);
    ctx.lineTo(38, cy);
    ctx.lineTo(0, len + 90);
    ctx.lineTo(-38, cy);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#ffe08a';
    ctx.stroke();

    // Tassels
    ctx.strokeStyle = '#ffd23f';
    for (let i = -2; i <= 2; i++) {
      const sway = 3 * Math.sin(t * 2 + i + phase);
      ctx.beginPath();
      ctx.moveTo(i * 4, len + 90);
      ctx.lineTo(i * 6 + sway, len + 130);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawMarigoldString(ctx, x, length, t, phase) {
    const sway = 4 * Math.sin(t * 1.1 + phase);
    for (let y = 0, i = 0; y < length; y += 19, i++) {
      const px = x + sway * (y / length);
      ctx.fillStyle = i % 2 ? '#ffb300' : '#ff6f00';
      ctx.beginPath();
      ctx.arc(px, y, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(120,40,0,0.35)';
      ctx.beginPath();
      ctx.arc(px, y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    // Mango-leaf tassel at the end
    ctx.fillStyle = '#2e8b2e';
    ctx.beginPath();
    ctx.ellipse(x + sway, length + 14, 7, 18, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawStar(ctx, x, y, outer, inner, points = 5) {
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const r = i % 2 ? inner : outer;
      const a = -Math.PI / 2 + (i * Math.PI) / points;
      ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    ctx.closePath();
  }

  // ---------- Face art (face geometry comes from buildFace() in face.js) ----------

  const FACE_ART = [
    {
      id: 'bindi',
      label: 'Bindi',
      emoji: '🔴',
      draw(ctx, f) {
        const r = f.width * 0.035;
        const { x, y } = f.browCenter;
        ctx.fillStyle = '#ffd23f';
        ctx.beginPath();
        ctx.arc(x, y, r * 1.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#c8001e';
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.beginPath();
        ctx.arc(x - r * 0.35, y - r * 0.35, r * 0.25, 0, Math.PI * 2);
        ctx.fill();
      },
    },
    {
      id: 'tilak',
      label: 'Tilak',
      emoji: '🟠',
      draw(ctx, f) {
        const len = Math.hypot(f.forehead.x - f.noseBridge.x, f.forehead.y - f.noseBridge.y) * 1.15;
        ctx.save();
        ctx.translate(f.noseBridge.x, f.noseBridge.y);
        ctx.rotate(f.angle);
        const g = ctx.createLinearGradient(0, 0, 0, -len);
        g.addColorStop(0, '#ff7a00');
        g.addColorStop(1, '#d1001f');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(0, -len / 2, f.width * 0.028, len / 2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff4d6';
        ctx.beginPath();
        ctx.ellipse(0, -len * 0.35, f.width * 0.012, f.width * 0.02, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      },
    },
    {
      id: 'crown',
      label: 'Marigold crown',
      emoji: '🌼',
      draw(ctx, f) {
        const w = f.width;
        ctx.save();
        ctx.translate(f.foreheadTop.x, f.foreheadTop.y);
        ctx.rotate(f.angle);
        const n = 11;
        for (let i = 0; i < n; i++) {
          const u = i / (n - 1);
          const x = (u - 0.5) * w * 1.15;
          const y = -w * 0.08 - (1 - (2 * u - 1) ** 2) * w * 0.12;
          if (i < n - 1) {
            ctx.fillStyle = '#2e8b2e';
            ctx.beginPath();
            ctx.ellipse(x + w * 0.055, y - w * 0.05, w * 0.02, w * 0.045, 0.6, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.fillStyle = i % 2 ? '#ffb300' : '#ff6f00';
          ctx.beginPath();
          ctx.arc(x, y, w * 0.065, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = 'rgba(140,50,0,0.45)';
          ctx.beginPath();
          ctx.arc(x, y, w * 0.025, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      },
    },
    {
      id: 'shades',
      label: 'Star shades',
      emoji: '🕶️',
      draw(ctx, f, t) {
        const r = f.eyeDistance * 0.45;
        ctx.save();
        ctx.strokeStyle = '#ffd23f';
        ctx.lineWidth = f.eyeDistance * 0.07;
        ctx.beginPath();
        ctx.moveTo(f.leftEye.x, f.leftEye.y);
        ctx.lineTo(f.rightEye.x, f.rightEye.y);
        ctx.stroke();
        for (const eye of [f.leftEye, f.rightEye]) {
          ctx.save();
          ctx.translate(eye.x, eye.y);
          ctx.rotate(f.angle);
          const g = ctx.createLinearGradient(0, -r, 0, r);
          g.addColorStop(0, '#fff3a0');
          g.addColorStop(1, '#e09000');
          ctx.fillStyle = g;
          drawStar(ctx, 0, 0, r, r * 0.55);
          ctx.fill();
          ctx.fillStyle = 'rgba(40,0,60,0.8)';
          ctx.beginPath();
          ctx.arc(0, r * 0.05, r * 0.42, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.6)';
          ctx.beginPath();
          ctx.arc(-r * 0.15, -r * 0.1, r * 0.08, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
        ctx.restore();
        glow(ctx, f.leftEye.x - r, f.leftEye.y - r, r * 0.8, 'rgba(255,240,180,0.9)', 0.5 + 0.5 * Math.sin(t * 5));
      },
    },
    {
      id: 'mustache',
      label: 'Mustache',
      emoji: '🥸',
      draw(ctx, f) {
        const s = f.mouthWidth * 1.3;
        ctx.save();
        ctx.translate(f.mustache.x, f.mustache.y);
        ctx.rotate(f.angle);
        ctx.fillStyle = '#1b1110';
        for (const side of [1, -1]) {
          ctx.save();
          ctx.scale(side, 1);
          ctx.beginPath();
          ctx.moveTo(0, -s * 0.03);
          ctx.bezierCurveTo(s * 0.15, -s * 0.16, s * 0.35, -s * 0.12, s * 0.42, -s * 0.02);
          ctx.bezierCurveTo(s * 0.5, s * 0.05, s * 0.6, -s * 0.1, s * 0.52, -s * 0.2);
          ctx.bezierCurveTo(s * 0.64, -s * 0.06, s * 0.48, s * 0.12, s * 0.3, s * 0.06);
          ctx.bezierCurveTo(s * 0.18, s * 0.03, s * 0.08, s * 0.07, 0, s * 0.04);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
        ctx.restore();
      },
    },
    {
      id: 'cheekDiyas',
      label: 'Cheek diyas',
      emoji: '🪔',
      draw(ctx, f, t) {
        const s = f.width * 0.16;
        drawDiya(ctx, f.leftCheek.x - s * 0.1, f.leftCheek.y, s, t, 1.1);
        drawDiya(ctx, f.rightCheek.x - s * 0.1, f.rightCheek.y, s, t, 2.7);
      },
    },
  ];

  function create(W, H, settings) {
    // Static sky rendered once
    const sky = document.createElement('canvas');
    sky.width = W;
    sky.height = H;
    const sctx = sky.getContext('2d');
    const g = sctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#07021f');
    g.addColorStop(0.55, '#2a0b4a');
    g.addColorStop(1, '#5a1a2e');
    sctx.fillStyle = g;
    sctx.fillRect(0, 0, W, H);

    const stars = Array.from({ length: 140 }, () => ({
      x: rand(0, W),
      y: rand(0, H * 0.7),
      r: rand(0.6, 1.8),
      speed: rand(1, 3),
      phase: rand(0, 6.28),
    }));

    const sparkles = Array.from({ length: 35 }, () => ({
      x: rand(0, W),
      y: rand(-H, H),
      vy: rand(20, 55),
      size: rand(3, 7),
      phase: rand(0, 6.28),
    }));

    const groundY = H - 40;
    const fountains = [W * 0.22, W * 0.78];
    const particles = [];
    const rockets = [];
    const flashes = [];
    const queued = []; // delayed launches for the grand finale
    let nextLaunch = 0.3;

    // `big`: launched by the guest (☝️ / tap / finale): whistle, bigger burst, bang
    function launch(x = rand(W * 0.1, W * 0.9), targetY = rand(H * 0.1, H * 0.42), big = false) {
      if (big && typeof Sfx !== 'undefined') Sfx.launch();
      rockets.push({
        big,
        x: x + (big ? 0 : rand(-30, 30)),
        y: H,
        vx: rand(-25, 25),
        // speed needed to reach targetY under gravity (260 px/s²), plus a little extra
        vy: -Math.sqrt(2 * 260 * Math.max(80, H - targetY)) * 1.05,
        targetY,
        // an occasional burst in the event's brand color
        color:
          typeof EVENT_BRANDING !== 'undefined' && EVENT_BRANDING.enabled && Math.random() < 0.2
            ? EVENT_BRANDING.color
            : pick(FIREWORK_COLORS),
      });
    }

    function burst(r, type, n, speedScale, color, multi) {
      for (let i = 0; i < n && particles.length < MAX_PARTICLES; i++) {
        const a = (i / n) * Math.PI * 2 + rand(-0.05, 0.05);
        const speed = (type === 'ring' ? 230 : rand(60, 270)) * speedScale;
        particles.push({
          x: r.x,
          y: r.y,
          vx: Math.cos(a) * speed,
          vy: Math.sin(a) * speed,
          age: 0,
          life: type === 'willow' ? rand(2.2, 3) : rand(1.2, 2),
          gravity: type === 'willow' ? 150 : 90,
          drag: 1.3,
          size: r.big ? 3 : 2.2,
          color: multi ? pick(FIREWORK_COLORS) : color,
          flicker: type === 'willow',
        });
      }
    }

    function explode(r) {
      if (r.big) {
        // The guest's own firecracker: a big double-ring peony with golden glitter and a bang
        burst(r, 'peony', 120, 1.35, r.color, false);
        burst(r, 'ring', 60, 1.0, pick(FIREWORK_COLORS), false);
        burst(r, 'willow', 50, 0.8, '#ffd23f', false);
        flashes.push({ x: r.x, y: r.y, age: 0, color: '#ffffff', big: true });
        if (typeof Sfx !== 'undefined') Sfx.bang(0, 0.8);
        return;
      }
      const type = pick(['peony', 'peony', 'ring', 'willow']);
      burst(r, type, Math.floor(rand(70, 110)), 1, r.color, Math.random() < 0.35);
      flashes.push({ x: r.x, y: r.y, age: 0, color: r.color });
    }

    function emitFountains(dt) {
      for (const fx of fountains) {
        const count = Math.floor(90 * dt + Math.random());
        for (let i = 0; i < count && particles.length < MAX_PARTICLES; i++) {
          const a = -Math.PI / 2 + rand(-0.35, 0.35);
          const speed = rand(250, 430);
          particles.push({
            x: fx,
            y: groundY - 8,
            vx: Math.cos(a) * speed,
            vy: Math.sin(a) * speed,
            age: 0,
            life: rand(0.6, 1.1),
            gravity: 520,
            drag: 0.6,
            size: 1.8,
            color: Math.random() < 0.3 ? '#ffffff' : '#ffc94a',
            flicker: true,
          });
        }
      }
    }

    function update(dt) {
      const rate = [0, 0.5, 1, 2.5][settings.fireworks] ?? 1;
      nextLaunch -= dt * rate;
      if (nextLaunch <= 0) {
        launch();
        nextLaunch = rand(0.45, 1.2);
      }

      for (let i = queued.length - 1; i >= 0; i--) {
        queued[i].delay -= dt;
        if (queued[i].delay <= 0) {
          launch(queued[i].x, queued[i].y, queued[i].big);
          queued.splice(i, 1);
        }
      }

      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i];
        r.x += r.vx * dt;
        r.y += r.vy * dt;
        r.vy += 260 * dt;
        if (r.y <= r.targetY || r.vy >= -60) {
          explode(r);
          rockets.splice(i, 1);
        }
      }

      if (settings.fountains) emitFountains(dt);

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        const k = Math.exp(-p.drag * dt);
        p.vx *= k;
        p.vy = p.vy * k + p.gravity * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.age += dt;
        if (p.age >= p.life) particles.splice(i, 1);
      }

      for (let i = flashes.length - 1; i >= 0; i--) {
        flashes[i].age += dt;
        if (flashes[i].age > 0.35) flashes.splice(i, 1);
      }
    }

    function drawStringLights(ctx, t, top, sag, offset) {
      ctx.strokeStyle = 'rgba(40,30,20,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 16) {
        const u = x / W;
        const y = top + sag * 4 * u * (1 - u);
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();

      for (let i = 0, x = 16 + offset; x < W; x += 34, i++) {
        const u = x / W;
        const y = top + sag * 4 * u * (1 - u) + 6;
        const color = LIGHT_COLORS[i % LIGHT_COLORS.length];
        const on = 0.45 + 0.55 * Math.max(0, Math.sin(t * 3 + i * 0.9));
        glow(ctx, x, y, 22, color, on * 0.8);
        ctx.globalAlpha = 0.5 + 0.5 * on;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    function drawParticles(ctx) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      for (const p of particles) {
        let alpha = Math.pow(1 - p.age / p.life, 1.4);
        if (p.flicker) alpha *= 0.55 + 0.45 * Math.random();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.size;
        ctx.beginPath();
        ctx.moveTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
      ctx.restore();
    }

    return {
      drawBackground(ctx, t, dt) {
        update(dt);
        ctx.drawImage(sky, 0, 0);

        // Twinkling stars
        ctx.fillStyle = '#ffffff';
        for (const s of stars) {
          ctx.globalAlpha = 0.25 + 0.75 * Math.abs(Math.sin(t * s.speed + s.phase));
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;

        for (const f of flashes) {
          glow(ctx, f.x, f.y, f.big ? 340 : 160, f.color, (f.big ? 0.6 : 0.35) * (1 - f.age / 0.35));
        }

        // Rockets with short trails
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (const r of rockets) {
          ctx.strokeStyle = '#ffdca0';
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(r.x - r.vx * 0.05, r.y - r.vy * 0.05);
          ctx.lineTo(r.x, r.y);
          ctx.stroke();
        }
        ctx.restore();

        drawParticles(ctx);

        if (settings.lanterns) {
          drawLantern(ctx, W * 0.1, 150, t, 0);
          drawLantern(ctx, W * 0.9, 120, t, 2);
        }

        if (settings.lights) {
          drawStringLights(ctx, t, 18, 60, 0);
          drawStringLights(ctx, t, 6, 110, 17);
        }

        // Ground ledge with small diyas
        const ground = ctx.createLinearGradient(0, groundY - 30, 0, H);
        ground.addColorStop(0, 'rgba(40,10,10,0)');
        ground.addColorStop(0.4, '#2b0d0a');
        ground.addColorStop(1, '#180605');
        ctx.fillStyle = ground;
        ctx.fillRect(0, groundY - 30, W, H - groundY + 30);
        for (let i = 0, x = 60; x < W; x += 115, i++) {
          drawDiya(ctx, x, groundY + 4, 30, t, i * 1.7);
        }
      },

      drawForeground(ctx, t, dt) {
        // Marigold garlands framing the sides
        if (settings.garlands) {
          drawMarigoldString(ctx, 18, H * 0.48, t, 0);
          drawMarigoldString(ctx, W - 18, H * 0.48, t, 1.5);
        }

        // Big diyas in the bottom corners
        const big = [
          [80, H - 55, 78],
          [190, H - 35, 64],
          [W - 210, H - 35, 64],
          [W - 95, H - 55, 78],
        ];
        big.forEach(([x, y, s], i) => drawDiya(ctx, x, y, s, t, i * 2.3 + 0.7));

        if (settings.sparkles) drawSparkles(ctx, t, dt);

        // Caption
        const caption = String(settings.caption || '').trim();
        if (caption) {
          ctx.save();
          // small and high up, so it stays above people's heads
          const size = Math.min(40, (W * 0.26) / (caption.length * 0.55));
          const cy = 44;
          ctx.font = `bold ${size}px Georgia, "Times New Roman", serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const cg = ctx.createLinearGradient(0, cy - size / 2, 0, cy + size / 2);
          cg.addColorStop(0, '#fff6c2');
          cg.addColorStop(0.5, '#ffc93c');
          cg.addColorStop(1, '#e07b00');
          ctx.shadowColor = 'rgba(255,140,0,0.9)';
          ctx.shadowBlur = 14;
          ctx.fillStyle = cg;
          ctx.fillText(caption, W / 2, cy);
          ctx.restore();
        }
      },

      onTap(x, y) {
        launch(x, Math.min(y, H * 0.6), true);
      },

      celebrate() {
        for (let i = 0; i < 9; i++) {
          // every third one is a big, noisy one so the finale isn't deafening
          queued.push({ delay: i * 0.15, x: W * (0.1 + 0.8 * Math.random()), y: rand(H * 0.1, H * 0.4), big: i % 3 === 0 });
        }
      },
    };

    function drawSparkles(ctx, t, dt) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = '#ffe08a';
        for (const s of sparkles) {
          s.y += s.vy * dt;
          if (s.y > H + 10) {
            s.y = -10;
            s.x = rand(0, W);
          }
          const tw = 0.4 + 0.6 * Math.abs(Math.sin(t * 4 + s.phase));
          const r = s.size * tw;
          ctx.globalAlpha = tw;
          ctx.beginPath();
          ctx.moveTo(s.x, s.y - r);
          ctx.lineTo(s.x + r * 0.25, s.y);
          ctx.lineTo(s.x, s.y + r);
          ctx.lineTo(s.x - r * 0.25, s.y);
          ctx.closePath();
          ctx.moveTo(s.x - r, s.y);
          ctx.lineTo(s.x, s.y + r * 0.25);
          ctx.lineTo(s.x + r, s.y);
          ctx.lineTo(s.x, s.y - r * 0.25);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
    }
  }

  PhotoboothThemes.register({
    id: 'diwali',
    name: 'Diwali',
    emoji: '🪔',
    accent: '#ffb300',
    greeting: 'Shubh Deepavali! 🙏',
    ambient: 'diwali', // soft background soundscape (see Sfx.ambient)
    // What the booth says during a visit (spoken on the board with Piper TTS)
    voice: {
      welcome:
        'Namaste, and welcome to the X D C Diwali photobooth! Point your finger at a circle on the side to try on a prop, or show a V sign to take a photo.',
      hints: [
        'Try a prop! Point your finger at one of the circles on the side of the screen, and hold it there.',
        'Point one finger up to launch your own firecracker!',
        'Give me a thumbs up for a firework finale!',
        'Ready for your photo? Show a V sign, or fold your hands in a namaste.',
      ],
      countdown: 'Get ready! Three, two, one, smile!',
      printPhrase: 'Happy Diwali',
      afterPhoto: 'What a lovely photo! To print it, just say: Happy Diwali! Or show a thumbs up.',
      finale: 'Here comes the firework finale!',
      themeIntro: 'Switching to Diwali. Let the festival of lights begin!',
      bye: 'Thank you for visiting. Happy Diwali!',
    },
    finaleName: 'Firework finale',
    pointName: 'Launch a firecracker',
    tapHint: 'You can also tap the picture to launch a firecracker.',
    settings: [
      { id: 'caption', label: 'Caption', type: 'text', value: 'Happy Diwali' },
      {
        id: 'fireworks',
        label: 'Firecrackers',
        type: 'range',
        min: 0,
        max: 3,
        value: 2,
        labels: ['Off', 'Calm', 'Festive', 'Mega'],
      },
      { id: 'fountains', label: 'Anar fountains', type: 'toggle', value: true },
      { id: 'lanterns', label: 'Sky lanterns', type: 'toggle', value: true },
      { id: 'lights', label: 'String lights', type: 'toggle', value: true },
      { id: 'garlands', label: 'Marigold garlands', type: 'toggle', value: true },
      { id: 'sparkles', label: 'Golden sparkles', type: 'toggle', value: true },
    ],
    faceArt: FACE_ART,
    countdown: ['Get ready!', 'Strike a pose!', 'Say “Happy Diwali”!'],
    create,
  });
})();
