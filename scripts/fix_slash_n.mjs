import fs from 'fs';
for (let file of ['lib/i18n/locales/en.ts', 'lib/i18n/locales/vi.ts']) {
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(/\\n\s*progress:/g, '\n  progress:');
  fs.writeFileSync(file, content);
}
