/**
 * Theme registry for the photobooth.
 *
 * A theme is a plain object registered with PhotoboothThemes.register():
 *
 *   {
 *     id: 'diwali',              // unique id, also used in saved photo filenames
 *     name: 'Diwali',            // label shown in the theme picker
 *     emoji: '🪔',
 *     accent: '#ffb300',         // UI accent color while the theme is active
 *
 *     // Optional: user controls, rendered automatically in the "Decorate" panel.
 *     // Current values are passed to create() as a live `settings` object.
 *     settings: [
 *       { id: 'caption', label: 'Caption', type: 'text', value: 'Happy Diwali' },
 *       { id: 'fireworks', label: 'Firecrackers', type: 'range', min: 0, max: 3, value: 2,
 *         labels: ['Off', 'Calm', 'Festive', 'Mega'] },
 *       { id: 'lanterns', label: 'Lanterns', type: 'toggle', value: true },
 *     ],
 *
 *     // Optional: face art the user can toggle. face = geometry from buildFace()
 *     // (points in stage coordinates, width, angle).
 *     faceArt: [{ id: 'bindi', label: 'Bindi', emoji: '🔴', draw(ctx, face, t) {} }],
 *
 *     // Optional: greeting shown when someone steps into the frame.
 *     greeting: 'Shubh Deepavali! 🙏',
 *
 *     // Optional: phrases shown during the 3-2-1 countdown.
 *     countdown: ['Get ready!', 'Strike a pose!', 'Say cheese!'],
 *
 *     create(width, height, settings) {   // called when the theme is selected
 *       return {
 *         drawBackground(ctx, t, dt) {},  // drawn BEHIND the person
 *         drawForeground(ctx, t, dt) {},  // drawn IN FRONT of the person
 *         onTap(x, y) {},                 // optional: user tapped the picture
 *         celebrate() {},                 // optional: big effect right before the photo
 *       };
 *     },
 *   }
 *
 * t is the time in seconds, dt the seconds since the previous frame.
 * To add a theme (e.g. Halloween): create js/themes/halloween.js that calls
 * PhotoboothThemes.register({...}) and add a <script> tag for it in index.html.
 */
const PhotoboothThemes = (() => {
  const themes = new Map();

  return {
    register(theme) {
      themes.set(theme.id, theme);
    },
    get(id) {
      return themes.get(id);
    },
    list() {
      return [...themes.values()];
    },
  };
})();

/** Small drawing helpers shared by themes. */
const ThemeUtils = {
  rand(min, max) {
    return min + Math.random() * (max - min);
  },

  pick(items) {
    return items[Math.floor(Math.random() * items.length)];
  },

  /** Soft additive glow centered at (x, y). Uses a cached sprite per color for speed. */
  glow(ctx, x, y, radius, color, alpha = 1) {
    if (alpha <= 0.01) return;
    const sprite = glowSprite(color);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.drawImage(sprite, x - radius, y - radius, radius * 2, radius * 2);
    ctx.restore();
  },
};

const glowSprites = new Map();
function glowSprite(color) {
  let sprite = glowSprites.get(color);
  if (!sprite) {
    sprite = document.createElement('canvas');
    sprite.width = sprite.height = 64;
    const c = sprite.getContext('2d');
    const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 64, 64);
    glowSprites.set(color, sprite);
  }
  return sprite;
}
