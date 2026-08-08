import fs from 'fs';

let content = fs.readFileSync('app/student/session/[sessionId]/page.tsx', 'utf8');
content = content.replace(/setMessage\("Check my step: "\)/g, 'setMessage(t("sessionActions.checkStep") + ": ")');
content = content.replace(/setMessage\("I'm stuck."\)/g, 'setMessage(t("sessionActions.stuck") + ".")');
content = content.replace(/setMessage\("Can you explain the concept\?"\)/g, 'setMessage(t("sessionActions.explainConcept") + "?")');
content = content.replace(/setMessage\("Can you give me a smaller hint\?"\)/g, 'setMessage(t("sessionActions.smallerHint") + "?")');
content = content.replace(/setMessage\("Can you explain that differently\?"\)/g, 'setMessage(t("sessionActions.explainDifferently") + "?")');
content = content.replace(/setMessage\("I think the tutor may be wrong here, because "\)/g, 'setMessage(t("sessionActions.reportIssue") + ", ")');

fs.writeFileSync('app/student/session/[sessionId]/page.tsx', content);
