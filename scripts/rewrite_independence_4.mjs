import fs from 'fs';
let content = fs.readFileSync('lib/scoring/independence.ts', 'utf8');

// Fix graded.rationale missing rationaleCode
content = content.replace("rationale: graded.rationale };", "rationale: graded.rationale, rationaleCode: (graded as any).rationaleCode };");
content = content.replace("rationale: graded.rationale,", "rationale: graded.rationale, rationaleCode: (graded as any).rationaleCode,");


// Fix the effectiveHint one
content = content.replace(
  /rationale:\s*effectiveHint === 0\s*\?\s*`Worked without asking for a hint, with level \$\{ceiling\} available.`\s*:\s*`Needed hints up to level \$\{effectiveHint\} of \$\{ceiling\} available.`,/g,
  "rationale: effectiveHint === 0 ? `Worked without asking for a hint, with level ${ceiling} available.` : `Needed hints up to level ${effectiveHint} of ${ceiling} available.`, rationaleCode: effectiveHint === 0 ? 'WORKED_WITHOUT_HINT' : 'NEEDED_HINTS',"
);

// We need to add rationaleCode to byOutcome Record type
content = content.replace("Record<TransferOutcome, { value: number; rationale: string }>", "Record<TransferOutcome, { value: number; rationale: string; rationaleCode?: string }>");

fs.writeFileSync('lib/scoring/independence.ts', content);
