#!/usr/bin/env node
/**
 * Generate 4 capture formats from an asciicast v2 recording:
 *   1. wblackwhite.txt     — plain text (no colors)
 *   2. wcolor.txt          — text with ANSI color escape codes
 *   3. wblackwhite-photo.png — monochrome PNG (white on dark bg)
 *   4. wcolor-photo.png    — full color PNG
 */

import * as fs from "fs";
import * as path from "path";
import xtermHeadless from "@xterm/headless";
import { Resvg } from "@resvg/resvg-js";

const { Terminal } = xtermHeadless;

// --- Config ---
const CAST_FILE = process.argv[2];
const OUT_DIR = process.argv[3] || path.dirname(CAST_FILE);

if (!CAST_FILE) {
  console.error("Usage: node gen-captures.mjs <file.cast> [output-dir]");
  process.exit(1);
}

// --- Color constants ---
const CM_DEFAULT = 0;
const CM_P16 = 0x1000000;
const CM_P256 = 0x2000000;
const CM_RGB = 0x3000000;

const palette16 = [
  '#282c34', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#abb2bf',
  '#5c6370', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#ffffff',
];
const BG_COLOR = '#282c34';
const FG_COLOR = '#abb2bf';
const MONO_FG = '#d4d4d4';

function color256(n) {
  if (n < 16) return palette16[n];
  if (n < 232) {
    n -= 16;
    return `rgb(${Math.floor(n/36)*51},${Math.floor((n%36)/6)*51},${(n%6)*51})`;
  }
  const g = (n - 232) * 10 + 8;
  return `rgb(${g},${g},${g})`;
}

function resolveColor(color, mode, isBg) {
  if (mode === CM_DEFAULT || color < 0) return isBg ? BG_COLOR : FG_COLOR;
  if (mode === CM_P16) return palette16[color] || (isBg ? BG_COLOR : FG_COLOR);
  if (mode === CM_P256) return color < 16 ? palette16[color] : color256(color);
  if (mode === CM_RGB) return `rgb(${(color>>16)&0xff},${(color>>8)&0xff},${color&0xff})`;
  return isBg ? BG_COLOR : FG_COLOR;
}

function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// --- Replay cast file ---
const lines = fs.readFileSync(CAST_FILE, "utf-8").split("\n").filter(l => l.trim());
const header = JSON.parse(lines[0]);
const cols = header.width || 120;
const rows = header.height || 40;

const term = new Terminal({ cols, rows, scrollback: 0, allowProposedApi: true });

// Collect all output data
const events = [];
for (let i = 1; i < lines.length; i++) {
  try {
    const ev = JSON.parse(lines[i]);
    if (ev[1] === "o") events.push(ev[2]);
  } catch {}
}

// Write all data and wait for processing
for (const data of events) {
  await new Promise(resolve => term.write(data, resolve));
}

const buffer = term.buffer.active;

// --- 1. Plain text (wblackwhite.txt) ---
const plainLines = [];
for (let y = 0; y < rows; y++) {
  const line = buffer.getLine(y);
  plainLines.push(line ? line.translateToString(true) : "");
}
while (plainLines.length > 0 && plainLines[plainLines.length - 1].trim() === "") plainLines.pop();
fs.writeFileSync(path.join(OUT_DIR, "wblackwhite.txt"), plainLines.join("\n") + "\n");
console.log("wrote wblackwhite.txt");

