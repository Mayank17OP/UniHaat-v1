/**
 * Generates the UniHaat product illustrations as lightweight SVG line-art.
 *
 * Why local SVGs: the prototype must render identically offline, and stock
 * photo hosts are unreliable in sandboxes. These are hand-drawn-feeling
 * line illustrations in the brand palette — deliberate, not placeholder grey.
 *
 * Usage: node scripts/make-assets.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "assets");
fs.mkdirSync(out, { recursive: true });

const PAPER = "#FFF3E0";
const INK = "#161210";
const ACCENT = "#FF4D1C";
const GREEN = "#0E4D2E";
const MUSTARD = "#FFB81C";

/** Wrap illustration body in the shared frame. */
const svg = (body, bg = PAPER) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" width="800" height="600" role="img">
<rect width="800" height="600" fill="${bg}"/>
<g fill="none" stroke="${INK}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round">${body}</g>
</svg>
`;

const ART = {
  "table-chair": svg(`
<path d="M110 230h300v26H110z" fill="#fff"/>
<path d="M140 256v180M380 256v180M140 436h240"/>
<path d="M230 256v60h80v-60"/>
<path d="M255 282h30"/>
<path d="M110 230v-18h300v18" stroke-width="7"/>
<path d="M500 260h170v20H500z" fill="#fff"/>
<path d="M520 280v160M650 280v160"/>
<path d="M500 260v-56h170v56" stroke-width="7"/>
<path d="M520 204v56M650 204v56"/>
<path d="M500 204h170" stroke="${ACCENT}"/>
<path d="M500 440h170" stroke="${GREEN}" stroke-width="9"/>
`),

  iphone: svg(`
<rect x="280" y="110" width="240" height="380" rx="34" fill="#fff"/>
<rect x="305" y="155" width="190" height="270" rx="14" stroke="${INK}" stroke-width="7"/>
<path d="M355 135h90" stroke-width="8"/>
<path d="M360 400h80" stroke="${ACCENT}" stroke-width="8"/>
<circle cx="400" cy="455" r="14" stroke-width="7"/>
<path d="M215 175v150" stroke="${GREEN}" stroke-width="10"/>
`),

  calculator: svg(`
<rect x="285" y="95" width="230" height="410" rx="24" fill="#fff"/>
<rect x="320" y="140" width="160" height="70" rx="10" stroke="${GREEN}" stroke-width="7"/>
<path d="M340 180h60" stroke="${GREEN}" stroke-width="7"/>
<g stroke-width="7">
<rect x="320" y="250" width="42" height="42" rx="9"/><rect x="377" y="250" width="42" height="42" rx="9"/>
<rect x="434" y="250" width="42" height="42" rx="9" fill="${MUSTARD}" stroke="${INK}"/>
<rect x="320" y="310" width="42" height="42" rx="9"/><rect x="377" y="310" width="42" height="42" rx="9"/>
<rect x="434" y="310" width="42" height="42" rx="9"/>
<rect x="320" y="370" width="42" height="42" rx="9"/><rect x="377" y="370" width="42" height="42" rx="9"/>
<rect x="434" y="370" width="42" height="42" rx="9"/>
</g>
`),

  cycle: svg(`
<circle cx="245" cy="400" r="110"/><circle cx="555" cy="400" r="110"/>
<path d="M245 400l90-190 90 190H245l130-190h145"/>
<path d="M335 210h-60M395 210h120"/>
<path d="M425 400l-40-190"/>
<circle cx="335" cy="180" r="18" stroke="${ACCENT}"/>
<path d="M300 400h80" stroke="${GREEN}" stroke-width="11"/>
`),

  mattress: svg(`
<rect x="130" y="270" width="540" height="130" rx="24" fill="#fff"/>
<path d="M130 300h540M130 340h540M130 380h540" stroke-width="5" stroke="${INK}" opacity=".35"/>
<path d="M130 400v70M670 400v70"/>
<rect x="170" y="235" width="180" height="42" rx="21" fill="${MUSTARD}" stroke="${INK}"/>
<path d="M400 270v130" stroke="${ACCENT}" stroke-width="8"/>
`),

  books: svg(`
