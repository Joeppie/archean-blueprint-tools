// xcdocs.ts — THE FUNCTION-REFERENCE DOCS (v1.16.14, the user: "there is no
// descriptions on the function names for e.g. blank; nothing shows up when
// mouseovering, telling me what it is or where it comes from"). One lookup
// table for every callable/constant/section word the editor can place the
// caret on: sig + one-line desc + ORIGIN (where it comes from). The Library
// side-tab tables (XC_LIB_DOC / XC_GLOBAL_CONSTS, curated over the eras) are
// REUSED, not duplicated (one concept = one word); the language functions
// are the interpreter's registry (tools/xenoncode/upstream/XenonCode.hpp
// `{"name", "(args):type", …}` — signatures read from the binary table)
// with descriptions transcribed from the shipped wiki
// (wiki/en/xenoncode/documentation.md, offline per §Local sources).
// THE COVERAGE LAW (xcdocs.test): every name in the analyzer's vocabulary
// sets (XC_LANG_FUNCTIONS ∪ XC_SHIM_FUNCTIONS), the panel/beacon members
// and the keywords/sections has an entry HERE — `blank` firing this feature
// was a vocabulary entry with no doc.
import { XC_LIB_DOC, XC_GLOBAL_CONSTS, XC_KEYWORDS } from './xcproject';
import { XC_LANG_FUNCTIONS, XC_SHIM_FUNCTIONS } from './xcanalyze';

export interface XCDoc { sig: string; desc: string; origin: string }

const GROUP_ORIGIN: Record<string, string> = {
  io: 'component-io function — declared by the computer’s device shim (xc_host)',
  screen: 'screen function — bare for the current panel, trailing on a $surf object (device shim)',
  device: 'device function — declared by the computer’s device shim (xc_host)',
  system: 'system function — the computer’s device shim (xc_host)',
  value: 'value getter — the computer’s device shim (xc_host)',
  recipe: 'Crafter recipe function — the computer’s device shim (xc_host)',
  worldsim: 'worldsim function — the computer’s device shim (xc_host)',
};
const LANG = 'XenonCode language function — the interpreter (XenonCode.hpp)';

/** the interpreter's language registry — sigs from the binary table,
 *  descriptions transcribed from the shipped wiki (documentation.md) */
const LANGUAGE_DOCS: Record<string, [string, string]> = {
  abs: ['abs(n)', 'absolute value'],
  acos: ['acos(n)', 'arc cosine (radians)'],
  add: ['add(a, b, …)', 'sum of numbers/vectors/matrices (the + operator as a call)'],
  angle: ['angle(v1, v2)', 'angle between two vectors (radians)'],
  append: ['append(array, v1, …)', 'append one or more values to the end of an array'],
  asin: ['asin(n)', 'arc sine (radians)'],
  atan: ['atan(n)', 'arc tangent (radians)'],
  avg: ['avg(a | n1, n2, …)', 'arithmetic mean of an array or argument list'],
  ceil: ['ceil(n)', 'round up to the nearest integer'],
  clamp: ['clamp(n, min, max)', 'clamp a value into a range'],
  clear: ['clear(array)', 'remove every item from an array'],
  contains: ['contains(haystack, value)', '1 when the array/text contains the value, else 0'],
  cos: ['cos(n)', 'cosine of radians'],
  cross: ['cross(v1, v2)', '3-D vector cross product'],
  determinant: ['determinant(m)', 'determinant of a matrix'],
  distance: ['distance(a, b)', 'euclidean distance between two points/vectors'],
  div: ['div(a, b)', 'integer division (the / operator as a call)'],
  dot: ['dot(v1, v2)', 'vector dot product'],
  erase: ['erase(array, index [, end])', 'remove one element (or a range) from an array'],
  fill: ['fill(array, qty, value)', 'resize and fill an array (clears previous values)'],
  find: ['find(haystack, needle [, from])', 'index of a substring/value, -1 when absent'],
  floor: ['floor(n)', 'round down to the nearest integer'],
  fract: ['fract(n)', 'fractional part of a number'],
  from: ['from(array, source [, sep])', 'set an array from another array or split text (also reverses on a text)'],
  hash: ['hash(text)', 'stable numeric hash of a string'],
  if: ['if(cond, a, b)', 'conditional EXPRESSION — a when cond is true, else b'],
  insert: ['insert(array, index, value)', 'insert a value, pushing later items back'],
  isnumeric: ['isnumeric(v)', '1 when the value parses as a number, else 0'],
  inverse: ['inverse(m)', 'inverse of a matrix'],
  last: ['last(array | text)', 'the last item of an array / character of a text'],
  length: ['length(v)', 'length of a vector (component magnitudes as x/y/z)'],
  lerp: ['lerp(a, b, t)', 'linear interpolation between a and b by t (0..1)'],
  log: ['log(n [, base])', 'logarithm (natural, or with an explicit base)'],
  lower: ['lower(text)', 'the lowercase version of a text'],
  max: ['max(a, b, …)', 'largest value'],
  med: ['med(array)', 'median value of an array'],
  min: ['min(a, b, …)', 'smallest value'],
  mod: ['mod(n, divisor)', 'modulo (remainder)'],
  mul: ['mul(a, b)', 'product (the * operator as a call; scales vectors/matrices)'],
  normalize: ['normalize(v)', 'scale a vector to unit length'],
  pop: ['pop(array)', 'remove the last value, shrinking the array by one'],
  pow: ['pow(base, exponent)', 'exponentiation'],
  replace: ['replace(text, from, to)', 'replace every occurrence of a substring'],
  round: ['round(n)', 'round to the nearest integer'],
  sign: ['sign(n [, d])', '-1 / 0 / +1, with an optional sign for zero'],
  sin: ['sin(n)', 'sine of radians'],
  size: ['size(array | text)', 'item count of an array; character count of a text'],
  smoothstep: ['smoothstep(e1, e2, n)', 'hermite interpolation between two edges'],
  sort: ['sort(array)', 'sort an array ascending'],
  sortd: ['sortd(array)', 'sort an array descending'],
  sqrt: ['sqrt(n)', 'square root'],
  step: ['step(edge, n) | step(e1, e2, n)', '0 below the edge, 1 at/above it'],
  sub: ['sub(a, b)', 'difference (the - operator as a call)'],
  substring: ['substring(text, at [, len])', 'a slice of a text'],
  sum: ['sum(array | n1, …)', 'sum of an array or argument list'],
  tan: ['tan(n)', 'tangent of radians'],
  text: ['text(format, vars…)', 'printf-style formatting into a text (%d, %s, %f…)'],
  transpose: ['transpose(m)', 'transpose of a matrix'],
  upper: ['upper(text)', 'the uppercase version of a text'],
};

