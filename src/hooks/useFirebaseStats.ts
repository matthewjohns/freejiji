import { useState, useEffect } from 'react';
import { signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import type { User } from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../firebase';

export interface UserStats {
  uid: string;
  createdAt: any;
  lastActive: any;
  allTimeScore: number;
  gamesPlayed: number;
  currentStreak: number;
  maxStreak: number;
  lastPlayedDate: string;
}

const getLocalDateString = (d: Date) => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const useFirebaseStats = () => {
  const [user, setUser] = useState<User | null>(null);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 1. Listen for auth state changes
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        await fetchAndSyncStats(currentUser.uid);
      } else {
        // Sign in anonymously if not logged in
        try {
          await signInAnonymously(auth);
        } catch (error) {
          console.error('Failed to sign in anonymously to Firebase:', error);
          setLoading(false);
        }
      }
    });

    return unsubscribe;
  }, []);

  const fetchAndSyncStats = async (uid: string) => {
    try {
      const userDocRef = doc(db, 'users', uid);
      const userDocSnap = await getDoc(userDocRef);

      const today = new Date();
      const todayStr = getLocalDateString(today);
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = getLocalDateString(yesterday);

      if (userDocSnap.exists()) {
        const data = userDocSnap.data() as UserStats;
        let currentStreak = data.currentStreak || 0;

        // Check if streak is broken
        // If last played date is not today and not yesterday, reset streak to 0
        if (data.lastPlayedDate && data.lastPlayedDate !== todayStr && data.lastPlayedDate !== yesterdayStr) {
          currentStreak = 0;
          // Sync broken streak back to database
          await updateDoc(userDocRef, {
            currentStreak: 0,
            lastActive: serverTimestamp()
          });
        }

        setStats({
          ...data,
          currentStreak
        });
      } else {
        // Initialize new user stats doc
        const initialStats: UserStats = {
          uid,
          createdAt: serverTimestamp(),
          lastActive: serverTimestamp(),
          allTimeScore: 0,
          gamesPlayed: 0,
          currentStreak: 0,
          maxStreak: 0,
          lastPlayedDate: '',
        };
        await setDoc(userDocRef, initialStats);

        // Fetch back (to get proper initialized format)
        const freshSnap = await getDoc(userDocRef);
        if (freshSnap.exists()) {
          setStats(freshSnap.data() as UserStats);
        }
      }
    } catch (error) {
      console.error('Error fetching/syncing Firebase stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const saveGameResult = async (score: number) => {
    if (!user || !stats) return;

    try {
      const userDocRef = doc(db, 'users', user.uid);
      const todayStr = getLocalDateString(new Date());

      let newStreak = stats.currentStreak;
      let newMaxStreak = stats.maxStreak;

      // Only increment streak if they haven't completed a game today
      if (stats.lastPlayedDate !== todayStr) {
        newStreak = stats.currentStreak + 1;
        newMaxStreak = Math.max(newStreak, stats.maxStreak);
      }

      const updatedStatsData = {
        allTimeScore: stats.allTimeScore + score,
        gamesPlayed: stats.gamesPlayed + 1,
        currentStreak: newStreak,
        maxStreak: newMaxStreak,
        lastPlayedDate: todayStr,
        lastActive: serverTimestamp(),
      };

      // Update Firestore
      await updateDoc(userDocRef, updatedStatsData);

      // Save detailed score in a subcollection for history reference
      const scoreDocRef = doc(db, 'users', user.uid, 'history', todayStr);
      await setDoc(scoreDocRef, {
        date: todayStr,
        score,
        timestamp: serverTimestamp()
      });

      // Update local state
      setStats((prev) => prev ? {
        ...prev,
        ...updatedStatsData
      } : null);

    } catch (error) {
      console.error('Error saving game result to Firebase:', error);
    }
  };

  return {
    user,
    stats,
    loading,
    saveGameResult
  };
};
