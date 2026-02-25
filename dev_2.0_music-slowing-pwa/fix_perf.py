"""
Replaces lines 129-348 (inclusive, 1-indexed) of styles.css with clean,
performant CSS that has NO CSS vars inside calc() inside @keyframes or
transform properties that update on every JS tick.
"""
import sys

css_path = r"S:\PROJECTS\Other\Music Slowing App\dev_2.0_music-slowing-pwa\src\styles.css"

with open(css_path, "r", encoding="utf-8") as f:
    lines = f.readlines()

# Lines 129-348 (0-indexed: 128-347) are the performance-killing CSS
# We'll replace them with clean aurora orbs
REMOVE_START = 128  # 0-indexed (line 129 in 1-indexed)
REMOVE_END   = 348  # 0-indexed exclusive (line 348 in 1-indexed, so remove up to and including line 348)

replacement = """\

/* \u2500\u2500\u2500 aurora background (pure CSS \u2014 no CSS vars inside @keyframes or transform calc) \u2500\u2500\u2500
   PERF CONTRACT: The @keyframes contain ZERO CSS var() references.
   GPU can pre-compute and cache them. JS only updates transform on .aurora-bg.
   This eliminates the main source of style-recalc jank on iOS.
*/
.aurora-bg {
  position: absolute;
  inset: -14%;
  z-index: -1;
  overflow: hidden;
  pointer-events: none;
  border-radius: inherit;
  /* JS updates only: transform via style.setProperty on the element directly */
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

/* STATIC keyframes \u2014 zero CSS var() references, fully GPU pre-computable */
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

"""

new_lines = lines[:REMOVE_START] + [replacement] + lines[REMOVE_END:]

with open(css_path, "w", encoding="utf-8", newline="") as f:
    f.writelines(new_lines)

print(f"Done. Replaced lines 129-348 (0-indexed {REMOVE_START}-{REMOVE_END}).")
print(f"Original line count: {len(lines)}, new: {len(new_lines)}")