const SCREEN_DRAW: Record<string, [string, string]> = {
  write: ['write(x, y, color, text)', 'draw text at a character cell'],
  blank: ['blank(color)', 'clear the whole surface to one color'],
  text_size: ['text_size(w, h)', 'set the character cell size (px)'],
  text_align: ['text_align(n)', 'set text alignment (left/center/right modes)'],
  newline_spacing: ['newline_spacing(n)', 'extra px between written text lines'],
  draw: ['draw(x, y, color, w, h)', 'legacy rect: x, y, COLOR, width, height (computer.md)'],
  draw_point: ['draw_point(x, y, color)', 'one pixel'],
  draw_line: ['draw_line(x1, y1, x2, y2, color)', 'a line between two points'],
  draw_rect: ['draw_rect(x1, y1, x2, y2, color)', 'a rectangle (corners; fill by width 0)'],
  draw_triangle: ['draw_triangle(x1, y1, x2, y2, x3, y3, color)', 'a triangle'],
  draw_circle: ['draw_circle(x, y, r, color [, fill])', 'a circle (center, radius; filled when fill is set)'],
  draw_poly: ['draw_poly(color, x1, y1, …)', 'a closed polygon from point pairs'],
  pixel: ['pixel(x, y)', 'read the color value of one pixel'],
  button: ['button(x, y, color, w, h):number', 'legacy button (COLOR 3rd) — true when clicked'],
  button_rect: ['button_rect(x, y, w, h, color):number', 'draws AND evaluates true if clicked this cycle'],
  button_circle: ['button_circle(x, y, r, color):number', 'the round twin — true when clicked INSIDE the circle'],
};
const SHIM_SYSTEM: Record<string, [string, string]> = {
  beacon: ['beacon(tx, rx):beacon', 'join a radio frequency pair — a beacon object (.data, .transmit)'],
  panel: ['panel(anchor, w, h):panel', 'a HUD panel surface — the drawable object (.width/.set_size/.set_position; anchor words like top_left)'],
  get: ['get(name):text', 'read a worldsim channel value by name'],
  set: ['set(name, text)', 'write text into a worldsim channel'],
  get_recipes_categories: ['get_recipes_categories():text', 'the Crafter recipe categories, KV text'],
  ipc: ['ipc(message, data)', 'inter-computer message on the router net'],
  mouse_x: ['mouse_x', 'player mouse X (px) — HUD/player contexts'],
  mouse_y: ['mouse_y', 'player mouse Y (px)'],
  mouse_look: ['mouse_look', '1 while mouse-look is active'],
  fov: ['fov', 'the player viewport field-of-view'],
  set_cps: ['set_cps(n)', 'HUD: set this panel\'s cycles-per-second (FORMAT §HUD cadence law)'],
  set_resolution_scale: ['set_resolution_scale(n)', 'HUD: the panel DPI hint'],
  start_craft: ['start_craft(item, qty)', 'ask the Crafter to build — progress/pixel feedback'],
  cancel_craft: ['cancel_craft()', 'cancel the running craft order'],
  enough_power: ['enough_power():number', '1 when the computer\'s power net feeds it (the shim\'s power answer)'],
  fluid_level: ['fluid_level():number', 'the connected fluid tank level (0..1)'],
  progress: ['progress(p)', 'report build progress (0..1) on the Crafter face'],
};
const PANEL_DOCS: Record<string, [string, string]> = {
  x: ['x', 'left edge (px) — trailing .x on a panel object (player screen)'],
  y: ['y', 'top edge (px) — trailing .y on a panel object (player screen)'],
  width: ['width', 'width in px — trailing .width on a screen/panel object'],
  height: ['height', 'height in px — trailing .height on a screen/panel object'],
  set_size: ['set_size(w, h)', 'resize the HUD panel (the wiki hud.md law the guide HUD calls live)'],
  set_position: ['set_position(x, y)', 'place the panel at player-screen px (the SCREEN window composites it there)'],
};
const BEACON_DOCS: Record<string, [string, string]> = {
  transmit: ['transmit(text)', 'send a text over the beacon’s radio pair (beaconpair events)'],
};
const SECTION_DOCS: Record<string, string> = {
  init: 'the body that runs ONCE when the computer is powered on',
  update: 'the body that runs every cycle (the 25 Hz cadence)',
  click: 'runs when the panel/screen is clicked (x, y as arguments)',
  click_hold: 'runs every cycle WHILE the panel is held down',
  tick: 'the cycle counter (a value) — also a HUD entry section',
  timer: 'a body that runs repeatedly at its declared Hz',
  frequency: 'the timer frequency (Hz) declared for a timer section',
  interval: 'the timer interval declared for a timer section',
  input: 'the input entry — runs when a cabled channel delivers a value',
  shutdown: 'the body that runs when the computer loses power',
  output: 'send a value through a data port (in a function body)',
  include: 'pull another file on the disk into the compile',
  function: 'declare a user function (@name, optional :return-type)',
  recursive: 'declare a @function that may call itself',
  var: 'declare a variable (0 / "" default)',
  const: 'declare a compile-time constant',
  storage: 'declare a variable persisted across power cycles',
  if: 'branch on a condition',
  elseif: 'branch, after if, on a new condition',
  else: 'branch, after all conditions failed',
  for: 'loop over an index range',
  foreach: 'loop over every item of an array',
  while: 'loop while the condition holds',
  repeat: 'loop n times',
  break: 'end the loop as if all iterations completed',
  continue: 'skip to the next iteration',
  return: 'stop the function here and return a value',
  and: 'logical and',
  or: 'logical or',
  xor: 'logical xor',
  not: 'logical not',
  number: 'a number type cast ($v:number) / declaration type',
  text: 'a text type / declaration type',
};

