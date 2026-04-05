import { useState, useEffect } from 'react';
import { DrillSession, DrillRep, WeaknessTag, StrengthTag } from '../types';
import { db, auth } from '../firebase';
import { collection, doc, setDoc, getDoc, onSnapshot, query, where, serverTimestamp } from 'firebase/firestore';

export function useStore() {
  const [sessions, setSessions] = useState<DrillSession[]>([]);

  useEffect(() => {
    if (!auth.currentUser) return;

    const q = query(
      collection(db, 'sessions'),
      where('uid', '==', auth.currentUser.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const loadedSessions: DrillSession[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        loadedSessions.push({
          id: data.id,
          date: data.date,
          mode: data.mode,
          reps: data.reps || [] // We will store reps inside the session for simplicity in the UI, or fetch them separately.
        });
      });
      // Sort by date descending
      loadedSessions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setSessions(loadedSessions);
    });

    return () => unsubscribe();
  }, [auth.currentUser?.uid]);

  const saveSession = async (session: DrillSession) => {
    if (!auth.currentUser) return;
    
    const sessionRef = doc(db, 'sessions', session.id);
    const snap = await getDoc(sessionRef);
    
    if (!snap.exists()) {
      await setDoc(sessionRef, {
        id: session.id,
        uid: auth.currentUser.uid,
        date: session.date,
        mode: session.mode,
        reps: session.reps,
        createdAt: serverTimestamp()
      });
    } else {
      await updateSession(session);
    }
  };

  const updateSession = async (session: DrillSession) => {
    if (!auth.currentUser) return;
    
    // Update session
    await setDoc(doc(db, 'sessions', session.id), {
      id: session.id,
      uid: auth.currentUser.uid,
      date: session.date,
      mode: session.mode,
      reps: session.reps,
      // Only set createdAt if we are creating it, otherwise leave it alone
    }, { merge: true });
  };

  const saveRep = async (rep: DrillRep, sessionId: string) => {
    if (!auth.currentUser) return;
    const repRef = doc(db, 'reps', rep.id);
    const snap = await getDoc(repRef);
    
    if (!snap.exists()) {
      await setDoc(repRef, {
        ...rep,
        sessionId,
        uid: auth.currentUser.uid,
        createdAt: serverTimestamp()
      });
    } else {
      await updateRep(rep, sessionId);
    }
  };

  const updateRep = async (rep: DrillRep, sessionId: string) => {
    if (!auth.currentUser) return;
    await setDoc(doc(db, 'reps', rep.id), {
      ...rep,
      sessionId,
      uid: auth.currentUser.uid,
    }, { merge: true });
  };

  const getRecentMistakes = (): { tag: WeaknessTag; count: number }[] => {
    const counts: Record<string, number> = {};
    sessions.flatMap(s => s.reps).forEach(rep => {
      const tagsToUse = [...(rep.mistakeTags || []), ...(rep.retryMistakeTags || [])];
      tagsToUse.forEach(tag => {
        counts[tag] = (counts[tag] || 0) + 1;
      });
    });
    return Object.entries(counts)
      .map(([tag, count]) => ({ tag: tag as WeaknessTag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  };

  const getRecentStrengths = (): { tag: StrengthTag; count: number }[] => {
    const counts: Record<string, number> = {};
    sessions.flatMap(s => s.reps).forEach(rep => {
      const tagsToUse = [...(rep.strengthTags || []), ...(rep.retryStrengthTags || [])];
      tagsToUse.forEach(tag => {
        counts[tag] = (counts[tag] || 0) + 1;
      });
    });
    return Object.entries(counts)
      .map(([tag, count]) => ({ tag: tag as StrengthTag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  };

  return { sessions, saveSession, updateSession, saveRep, updateRep, getRecentMistakes, getRecentStrengths };
}
