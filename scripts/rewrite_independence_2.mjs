import fs from 'fs';
let content = fs.readFileSync('lib/scoring/independence.ts', 'utf8');

// Replace { ... rationale: '...', ... } with { ... rationale: '...', rationaleCode: '...' }
// Let's do it with a regex!
content = content.replace(/rationale:\s*'([^']+)'(,?)/g, (match, text, comma) => {
  // Let's create a code from the text
  let code = text.toUpperCase().replace(/[^A-Z0-9]/g, '_').substring(0, 30).replace(/_+$/, '');
  return `rationale: '${text}', rationaleCode: '${code}'${comma}`;
});

// also handle template literals: rationale: `...`
content = content.replace(/rationale:\s*`([^`]+)`(,?)/g, (match, text, comma) => {
  // We'll need a generic code and pass variables?
  // There are only a few template literals:
  if (text.includes('Worked without asking for a hint')) {
    return `rationale: \`${text}\`, rationaleCode: 'WORKED_WITHOUT_HINT'${comma}`;
  }
  if (text.includes('Needed hints up to level')) {
    return `rationale: \`${text}\`, rationaleCode: 'NEEDED_HINTS'${comma}`;
  }
  if (text.includes('Met ${met} of 4 explanation criteria')) {
    return `rationale: \`${text}\`, rationaleCode: 'MET_EXPLANATION_CRITERIA'${comma}`;
  }
  if (text.includes('Met ${met} of 4 checking criteria')) {
    return `rationale: \`${text}\`, rationaleCode: 'MET_CHECKING_CRITERIA'${comma}`;
  }
  return match;
});

fs.writeFileSync('lib/scoring/independence.ts', content);
