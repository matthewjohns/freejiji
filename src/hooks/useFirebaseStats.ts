import { useState, useEffect, useCallback } from 'react';
import { signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import type { User } from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp, runTransaction } from 'firebase/firestore';
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
  scoreDistribution?: { [key: number]: number };
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

        // Handle migrating existing users who don't have scoreDistribution
        let scoreDistribution = data.scoreDistribution;
        if (!scoreDistribution) {
          scoreDistribution = {
            0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0, 10: 0
          };
          await updateDoc(userDocRef, {
            scoreDistribution,
            lastActive: serverTimestamp()
          });
        }

        const finalStats = {
          ...data,
          currentStreak,
          scoreDistribution
        };

        // Backup stats to localStorage
        try {
          localStorage.setItem('freejiji_user_stats_backup', JSON.stringify(finalStats));
        } catch (e) {
          console.error('Failed to back up stats to localStorage:', e);
        }

        setStats(finalStats);
      } else {
        // Doc does not exist in Firestore. Check if we have backup stats in localStorage.
        let restoredStats: UserStats | null = null;
        try {
          const backupStr = localStorage.getItem('freejiji_user_stats_backup');
          if (backupStr) {
            const backupData = JSON.parse(backupStr);
            if (backupData && typeof backupData === 'object') {
              restoredStats = {
                uid,
                createdAt: backupData.createdAt || serverTimestamp(),
                lastActive: serverTimestamp(),
                allTimeScore: backupData.allTimeScore || 0,
                gamesPlayed: backupData.gamesPlayed || 0,
                currentStreak: backupData.currentStreak || 0,
                maxStreak: backupData.maxStreak || 0,
                lastPlayedDate: backupData.lastPlayedDate || '',
                scoreDistribution: backupData.scoreDistribution || {
                  0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0, 10: 0
                }
              };
              console.log('Restoring user stats from localStorage backup for new session UID:', uid);
            }
          }
        } catch (e) {
          console.error('Failed to read/parse stats backup from localStorage:', e);
        }

        const initialStats: UserStats = restoredStats || {
          uid,
          createdAt: serverTimestamp(),
          lastActive: serverTimestamp(),
          allTimeScore: 0,
          gamesPlayed: 0,
          currentStreak: 0,
          maxStreak: 0,
          lastPlayedDate: '',
          scoreDistribution: {
            0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0, 10: 0
          }
        };

        // Write the stats to the new UID document in Firestore
        await setDoc(userDocRef, initialStats);

        // If we restored stats and we have a local history backup for that last played date, let's restore it too!
        if (restoredStats && restoredStats.lastPlayedDate) {
          try {
            const historyBackupStr = localStorage.getItem(`freejiji_history_backup_${restoredStats.lastPlayedDate}`);
            if (historyBackupStr) {
              const historyBackup = JSON.parse(historyBackupStr);
              if (historyBackup && typeof historyBackup === 'object') {
                const scoreDocRef = doc(db, 'users', uid, 'history', restoredStats.lastPlayedDate);
                await setDoc(scoreDocRef, {
                  date: restoredStats.lastPlayedDate,
                  score: historyBackup.score || 0,
                  guesses: historyBackup.guesses || [],
                  userSwipes: historyBackup.userSwipes || [],
                  timestamp: serverTimestamp()
                });
                console.log('Restored daily history from localStorage backup for date:', restoredStats.lastPlayedDate);
              }
            }
          } catch (e) {
            console.error('Failed to read/restore daily history from localStorage backup:', e);
          }
        }

        // Fetch back (to get proper initialized format)
        const freshSnap = await getDoc(userDocRef);
        if (freshSnap.exists()) {
          const freshData = freshSnap.data() as UserStats;
          // Backup again
          try {
            localStorage.setItem('freejiji_user_stats_backup', JSON.stringify(freshData));
          } catch (e) {
            console.error('Failed to back up stats to localStorage:', e);
          }
          setStats(freshData);
        }
      }
    } catch (error) {
      console.error('Error fetching/syncing Firebase stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchTodayHistory = useCallback(async (todayStr: string) => {
    if (!auth.currentUser) return null;
    try {
      const scoreDocRef = doc(db, 'users', auth.currentUser.uid, 'history', todayStr);
      const snap = await getDoc(scoreDocRef);
      if (snap.exists()) {
        const data = snap.data();
        return {
          score: data.score as number,
          guesses: (data.guesses || []) as (boolean | null)[],
          userSwipes: (data.userSwipes || []) as boolean[],
        };
      }
    } catch (error) {
      console.error('Error fetching today history:', error);
    }
    return null;
  }, []);

  const saveGameResult = useCallback(async (
    score: number,
    guesses: (boolean | null)[],
    userSwipes: boolean[],
    currentItems: any[],
    gameDate: string
  ) => {
    if (!user || !stats) return null;

    try {
      const userDocRef = doc(db, 'users', user.uid);
      const todayStr = gameDate;

      let newStreak = stats.currentStreak;
      let newMaxStreak = stats.maxStreak;

      // Only increment streak if they haven't completed a game today
      if (stats.lastPlayedDate !== todayStr) {
        newStreak = stats.currentStreak + 1;
        newMaxStreak = Math.max(newStreak, stats.maxStreak);
      }

      // Calculate updated score distribution
      const currentDist = stats.scoreDistribution || {
        0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0, 10: 0
      };
      const newScoreCount = (currentDist[score] || 0) + 1;
      const updatedDist = {
        ...currentDist,
        [score]: newScoreCount
      };

      const updatedStatsData = {
        allTimeScore: stats.allTimeScore + score,
        gamesPlayed: stats.gamesPlayed + 1,
        currentStreak: newStreak,
        maxStreak: newMaxStreak,
        lastPlayedDate: todayStr,
        lastActive: serverTimestamp(),
        scoreDistribution: updatedDist
      };

      // 1. Save detailed score in a subcollection for history reference
      const scoreDocRef = doc(db, 'users', user.uid, 'history', todayStr);
      await setDoc(scoreDocRef, {
        date: todayStr,
        score,
        guesses,
        userSwipes,
        timestamp: serverTimestamp()
      });

      // Save history backup to localStorage
      try {
        localStorage.setItem(`freejiji_history_backup_${todayStr}`, JSON.stringify({
          score,
          guesses,
          userSwipes
        }));
      } catch (e) {
        console.error('Failed to save history backup to localStorage:', e);
      }

      // 2. Perform transaction to update global correctness on daily_games/{date}
      const dailyGameRef = doc(db, 'daily_games', todayStr);
      let updatedItemsList = [...currentItems];
      let updatedGlobalDist = {
        0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0, 10: 0
      };

      try {
        await runTransaction(db, async (transaction) => {
          const dailyGameSnap = await transaction.get(dailyGameRef);
          if (!dailyGameSnap.exists()) {
            throw new Error("Daily game doc does not exist");
          }
          const dailyGameData = dailyGameSnap.data();
          const itemsList = dailyGameData.items || [];
          
          updatedItemsList = itemsList.map((item: any, idx: number) => {
            const isCorrect = guesses[idx] === true;
            const prevCorrect = item.correctCount || 0;
            const prevTotal = item.totalCount || 0;
            return {
              ...item,
              correctCount: isCorrect ? prevCorrect + 1 : prevCorrect,
              totalCount: prevTotal + 1
            };
          });

          const currentGlobalDist = dailyGameData.scoreDistribution || {
            0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0, 10: 0
          };
          updatedGlobalDist = {
            ...currentGlobalDist,
            [score]: (currentGlobalDist[score] || 0) + 1
          };

          transaction.update(dailyGameRef, { 
            items: updatedItemsList,
            scoreDistribution: updatedGlobalDist
          });
        });
      } catch (transError) {
        console.error('Transaction failed to update global stats:', transError);
      }

      // 3. Update User Stats document
      await updateDoc(userDocRef, updatedStatsData);

      // 4. Update local state
      setStats((prev) => {
        const next = prev ? {
          ...prev,
          ...updatedStatsData
        } : null;
        if (next) {
          try {
            localStorage.setItem('freejiji_user_stats_backup', JSON.stringify(next));
          } catch (e) {
            console.error('Failed to backup stats to localStorage:', e);
          }
        }
        return next;
      });

      return {
        items: updatedItemsList,
        scoreDistribution: updatedGlobalDist
      };

    } catch (error) {
      console.error('Error saving game result to Firebase:', error);
      return null;
    }
  }, [user, stats]);

  const resetStats = useCallback(async (gameDate: string) => {
    if (!user) return false;
    try {
      const userDocRef = doc(db, 'users', user.uid);
      const initialStats: UserStats = {
        uid: user.uid,
        createdAt: serverTimestamp(),
        lastActive: serverTimestamp(),
        allTimeScore: 0,
        gamesPlayed: 0,
        currentStreak: 0,
        maxStreak: 0,
        lastPlayedDate: '',
        scoreDistribution: {
          0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0, 10: 0
        }
      };
      await setDoc(userDocRef, initialStats);

      const scoreDocRef = doc(db, 'users', user.uid, 'history', gameDate);
      await deleteDoc(scoreDocRef);

      // Clear local backups as well
      try {
        localStorage.removeItem('freejiji_user_stats_backup');
        localStorage.removeItem(`freejiji_history_backup_${gameDate}`);
      } catch (e) {
        console.error('Failed to clear backups in resetStats:', e);
      }

      setStats(initialStats);
      return true;
    } catch (error) {
      console.error('Failed to reset stats:', error);
      return false;
    }
  }, [user]);

  return {
    user,
    stats,
    loading,
    saveGameResult,
    fetchTodayHistory,
    resetStats
  };
};
