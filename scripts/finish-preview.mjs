// Turns the single-file preview build into a page body for hosting inside
// another page's skeleton: drops the document wrapper tags and gives it a name.
import { readFileSync, writeFileSync } from 'node:fs';

const path = new URL('../dist-preview/index.html', import.meta.url);
let html = readFileSync(path, 'utf8');
html = html
  .replace(/<!doctype html>/i, '')
  .replace(/<\/?html[^>]*>/gi, '')
  .replace(/<\/?head>/gi, '')
  .replace(/<\/?body>/gi, '')
  .replace(/<meta charset="UTF-8" \/>/i, '')
  .replace(/<meta name="viewport"[^>]*>/i, '')
  .replace(/<title>[^<]*<\/title>/i, '<title>Herd Pet Care</title>\n<meta name="claude:viewport-fit-sides" content="cover">');
writeFileSync(path, html.trim() + '\n');
console.log('preview page ready:', Math.round(html.length / 1024), 'KB');
