import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const currentNotesPath = process.argv[2];
const outputPath = process.argv[3];

if (!currentNotesPath || !outputPath) {
  console.error(
    'Usage: node scripts/render-release-notes.mjs <current-notes> <output>',
  );
  process.exit(1);
}

const startMarker = '<!-- skills-hub-release-preamble:start -->';
const endMarker = '<!-- skills-hub-release-preamble:end -->';
const preamble = readFileSync(
  resolve(root, '.github/release-notes-preamble.md'),
  'utf8',
).trim();
const currentNotes = readFileSync(resolve(currentNotesPath), 'utf8');
const markerPattern = new RegExp(
  `${startMarker}[\\s\\S]*?${endMarker}\\s*`,
  'g',
);
const changelog = currentNotes.replace(markerPattern, '').trim();
const rendered = changelog ? `${preamble}\n\n${changelog}\n` : `${preamble}\n`;

writeFileSync(resolve(outputPath), rendered);