<rect x="180" y="360" width="440" height="60" rx="8" fill="${ACCENT}" stroke="${INK}"/>
<rect x="210" y="290" width="380" height="60" rx="8" fill="${MUSTARD}" stroke="${INK}"/>
<rect x="240" y="220" width="320" height="60" rx="8" fill="#fff" stroke="${INK}"/>
<path d="M300 360v60M250 290v60M280 220v60"/>
<path d="M130 440h540" stroke="${GREEN}" stroke-width="9"/>
`),

  kettle: svg(`
<path d="M300 230h200l-24 190H324z" fill="#fff"/>
<path d="M300 230l24-60h128l24 60"/>
<path d="M352 170v-40h96v40"/>
<path d="M500 280c60 10 60 110-10 130" stroke-width="11"/>
<path d="M300 270h200" stroke="${GREEN}" stroke-width="8"/>
<path d="M280 440h240"/>
<path d="M330 320h60" stroke="${ACCENT}" stroke-width="8"/>
`),

  "laptop-keyboard": svg(`
<path d="M270 170h260v170H270z" fill="#fff"/>
<path d="M270 170l-30 60h290l-30-60"/>
<path d="M250 340h300l60 70H190z" fill="#fff"/>
<path d="M320 375h160M300 405h200" stroke-width="6"/>
<circle cx="400" cy="230" r="34" stroke="${ACCENT}" stroke-width="8"/>
`),

  fridge: svg(`
<rect x="270" y="100" width="260" height="400" rx="20" fill="#fff"/>
<path d="M270 220h260"/>
<path d="M300 250v70M500 250v70" stroke-width="11"/>
<path d="M330 150h60" stroke="${ACCENT}" stroke-width="8"/>
<path d="M300 500v30M500 500v30"/>
<path d="M270 180h-40M270 280h-40" stroke="${GREEN}" stroke-width="9"/>
`),

  guitar: svg(`
<path d="M400 90v230" stroke-width="11"/>
<path d="M370 70h60"/>
<path d="M400 320c-70 0-115 55-115 105s45 105 115 105 115-55 115-105-45-105-115-105z" fill="#fff"/>
<circle cx="400" cy="425" r="38" stroke="${INK}" stroke-width="8"/>
<path d="M360 120h80M360 170h80" stroke-width="6"/>
<path d="M330 520h140" stroke="${GREEN}" stroke-width="9"/>
`),

  "lab-coat": svg(`
<path d="M330 130l-110 60 40 90 50-25v245h180V255l50 25 40-90-110-60z" fill="#fff"/>
<path d="M400 130v370M340 210l60 90 60-90"/>
<circle cx="400" cy="270" r="10" fill="${INK}"/>
<circle cx="400" cy="330" r="10" fill="${INK}"/>
<circle cx="400" cy="390" r="10" fill="${ACCENT}"/>
<path d="M330 130l70 60 70-60" />
`),

  lamp: svg(`
<path d="M300 120h200l-40 90H340z" fill="${MUSTARD}" stroke="${INK}"/>
<path d="M400 210v190"/>
<path d="M320 400h160l30 50H290z" fill="#fff"/>
<path d="M340 150h120" stroke="${ACCENT}" stroke-width="8"/>
<path d="M400 240c-40 0-70 30-70 70" stroke="${GREEN}" stroke-width="8"/>
`),

  printer: svg(`
<rect x="230" y="230" width="340" height="140" rx="16" fill="#fff"/>
<path d="M280 230v-90h240v90"/>
<rect x="290" y="370" width="220" height="130" rx="8" fill="#fff"/>
<path d="M330 410h140M330 445h140" stroke-width="6"/>
<circle cx="510" cy="285" r="14" fill="${ACCENT}" stroke="${INK}"/>
<path d="M230 300h-40M570 300h40" stroke="${GREEN}" stroke-width="9"/>
`),

  bundle: svg(`
<rect x="140" y="300" width="250" height="150" rx="14" fill="#fff"/>
<path d="M140 345h250M140 400h250"/>
<path d="M200 300v150M330 300v150"/>
<path d="M450 250h180v26H450z" fill="${MUSTARD}" stroke="${INK}"/>
<path d="M470 276v110M610 276v110M470 386h140"/>
<path d="M420 160h160l-30 70h-100z" fill="${ACCENT}" stroke="${INK}"/>
<path d="M500 230v-60"/>
`),
};

for (const [name, content] of Object.entries(ART)) {
  fs.writeFileSync(path.join(out, `${name}.svg`), content);
}
console.log(`✓ wrote ${Object.keys(ART).length} illustrations to assets/`);
