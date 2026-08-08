import fs from 'fs';

let content = fs.readFileSync('lib/scoring/independence.ts', 'utf8');
content = content.replace(/rationaleCode: \(graded as any\).rationaleCode,\s*rationaleCode: \(graded as any\).rationaleCode/g, 'rationaleCode: (graded as any).rationaleCode');
fs.writeFileSync('lib/scoring/independence.ts', content);
