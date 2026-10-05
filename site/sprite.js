// Mochi pixel sprite. 16x16 grid, one char per pixel. Shared by extension, site and icon builder.
// Keys: . transparent, o outline, b body, l highlight, s shade, e eye, w eye shine, c cheek, m mouth, z extra (zzz / sweat / sparkle)
(function (root) {
  const BASE = [
    '................',
    '..oo........oo..',
    '.obbo......obbo.',
    '.obcboooooobcbo.',
    'obbbbbbbbbbbbbbo',
    'obllbbbbbbbbbbbo',
    'oblbbbbbbbbbbbbo',
    'obbwebbbbbbwebbo',
    'obbeebbbbbbeebbo',
    'obcbbbbmmbbbbcbo',
    'obbbbbbbbbbbbbbo',
    'obbbbbbbbbbbbbso',
    '.obbbbbbbbbbbso.',
    '..oosbbbbbbsoo..',
    '....oooooooo....',
    '................',
  ];

  // Each mood replaces some rows of BASE.
  const MOODS = {
    idle: {},
    blink: { 7: 'obbbbbbbbbbbbbbo', 8: 'obbeebbbbbbeebbo' },
    happy: { 7: 'obbbebbbbbbebbbo', 8: 'obbebebbbbebebbo', 9: 'obcbbbmbbmbbbcbo', 10: 'obbbbbbmmbbbbbbo' },
    think: { 7: 'obbbwebbbbbbwebo', 8: 'obbbeebbbbbbeebo', 9: 'obcbbbbbmmbbbcbo' },
    alert: {
      7: 'obbeeebbbbeeebbo',
      8: 'obbewebbbbewebbo',
      9: 'obcbbbbbbbbbbcbo',
      10: 'obbbbbbmmbbbbbbo',
      11: 'obbbbbbmmbbbbbso',
    },
    sad: { 7: 'obbwebbbbbbwebbo', 8: 'obbeebbbbbbeebbo', 9: 'obcbbbbbbbbbbcbo', 10: 'obbbbbbmmbbbbbbo', 11: 'obbbbbmbbmbbbbso' },
    sleep: { 7: 'obbbbbbbbbbbbbbo', 8: 'obbeebbbbbbeebbo', 9: 'obcbbbbmmbbbbcbo', 1: '..oo........oozz', 2: '.obbo......obbz.' },
  };

  // Palettes. Body colour is user-configurable; the rest derives from it.
  const COLORS = {
    mint: '#8EE3C8',
    peach: '#FFB89A',
    lilac: '#C3B1F5',
    sky: '#9CCBFF',
    lemon: '#FFE08A',
    rose: '#FF9EC4',
    ghost: '#E9ECF2',
  };

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const f = (c) => Math.max(0, Math.min(255, Math.round(c + (amt < 0 ? c * amt : (255 - c) * amt))));
    const r = f(n >> 16), g = f((n >> 8) & 255), b = f(n & 255);
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
  }

  function palette(body) {
    body = COLORS[body] || body || COLORS.mint;
    return {
      o: '#1E1B2E',
      b: body,
      l: shade(body, 0.55),
      s: shade(body, -0.18),
      e: '#1E1B2E',
      w: '#FFFFFF',
      c: '#FF8FAB',
      m: '#1E1B2E',
      z: '#7A86A8',
    };
  }

  function grid(mood) {
    const m = MOODS[mood] || {};
    return BASE.map((row, i) => m[i] || row);
  }

  // Draw onto a canvas 2D context at pixel scale `px`.
  function draw(ctx, mood, body, px, ox, oy) {
    const pal = palette(body);
    const g = grid(mood);
    ox = ox || 0; oy = oy || 0;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const k = g[y][x];
      if (k === '.') continue;
      ctx.fillStyle = pal[k];
      ctx.fillRect(ox + x * px, oy + y * px, px, px);
    }
  }

  // SVG string (crisp at any size).
  function svg(mood, body, size) {
    const pal = palette(body);
    const g = grid(mood);
    let r = '';
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const k = g[y][x];
      if (k !== '.') r += `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${pal[k]}"/>`;
    }
    const s = size || 64;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="${s}" height="${s}" shape-rendering="crispEdges">${r}</svg>`;
  }

  const api = { BASE, MOODS, COLORS, palette, grid, draw, svg };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PetSprite = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