function build(): Map<string, XCDoc> {
  const m = new Map<string, XCDoc>();
  for (const f of XC_LIB_DOC)
    m.set(f.name, { sig: f.sig, desc: f.desc, origin: GROUP_ORIGIN[f.group] ?? 'the computer’s device shim' });
  for (const c of XC_GLOBAL_CONSTS)
    m.set(c.name, {
      sig: c.name,
      desc: c.desc + ('hex' in c && c.hex ? ` (${String(c.hex)})` : ''),
      origin: c.kind === 'align'
        ? 'a panel anchor constant — panel(anchor, w, h) (the shim declares it)'
        : c.kind === 'math'
          ? 'a built-in global constant (pi, 2pi — the shim declares it)'
          : 'a built-in color constant (the shim declares it)',
    });
  for (const [n, [sig, desc]] of Object.entries(LANGUAGE_DOCS))
    m.set(n, { sig, desc, origin: LANG });
  for (const [n, [sig, desc]] of Object.entries(SCREEN_DRAW))
    m.set(n, { sig, desc, origin: 'a screen function — bare on the current panel, trailing on a $surf object (the device shim)' });
  for (const [n, [sig, desc]] of Object.entries(SHIM_SYSTEM))
    m.set(n, { sig, desc, origin: 'a device function — the computer’s device shim (xc_host)' });
  for (const [n, [sig, desc]] of Object.entries(PANEL_DOCS))
    m.set(n, { sig, desc, origin: 'a HUD panel object member (panel())' });
  for (const [n, [sig, desc]] of Object.entries(BEACON_DOCS))
    m.set(n, { sig, desc, origin: 'a beacon object member (beacon(tx, rx))' });
  for (const [n, desc] of Object.entries(SECTION_DOCS))
    m.set(n, { sig: n, desc, origin: 'a XenonCode keyword / section word' });
  return m;
}
const XC_DOCS_ALL = build();

/** the reference entry for a word under the caret (lowercased lookup);
 *  undefined = not a known callable/constant/keyword. */
export function xcDoc(name: string): XCDoc | undefined {
  return XC_DOCS_ALL.get(name.toLowerCase());
}

/** the coverage sets the test pins walk (kept exported for the law) */
export const XC_DOC_VOCAB_SOURCES = {
  lang: [...XC_LANG_FUNCTIONS],
  shim: [...XC_SHIM_FUNCTIONS],
  panel: Object.keys(PANEL_DOCS),
  beacon: Object.keys(BEACON_DOCS),
  keywords: [...XC_KEYWORDS, ...Object.keys(SECTION_DOCS)],
};
