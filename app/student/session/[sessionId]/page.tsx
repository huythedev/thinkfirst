'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/components/providers/AuthProvider';
import { db } from '@/lib/firebase/config';
import { doc, onSnapshot, collection, query, where, orderBy, setDoc, updateDoc } from 'firebase/firestore';
import { TutorMarkdown } from '@/components/TutorMarkdown';
import { LiveScorePanel } from '@/components/LiveScorePanel';
import { useLiveSessionScore } from '@/hooks/use-live-session-score';
import { HintLadderIndicator } from '@/components/HintLadderIndicator';
import { Scratchpad } from '@/components/Scratchpad';
import { SessionProblemImage } from '@/components/SessionProblemImage';

export default function LearningWorkspace() {
  const { sessionId } = useParams() as { sessionId: string };
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  
  const [session, setSession] = useState<any>(null);
  const [turns, setTurns] = useState<any[]>([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [mobilePanel, setMobilePanel] = useState<'problem' | 'chat' | 'scratchpad'>('chat');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Recomputed from the streaming turns, so it moves as the student works.
  const { score: liveScore } = useLiveSessionScore(session, turns);

  useEffect(() => {
    // The signed-out case is derived at render time rather than pushed from this
    // effect, so subscribing stays the only thing the effect does.
    if (authLoading || !sessionId || !user) return;
    
    // A realtime listener, not a one-shot read, so the hint indicator follows the
    // server's write to currentHintLevel rather than a local guess.
    const unsubscribeSession = onSnapshot(
      doc(db, 'learningSessions', sessionId),
      (docSnap) => {
        if (docSnap.exists()) {
          setSession({ id: docSnap.id, ...docSnap.data() });
          setLoadError(null);
        } else {
          setLoadError('This session no longer exists.');
        }
        setLoading(false);
      },
      (error) => {
        console.error('Failed to load session', error);
        setLoadError('We could not open this session. It may belong to another account.');
        setLoading(false);
      },
    );
    const q = query(
      collection(db, 'sessionTurns'),
      where('studentId', '==', user.uid),
      where('sessionId', '==', sessionId),
      orderBy('sequence', 'asc'),
    );
    const unsubscribeTurns = onSnapshot(
      q,
      (snapshot) => {
        setTurns(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
      },
      (error) => {
        console.error('Failed to load transcript', error);
        setLoadError('We could not load this conversation.');
      },
    );

    return () => {
      unsubscribeSession();
      unsubscribeTurns();
    };
  }, [user, authLoading, sessionId, router]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns]);

  const handleSend = async () => {
    if (!message.trim() || sending || !user || !session) return;
    
    setSending(true);
    setSendError(null);
    const userMsg = message;
    setMessage('');
    
    try {
      const newSequence = turns.length + 1;
      const studentTurnId = crypto.randomUUID();
      const studentTurnData = {
        sessionId,
        studentId: user.uid,
        role: 'student' as const,
        message: userMsg,
        sequence: newSequence,
        createdAt: new Date(),
      };
      await setDoc(doc(db, 'sessionTurns', studentTurnId), studentTurnData);

      // Only the session id and the student's message cross this boundary. Every
      // policy input is read server-side, and the transcript is read from
      // Firestore, so neither is sent from here.
      const res = await fetch('/api/session/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${await user.getIdToken()}`,
        },
        body: JSON.stringify({ message: userMsg, sessionId }),
      });

      if (!res.ok) {
        if (res.status === 429) {
          // Distinguished from a failure: nothing is broken and retrying later
          // will work, so the message says how long rather than "try again".
          const retryAfter = Number(res.headers.get('Retry-After') ?? 0);
          const wait = Number.isFinite(retryAfter) && retryAfter > 0
            ? `about ${retryAfter} second${retryAfter === 1 ? '' : 's'}`
            : 'a moment';
          throw new Error(
            `You are sending messages faster than the tutor can keep up. Your message was saved. Please wait ${wait} and try again.`,
          );
        }
        throw new Error(
          res.status === 503
            ? 'The tutor is not available right now. Your message was saved.'
            : 'The tutor could not respond. Your message was saved, so you can try again.',
        );
      }

      // The assistant turn is written by the endpoint under Admin credentials and
      // arrives here through the turn listener. It carries the policy decision
      // (`responsePlan`, `rationaleCode`, `allowedHintLevel`), which section 41.1
      // lists among the values a client must never author. `currentHintLevel`
      // reaches the UI the same way.
      await res.json();

    } catch (err) {
      console.error(err);
      setSendError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      setMessage(userMsg); // restore on error
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  /** The scratchpad is the student's own notes, so the client writes it directly. */
  const saveScratchpad = useCallback(
    (value: string) => {
      const path = `learningSessions/${sessionId}`;
      const sessionDocRef = doc(db, 'learningSessions', sessionId);
      console.log('[SCRATCHPAD WRITE]', {
        path,
        refPath: sessionDocRef.path,
        authUid: user?.uid ?? null,
        sessionStudentId: session?.studentId,
        payloadKeys: Object.keys({ scratchpad: value }),
        existingKeys: session ? Object.keys(session).filter(k => k !== 'id') : [],
        sessionStatus: session?.status ?? null,
      });
      return updateDoc(sessionDocRef, { scratchpad: value });
    },
    [sessionId, user?.uid, session?.studentId],
  );

  // The server-side guard let this route render, so the cookie is valid, but the
  // client SDK has no user and Firestore reads would hang unanswered.
  const signedOut = !authLoading && !user;
  const workspaceError = signedOut
    ? 'Your sign-in has expired. Reload the page to continue.'
    : loadError;

  if (loading && !signedOut) {
    return (
      <div
        className="flex flex-col md:flex-row gap-6 h-[calc(100vh-8rem)]"
        role="status"
        aria-live="polite"
      >
        <span className="sr-only">Loading workspace</span>
        <div className="md:w-1/3 bg-white border border-gray-200 rounded-2xl p-6 animate-pulse space-y-3">
          <div className="h-4 w-24 bg-gray-100 rounded" />
          <div className="h-3 w-full bg-gray-100 rounded" />
          <div className="h-3 w-5/6 bg-gray-100 rounded" />
        </div>
        <div className="md:w-2/3 bg-white border border-gray-200 rounded-2xl p-6 animate-pulse space-y-4">
          <div className="h-16 w-2/3 bg-gray-100 rounded-2xl" />
          <div className="h-16 w-1/2 bg-gray-100 rounded-2xl ml-auto" />
          <div className="h-16 w-3/5 bg-gray-100 rounded-2xl" />
        </div>
      </div>
    );
  }

  if (workspaceError || !session) {
    return (
      <div className="max-w-lg mx-auto mt-16 bg-white border border-gray-200 rounded-2xl p-8 text-center shadow-sm">
        <h1 className="text-xl font-bold text-gray-900">This session could not be opened</h1>
        <p className="text-gray-600 mt-2">{workspaceError ?? 'The session is unavailable.'}</p>
        <button
          onClick={() => router.push('/student/session')}
          className="mt-6 px-6 py-3 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700"
        >
          Back to my sessions
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 h-[calc(100vh-8rem)]">
      {/* Session header. Every value here is read from the session document, so
          the mode and hint indicators show server state rather than a local guess. */}
      <HintLadderIndicator
        mode={session.mode}
        subject={session.subject}
        strictness={session.strictness}
        currentHintLevel={session.currentHintLevel ?? 0}
        status={session.status}
        turnCount={turns.length}
      />

      {/* Mobile: the problem and scratchpad are tabs, per the section 31 layout. */}
      <div className="flex md:hidden gap-1 bg-gray-100 p-1 rounded-xl" role="tablist" aria-label="Workspace panels">
        {(['problem', 'chat', 'scratchpad'] as const).map((panel) => (
          <button
            key={panel}
            role="tab"
            aria-selected={mobilePanel === panel}
            onClick={() => setMobilePanel(panel)}
            className={`flex-1 text-sm font-medium capitalize py-2 rounded-lg ${
              mobilePanel === panel ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600'
            }`}
          >
            {panel}
          </button>
        ))}
      </div>

      <div className="flex flex-col md:flex-row gap-6 flex-1 min-h-0">
      {/* Left column: problem above, scratchpad below. */}
      <div
        className={`md:w-1/3 md:flex flex-col gap-4 min-h-0 ${
          mobilePanel === 'chat' ? 'hidden' : 'flex'
        }`}
      >
        <div
          className={`bg-white border border-gray-200 rounded-2xl flex flex-col overflow-hidden shadow-sm flex-1 min-h-0 ${
            mobilePanel === 'scratchpad' ? 'hidden md:flex' : 'flex'
          }`}
        >
          <div className="bg-gray-50 border-b border-gray-200 p-4">
            <h2 className="font-bold text-gray-800">Problem</h2>
          </div>
          <div className="p-6 overflow-y-auto font-mono text-gray-900 whitespace-pre-wrap flex-1">
            {session.originalProblem}
          </div>
          {typeof session.imageId === 'string' && session.imageId.length > 0 && (
            <SessionProblemImage imageId={session.imageId} />
          )}
        </div>

        <div className={`flex-1 min-h-0 ${mobilePanel === 'problem' ? 'hidden md:block' : 'block'}`}>
          <Scratchpad
            key={sessionId}
            initialValue={typeof session.scratchpad === 'string' ? session.scratchpad : ''}
            onSave={saveScratchpad}
          />
        </div>
      </div>

      {/* Right Panel: Chat Interface */}
      <div
        className={`md:w-2/3 bg-white border border-gray-200 rounded-2xl md:flex flex-col overflow-hidden shadow-sm min-h-0 ${
          mobilePanel === 'chat' ? 'flex flex-1' : 'hidden'
        }`}
      >
        <div
          className="flex-1 p-6 overflow-y-auto space-y-6"
          role="log"
          aria-live="polite"
          aria-label="Conversation with your tutor"
          // Section 40: a screen reader picks pronunciation from `lang`, so a
          // Vietnamese transcript inside a document declared `en` is read with
          // English phonetics and is close to unintelligible. The document
          // language stays `en` for the chrome; only the transcript is marked.
          lang={session?.language === 'vi' ? 'vi' : 'en'}
        >
          {turns.length === 0 && (
            <div className="text-center text-gray-500 mt-10">
              <p>Session started.</p>
              <p className="text-sm mt-2">How would you like to begin solving this?</p>
            </div>
          )}
          
          {turns.map(turn => {
            // A safety turn is styled apart from ordinary tutoring on purpose.
            // Section 24 requires educational redirection, emergency guidance and
            // review flags to be clearly distinguished, and a crisis message in the
            // same grey bubble as a hint about fractions reads as one more hint.
            // The class comes from the server-written turn, never from the message
            // text, so the styling cannot be triggered by what a student types.
            const safetyClass: string | undefined = turn.safetyMetadata?.responseClass;
            const isSupport =
              safetyClass === 'emergency_guidance' || safetyClass === 'teacher_review';

            return (
              <div key={turn.id} className={`flex ${turn.actor === 'student' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] rounded-2xl p-4 ${
                    turn.actor === 'student'
                      ? 'bg-blue-600 text-white rounded-br-none'
                      : isSupport
                        ? 'bg-amber-50 border border-amber-300 text-amber-950 rounded-bl-none'
                        : 'bg-gray-100 text-gray-900 rounded-bl-none'
                  }`}
                  // Announced immediately: this is the one message a student must
                  // not miss, and a screen reader would otherwise reach it only on
                  // the next navigation.
                  role={isSupport ? 'alert' : undefined}
                >
                  {turn.actor === 'student' ? (
                    <div className="whitespace-pre-wrap">{turn.content}</div>
                  ) : (
                    <>
                      {isSupport && (
                        <p className="text-xs font-semibold uppercase tracking-wide text-amber-800 mb-2">
                          Support
                        </p>
                      )}
                      <TutorMarkdown>{turn.content}</TutorMarkdown>
                      {turn.safetyMetadata?.flaggedForTeacherReview && (
                        // Stated rather than hidden: section 24 forbids promising
                        // secrecy, and staying silent about the flag would be an
                        // implied promise.
                        <p className="text-xs text-amber-800 mt-3 pt-3 border-t border-amber-200">
                          A teacher at your school has been told you may want to talk. Your
                          classmates cannot see this.
                        </p>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}

          {sending && (
            <div className="flex justify-start">
              <div className="max-w-[85%] rounded-2xl p-4 bg-gray-100 text-gray-900 rounded-bl-none flex items-center gap-2">
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></span>
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></span>
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{animationDelay: '0.4s'}}></span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
        
        <LiveScorePanel score={liveScore} />

        <div className="p-4 bg-gray-50 border-t border-gray-200">
          {sendError && (
            <div role="alert" className="mb-3 flex items-start justify-between gap-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">
              <span>{sendError}</span>
              <button
                onClick={() => setSendError(null)}
                className="font-medium underline shrink-0"
              >
                Dismiss
              </button>
            </div>
          )}
          <div className="flex gap-2">
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Explain your step or ask a question..."
              aria-label="Your message to the tutor"
              className="flex-1 p-4 border border-gray-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 resize-none font-sans"
              rows={2}
            />
            <button
              onClick={handleSend}
              disabled={sending || !message.trim()}
              className="px-6 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 disabled:opacity-50"
            >
              Send
            </button>
          </div>
          <div className="flex gap-2 mt-3 overflow-x-auto pb-1">
            <button onClick={() => setMessage("Check my step: ")} className="text-xs bg-white border border-gray-300 px-3 py-1.5 rounded-full hover:bg-gray-100 whitespace-nowrap">Check my step</button>
            <button onClick={() => setMessage("I'm stuck.")} className="text-xs bg-white border border-gray-300 px-3 py-1.5 rounded-full hover:bg-gray-100 whitespace-nowrap">I&apos;m stuck</button>
            <button onClick={() => setMessage("Can you explain the concept?")} className="text-xs bg-white border border-gray-300 px-3 py-1.5 rounded-full hover:bg-gray-100 whitespace-nowrap">Explain concept</button>
            <button onClick={() => setMessage("Can you give me a smaller hint?")} className="text-xs bg-white border border-gray-300 px-3 py-1.5 rounded-full hover:bg-gray-100 whitespace-nowrap">Smaller hint</button>
            <button onClick={() => setMessage("Can you explain that differently?")} className="text-xs bg-white border border-gray-300 px-3 py-1.5 rounded-full hover:bg-gray-100 whitespace-nowrap">Explain differently</button>
            <button onClick={() => setMessage("I think the tutor may be wrong here, because ")} className="text-xs bg-white border border-gray-300 px-3 py-1.5 rounded-full hover:bg-gray-100 whitespace-nowrap">Report an issue</button>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