// --- 2. ANSI color text (wcolor.txt) ---
const ansiLines = [];
for (let y = 0; y < rows; y++) {
  const line = buffer.getLine(y);
  if (!line) { ansiLines.push(""); continue; }

  let s = "";
  let lFg = -999, lFgM = -999, lBg = -999, lBgM = -999;
  let lBold = false, lDim = false, lItalic = false, lUl = false;

  for (let x = 0; x < line.length; x++) {
    const cell = line.getCell(x);
    if (!cell) continue;
    const ch = cell.getChars();
    const fg = cell.getFgColor(), fgM = cell.getFgColorMode();
    const bg = cell.getBgColor(), bgM = cell.getBgColorMode();
    const bold = cell.isBold() === 1, dim = cell.isDim() === 1;
    const italic = cell.isItalic() === 1, ul = cell.isUnderline() === 1;

    if (fg !== lFg || fgM !== lFgM || bg !== lBg || bgM !== lBgM ||
        bold !== lBold || dim !== lDim || italic !== lItalic || ul !== lUl) {
      const sgr = [];
      if (lFgM !== -999) sgr.push("0");
      if (bold) sgr.push("1");
      if (dim) sgr.push("2");
      if (italic) sgr.push("3");
      if (ul) sgr.push("4");
      if (fgM === CM_P16) sgr.push(fg < 8 ? `${30+fg}` : `${90+fg-8}`);
      else if (fgM === CM_P256) sgr.push(`38;5;${fg}`);
      else if (fgM === CM_RGB) sgr.push(`38;2;${(fg>>16)&0xff};${(fg>>8)&0xff};${fg&0xff}`);
      if (bgM === CM_P16) sgr.push(bg < 8 ? `${40+bg}` : `${100+bg-8}`);
      else if (bgM === CM_P256) sgr.push(`48;5;${bg}`);
      else if (bgM === CM_RGB) sgr.push(`48;2;${(bg>>16)&0xff};${(bg>>8)&0xff};${bg&0xff}`);
      if (sgr.length > 0) s += `\x1b[${sgr.join(";")}m`;
      lFg = fg; lFgM = fgM; lBg = bg; lBgM = bgM;
      lBold = bold; lDim = dim; lItalic = italic; lUl = ul;
    }
    s += ch || " ";
  }
  if (lFgM !== -999) s += "\x1b[0m";
  ansiLines.push(s);
}
while (ansiLines.length > 0 && ansiLines[ansiLines.length-1].replace(/\x1b\[[0-9;]*m/g,"").trim() === "") ansiLines.pop();
fs.writeFileSync(path.join(OUT_DIR, "wcolor.txt"), ansiLines.join("\n") + "\n");
console.log("wrote wcolor.txt");

// --- SVG builder helper ---
function buildSvg(useColor) {
  const fontFamily = 'JetBrains Mono';
  const charW = 8.4, charH = 17;
  const padX = 16, padY = 44, padBottom = 12;
  const width = cols * charW + padX * 2;
  const height = rows * charH + padY + padBottom;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<defs><style>text { font-family: '${fontFamily}'; font-size: 13px; }</style></defs>
<rect width="${width}" height="${height}" rx="10" ry="10" fill="${BG_COLOR}"/>
<circle cx="20" cy="18" r="6" fill="#ff5f57"/>
<circle cx="40" cy="18" r="6" fill="#febc2e"/>
<circle cx="60" cy="18" r="6" fill="#28c840"/>
`;

  for (let y = 0; y < rows; y++) {
    const line = buffer.getLine(y);
    if (!line) continue;

    // Render each character individually at its exact grid position
    for (let x = 0; x < cols; x++) {
      const cell = line.getCell(x);
      if (!cell) continue;
      const ch = cell.getChars();
      if (!ch || ch === ' ') continue;

      const bold = cell.isBold() === 1;
      const cx = padX + x * charW;
      const cy = padY + y * charH + charH - 4;

      let fg;
      if (useColor) {
        fg = resolveColor(cell.getFgColor(), cell.getFgColorMode(), false);
        // Render non-default backgrounds
        const bg = resolveColor(cell.getBgColor(), cell.getBgColorMode(), true);
        if (bg !== BG_COLOR) {
          svg += `<rect x="${cx}" y="${padY + y*charH}" width="${charW}" height="${charH}" fill="${bg}"/>`;
        }
      } else {
        fg = MONO_FG;
      }

      const w = bold ? ' font-weight="bold"' : '';
      svg += `<text x="${cx}" y="${cy}" fill="${fg}"${w}>${escapeXml(ch)}</text>\n`;
    }
  }

  svg += '</svg>';
  return svg;
}

function svgToPng(svg) {
  const fontDirs = [path.join(process.env.HOME, '.local/share/fonts')];
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: Math.round((cols * 8.4 + 32) * 2) },
    font: {
      loadSystemFonts: false,
      fontDirs,
      defaultFontFamily: 'JetBrains Mono',
    },
  });
  return Buffer.from(resvg.render().asPng());
}

// --- 3. Black & white PNG ---
const bwSvg = buildSvg(false);
fs.writeFileSync(path.join(OUT_DIR, "wblackwhite-photo.png"), svgToPng(bwSvg));
console.log("wrote wblackwhite-photo.png");

// --- 4. Color PNG ---
const colorSvg = buildSvg(true);
fs.writeFileSync(path.join(OUT_DIR, "wcolor-photo.png"), svgToPng(colorSvg));
console.log("wrote wcolor-photo.png");

term.dispose();
console.log("done!");
