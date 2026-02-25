// fix_perf.cjs — replaces lines 129-348 (1-indexed) of styles.css with
// clean, performant CSS that has ZERO CSS vars inside @keyframes
const fs = require("fs");
const path = require("path");

const cssPath = path.join(__dirname, "src", "styles.css");
const src = fs.readFileSync(cssPath, "utf8");

// Split preserving line endings
const lines = src.split(/(?<=\n)/);

const REMOVE_START = 128; // 0-indexed (=line 129)
const REMOVE_END = 348; // 0-indexed exclusive (removes through line 348)

const replacement = `
/* ─── aurora background (pure CSS — no CSS vars inside @keyframes) ───
   PERF CONTRACT: @keyframes contain ZERO CSS var() references.
   GPU can pre-compute and cache them. JS only updates .aurora-bg transform.
   This eliminates the main source of style-recalc jank on iOS Safari PWA.
*/
.aurora-bg {
  position: absolute;
  inset: -14%;
  z-index: -1;
  overflow: hidden;
  pointer-events: none;
  border-radius: inherit;
  filter: blur(48px);
  will-change: transform;
  contain: paint;
}

.aurora-bg::after {
  content: "";
  position: absolute;
  inset: 0;
  background: rgba(4, 8, 18, 0.40);
  z-index: 1;
}

.aurora-orb {
  position: absolute;
  border-radius: 50%;
  mix-blend-mode: screen;
  will-change: transform;
}

.aurora-orb-1 {
  width: 80%;
  height: 95%;
  top: -22%;
  left: -12%;
  background: radial-gradient(ellipse at center,
      var(--accent) 0%,
      color-mix(in srgb, var(--accent) 45%, transparent) 48%,
      transparent 72%);
  opacity: 0.88;
  animation: auroraOrb1 9s ease-in-out infinite alternate;
}

.aurora-orb-2 {
  width: 85%;
  height: 88%;
  top: 10%;
  right: -18%;
  background: radial-gradient(ellipse at center,
      var(--accent-2) 0%,
      color-mix(in srgb, var(--accent-2) 38%, transparent) 50%,
      transparent 74%);
  opacity: 0.82;
  animation: auroraOrb2 13s ease-in-out infinite alternate;
}

.aurora-orb-3 {
  width: 68%;
  height: 74%;
  bottom: -18%;
  left: 12%;
  background: radial-gradient(ellipse at center,
      color-mix(in srgb, var(--accent) 60%, var(--accent-2)) 0%,
      color-mix(in srgb, var(--accent) 28%, transparent) 54%,
      transparent 76%);
  opacity: 0.72;
  animation: auroraOrb3 11s ease-in-out infinite alternate;
}

.aurora-orb-4 {
  width: 52%;
  height: 62%;
  top: 22%;
  left: 24%;
  background: radial-gradient(ellipse at center,
      color-mix(in srgb, var(--accent-2) 65%, var(--accent)) 0%,
      color-mix(in srgb, var(--accent-2) 22%, transparent) 52%,
      transparent 78%);
  opacity: 0.60;
  animation: auroraOrb4 17s ease-in-out infinite alternate;
}

/* STATIC keyframes — zero CSS var() refs, fully GPU pre-computable */
@keyframes auroraOrb1 {
  from { transform: translate(0%,   0%)   scale(1.00); }
  33%  { transform: translate(16%,  -10%) scale(1.07); }
  67%  { transform: translate(-7%,  18%)  scale(0.95); }
  to   { transform: translate(28%,  6%)   scale(1.04); }
}

@keyframes auroraOrb2 {
  from { transform: translate(0%,   0%)   scale(1.00); }
  40%  { transform: translate(-20%, 13%)  scale(1.09); }
  75%  { transform: translate(10%,  -18%) scale(0.91); }
  to   { transform: translate(-28%, 4%)   scale(1.03); }
}

@keyframes auroraOrb3 {
  from { transform: translate(0%,   0%)   scale(1.00); }
  50%  { transform: translate(18%,  -16%) scale(1.11); }
  to   { transform: translate(-14%, 10%)  scale(0.93); }
}

@keyframes auroraOrb4 {
  from { transform: translate(0%,   0%)   scale(1.00); }
  30%  { transform: translate(-16%, 12%)  scale(1.05); }
  70%  { transform: translate(20%,  -9%)  scale(0.97); }
  to   { transform: translate(9%,   18%)  scale(1.07); }
}

`;

const newLines = [...lines.slice(0, REMOVE_START), replacement, ...lines.slice(REMOVE_END)];
fs.writeFileSync(cssPath, newLines.join(""), "utf8");

console.log(`Done. Removed ${REMOVE_END - REMOVE_START} lines (129-348), inserted clean aurora CSS.`);
console.log(`Original: ${lines.length} lines, new: ~${newLines.length} entries`);
