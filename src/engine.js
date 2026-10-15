/* Glitter powder: a WebGL2 glitter simulation you can draw glue into, pour
   glitter over, push around, and blow away to reveal what stuck.

   createGlitter(canvas, options) runs it in any <canvas>; the canvas fills
   whatever box CSS gives it. Returns a handle with set(), blow(), pour(),
   clear(), clearGlue(), reveal() and destroy(). See README.md for options. */

const VS = `#version 300 es
in vec2 a;
void main(){ gl_Position = vec4(a, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float;
uniform vec2  uRes;     // device px
uniform float uTime;
uniform float uDpr;
uniform vec2  uLight;   // light position in scene space
uniform sampler2D uSim; // r = powder height (in sim cells), g = shuffle seed, b = glitter bonded to glue
uniform vec2  uGrid;    // sim grid size (cells)
uniform float uCell;    // css px per sim cell
uniform sampler2D uGlue; // full-resolution glue mask (alpha), for crisp lettering
uniform highp sampler2D uCol; // per cell, as palette slots: r = loose glitter's two colours (4 bits each),
                        // g = share of the second, b/a = the same for the glitter stuck to the glue
uniform vec3  uPal[16]; // the glitter colours in use
uniform vec3  uPaper;   // the paper underneath
uniform float uHolo;    // 0 = reflections in the base colour (metallic), 1 = full rainbow
uniform float uFlakePx; // spacing of the holographic flakes (CSS px), scaled to the lettering
out vec4 outColor;

// The base colour at full brightness: what a coloured metallic flake reflects
vec3 tintSpec(vec3 c){ return c / max(max(c.r, max(c.g, c.b)), 0.04); }

// One grain's colour. Each cell holds up to two colours of loose glitter and two of
// glitter stuck to the glue; a grain is one or the other by chance, so mixed
// glitter reads as speckles of each colour rather than a blend.
vec3 cellColour(ivec2 c, float pick, bool loose){
  vec4 v = floor(texelFetch(uCol, c, 0) * 255.0 + 0.5);
  vec2 lv = loose ? v.rg : v.ba;
  int ab = int(lv.x), a = ab / 16, b = ab - a * 16;
  return uPal[pick < lv.y / 255.0 ? b : a];
}

vec3 hash32(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yzz) * p3.zyx);
}
float hash12(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
// Thin-film interference: light reflecting off the top and bottom of a coating of
// thickness d (nm) interferes, so the colour depends on film thickness and viewing angle.
vec3 thinFilm(float cosI, float d){
  const float n = 1.5;
  float cosT = sqrt(max(1.0 - (1.0 - cosI * cosI) / (n * n), 0.0));
  float opd = 2.0 * n * d * cosT;                              // optical path difference
  vec3 c = 0.5 + 0.5 * cos(6.28318 * opd / vec3(650.0, 530.0, 450.0) + 3.14159);
  c = pow(c, vec3(1.6));
  float l = dot(c, vec3(0.333));
  return clamp(mix(vec3(l), c, 2.4), 0.0, 1.0);                // holographic coatings read vivid
}
float height(vec2 css){ return texture(uSim, css / (uGrid * uCell)).r; }

// A holographic flake is a tiny flat mirror on the grain. It only sparkles when its facet
// lines up with the light, so sparkles gather where the pile's surface faces the light.
vec3 flakeLight(vec2 sid, float chance, float flatness, vec3 N, vec3 L, vec3 H, vec3 tint, out vec3 rainbow, out float isFlake){
  vec3 gh2 = hash32(sid * 1.37 + 5.1);
  isFlake = step(gh2.x, chance);
  rainbow = vec3(1.0);
  if (isFlake == 0.0) return vec3(0.0);
  vec3 gh  = hash32(sid + 71.3);
  vec3 gh3 = hash32(sid * 0.73 + 19.0);
  // Facet tilt: most lie nearly flat on the surface, a few sit at steep angles
  float tilt = (0.05 + 0.85 * gh3.z) * (1.0 - 0.55 * flatness);   // flakes pressed into glue lie flatter
  // Grains settle and shimmer very slightly, each at its own pace
  float rate = exp2(mix(-2.5, 0.8, gh2.z));
  float a = gh2.y * 6.2832 + (gh.x > 0.5 ? 1.0 : -1.0) * uTime * rate
          + 0.6 * sin(uTime * rate * (0.6 + 1.6 * gh3.x) + gh3.y * 6.28);
  vec3 Nf = normalize(N + vec3(cos(a), sin(a), 0.0) * tilt);
  float fd = max(dot(Nf, H), 0.0);
  float sharp = mix(14.0, 140.0, gh3.x * gh3.x);                     // facet flatness
  float amp = 1.0 + 4.0 * pow(gh3.y, 3.0);                   // facet size / quality
  // Colour from the flake's coating thickness and the angle light hits its face
  float film = mix(250.0, 600.0, hash32(sid * 2.7 + 1.3).x);
  rainbow = mix(tintSpec(tint), thinFilm(max(dot(Nf, L), 0.0), film), uHolo);
  float spec = pow(fd, sharp) * amp;
  return rainbow * (pow(fd, 12.0) * 0.15 + spec * 1.6)       // coloured reflection
       + vec3(1.0) * pow(spec, 3.0) * 0.08;                  // white core only at near-perfect alignment
}

void main(){
  float unit = min(uRes.x, uRes.y);
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / unit;
  vec2 css = gl_FragCoord.xy / uDpr;

  // ---- Surface from the simulated heightfield ----
  float h = height(css);
  float stuckLow = texture(uSim, css / (uGrid * uCell)).b;
  vec2 inv = 1.0 / uRes;
  float hiGlue = texture(uGlue, gl_FragCoord.xy * inv).a;
  float bonded = smoothstep(0.02, 0.25, stuckLow);               // glitter actually stuck here
  // Neighbouring glue samples, ~1.5 CSS px away: give the glued layer a raised, rounded edge
  float go = 1.5 * uDpr;
  float gL = texture(uGlue, (gl_FragCoord.xy - vec2(go, 0.0)) * inv).a;
  float gR = texture(uGlue, (gl_FragCoord.xy + vec2(go, 0.0)) * inv).a;
  float gD = texture(uGlue, (gl_FragCoord.xy - vec2(0.0, go)) * inv).a;
  float gU = texture(uGlue, (gl_FragCoord.xy + vec2(0.0, go)) * inv).a;
  float looseH = max(h - stuckLow, 0.0);                         // loose glitter lying on top
  // How uncovered the glued layer is. Buried under the pile, the glue mustn't show at all.
  float uncovered = 1.0 - smoothstep(0.25, 1.1, looseH);
  vec2 glueGrad = vec2(gR - gL, gU - gD) * bonded * uncovered;
  float glueBlur = (gL + gR + gD + gU + hiGlue) * 0.2;
  // Slope sampled at several widths so the grid's facet ridges read as soft, rounded crests
  vec2 grad = vec2(0.0);
  for (int k = 0; k < 3; k++){
    float o = uCell * (1.5 + 3.0 * float(k));
    float w = 2.0 * o / uCell;
    grad += vec2(height(css + vec2(o, 0)) - height(css - vec2(o, 0)),
                 height(css + vec2(0, o)) - height(css - vec2(0, o))) / w;
  }
  grad /= 3.0;
  vec3 N = normalize(vec3(-grad - glueGrad * 0.9, 1.0));          // pile shape + raised glue strokes

  vec3 L = normalize(vec3(uLight - p, 0.6));
  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));

  // ---- White canvas with soft shadow cast by the powder ----
  vec2 away = normalize(p - uLight + 1e-4);
  float sh = 0.0;
  for (int k = 1; k <= 3; k++) sh += smoothstep(0.3, 7.0, height(css - away * float(k) * 7.0));
  float shadow = 0.10 * sh / 3.0 + 0.06 * smoothstep(0.1, 1.0, h);
  // The glued glitter is a layer on top of the paper: it casts a hairline shadow beside it
  float glueShadow = texture(uGlue, (gl_FragCoord.xy - away * 2.2 * uDpr) * inv).a * bonded * (1.0 - hiGlue) * uncovered;
  shadow += 0.12 * glueShadow;
  vec3 bg = uPaper - shadow * vec3(1.0, 1.0, 0.97);

  // ---- Grain field (packed glass beads via Voronoi) ----
  float scale = unit / (1.0 * uDpr);    // ~1 CSS px per grain
  vec2 g = p * scale;
  vec2 gi = floor(g), gf = fract(g);
  float b1 = 8.0, b2 = 8.0;
  vec2 bR = vec2(0.0), bId = vec2(0.0), bPt = vec2(0.0);
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++){
    vec2 cell = vec2(float(x), float(y));
    vec2 pt = cell + 0.15 + 0.7 * hash32(gi + cell).xy;
    vec2 r = pt - gf;
    float dd = dot(r, r);
    if (dd < b1){ b2 = b1; b1 = dd; bR = r; bId = gi + cell; bPt = gi + pt; }
    else if (dd < b2){ b2 = dd; }
  }
  float dist = sqrt(b1);
  float edge = sqrt(b2) - dist;

  // Shuffle seed at the grain's centre: disturbed grains get a new random look
  vec2 gcCss = ((bPt / scale) * unit + 0.5 * uRes) / uDpr;
  ivec2 sc = clamp(ivec2(floor(gcCss / uCell)), ivec2(0), ivec2(uGrid) - 1);
  float s = texelFetch(uSim, sc, 0).g;
  vec2 sid = bId + s * 13.17;
  vec3 gh  = hash32(sid + 71.3);
  vec3 gh2 = hash32(sid * 1.37 + 5.1);
  vec3 gh3 = hash32(sid * 0.73 + 19.0);

  // The grain's colour, from a cell near its centre (jittered, so colour borders come out
  // grainy instead of square): the loose glitter on top, or what's stuck to the glue below
  vec3 gj = hash32(sid * 2.31 + 9.7);
  ivec2 cc = clamp(ivec2(floor((gcCss + (gj.xy - 0.5) * uCell * 1.6) / uCell)), ivec2(0), ivec2(uGrid) - 1);
  vec3 tint = cellColour(cc, gj.z, gh.y < clamp(looseH / 0.9, 0.0, 1.0));

  float rad = 0.5 + 0.12 * gh.x;
  float rr = dist / rad;
  float inBead = 1.0 - smoothstep(0.82, 1.0, rr);

  // Glued glitter, built grain by grain: at the edges each grain is either caught by the
  // glue or not, and a few stick just outside where the glue spread into the paper
  float glueSoft = mix(hiGlue, glueBlur, 0.6);
  float glueAmt = smoothstep(0.15, 0.85, glueSoft + (gh.x - 0.5) * 0.55) * bonded;
  float exposedGlue = glueAmt * uncovered;

  // Thin layers show only some grains; deep layers show powder in the gaps
  float present = gh.y < max(clamp(looseH / 0.9, 0.0, 1.0), glueAmt) ? 1.0 : 0.0;   // strict: none where there's no glitter
  float deep = smoothstep(0.4, 1.4, looseH + pow(glueAmt, 1.5) * 1.6);   // thin glue shows paper between grains

  vec2 nb = -bR / rad;
  vec3 Nb = normalize(N + vec3(nb * 0.9, 0.0) * step(rr, 1.0));
  float diff = clamp(dot(Nb, L), 0.0, 1.0);
  float macroDiff = clamp(dot(N, L), 0.0, 1.0);

  // Gritty base: each grain has its own tone, a few are noticeably darker or brighter
  float tone = (0.80 + 0.26 * gh.z) * (1.0 + 0.05 * exposedGlue);
  tone *= mix(1.0, 0.72, step(0.95, gh3.y));                  // occasional dark grain
  vec3 albedo = tint * tone;
  vec3 bead = albedo * (0.80 + 0.30 * diff);
  bead *= mix(0.84, 1.0, smoothstep(0.0, 0.22, edge));
  bead += mix(vec3(1.0), tintSpec(tint), 0.5) * pow(max(dot(Nb, H), 0.0), 45.0) * 0.35;

  // Tiny glints from the fine grains themselves
  vec3 rainbow;
  float isFlake;
  vec3 flake = flakeLight(sid, 0.06, exposedGlue, N, L, H, tint, rainbow, isFlake);
  bead += flake * isFlake * inBead * 0.7;

  vec3 gapPowder = tint * 0.935 * (0.76 + 0.26 * macroDiff);
  vec3 col = mix(mix(bg, gapPowder, deep), bead, inBead * present);

  // ---- Wet glue that no glitter has stuck to yet: a clear, raised, glossy line ----
  float wet = smoothstep(0.08, 0.5, glueBlur) * (1.0 - bonded) * (1.0 - smoothstep(0.05, 0.6, h));
  if (wet > 0.001) {
    vec2 gG = vec2(gR - gL, gU - gD);
    vec3 Ng = normalize(vec3(-gG * 2.2, 1.0));
    float rim = clamp(length(gG) * 1.6, 0.0, 1.0);                 // darker where the bead curves away
    float gloss = pow(max(dot(Ng, H), 0.0), 70.0);
    float wetShadow = texture(uGlue, (gl_FragCoord.xy - away * 2.0 * uDpr) * inv).a * (1.0 - hiGlue);
    vec3 glueCol = uPaper * (0.925 - 0.12 * rim) * vec3(0.975, 0.985, 1.0) + gloss * 0.85;   // a touch darker than the paper, faintly cool
    col = mix(col, glueCol, wet);
    col -= 0.05 * wetShadow * (1.0 - wet) * smoothstep(0.05, 0.4, glueBlur + 0.3);
  }

  // ---- Holographic flakes: larger, flat particles mixed into the powder ----
  // Each is a disc of random size. Unlit it reads as a silvery speck; when its face
  // lines up with the light it flashes, and the brightest ones go soft like bokeh.
  float fscale = unit / (uFlakePx * uDpr);                    // one candidate per uFlakePx CSS px
  vec2 fg = p * fscale;
  vec2 fi = floor(fg);
  vec3 bloom = vec3(0.0);
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++){
    vec2 id = fi + vec2(float(x), float(y));
    vec3 r1 = hash32(id * 1.91 + 2.7);
    vec2 c = id + 0.2 + 0.6 * r1.yz;
    vec2 cCss = ((c / fscale) * unit + 0.5 * uRes) / uDpr;
    ivec2 ct = clamp(ivec2(floor(cCss / uCell)), ivec2(0), ivec2(uGrid) - 1);
    vec3 cs = texelFetch(uSim, ct, 0).rgb;                    // height, shuffle seed, glued amount
    float glueF = texture(uGlue, cCss * uDpr / uRes).a * smoothstep(0.02, 0.25, cs.b);
    float looseF = max(cs.r - cs.b, 0.0);
    float onGlue = glueF * (1.0 - smoothstep(0.25, 1.1, looseF));   // only once the loose cover is gone
    if (r1.x > mix(0.45, 0.8, onGlue) * (uFlakePx / 5.0)) continue;   // smaller flakes: a few more per area, not 2x
    vec2 fsid = id * 3.1 + cs.g * 13.17;
    vec3 r2 = hash32(fsid + 40.0);
    if (r2.y >= max(clamp(looseF / 1.2, 0.0, 1.0), glueF)) continue;  // thin layers carry fewer flakes (none on bare paper)

    float size = r2.x * r2.x * r2.x;                           // mostly small, a few large
    float radius = mix(0.12, 0.45, size);                      // up to ~0.9 × uFlakePx across
    vec3 fc = hash32(fsid * 1.7 + 3.3);
    vec3 tintF = cellColour(ct, fc.x, r2.y < clamp(looseF / 1.2, 0.0, 1.0));
    vec3 rb; float isF;
    vec3 lit = flakeLight(fsid, 1.0, onGlue, N, L, H, tintF, rb, isF);
    float peak = max(lit.r, max(lit.g, lit.b));
    float soft = radius * (0.18 + 0.7 * clamp(peak - 0.8, 0.0, 1.0) * (0.3 + size));
    float d = length(fg - c);
    float cov = 1.0 - smoothstep(radius - soft, radius + soft, d);

    vec3 silver = tintF * 0.945 * (0.80 + 0.24 * macroDiff) * (0.92 + 0.14 * r2.z);
    float lift = clamp(peak, 0.0, 1.0);                       // unlit flakes stay faint, lit ones solid
    col = mix(col, silver + lit * (1.0 + size), cov * mix(0.45, 1.0, lift));
    float over = max(peak - 1.0, 0.0);
    bloom += normalize(lit + 1e-4) * over * exp(-pow(d / (radius * 1.5), 2.0)) * smoothstep(1.15, 0.8, d) * 0.25 * (0.4 + size);
  }
  col += bloom;

  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

const PVS = `#version 300 es
// Airborne flakes: flat mirrors tumbling as they drift down
in vec4 aA;             // x, y (sim cells), altitude (cells), size (css px)
in vec4 aB;             // spin angle, spin axis angle, film thickness (nm), colour (palette slot)
uniform vec2  uRes;
uniform float uDpr;
uniform float uCell;
uniform vec2  uLight;
uniform float uShadow;  // 1 = draw the soft shadow on the ground, 0 = the flake itself
uniform vec3  uPal[16];
uniform float uHolo;
out vec3  vCol;
out float vAlpha;
vec3 thinFilm(float cosI, float d){
  const float n = 1.5;
  float cosT = sqrt(max(1.0 - (1.0 - cosI * cosI) / (n * n), 0.0));
  float opd = 2.0 * n * d * cosT;
  vec3 c = 0.5 + 0.5 * cos(6.28318 * opd / vec3(650.0, 530.0, 450.0) + 3.14159);
  c = pow(c, vec3(1.6));
  float l = dot(c, vec3(0.333));
  return clamp(mix(vec3(l), c, 2.4), 0.0, 1.0);                // holographic coatings read vivid
}
void main(){
  float unit = min(uRes.x, uRes.y);
  vec2 css = aA.xy * uCell;
  vec2 p = (css * uDpr - 0.5 * uRes) / unit;
  // Tumbling: the face normal sweeps around a random axis
  float phi = aB.y;
  vec3 Nf = vec3(sin(aB.x) * cos(phi), sin(aB.x) * sin(phi), cos(aB.x));
  float faceOn = abs(Nf.z);                     // edge-on flakes look thin and dim
  float size = aA.w * (1.0 + aA.z * 0.02);
  if (uShadow > 0.5){
    vec2 away = normalize(p - uLight + 1e-4);
    css += away * aA.z * uCell * 0.5;
    gl_PointSize = size * 1.6 * uDpr;
    vCol = vec3(0.55, 0.56, 0.6);
    vAlpha = 0.10 * (0.4 + 0.6 * faceOn) * clamp(1.0 - aA.z / 60.0, 0.0, 1.0);
  } else {
    vec3 L = normalize(vec3(uLight - p, 0.6));
    vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
    float fd = abs(dot(Nf, H));                 // a flat flake reflects from either side
    float spec = pow(fd, 40.0) * 3.0;
    vec3 tint = uPal[int(aB.w + 0.5)];
    vec3 silver = tint * 0.86 * (0.75 + 0.25 * faceOn);
    vec3 tintSpec = tint / max(max(tint.r, max(tint.g, tint.b)), 0.04);
    vCol = silver + mix(tintSpec, thinFilm(abs(dot(Nf, L)), aB.z), uHolo) * spec + vec3(pow(spec, 3.0) * 0.05);
    gl_PointSize = max(size * (0.6 + 0.4 * faceOn) * uDpr, 1.0);
    vAlpha = mix(0.6, 1.0, clamp(spec, 0.0, 1.0)) * (0.6 + 0.4 * faceOn);
  }
  gl_Position = vec4(css * uDpr / uRes * 2.0 - 1.0, 0.0, 1.0);
}`;

const PFS = `#version 300 es
precision highp float;
in vec3  vCol;
in float vAlpha;
out vec4 outColor;
void main(){
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = 1.0 - smoothstep(0.55, 1.0, d);
  outColor = vec4(min(vCol, vec3(1.0)), vAlpha * a);
}`;

const GLUE_FONT_URL = 'https://fonts.googleapis.com/css2?family=Qwitcher+Grypen:wght@700&display=swap';

// Adds the glue lettering's font stylesheet once per page and waits for it
// (up to 4 s, so a blocked stylesheet can't stall the glitter)
let fontLoading = null;
function loadFont(url) {
  if (!url) return Promise.resolve();
  if (fontLoading) return fontLoading;
  if ([...document.styleSheets].some((s) => s.href && s.href.includes('Qwitcher'))) return (fontLoading = Promise.resolve());
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = url;
  fontLoading = new Promise((res) => { link.onload = link.onerror = res; setTimeout(res, 4000); });
  document.head.appendChild(link);
  return fontLoading;
}

export const DEFAULTS = {
  color: '#f2a7c8',        // colour of the glitter you add next (what's already down keeps its colour)
  shimmer: 0.55,           // how iridescent the flakes are (0 plain – 1 rainbow)
  paper: '#ffffff',        // the paper underneath
  word: '',                // a word written in glue to start with ('' for none)
  tool: 'push',            // 'glue' draws glue, 'glitter' sprinkles glitter, 'push' plays with it, 'erase' wipes glue
  glueWidth: 14,           // glue line width, CSS px
  brushSize: 22,           // glitter sprinkle radius, CSS px
  pushSize: 20,            // finger radius when pushing glitter, CSS px
  eraserSize: 28,          // eraser width, CSS px
  amount: 1.2,             // how much glitter one sprinkle drops
  heap: true,              // start with a heap of glitter poured over the glue
  autoBlow: false,         // blow it away by itself once it has loaded
  blowOnLongPress: true,   // holding still for half a second blows it away
  interactive: true,       // respond to the pointer at all
  loadFont: true,          // load the glue lettering's font from Google Fonts
  onReveal: null,          // called when a blow has finished
  onReady: null,           // called once it has drawn its first glitter
};

export function createGlitter(canvas, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const gl = canvas.getContext('webgl2', { antialias: false });
  if (!gl) { opts.onError?.(new Error('WebGL 2 is not available')); return null; }
  let VW = 0, VH = 0, ready = false, destroyed = false;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- GL setup ----------
  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src.trim());
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const link = (vs, fs) => {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  };
  const prog = link(VS, FS);
  const pprog = link(PVS, PFS);
  gl.useProgram(prog);

  const quadVao = gl.createVertexArray();
  gl.bindVertexArray(quadVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'a');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const U = {};
  for (const n of ['uRes','uTime','uDpr','uLight','uSim','uGrid','uCell','uGlue','uCol','uPal','uHolo','uFlakePx','uPaper']) U[n] = gl.getUniformLocation(prog, n);
  const PU = {};
  for (const n of ['uRes','uDpr','uCell','uLight','uShadow','uPal','uHolo']) PU[n] = gl.getUniformLocation(pprog, n);

  // Airborne flake buffer: 8 floats per particle
  const MAXP = 4000, PSTRIDE = 8;
  const pdata = new Float32Array(MAXP * PSTRIDE);
  const pVao = gl.createVertexArray();
  gl.bindVertexArray(pVao);
  const pbuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, pbuf);
  gl.bufferData(gl.ARRAY_BUFFER, pdata.byteLength, gl.DYNAMIC_DRAW);
  const aA = gl.getAttribLocation(pprog, 'aA'), aB = gl.getAttribLocation(pprog, 'aB');
  gl.enableVertexAttribArray(aA);
  gl.vertexAttribPointer(aA, 4, gl.FLOAT, false, PSTRIDE * 4, 0);
  gl.enableVertexAttribArray(aB);
  gl.vertexAttribPointer(aB, 4, gl.FLOAT, false, PSTRIDE * 4, 16);
  gl.bindVertexArray(null);

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.uniform1i(U.uSim, 0);
  gl.uniform1i(U.uGlue, 1);
  gl.uniform1i(U.uCol, 2);
  const glueTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, glueTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const colTex = gl.createTexture();                 // glitter colours per sim cell
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, colTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.activeTexture(gl.TEXTURE0);

  // ---------- Powder simulation (heightfield + angle of repose) ----------
  const CELL = 4;          // css px per sim cell
  const REPOSE = 0.42;     // smooth flakes have little friction, so glitter holds only shallow slopes
  const FLOOR = 0.06;      // dusting left under the finger
  const CLING_MAX = 6;     // how much powder a fingertip can hold
  const GLUE_DEPTH = 1.4;  // thickness of glitter that bonds to the glue (cells)
  let GLUE_TEXT = opts.word || '';
  // Per-letter glue settings. width: stroke wideness (-1 thin … 1 wide);
  // gaps: how patchy/starved the glue is (0 even … 1 lots of gaps);
  // thickness: how densely glitter coats it (0.1 sparse … 1 solid)
  // The saved look
  const DEFAULT_LETTERS = [
    { width: -0.59, gaps: 0,    thickness: 0.96 },  // h
    { width: 0,     gaps: 0,    thickness: 0.85 },  // e
    { width: -0.56, gaps: 0.46, thickness: 1 },     // l
    { width: 1,     gaps: 0.29, thickness: 0.76 },  // l
    { width: 0,     gaps: 0,    thickness: 0.91 },  // o
  ];
  let letterParams = [...GLUE_TEXT].map((_, i) => ({ ...(DEFAULT_LETTERS[i] || { width: 0, gaps: 0.5, thickness: 0.85 }) }));
  let glueSeed = 31.450682086121983;               // the hand-made glue pattern

  // Glitter colour: base tint + how iridescent the reflections are
  const hexToRgb = hx => [1, 3, 5].map(i => parseInt(hx.slice(i, i + 2), 16) / 255);
  const DEFAULT_COLOR = { hex: '#f2a7c8', holo: 0.55 }; // pink, partly iridescent
  // How the glitter is poured over the glue
  const DEFAULT_POUR = { spread: 0.8, depth: 0.37, shape: 0.76, stretch: 0.59, rag: 0.48, lumps: 0.95, dust: 0 };
  const pourParams = { ...DEFAULT_POUR };
  // The breath: force (how hard), direction (where it comes from, degrees: 0 left,
  // 90 top, 180 right, -90 bottom) and speed (how fast blown glitter travels)
  const DEFAULT_AIR = { force: 1.2, dir: -20, speed: 1 };
  const airParams = { ...DEFAULT_AIR };
  const DEFAULT_SIZE = 197;                               // font size of the glue lettering (CSS px)
  let flakePx = 5;                                        // set from the font size in buildGlueBase()
  let glueSize = DEFAULT_SIZE;
  const colorState = { holo: opts.shimmer };
  // Glitter colours. Every colour on the paper has a slot in a small palette; the sim
  // tracks, per cell, which slots its glitter is made of. Slots free up once a colour
  // is entirely gone from the paper.
  const SLOTS = 16;
  const palHex = new Array(SLOTS).fill(null);
  const palRgb = new Float32Array(SLOTS * 3);
  let curSlot = -1, curHex = '';
  const normHex = (hx) => {
    let v = String(hx || '').trim().toLowerCase();
    if (/^#[0-9a-f]{3}$/.test(v)) v = '#' + [...v.slice(1)].map((c) => c + c).join('');
    return /^#[0-9a-f]{6}$/.test(v) ? v : DEFAULTS.color;
  };
  // The slot for the colour new glitter is added in
  function slotNow() {
    const hx = normHex(opts.color);
    if (hx === curHex && palHex[curSlot] === hx) return curSlot;
    let s = palHex.indexOf(hx);
    if (s < 0) s = palHex.indexOf(null);
    if (s < 0) { freeSlots(); s = palHex.indexOf(null); }
    if (s < 0) {                                       // all in use: borrow the nearest colour
      const c = hexToRgb(hx);
      let best = 1e9;
      for (let k = 0; k < SLOTS; k++) {
        const d = (palRgb[3 * k] - c[0]) ** 2 + (palRgb[3 * k + 1] - c[1]) ** 2 + (palRgb[3 * k + 2] - c[2]) ** 2;
        if (d < best) { best = d; s = k; }
      }
    } else {
      palHex[s] = hx;
      palRgb.set(hexToRgb(hx), 3 * s);
    }
    curHex = hx; curSlot = s;
    return s;
  }
  // Frees the slots of colours no longer anywhere on the paper (or in the air)
  function freeSlots() {
    const used = new Uint8Array(SLOTS);
    for (let i = 0; i < h.length; i++) {
      if (h[i] - stuck[i] > 1e-3) { if (lA[i] >= 0) used[lA[i]] = 1; if (lB[i] >= 0) used[lB[i]] = 1; }
      if (stuck[i] > 1e-3) { if (sA[i] >= 0) used[sA[i]] = 1; if (sB[i] >= 0) used[sB[i]] = 1; }
    }
    for (let n = 0; n < np; n++) used[P.c[n]] = 1;
    if (carried > 0 && carriedSlot >= 0) used[carriedSlot] = 1;
    for (let k = 0; k < SLOTS; k++) if (!used[k]) palHex[k] = null;
  }
  const paperRgb = new Float32Array(hexToRgb(opts.paper));
  const GLUE_FONT = '"Qwitcher Grypen", cursive';
  let W, H, h, seed, thr, flow, glue, paperCap, stuck, dh, buf, active = 0, dirty = true;
  // Colours per cell: the loose glitter's two main palette slots (A, B; -1 for none) and the
  // share of B, the same for the glitter stuck to the glue, and for glitter blown in this step
  let lA, lB, lF, sA, sB, sF, iA, iB, iF, colBuf;
  let carriedSlot = -1;    // colour of what clings to the finger
  let vx, vy, outM, mIn, pX, pY;   // velocity of moving loose glitter, and per-step momentum bookkeeping
  let carried = 0;         // powder clinging to the finger (static)

  const ihash = (x, y) => {
    let n = (x * 374761393 + y * 668265263) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const vnoise = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const a = ihash(xi, yi), b = ihash(xi + 1, yi), c = ihash(xi, yi + 1), d = ihash(xi + 1, yi + 1);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  };
  const fbm = (x, y) => { let s = 0, a = 0.5; for (let i = 0; i < 4; i++) { s += a * vnoise(x, y); x = x * 2.03 + 17; y = y * 2.03 + 9; a *= 0.5; } return s; };

  function alloc() {
    W = Math.ceil(VW / CELL) + 1;
    H = Math.ceil(VH / CELL) + 1;
    h = new Float32Array(W * H);
    seed = new Float32Array(W * H);
    thr = new Float32Array(W * H);
    flow = new Float32Array(W * H);
    glue = new Float32Array(W * H);
    paperCap = new Float32Array(W * H);
    stuck = new Float32Array(W * H);
    dh = new Float32Array(W * H);
    vx = new Float32Array(W * H); vy = new Float32Array(W * H);
    outM = new Float32Array(W * H); mIn = new Float32Array(W * H);
    pX = new Float32Array(W * H); pY = new Float32Array(W * H);
    lA = new Int8Array(W * H).fill(-1); lB = new Int8Array(W * H).fill(-1); lF = new Float32Array(W * H);
    sA = new Int8Array(W * H).fill(-1); sB = new Int8Array(W * H).fill(-1); sF = new Float32Array(W * H);
    iA = new Int8Array(W * H).fill(-1); iB = new Int8Array(W * H).fill(-1); iF = new Float32Array(W * H);
    makeGlue();
    buf = new Float32Array(W * H * 4);
    colBuf = new Uint8Array(W * H * 4);
    for (let i = 0; i < thr.length; i++) thr[i] = REPOSE * (0.8 + 0.4 * Math.random());
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, W, H, 0, gl.RGBA, gl.FLOAT, buf);
    gl.activeTexture(gl.TEXTURE2);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, colBuf);
    gl.activeTexture(gl.TEXTURE0);
  }

  // ---------- Glitter colours ----------
  // Mixes m2 of glitter (slots a2 and b2, share f2 of b2) into cell i of a layer that
  // already holds m1. A cell keeps its two main colours; a third, smaller one is
  // shared out between them.
  const mixS = new Int8Array(4), mixW = new Float32Array(4);
  function mixInto(A, B, F, i, m1, a2, b2, f2, m2) {
    if (m2 <= 0 || a2 < 0) return;
    const a1 = A[i];
    if (m1 <= 1e-4 || a1 < 0) { A[i] = a2; B[i] = b2; F[i] = b2 < 0 ? 0 : f2; return; }
    const b1 = B[i];
    if (b1 < 0 && b2 < 0 && a1 === a2) return;          // same single colour: nothing changes
    const f1 = F[i];
    mixS[0] = a1; mixW[0] = m1 * (1 - f1);
    mixS[1] = b1; mixW[1] = b1 < 0 ? 0 : m1 * f1;
    mixS[2] = a2; mixW[2] = m2 * (1 - f2);
    mixS[3] = b2; mixW[3] = b2 < 0 ? 0 : m2 * f2;
    for (let p = 0; p < 4; p++) {
      if (mixW[p] <= 0) continue;
      for (let q = p + 1; q < 4; q++) if (mixS[q] === mixS[p] && mixW[q] > 0) { mixW[p] += mixW[q]; mixW[q] = 0; }
    }
    let i1 = -1, i2 = -1;
    for (let p = 0; p < 4; p++) {
      if (mixW[p] <= 0) continue;
      if (i1 < 0 || mixW[p] > mixW[i1]) { i2 = i1; i1 = p; }
      else if (i2 < 0 || mixW[p] > mixW[i2]) i2 = p;
    }
    if (i1 < 0) return;
    const share = i2 < 0 ? 0 : mixW[i2] / (mixW[i1] + mixW[i2]);
    A[i] = mixS[i1];
    if (share < 0.02) { B[i] = -1; F[i] = 0; } else { B[i] = mixS[i2]; F[i] = share; }
  }
  // Adds m of loose glitter to cell i
  function addLoose(i, m, a, b, f) {
    mixInto(lA, lB, lF, i, Math.max(0, h[i] - stuck[i]), a, b, f, m);
    h[i] += m;
  }
  // Glitter bonding to the glue takes on the colour of the loose glitter it came from
  function setStuck(i, ns) {
    if (ns > stuck[i]) mixInto(sA, sB, sF, i, stuck[i], lA[i], lB[i], lF[i], ns - stuck[i]);
    stuck[i] = ns;
  }
  // One flake's colour, from the cell it left
  const pickSlot = (i) => (lB[i] >= 0 && Math.random() < lF[i] ? lB[i] : lA[i]);

  // The hidden word, "written" in glue by hand. Hand-laid glue is uneven: strokes swell
  // and pinch, some stretches are barely tacky, edges are ragged.
  // buildGlueBase() does the slow part once per pattern (lettering + noise);
  // applyGlue() turns it into a mask using each letter's settings, and is cheap.
  let GB = null;
  // Largest font size at which the word still fits inside the window
  function maxGlueSize() {
    const g = document.createElement('canvas').getContext('2d');
    g.font = `700 100px ${GLUE_FONT}`;
    const w100 = g.measureText(GLUE_TEXT).width || 130;
    return Math.max(16, Math.floor(Math.min(VW * 0.95 / (w100 / 100), VH * 0.9)));
  }
  function buildGlueBase() {
    const vw = VW, vh = VH;
    const g2 = document.createElement('canvas').getContext('2d');
    const size = Math.min(glueSize, maxGlueSize());
    const ks = size / 675;   // effects below were tuned for a ~675px word; scale them with the type
    flakePx = Math.min(5, Math.max(2, size * 0.014));          // glitter flakes in proportion to the strokes
    g2.font = `700 ${size}px ${GLUE_FONT}`;
    const m = g2.measureText(GLUE_TEXT);
    const tw = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
    const th = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
    const tx = vw / 2 - tw / 2 + m.actualBoundingBoxLeft;
    const ty = vh / 2 - th / 2 + m.actualBoundingBoxAscent;
    // Letter boundaries along x (script letters overlap a little; blend across the seam)
    const bounds = [];
    for (let i = 1; i < GLUE_TEXT.length; i++) bounds.push(tx + g2.measureText(GLUE_TEXT.slice(0, i)).width);

    // Soft lettering: draw small, scale up with smoothing. Its 0.5 contour sits on the
    // outline; lower/higher thresholds give wider/thinner strokes.
    const S = Math.max(2, Math.round(3 * Math.sqrt(size / 200)));
    const sm = document.createElement('canvas');
    sm.width = Math.ceil(vw / S); sm.height = Math.ceil(vh / S);
    const s2 = sm.getContext('2d');
    s2.scale(1 / S, 1 / S);
    s2.font = g2.font;
    s2.fillStyle = s2.strokeStyle = '#fff';
    s2.lineJoin = s2.lineCap = 'round';
    s2.lineWidth = size * 0.012;
    s2.fillText(GLUE_TEXT, tx, ty);
    s2.strokeText(GLUE_TEXT, tx, ty);
    const big = document.createElement('canvas');
    big.width = vw; big.height = vh;
    const b2 = big.getContext('2d');
    b2.imageSmoothingEnabled = true;
    b2.imageSmoothingQuality = 'high';
    b2.drawImage(sm, 0, 0, vw, vh);
    const src = b2.getImageData(0, 0, vw, vh).data;

    const off = glueSeed;
    const soft = new Float32Array(vw * vh);
    const idx = [];
    for (let k = 0; k < vw * vh; k++) { soft[k] = src[k * 4 + 3] / 255; if (soft[k] >= 0.03) idx.push(k); }
    const n = idx.length;
    const nW = new Float32Array(n), nB = new Float32Array(n), nT = new Float32Array(n);
    const li = new Uint8Array(n), lj = new Uint8Array(n), lt = new Float32Array(n);
    const SEAM = Math.max(1.5, size * 0.03);
    const gapF = 1 / (size * 0.11);                             // dry patches a little longer than a stroke is wide
    for (let q = 0; q < n; q++) {
      const pk = idx[q], x = pk % vw, y = (pk / vw) | 0;
      nW[q] = fbm(x * 0.010 / ks + off, y * 0.010 / ks);        // stroke swells and pinches
      nB[q] = vnoise(x * 0.09 / ks + off, y * 0.09 / ks);        // ragged edge
      nT[q] = fbm(x * gapF + off * 3, y * gapF + 7);              // where the glue ran dry
      let i = 0; while (i < bounds.length && x >= bounds[i]) i++;
      li[q] = lj[q] = i; lt[q] = 0;
      if (i < bounds.length && x > bounds[i] - SEAM) { lj[q] = i + 1; lt[q] = (x - (bounds[i] - SEAM)) / (2 * SEAM); }
      else if (i > 0 && x < bounds[i - 1] + SEAM) { li[q] = i - 1; lj[q] = i; lt[q] = (x - (bounds[i - 1] - SEAM)) / (2 * SEAM); }
      lt[q] = lt[q] * lt[q] * (3 - 2 * lt[q]);
    }
    // Rank-normalise the dryness noise so the Gaps slider reads as "share of the letter left bare"
    const bins = new Float32Array(513);
    for (let q = 0; q < n; q++) bins[Math.min(511, (nT[q] * 512) | 0) + 1]++;
    for (let b = 1; b <= 512; b++) bins[b] += bins[b - 1];
    for (let q = 0; q < n; q++) { const v = nT[q] * 512, b = Math.min(511, v | 0); nT[q] = (bins[b] + (bins[b + 1] - bins[b]) * (v - b)) / Math.max(1, n); }
    GB = { vw, vh, tw, th, soft, idx: Int32Array.from(idx), nW, nB, nT, li, lj, lt,
           px: new Uint8ClampedArray(vw * vh * 4), mask: new Float32Array(vw * vh) };

    // Glitter clings a little to bare paper too (static, oils, fibres): patchy, heavier
    // just around the letters where glue was smeared thin. Doesn't depend on the sliders.
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const cx = Math.min(vw - 1, Math.round((x + 0.5) * CELL)), cy = Math.min(vh - 1, Math.max(0, Math.round(vh - (y + 0.5) * CELL)));
      const patch = Math.max(0, fbm(x * 0.05 + off, y * 0.05) * 1.7 - 0.55);
      const halo = soft[cy * vw + cx];
      paperCap[y * W + x] = (0.003 + 0.03 * patch + 0.16 * halo * halo * 0.5) * (0.3 + 1.4 * ihash(x + 3, y + 11));
    }
  }

  function applyGlue() {
    const { vw, vh, soft, idx, nW, nB, nT, li, lj, lt, px, mask } = GB;
    px.fill(0); mask.fill(0);
    const P = letterParams;
    for (let q = 0; q < idx.length; q++) {
      const k = idx[q], a0 = P[li[q]], a1 = P[lj[q]], u = lt[q];
      const wd = a0.width + (a1.width - a0.width) * u;
      const gp = a0.gaps + (a1.gaps - a0.gaps) * u;
      const tk = a0.thickness + (a1.thickness - a0.thickness) * u;
      const t = 0.52 - wd * 0.22 + (nW[q] - 0.5) * 0.36 + (nB[q] - 0.5) * 0.14;
      let a = Math.min(1, Math.max(0, (soft[k] - t + 0.03) / 0.06));
      if (a === 0) continue;
      const cut = gp * 0.42, r = nT[q];                          // gp=1 leaves ~40% of the letter bare
      const hole = Math.min(1, Math.max(0, (r - cut) / 0.05));      // dry gap: no glue at all
      const near = Math.min(1, Math.max(0, (r - cut) / 0.3));
      a *= hole * (1 - gp * 0.45 * (1 - near));                     // glue thins out toward a gap
      a *= tk;
      mask[k] = a;
      px[k * 4] = px[k * 4 + 1] = px[k * 4 + 2] = 255;
      px[k * 4 + 3] = Math.round(a * 255);
    }
    // the ink: the word's glue, with anything drawn laid over it
    if (!ink || ink.width !== vw || ink.height !== vh) {
      ink = document.createElement('canvas');
      ink.width = vw; ink.height = vh;
      inkCtx = ink.getContext('2d', { willReadFrequently: true });
    }
    inkCtx.clearRect(0, 0, vw, vh);
    inkCtx.putImageData(new ImageData(px, vw, vh), 0, 0);
    if (holes) {                                                  // bits of the word that were erased
      inkCtx.globalCompositeOperation = 'destination-out';
      inkCtx.drawImage(holes, 0, 0);
      inkCtx.globalCompositeOperation = 'source-over';
    }
    if (strokes) inkCtx.drawImage(strokes, 0, 0);
    uploadInk();
    glue.fill(0);
    glueFromInk(0, 0, vw, vh);
  }

  // ---------- Ink: the glue as a CSS-px picture ----------
  let ink = null, inkCtx = null;
  function uploadInk() {
    gl.activeTexture(gl.TEXTURE1);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, ink);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.activeTexture(gl.TEXTURE0);
  }
  // Glue per sim cell from the ink inside a box (CSS px, top-down), averaging
  // four samples per cell. Only cells whose centre is in the box change.
  function glueFromInk(bx0, by0, bx1, by1) {
    const vw = ink.width, vh = ink.height, pad = CELL;
    const rx0 = Math.max(0, Math.floor(bx0 - pad)), ry0 = Math.max(0, Math.floor(by0 - pad));
    const rx1 = Math.min(vw, Math.ceil(bx1 + pad)), ry1 = Math.min(vh, Math.ceil(by1 + pad));
    if (rx1 <= rx0 || ry1 <= ry0) return;
    const bw = rx1 - rx0, bh = ry1 - ry0;
    const data = inkCtx.getImageData(rx0, ry0, bw, bh).data;
    const at = (cx, cyTop) => {
      const x = Math.min(bw - 1, Math.max(0, Math.round(cx - rx0))), y = Math.min(bh - 1, Math.max(0, Math.round(cyTop - ry0)));
      return data[(y * bw + x) * 4 + 3] / 255;
    };
    const q4 = CELL / 4;
    const x0 = Math.max(0, Math.floor(bx0 / CELL)), x1 = Math.min(W - 1, Math.ceil(bx1 / CELL));
    const y0 = Math.max(0, Math.floor((vh - by1) / CELL)), y1 = Math.min(H - 1, Math.ceil((vh - by0) / CELL));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const cx = (x + 0.5) * CELL, cyTop = vh - (y + 0.5) * CELL;   // sim rows run bottom-up
      if (cx < bx0 || cx > bx1 || cyTop < by0 || cyTop > by1) continue;
      glue[y * W + x] = (at(cx - q4, cyTop - q4) + at(cx + q4, cyTop - q4) + at(cx - q4, cyTop + q4) + at(cx + q4, cyTop + q4)) / 4;
    }
  }
  function makeGlue() { buildGlueBase(); applyGlue(); }

  // Show the finished piece straight away: only glitter held by glue (and a little by paper)
  function reveal() {
    const s = slotNow();
    for (let i = 0; i < h.length; i++) {
      const c = GLUE_DEPTH * glue[i] + paperCap[i];
      if (c > stuck[i] && (h[i] - stuck[i] <= 1e-4 || lA[i] < 0)) { lA[i] = s; lB[i] = -1; lF[i] = 0; }   // fills bare glue in the current colour
      setStuck(i, c); h[i] = c;
    }
    np = 0; carried = 0; flow.fill(0); vx.fill(0); vy.fill(0);
    active = 2; dirty = true;
  }

  // Glitter touching glue bonds to it; that layer can no longer be moved
  function absorb() {
    for (let i = 0; i < glue.length; i++) {
      const cap = GLUE_DEPTH * glue[i] + paperCap[i];
      if (stuck[i] < cap) setStuck(i, Math.min(h[i], cap));
    }
  }

  // Pour a heap centred at (cx, cy) in cells, radius r in cells
  // Pour glitter centred at (cx, cy) in cells.
  //   r       radius (cells)          peak    height at the centre (cells)
  //   shape   0 flat layer … 1 heap    stretch -1 tall … 1 wide
  //   rag     ragged outline 0…1       lumps   bumpy surface 0…1
  //   dust    stray glitter around it 0…1
  function pour(cx, cy, o) {
    const slot = slotNow();
    const { r, peak, shape = 0.1, stretch = 0, rag = 0.22, lumps = 0.5, dust = 0.5 } = o;
    const seedOff = Math.random() * 100;
    const sx = 1.08 * Math.pow(2, stretch * 0.8), sy = 0.85 * Math.pow(2, -stretch * 0.8);
    const ext = r * 2.4 * Math.max(sx, sy);
    const x0 = Math.max(1, Math.floor(cx - ext)), x1 = Math.min(W - 2, Math.ceil(cx + ext));
    const y0 = Math.max(1, Math.floor(cy - ext)), y1 = Math.min(H - 2, Math.ceil(cy + ext));
    const expo = 0.35 + 1.65 * shape;                            // profile: flat-topped … peaked
    const ragAmp = 0.4 * rag;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const dx = (x + 0.5 - cx) / sx, dy = (y + 0.5 - cy) / sy;
      const ang = Math.atan2(dy, dx);
      const rim = r * (1 + ragAmp * (fbm(Math.cos(ang) * 1.2 + seedOff, Math.sin(ang) * 1.2) - 0.5) * 2
                         + ragAmp * 0.35 * (fbm(Math.cos(ang) * 4 + seedOff, Math.sin(ang) * 4) - 0.5) * 2);
      const d = Math.hypot(dx, dy) / rim;
      if (d >= 1) {
        // Fine dust thrown around the heap: fades with distance, patchy like real spills
        if (dust <= 0 || d >= 1 + 0.9 * (0.4 + dust)) continue;
        const patch = fbm(x * 0.06 + seedOff * 2, y * 0.06);
        const m = dust * Math.exp(-(d - 1) * 4.0 / (0.4 + dust)) * Math.max(0, patch * 1.8 - 0.45);
        if (m > 0) addLoose(y * W + x, m, slot, -1, 0);
        continue;
      }
      const lump = (fbm(x * 0.09 + seedOff, y * 0.09) - 0.5) * 0.6 * lumps * peak * (1 - d);
      const m = Math.max(0, peak * Math.pow(1 - d, expo) * (1 - 0.3 * d * d) + lump);
      if (m > 0) addLoose(y * W + x, m, slot, -1, 0);
    }
    const strays = Math.round(3000 * dust * (r / 100));
    for (let k = 0; k < strays; k++) {
      const ang = Math.random() * Math.PI * 2, rd = r * (1 + Math.pow(Math.random(), 2) * (0.4 + 1.2 * dust));
      const x = Math.round(cx + Math.cos(ang) * rd * sx), y = Math.round(cy + Math.sin(ang) * rd * sy);
      if (x > 0 && y > 0 && x < W - 1 && y < H - 1) addLoose(y * W + x, 0.05 + Math.random() * 0.25, slot, -1, 0);
    }
    absorb();
    for (let k = 0; k < 40; k++) relax();
    active = 150; dirty = true;
  }

  // The main pour, from the pour settings. fit: shape the heap to just cover the bare
  // glue (for pouring again over a piece in progress) instead of the generous first pour.
  function pourMain(fit = false) {
    const P = pourParams;
    // Cover the glue that's still bare (so earlier colours are left alone); with none
    // bare, all of the glue: the word and anything drawn; with no glue, the middle
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (glue[i] < 0.15 || stuck[i] > 0.5 * GLUE_DEPTH * glue[i]) continue;
      const px = (x + 0.5) * CELL, py = VH - (y + 0.5) * CELL;
      if (px < bx0) bx0 = px; if (px > bx1) bx1 = px; if (py < by0) by0 = py; if (py > by1) by1 = py;
    }
    if (bx1 > bx0) { bx0 -= CELL; bx1 += CELL; by0 -= CELL; by1 += CELL; }
    else {
      if (GB && GB.tw > 0) { bx0 = (VW - GB.tw) / 2; bx1 = (VW + GB.tw) / 2; by0 = (VH - GB.th) / 2; by1 = (VH + GB.th) / 2; }
      if (inkBox) { bx0 = Math.min(bx0, inkBox.x0); by0 = Math.min(by0, inkBox.y0); bx1 = Math.max(bx1, inkBox.x1); by1 = Math.max(by1, inkBox.y1); }
    }
    const has = bx1 > bx0;
    const bw = has ? bx1 - bx0 : Math.min(VW, VH) * 0.55, bh = has ? by1 - by0 : Math.min(VW, VH) * 0.3;
    const mx = has ? (bx0 + bx1) / 2 : VW / 2, my = has ? (by0 + by1) / 2 : VH / 2;
    if (fit && has) {
      // an oval a bit bigger than the box (the rim is ragged and thin), stretched to its shape
      const rx = bw / 2 + 24, ry = bh / 2 + 24;
      const stretch = Math.max(-1.2, Math.min(1.2, Math.log2(rx / ry / 1.27) / 1.6));
      const sx = 1.08 * Math.pow(2, stretch * 0.8);
      pour(mx / CELL, (VH - my) / CELL, {
        r: 1.5 * rx / sx / CELL, peak: 1.5 + 38 * P.depth * P.depth,
        shape: P.shape, stretch, rag: P.rag, lumps: P.lumps, dust: P.dust,
      });
      return;
    }
    pour(mx / CELL, (VH - my) / CELL, {
      // Spread is relative to what it covers, so the pour keeps covering it at any size
      r: P.spread * 3 * Math.max(bw * 0.5, bh * 0.9) * (has ? 1 : 0.6) / CELL,
      peak: 1.5 + 38 * P.depth * P.depth,
      shape: P.shape, stretch: P.stretch, rag: P.rag, lumps: P.lumps, dust: P.dust,
    });
  }

  // Grains slide downhill wherever a slope is steeper than the angle of repose.
  // Powder that is already sliding keeps going on shallower slopes (momentum),
  // which gives glitter its fluid, pour-like run-out.
  const SQ2 = Math.SQRT2;
  function relax() {
    const D = [1, W, W + 1, W - 1], F = [1, 1, SQ2, SQ2];
    let moved = 0;
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const fi = flow[i] > 1 ? 1 : flow[i];
      for (let k = 0; k < 4; k++) {
        const j = i + D[k];
        const fj = flow[j] > 1 ? 1 : flow[j];
        const d = h[i] - h[j];
        if (d > 0) {
          const T = thr[i] * F[k] * (1 - 0.3 * fi);
          if (d <= T) continue;
          const t = Math.min((d - T) * 0.25, h[i] - stuck[i]);
          if (t <= 0) continue;
          h[i] -= t; addLoose(j, t, lA[i], lB[i], lF[i]); moved += t;
          flow[j] += t * 1.5;
          if (t > 0.03) seed[j] = (seed[j] + 1) % 1024;
        } else {
          const T = thr[i] * F[k] * (1 - 0.3 * fj);
          if (-d <= T) continue;
          const t = Math.min((-d - T) * 0.25, h[j] - stuck[j]);
          if (t <= 0) continue;
          h[j] -= t; addLoose(i, t, lA[j], lB[j], lF[j]); moved += t;
          flow[i] += t * 1.5;
          if (t > 0.03) seed[i] = (seed[i] + 1) % 1024;
        }
      }
    }
    return moved;
  }
  function decayFlow() { for (let i = 0; i < flow.length; i++) flow[i] *= 0.8; }

  function splat(x, y, m, a, b = -1, f = 0) {
    x -= 0.5; y -= 0.5;
    const xi = Math.floor(x), yi = Math.floor(y);
    if (xi < 1 || yi < 1 || xi >= W - 2 || yi >= H - 2) return;
    const fx = x - xi, fy = y - yi, i = yi * W + xi;
    addLoose(i, m * (1 - fx) * (1 - fy), a, b, f); addLoose(i + 1, m * fx * (1 - fy), a, b, f);
    addLoose(i + W, m * (1 - fx) * fy, a, b, f);   addLoose(i + W + 1, m * fx * fy, a, b, f);
  }

  // The finger presses down to a shallow floor and shoves the excess outward, biased forward
  function plow(cx, cy, fx, fy, R) {
    const x0 = Math.max(1, Math.floor(cx - R)), x1 = Math.min(W - 2, Math.ceil(cx + R));
    const y0 = Math.max(1, Math.floor(cy - R)), y1 = Math.min(H - 2, Math.ceil(cy + R));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const ox = x + 0.5 - cx, oy = y + 0.5 - cy, d = Math.hypot(ox, oy);
      if (d >= R) continue;
      const i = y * W + x;
      const ex = h[i] - Math.max(FLOOR + 0.6 * (d / R) * (d / R), stuck[i]);
      if (ex <= 0) continue;
      const take = ex * 0.7;
      h[i] -= take;
      seed[i] = (seed[i] + 1) % 1024;
      const cling = Math.min(take * 0.15, Math.max(0, CLING_MAX - carried));
      if (cling > 0 && (carried < 0.05 || Math.random() < cling / (carried + cling))) carriedSlot = pickSlot(i);
      carried += cling;                        // some sticks to the finger
      const pushed = take - cling;
      let ux = (d ? ox / d : Math.random() - 0.5) + fx * 1.2;
      let uy = (d ? oy / d : Math.random() - 0.5) + fy * 1.2;
      const ul = Math.hypot(ux, uy) || 1;
      ux /= ul; uy /= ul;
      const reach = R + 0.8 + Math.random() * 1.5;
      splat(cx + ux * reach, cy + uy * reach, pushed, lA[i], lB[i], lF[i]);
    }
    // The finger sheds a little of what clings to it, leaving a dusty trail behind
    const shed = carried * 0.04;
    carried -= shed;
    for (let k = 0; k < 3; k++) {
      const a = Math.random() * Math.PI * 2, rr = Math.random() * R * 0.8;
      splat(cx - fx * R * 0.7 + Math.cos(a) * rr, cy - fy * R * 0.7 + Math.sin(a) * rr, shed / 3, carriedSlot);
    }
    active = 150; dirty = true;
  }

  // ---------- Airborne flakes ----------
  // Flat flakes catch the air like sails: kicked up by fast strokes, they drift,
  // flutter and tumble (twinkling) before settling back into the powder.
  let np = 0;
  const P = {
    x: new Float32Array(MAXP), y: new Float32Array(MAXP), z: new Float32Array(MAXP),
    vx: new Float32Array(MAXP), vy: new Float32Array(MAXP), vz: new Float32Array(MAXP),
    m: new Float32Array(MAXP), spin: new Float32Array(MAXP), rate: new Float32Array(MAXP),
    axis: new Float32Array(MAXP), film: new Float32Array(MAXP), size: new Float32Array(MAXP),
    vt: new Float32Array(MAXP), fl: new Float32Array(MAXP), ph: new Float32Array(MAXP),
    c: new Int8Array(MAXP),                     // colour (palette slot)
  };
  function kick(cx, cy, fvx, fvy, R, count) {
    for (let k = 0; k < count && np < MAXP; k++) {
      const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * R;
      const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
      const xi = x | 0, yi = y | 0;
      if (xi < 1 || yi < 1 || xi >= W - 1 || yi >= H - 1) continue;
      const i = yi * W + xi, m = Math.min(0.06, h[i] - stuck[i] - 0.02);
      if (m <= 0.005) continue;
      h[i] -= m;
      const s = 0.04 + 0.12 * Math.random();
      spawn(x, y, fvx * s + (Math.random() - 0.5) * 30, fvy * s + (Math.random() - 0.5) * 30, 12 + Math.random() * 30, m, pickSlot(i));
    }
  }
  function spawn(x, y, vx, vy, vz, m, c) {
    if (np >= MAXP || c < 0) return;
    {
      const n = np++;
      P.x[n] = x; P.y[n] = y; P.z[n] = 0.5;
      P.vx[n] = vx; P.vy[n] = vy; P.vz[n] = vz;
      P.m[n] = m; P.c[n] = c;
      P.spin[n] = Math.random() * Math.PI * 2;
      P.rate[n] = (Math.random() < 0.5 ? -1 : 1) * (3 + Math.random() * 12);
      P.axis[n] = Math.random() * Math.PI * 2;
      P.film[n] = 250 + Math.random() * 350;
      P.size[n] = (1.6 + 3.4 * Math.random() * Math.random()) * flakePx / 5;
      P.vt[n] = 5 + Math.random() * 9;            // slow terminal fall: they float
      P.fl[n] = 3 + Math.random() * 6;            // flutter strength
      P.ph[n] = Math.random() * 100;
    }
  }
  // ---------- Blowing ----------
  // Someone blowing across the page (from the left by default). The breath leaves a mouth
  // just off the edge it comes from, as a cone of air that pushes glitter across and off
  // the far side. Real breath isn't steady: a strong first puff, gusts that rise and fall, the
  // breath running out, turbulent patches drifting with the air, and the stream wobbling
  // sideways. Only glitter bonded to the glue stays behind.
  let blowing = false, blow_ = 0, blowT = 0, wasBlowing = false;
  let blowAge = 0;                                             // total time spent blowing in this intro
  const hover = { x: 0, y: 0 };
  const WIND = { mx: 0, my: 0, aim: 0, gust: 0, t: 0, d0: 0, ca: 1, sa: 0 };   // this frame's breath
  const CONE = 0.5;                                            // half-width of the breath cone (radians)
  function updateBreath(dt, t) {
    if (blowing && !wasBlowing && blow_ < 0.1) blowT = 0;       // a fresh breath
    wasBlowing = blowing;
    if (blowing) { blowT += dt; blowAge += dt; }
    // Starts as a gentle breath and builds to full strength over the first ~2.5 s
    const u = Math.min(1, blowAge / 2.5), ramp = 0.25 + 0.75 * u * u * (3 - 2 * u);
    const puff = 0.4 * Math.exp(-Math.pow((blowT - 0.22) / 0.16, 2));          // first push of air
    const lungs = (1 - Math.exp(-blowT * 7)) * (0.75 + 0.25 * Math.exp(-blowT / 2.4));  // eases off a little
    let gusts = 0.6 + 0.6 * vnoise(t * 2.3, 1.7) + 0.35 * (vnoise(t * 6.1, 4.2) - 0.5);
    // Toward the end the breath steadies into one smooth push (no stuttering)
    const steady = intro.on ? Math.max(0, 1 - intro.left / 0.35) : 0;
    gusts += (1.05 - gusts) * steady;
    // A last strong push once most of it is gone, so stragglers shoot off instead of drifting
    const finale = intro.on ? 1 + 1.6 * Math.max(0, 1 - intro.left / 0.2) : 1;
    WIND.gust = blow_ * airParams.force * ramp * finale * Math.max(0, lungs * gusts + puff * ramp);
    const a = -airParams.dir * Math.PI / 180;                  // blowing direction (sim y points up)
    const ca = Math.cos(a), sa = Math.sin(a);
    const ext = 0.5 * (Math.abs(ca) * W + Math.abs(sa) * H);  // centre to page edge along the breath
    const D = ext + 0.35 * Math.max(W, H);                     // mouth sits a little beyond that edge
    WIND.mx = W / 2 - ca * D; WIND.my = H / 2 - sa * D;
    WIND.d0 = D - ext; WIND.ca = ca; WIND.sa = sa;
    WIND.aim = a + 0.16 * (vnoise(t * 0.9, 7.7) - 0.5);         // the stream sways a little
    WIND.t = t;
  }
  // Air at a point: strength and direction
  function windAt(x, y, out) {
    const rx = x - WIND.mx, ry = y - WIND.my, d = Math.hypot(rx, ry) || 1;
    const ang = Math.atan2(ry, rx);
    let off = ang - WIND.aim; off = Math.atan2(Math.sin(off), Math.cos(off));
    const cone = Math.exp(-(off / CONE) * (off / CONE));
    const fall = 0.7 + 0.3 / (1 + Math.max(0, d - WIND.d0) / (0.8 * W));     // a little weaker far from the mouth
    const drift = WIND.t * 55 * airParams.speed;                 // eddies travel with the air
    const ex = x - WIND.ca * drift, ey = y - WIND.sa * drift;
    const turb = 0.4 + 1.2 * vnoise(ex * 0.035, ey * 0.035 + 5);
    const side = (vnoise(ex * 0.05 + 30, ey * 0.05) - 0.5) * 0.9;           // sideways wobble
    out.f = WIND.gust * cone * fall * turb;
    out.ux = Math.cos(ang + side); out.uy = Math.sin(ang + side);
    return out;
  }
  const wv = { f: 0, ux: 0, uy: 0 };

  // ---------- The intro: a few uneven breaths until only the glued word is left ----------
  const intro = { on: false, done: false, phase: 'idle', t: 0, len: 0, breaths: 0, startMass: 1, left: 1, tick: 0 };
  function looseMass() {
    let m = 0;
    for (let i = 0; i < h.length; i++) { const v = h[i] - stuck[i]; if (v > 0) m += v; }
    return m;
  }
  // fresh: pour a new heap first (otherwise blow away what's already there)
  function playIntro(delay = 0, fresh = true) {
    if (fresh) reset();
    Object.assign(intro, { on: true, done: false, phase: 'wait', t: -delay, breaths: 0, startMass: Math.max(1, looseMass()), left: 1, tick: 0 });
    blowAge = 0;
    blowing = false;
  }
  function finishIntro() {
    Object.assign(intro, { on: false, done: true, phase: 'done' });
    blowing = false;
    opts.onReveal?.();
  }
  function stepIntro(dt) {
    if (!intro.on) return;
    intro.t += dt;
    if (++intro.tick % 6 === 0) intro.left = looseMass() / intro.startMass;   // share of loose glitter still on the page
    if (intro.phase === 'blow' && intro.left < 0.03) { finishIntro(); return; }
    if (intro.phase === 'wait' && intro.t >= 0) {
      Object.assign(intro, { phase: 'blow', t: 0, len: 2.2 + Math.random() * 0.8 }); blowing = true;
    } else if (intro.phase === 'blow' && intro.t > 9) {           // one continuous breath (safety stop at 9 s)
      Object.assign(intro, { phase: 'inhale', t: 0 }); intro.breaths++; blowing = false;
    } else if (intro.phase === 'inhale' && intro.t > 0.35 + Math.random() * 0.02) {
      if (intro.left < 0.03 || intro.breaths >= 6) finishIntro();
      else { Object.assign(intro, { phase: 'blow', t: 0, len: 1.4 + Math.random() * 0.9 }); blowing = true; }
    }
  }
  // Loose glitter carries its own velocity: a gust gets it moving, and when the air drops
  // it coasts and slows on the paper instead of freezing. Moving glitter keeps its speed
  // into calmer air and fans out sideways, so it thins into streaks on its way off the page.
  function stepBlow(dt) {
    const x0 = 1, x1 = W - 2, y0 = 1, y1 = H - 2;
    const k = dt * 60;
    const spd = airParams.speed;
    const speedUp = 1 - Math.exp(-dt * 7);                     // picks up a gust quickly
    const slowDown = 1 - Math.exp(-dt * 3.2);                  // coasts to a stop in ~0.3 s
    const windOn = WIND.gust > 0.01;
    let moving = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * W + x;
      const loose = h[i] - stuck[i];
      if (loose <= 0.002) { vx[i] = vy[i] = 0; continue; }
      let f = 0, tvx = 0, tvy = 0;
      if (windOn) {
        windAt(x + 0.5, y + 0.5, wv);
        f = wv.f * (1 - 0.6 * glue[i]);                          // wet glue holds loose glitter back
        const ts = (1 + 8 * f) * spd * Math.min(1, f * 2);       // speed the air would give it
        tvx = wv.ux * ts; tvy = wv.uy * ts;
      }
      const cur = vx[i] * vx[i] + vy[i] * vy[i], tgt = tvx * tvx + tvy * tvy;
      const r = tgt > cur ? speedUp : slowDown;
      vx[i] += (tvx - vx[i]) * r; vy[i] += (tvy - vy[i]) * r;
      const sp = Math.hypot(vx[i], vy[i]);
      if (sp < 0.05) continue;
      moving++;
      // How much of the column is on the move: what the gust lifts plus what's still coasting.
      // Thin layers go almost at once; deep heaps peel away layer by layer.
      const mob = (0.12 * f + 0.18 * f * f) * k + 0.06 * Math.min(sp, 4) * k;
      const m = Math.min(loose, loose * Math.min(1, mob) + (0.1 + 0.01 * loose) * f * k + 0.02 * sp * k);
      if (m < 1e-4) continue;
      const ux = vx[i] / sp, uy = vy[i] / sp, step = sp * k;
      const lat = (Math.random() - 0.5) * (0.6 + 0.35 * step);  // fans out sideways as it travels
      const tx = x + 0.5 + ux * step - uy * lat + (Math.random() - 0.5) * 0.6;
      const ty = y + 0.5 + uy * step + ux * lat + (Math.random() - 0.5) * 0.6;
      dh[i] -= m; outM[i] += m;
      const sx = tx - 0.5, sy = ty - 0.5, xi = Math.floor(sx), yi = Math.floor(sy);
      if (xi >= 1 && yi >= 1 && xi < W - 2 && yi < H - 2) {     // past the edge: blown off the page
        const fx = sx - xi, fy = sy - yi, j = yi * W + xi;
        const w00 = (1 - fx) * (1 - fy) * m, w10 = fx * (1 - fy) * m, w01 = (1 - fx) * fy * m, w11 = fx * fy * m;
        dh[j] += w00; dh[j + 1] += w10; dh[j + W] += w01; dh[j + W + 1] += w11;
        const ca = lA[i], cb = lB[i], cf = lF[i];               // its colours travel with it
        mixInto(iA, iB, iF, j, mIn[j], ca, cb, cf, w00);         mixInto(iA, iB, iF, j + 1, mIn[j + 1], ca, cb, cf, w10);
        mixInto(iA, iB, iF, j + W, mIn[j + W], ca, cb, cf, w01); mixInto(iA, iB, iF, j + W + 1, mIn[j + W + 1], ca, cb, cf, w11);
        mIn[j] += w00; mIn[j + 1] += w10; mIn[j + W] += w01; mIn[j + W + 1] += w11;
        const ax = vx[i], ay = vy[i];                            // the glitter brings its momentum along
        pX[j] += w00 * ax; pX[j + 1] += w10 * ax; pX[j + W] += w01 * ax; pX[j + W + 1] += w11 * ax;
        pY[j] += w00 * ay; pY[j + 1] += w10 * ay; pY[j + W] += w01 * ay; pY[j + W + 1] += w11 * ay;
      }
      seed[i] = (seed[i] + 1) % 1024;
      // Some flakes catch the air and lift (flat flakes act like sails)
      if (f > 0 && m > 0.01 && Math.random() < f * f * 0.12 * k) {
        const lift = Math.min(m * 0.5, 0.05);
        dh[i] -= lift; outM[i] += lift;
        const psp = (40 + 110 * f * Math.random()) * spd;
        spawn(x + 0.5, y + 0.5, wv.ux * psp, wv.uy * psp, 4 + 14 * Math.random(), lift, pickSlot(i));
      }
    }
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * W + x;
      if (dh[i] === 0 && mIn[i] === 0) continue;
      const inSlot = iA[i];
      if (mIn[i] > 0) {                                          // mix incoming momentum (and colour) with what stayed
        const stay = Math.max(0, h[i] - stuck[i] - outM[i]), tot = stay + mIn[i];
        vx[i] = (vx[i] * stay + pX[i]) / tot; vy[i] = (vy[i] * stay + pY[i]) / tot;
        mixInto(lA, lB, lF, i, stay, iA[i], iB[i], iF[i], mIn[i]);
        iA[i] = -1; iB[i] = -1; iF[i] = 0;
      }
      h[i] = Math.max(h[i] + dh[i], 0);
      // Glitter blowing across glue gets caught: strokes build up unevenly, thickest
      // where the stream hits them first. Glue that's already coated only builds up
      // more of its own colour, so other colours blow over it without speckling it.
      if (dh[i] > 0 && glue[i] > 0) {
        let room = GLUE_DEPTH * glue[i] + paperCap[i] - stuck[i];
        if (inSlot >= 0 && inSlot === sA[i] && sB[i] < 0) room += GLUE_DEPTH * glue[i] * 0.8;
        if (room > 0) setStuck(i, stuck[i] + Math.min(dh[i] * 0.4, room));
      }
      dh[i] = 0; mIn[i] = 0; pX[i] = 0; pY[i] = 0; outM[i] = 0;
      if (stuck[i] > h[i]) stuck[i] = h[i];
    }
    active = 150; dirty = true;
    return moving;
  }

  function stepParticles(dt, t) {
    const drag = Math.exp(-4 * dt);
    for (let n = 0; n < np; n++) {
      P.vx[n] *= drag; P.vy[n] *= drag;
      P.vz[n] = Math.max(P.vz[n] - 60 * dt, -P.vt[n]);
      const falling = P.vz[n] < 0 ? 1 : 0.3;
      const wind = 6 * (vnoise(P.x[n] * 0.02, t * 0.2) - 0.5);
      const windY = 6 * (vnoise(P.y[n] * 0.02 + 40, t * 0.2) - 0.5);
      const fa = Math.sin(t * 4 + P.ph[n]) * P.fl[n] * falling;
      const fb = Math.cos(t * 3.1 + P.ph[n] * 1.7) * P.fl[n] * falling;
      if (WIND.gust > 0.03) {
        windAt(P.x[n], P.y[n], wv);
        const push = 170 * wv.f;
        P.vx[n] += wv.ux * push * dt; P.vy[n] += wv.uy * push * dt;
      }
      P.x[n] += (P.vx[n] + wind + fa) * dt;
      P.y[n] += (P.vy[n] + windY + fb) * dt;
      P.z[n] += P.vz[n] * dt;
      P.spin[n] += P.rate[n] * dt;
      const gone = P.x[n] < -10 || P.y[n] < -10 || P.x[n] > W + 10 || P.y[n] > H + 10;   // well off screen
      const inside = P.x[n] >= 1 && P.y[n] >= 1 && P.x[n] < W - 2 && P.y[n] < H - 2;
      if (P.z[n] <= 0 || gone) {
        if (P.z[n] <= 0 && inside) {
          splat(P.x[n], P.y[n], P.m[n], P.c[n]);
          const i = (P.y[n] | 0) * W + (P.x[n] | 0);
          seed[i] = (seed[i] + 1) % 1024;
          active = Math.max(active, 30); dirty = true;
        }
        const last = --np;                         // swap-remove
        for (const k in P) P[k][n] = P[k][last];
        n--;
      }
    }
  }

  // ---------- Starting over ----------
  // heap: pour a fresh heap over the glue; otherwise leave the paper bare
  function reset(heap = true) {
    h.fill(0); seed.fill(0); flow.fill(0); stuck.fill(0); vx.fill(0); vy.fill(0);
    lA.fill(-1); lB.fill(-1); sA.fill(-1); sB.fill(-1);
    np = 0; carried = 0;
    if (heap) pourMain(); else { active = 2; dirty = true; }
  }

  // ---------- Sprinkling glitter by hand ----------
  // Rains glitter onto a disc around (cx, cy) in cells: thickest in the middle,
  // grainy at the rim, with the odd stray grain beyond it.
  function sprinkle(cx, cy, R, amount) {
    const slot = slotNow();
    const x0 = Math.max(1, Math.floor(cx - R * 1.6)), x1 = Math.min(W - 2, Math.ceil(cx + R * 1.6));
    const y0 = Math.max(1, Math.floor(cy - R * 1.6)), y1 = Math.min(H - 2, Math.ceil(cy + R * 1.6));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / R;
      const i = y * W + x;
      if (d < 1) addLoose(i, amount * (1 - d * d) * (0.35 + Math.random()), slot, -1, 0);
      else if (d < 1.6 && Math.random() < 0.06) addLoose(i, amount * 0.4 * Math.random(), slot, -1, 0);
      else continue;
      seed[i] = (seed[i] + 1) % 1024;
    }
    active = 150; dirty = true;
  }

  // ---------- Glue the person draws ----------
  // Strokes go into their own canvas (so they survive resizes and word changes);
  // the ink canvas is the word's glue with the strokes laid over it.
  // Erasing cuts holes in the word's glue too, kept in their own canvas.
  let strokes = null, strokesCtx = null, holes = null, holesCtx = null, inkBox = null, inkDirty = false, strokeLen = 0;
  function makeStrokes(vw, vh) {
    const grow = (old) => {
      const c = document.createElement('canvas');
      c.width = vw; c.height = vh;
      if (old) c.getContext('2d').drawImage(old, Math.round((vw - old.width) / 2), Math.round((vh - old.height) / 2));
      return c;
    };
    if (inkBox && strokes) {
      const ox = Math.round((vw - strokes.width) / 2), oy = Math.round((vh - strokes.height) / 2);
      inkBox = { x0: inkBox.x0 + ox, y0: inkBox.y0 + oy, x1: inkBox.x1 + ox, y1: inkBox.y1 + oy };
    }
    strokes = grow(strokes); strokesCtx = strokes.getContext('2d');
    holes = grow(holes); holesCtx = holes.getContext('2d');
  }
  // A hand-laid line of glue from (x0, y0) to (x1, y1), CSS px: it swells and
  // pinches as it goes, like glue squeezed from a bottle.
  function glueLine(x0, y0, x1, y1) {
    const w = opts.glueWidth;
    const d = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.ceil(d / (w * 0.2)));
    for (let k = 0; k <= n; k++) {
      const t = k / n, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
      const r = w * 0.5 * (0.7 + 0.6 * vnoise(strokeLen * 0.035 + k * d / n * 0.035, glueSeed));
      for (const c of [strokesCtx, inkCtx]) {
        c.fillStyle = '#fff';
        c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
      }
    }
    strokeLen += d;
    const pad = w;
    const bx0 = Math.min(x0, x1) - pad, by0 = Math.min(y0, y1) - pad, bx1 = Math.max(x0, x1) + pad, by1 = Math.max(y0, y1) + pad;
    inkBox = inkBox ? { x0: Math.min(inkBox.x0, bx0), y0: Math.min(inkBox.y0, by0), x1: Math.max(inkBox.x1, bx1), y1: Math.max(inkBox.y1, by1) }
                    : { x0: bx0, y0: by0, x1: bx1, y1: by1 };
    glueFromInk(bx0, by0, bx1, by1);
    absorb();
    inkDirty = true; dirty = true;
  }
  // Erases glue along a line (CSS px). Glitter stuck to that glue comes away with it.
  function eraseLine(x0, y0, x1, y1) {
    const r = opts.eraserSize / 2;
    for (const c of [strokesCtx, inkCtx, holesCtx]) {
      c.save();
      if (c !== holesCtx) c.globalCompositeOperation = 'destination-out';
      c.strokeStyle = c.fillStyle = '#000';
      c.lineWidth = r * 2; c.lineCap = 'round';
      c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
      c.beginPath(); c.arc(x1, y1, r, 0, Math.PI * 2); c.fill();
      c.restore();
    }
    const bx0 = Math.min(x0, x1) - r, by0 = Math.min(y0, y1) - r, bx1 = Math.max(x0, x1) + r, by1 = Math.max(y0, y1) + r;
    glueFromInk(bx0, by0, bx1, by1);
    const cx0 = Math.max(0, Math.floor(bx0 / CELL) - 1), cx1 = Math.min(W - 1, Math.ceil(bx1 / CELL) + 1);
    const cy0 = Math.max(0, Math.floor((VH - by1) / CELL) - 1), cy1 = Math.min(H - 1, Math.ceil((VH - by0) / CELL) + 1);
    for (let y = cy0; y <= cy1; y++) for (let x = cx0; x <= cx1; x++) {
      const i = y * W + x, cap = GLUE_DEPTH * glue[i] + paperCap[i];
      if (stuck[i] > cap) { h[i] = Math.max(0, h[i] - (stuck[i] - cap)); stuck[i] = cap; }
    }
    inkDirty = true; dirty = true;
  }
  function clearGlue() {
    strokesCtx.clearRect(0, 0, strokes.width, strokes.height);
    holesCtx.clearRect(0, 0, holes.width, holes.height);
    inkBox = null; strokeLen = 0;
    applyGlue();
    // glitter that was stuck to the wiped glue is loose now: the next blow takes it
    for (let i = 0; i < stuck.length; i++) {
      const cap = GLUE_DEPTH * glue[i] + paperCap[i];
      if (stuck[i] > cap) { mixInto(lA, lB, lF, i, Math.max(0, h[i] - stuck[i]), sA[i], sB[i], sF[i], stuck[i] - cap); stuck[i] = cap; }
    }
    active = Math.max(active, 2); dirty = true;
  }

  const light = { x: -0.25, y: 0.35 };   // fixed light, upper left

  // ---------- Size ----------
  // The canvas fills whatever box it's given; the glitter keeps its scale (one
  // cell is always 4 CSS px), so a bigger box means more room, not bigger grains.
  let dpr = 1, resizeTimer = 0;
  function measure() {
    VW = Math.max(16, Math.round(canvas.clientWidth));
    VH = Math.max(16, Math.round(canvas.clientHeight));
    dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(VW * dpr);
    canvas.height = Math.round(VH * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
  // After a resize: a new grid, with the old glitter carried over, centred
  function regrid() {
    const oW = W, oH = H, old = h && { h, stuck, lA, lB, lF, sA, sB, sF };
    makeStrokes(VW, VH);                                           // drawn glue moves with the centre too
    alloc();
    if (old) {
      const ox = Math.round((W - oW) / 2), oy = Math.round((H - oH) / 2);
      const cur = { h, stuck, lA, lB, lF, sA, sB, sF };
      for (let y = 0; y < oH; y++) {
        const ny = y + oy;
        if (ny < 0 || ny >= H) continue;
        for (let x = 0; x < oW; x++) {
          const nx = x + ox;
          if (nx < 0 || nx >= W) continue;
          const i = ny * W + nx, o = y * oW + x;
          for (const k in cur) cur[k][i] = old[k][o];
        }
      }
    }
    absorb();
    active = 30; dirty = true;
  }
  const ro = new ResizeObserver(() => {
    if (!ready || destroyed) return;
    const w = Math.round(canvas.clientWidth), hh = Math.round(canvas.clientHeight);
    if (w === VW && hh === VH) return;
    measure();
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (!destroyed) regrid(); }, 150);
  });

  // ---------- Input ----------
  // Tools: 'glue' draws glue, 'glitter' sprinkles glitter, 'push' ploughs
  // through it (a fast flick throws flakes into the air). Holding still for a
  // moment (any tool) is a long press: the breath blows the loose glitter away.
  const HOLD_MS = 450;
  let hold = null, touch = null;
  const local = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  // CSS px → sim cells; the sim's rows run bottom-up, the screen's top-down
  const toCell = (px, py) => [px / CELL, (VH - py) / CELL];
  const cancelHold = () => { if (hold) { clearTimeout(hold.timer); hold = null; } };
  const fingerR = () => Math.max(1.5, opts.pushSize / CELL);       // cells

  function onDown(e) {
    if (!ready || destroyed || !opts.interactive) return;
    if (e.button !== undefined && e.button !== 0) return;
    canvas.setPointerCapture?.(e.pointerId);
    const [px, py] = local(e);
    cancelHold();
    if (opts.blowOnLongPress && !intro.on) {
      hold = { x: px, y: py, timer: setTimeout(() => { hold = null; blow(); }, HOLD_MS) };
    }
    const [x, y] = toCell(px, py);
    touch = { id: e.pointerId, px, py, x, y, t: performance.now() };
    if (opts.tool === 'glue') glueLine(px, py, px, py);
    else if (opts.tool === 'erase') eraseLine(px, py, px, py);
    else if (opts.tool === 'glitter') sprinkle(x, y, opts.brushSize / CELL, opts.amount);
    else plow(x, y, 0, 0, fingerR() * 0.8);                       // a dent where it lands
  }
  function onMove(e) {
    if (hold && Math.hypot(local(e)[0] - hold.x, local(e)[1] - hold.y) > 10) cancelHold();
    if (!touch || e.pointerId !== touch.id) return;
    const [px, py] = local(e);
    const [x, y] = toCell(px, py);
    const dx = x - touch.x, dy = y - touch.y, d = Math.hypot(dx, dy);
    if (d < 0.5) return;
    if (opts.tool === 'glue') {
      glueLine(touch.px, touch.py, px, py);
    } else if (opts.tool === 'erase') {
      eraseLine(touch.px, touch.py, px, py);
    } else if (opts.tool === 'glitter') {
      const R = opts.brushSize / CELL, steps = Math.ceil(d / (R * 0.4));
      for (let k = 1; k <= steps; k++) sprinkle(touch.x + dx * k / steps, touch.y + dy * k / steps, R, opts.amount * 0.5);
    } else {
      // at least a frame apart: events can arrive in the same instant, and a
      // near-zero gap would read as an impossibly fast flick
      const now = performance.now(), dt = Math.max(16, now - touch.t) / 1000;
      const R = fingerR(), steps = Math.ceil(d / (R * 0.5));        // no gaps on fast strokes
      for (let k = 1; k <= steps; k++) plow(touch.x + dx * k / steps, touch.y + dy * k / steps, dx / d, dy / d, R);
      const speed = d / dt;                                        // cells per second
      if (speed > 120) {
        const s = Math.min(1, 500 / speed);                        // even a wild flick throws flakes only so fast
        kick(x, y, dx / dt * s, dy / dt * s, R, Math.min(40, (speed / 12) | 0));
      }
    }
    Object.assign(touch, { px, py, x, y, t: performance.now() });
  }
  function onUp(e) { cancelHold(); if (touch && e.pointerId === touch.id) touch = null; }
  const noMenu = (e) => e.preventDefault();                       // a long touch would otherwise open the menu
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('contextmenu', noMenu);

  // ---------- Actions ----------
  function blow() {
    if (!ready || intro.on) return;
    if (reduceMotion) { reveal(); finishIntro(); return; }         // no motion: straight to the finished piece
    playIntro(0, false);
  }
  function setWord(word) {
    GLUE_TEXT = word || '';
    letterParams = [...GLUE_TEXT].map((_, i) => ({ ...(DEFAULT_LETTERS[i] || { width: 0, gaps: 0.5, thickness: 0.85 }) }));
    makeGlue();
    absorb();
    dirty = true;
  }
  function setColor() {
    colorState.holo = opts.shimmer;           // the colour itself is picked up when glitter is next added
  }

  // ---------- Loop ----------
  const start = performance.now();
  let lastNow = performance.now(), blowMoving = 0, raf = 0, visible = true;
  const io = new IntersectionObserver(([en]) => { visible = en.isIntersecting; });
  io.observe(canvas);
  function frame(now) {
    if (destroyed) return;
    raf = requestAnimationFrame(frame);
    if (!ready || !visible) { lastNow = now; return; }
    const t = (now - start) / 1000;
    const dt = Math.min((now - lastNow) / 1000, 0.05);
    lastNow = now;

    stepIntro(dt);
    blow_ += ((blowing ? 1 : 0) - blow_) * Math.min(1, dt * (blowing ? 5 : 8));
    updateBreath(dt, t);
    if (blow_ > 0.02 || blowMoving > 0) blowMoving = stepBlow(dt);
    if (np > 0) stepParticles(dt, t);
    if (active > 0) {
      relax(); relax(); decayFlow(); absorb();
      active--; dirty = true;
    }
    if (inkDirty) { uploadInk(); inkDirty = false; }
    if (dirty) {
      for (let i = 0, n = W * H; i < n; i++) {
        buf[4 * i] = h[i]; buf[4 * i + 1] = seed[i]; buf[4 * i + 2] = Math.min(stuck[i], GLUE_DEPTH * glue[i]);
        // Colours as palette slots. Where there's hardly any loose glitter, what shows
        // as loose is the glitter stuck to the paper, so it takes the stuck colours.
        let sa = sA[i], sb = sB[i], sf = sF[i];
        let la = lA[i], lb = lB[i], lf = lF[i];
        if (sa < 0) { sa = la; sb = lb; sf = lf; }
        if (la < 0 || h[i] - stuck[i] < 0.02) { la = sa; lb = sb; lf = sf; }
        if (la < 0) la = 0; if (sa < 0) sa = 0;
        colBuf[4 * i] = la * 16 + (lb < 0 ? la : lb); colBuf[4 * i + 1] = Math.round(lf * 255);
        colBuf[4 * i + 2] = sa * 16 + (sb < 0 ? sa : sb); colBuf[4 * i + 3] = Math.round(sf * 255);
      }
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.FLOAT, buf);
      gl.activeTexture(gl.TEXTURE2);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, colBuf);
      gl.activeTexture(gl.TEXTURE0);
      dirty = false;
    }

    gl.useProgram(prog);
    gl.bindVertexArray(quadVao);
    gl.uniform2f(U.uRes, canvas.width, canvas.height);
    gl.uniform1f(U.uTime, reduceMotion ? 0 : t);
    gl.uniform1f(U.uDpr, dpr);
    gl.uniform2f(U.uLight, light.x, light.y);
    gl.uniform2f(U.uGrid, W, H);
    gl.uniform1f(U.uCell, CELL);
    gl.uniform3fv(U.uPal, palRgb);
    gl.uniform1f(U.uHolo, colorState.holo);
    gl.uniform1f(U.uFlakePx, flakePx);
    gl.uniform3fv(U.uPaper, paperRgb);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    if (np > 0) {
      for (let n = 0; n < np; n++) {
        const o = n * PSTRIDE;
        pdata[o] = P.x[n]; pdata[o + 1] = P.y[n]; pdata[o + 2] = P.z[n]; pdata[o + 3] = P.size[n];
        pdata[o + 4] = P.spin[n]; pdata[o + 5] = P.axis[n]; pdata[o + 6] = P.film[n]; pdata[o + 7] = P.c[n];
      }
      gl.useProgram(pprog);
      gl.bindVertexArray(pVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, pbuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, pdata, 0, np * PSTRIDE);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform2f(PU.uRes, canvas.width, canvas.height);
      gl.uniform1f(PU.uDpr, dpr);
      gl.uniform1f(PU.uCell, CELL);
      gl.uniform3fv(PU.uPal, palRgb);
      gl.uniform1f(PU.uHolo, colorState.holo);
      gl.uniform2f(PU.uLight, light.x, light.y);
      gl.uniform1f(PU.uShadow, 1);
      gl.drawArrays(gl.POINTS, 0, np);
      gl.uniform1f(PU.uShadow, 0);
      gl.drawArrays(gl.POINTS, 0, np);
      gl.disable(gl.BLEND);
    }
  }

  // ---------- Start ----------
  measure();
  ro.observe(canvas);
  raf = requestAnimationFrame(frame);
  // The glue lettering needs its script font: load it (unless told not to),
  // wait for it, then pour
  loadFont(opts.loadFont ? GLUE_FONT_URL : null).then(() => document.fonts.load(`700 100px ${GLUE_FONT}`)).catch(() => {}).finally(() => {
    if (destroyed) return;
    makeStrokes(VW, VH);
    alloc();
    reset(opts.heap);
    if (opts.autoBlow) { if (reduceMotion) { reveal(); finishIntro(); } else playIntro(0.6, false); }
    ready = true;
    opts.onReady?.();
  });

  return {
    /** Change any option on the fly (colour, tool, sizes, word, …) */
    set(o) {
      const wordChanged = 'word' in o && (o.word || '') !== GLUE_TEXT;
      Object.assign(opts, o);
      if ('color' in o || 'shimmer' in o) setColor();
      if ('paper' in o) paperRgb.set(hexToRgb(opts.paper));
      if (wordChanged && ready) setWord(opts.word);
      else if (wordChanged) GLUE_TEXT = opts.word || '';
    },
    /** The breath: blows loose glitter away, leaving what's stuck to the glue */
    blow,
    /** Pour a heap of glitter, in the current colour, over the bare glue (or the middle,
        if there's no glue). What's already on the paper stays. */
    pour() { if (ready) { if (intro.on) Object.assign(intro, { on: false, phase: 'idle' }); blowing = false; pourMain(true); } },
    /** Sweep all glitter off, keeping the glue */
    clear() { if (ready) { if (intro.on) Object.assign(intro, { on: false, phase: 'idle' }); blowing = false; reset(false); } },
    /** Wipe the drawn glue (the word, if any, comes back whole). Glitter that was
        stuck to it comes loose. */
    clearGlue() { if (ready) clearGlue(); },
    /** Skip to the finished piece: only the glitter held by glue */
    reveal() { if (ready) { reveal(); finishIntro(); } },
    /** Stop everything and free the GPU */
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      clearTimeout(resizeTimer);
      cancelHold();
      ro.disconnect(); io.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('contextmenu', noMenu);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}
