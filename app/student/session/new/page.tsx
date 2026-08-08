'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { db } from '@/lib/firebase/config';
import { collection, addDoc, doc, getDoc, serverTimestamp } from 'firebase/firestore';
import { useAuth } from '@/components/providers/AuthProvider';
import { Strictness } from '@/lib/types/user';
import { AI_VERSIONS } from '@/lib/versions';
import { ProblemImageUpload, type ExtractionOutcome } from '@/components/ProblemImageUpload';

export default function NewSession() {
  const router = useRouter();
  const { user, profile } = useAuth();
  
  const [subject, setSubject] = useState('mathematics');
  const [mode, setMode] = useState('practice');
  const [problem, setProblem] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [grade, setGrade] = useState<number | null>(null);
  const [strictness, setStrictness] = useState<Strictness>('balanced');
  const [extraction, setExtraction] = useState<ExtractionOutcome | null>(null);
  const [imageAttached, setImageAttached] = useState(false);

  // The text the session will start from. A confirmed extraction wins over the
  // textarea, because it is the text the student checked against the image.
  const problemText = extraction?.text?.trim() || problem.trim();

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    getDoc(doc(db, 'studentProfiles', user.uid))
      .then((snapshot) => {
        if (cancelled || !snapshot.exists()) return;
        const data = snapshot.data();
        if (typeof data.grade === 'number') setGrade(data.grade);
        const configured = data.assistanceProfile?.defaultStrictness;
        if (configured) setStrictness(configured as Strictness);
      })
      .catch((err) => console.error('Failed to load student profile', err));

    return () => {
      cancelled = true;
    };
  }, [user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Section 34 step 10. An image whose extraction needs confirming cannot start
    // a session until it is confirmed. This is the UI half of the rule; the
    // enforcing half is policy rule R6, which refuses to tutor on an unconfirmed
    // low-confidence extraction even if this check were bypassed.
    if (imageAttached && !extraction) {
      setError('Check and confirm the text from your image before starting.');
      return;
    }

    if (!problemText) {
      setError('Please enter a problem, or upload a photo of one');
      return;
    }
    if (!user) return;

    setLoading(true);
    setError('');

    try {
      const sessionRef = await addDoc(collection(db, 'learningSessions'), {
        studentId: user.uid,
        subject,
        grade: grade ?? 8,
        language: profile?.preferredLanguage ?? 'en',
        mode,
        strictness,
        status: 'active',
        originalProblem: problemText,
        // Names the image this problem came from. The confidence and the
        // confirmation state are NOT written here: they decide whether tutoring
        // may begin, and the client cannot write `problemImages`. The server
        // follows this id to the document it wrote itself.
        ...(extraction ? { imageId: extraction.imageId } : {}),
        currentHintLevel: 0,
        startedAt: serverTimestamp(),
        // Read from the section 36 registry rather than written out here. These
        // were hardcoded as `policy-v1` and `scoring-v1`, and both had gone stale:
        // policy moved to v2 in session 08 and scoring in session 09, so every new
        // session was labelled with an algorithm that had not governed it for two
        // sessions. They are descriptive labels only; the values that decide
        // anything are stamped server-side on each turn.
        policyVersion: AI_VERSIONS.policy,
        scoringVersion: AI_VERSIONS.scoring
      });

      router.push(`/student/session/${sessionRef.id}`);
    } catch (err: any) {
      console.error(err);
      setError('Failed to start session');
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Start Learning Session</h1>
      
      {error && <div className="mb-6 p-4 bg-red-50 text-red-700 rounded-xl">{error}</div>}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Subject</label>
          <select 
            value={subject}
            onChange={e => setSubject(e.target.value)}
            className="w-full p-3 border border-gray-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="mathematics">Mathematics</option>
            <option value="science">Science</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Learning Mode</label>
          <select 
            value={mode}
            onChange={e => setMode(e.target.value)}
            className="w-full p-3 border border-gray-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="learn">Learn (New Concept)</option>
            <option value="practice">Practice (Guided)</option>
            <option value="assignment">Assignment (Attempt Required)</option>
            <option value="verify">Verify (Check AI)</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">What problem are you working on?</label>
          <textarea 
            value={problem}
            onChange={e => setProblem(e.target.value)}
            rows={5}
            placeholder="e.g. Solve x² - 5x + 6 = 0"
            className="w-full p-4 border border-gray-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 resize-none font-mono"
          />
        </div>

        <ProblemImageUpload
          onExtraction={setExtraction}
          // Tracks that an image is in play even while its text is unconfirmed.
          // Without this, an image awaiting confirmation looks identical to no
          // image, and submitting would fall back to the textarea.
          onAttachedChange={setImageAttached}
        />

        <button 
          type="submit" 
          disabled={loading || (imageAttached && !extraction)}
          className="w-full py-4 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Starting...' : 'Start Session'}
        </button>
      </form>
    </div>
  );
}
