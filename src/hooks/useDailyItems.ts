import { useState, useEffect } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import type { KijijiItem } from '../types';

/**
 * Returns the "game date" string (YYYY-MM-DD, Toronto time).
 * The game resets at 3:00 AM Toronto time each day —
 * if it's currently before 3am in Toronto, we use yesterday's date.
 */
function getGameDateString(): string {
  const now = new Date();

  // Get the current hour in Toronto time (24h)
  const torontoHour = parseInt(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Toronto',
      hour: 'numeric',
      hour12: false,
    }).format(now),
    10
  );

  // If it's before 3am Toronto time, treat it as "still yesterday"
  const effectiveDate = new Date(now);
  if (torontoHour < 3) {
    effectiveDate.setDate(effectiveDate.getDate() - 1);
  }

  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(effectiveDate);
}

export interface DailyItemsResult {
  items: KijijiItem[];
  gameDate: string;
  loading: boolean;
  error: 'no-content' | 'not-ready' | 'fetch-error' | null;
}

export function useDailyItems(): DailyItemsResult {
  const gameDate = getGameDateString();
  const [items, setItems] = useState<KijijiItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<DailyItemsResult['error']>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchItems() {
      setLoading(true);
      setError(null);
      setItems([]);

      try {
        const docRef = doc(db, 'daily_games', gameDate);
        const snap = await getDoc(docRef);

        if (cancelled) return;

        if (!snap.exists()) {
          setError('no-content');
          return;
        }

        const data = snap.data();

        if (data.status !== 'ready') {
          setError('not-ready');
          return;
        }

        const fetchedItems: KijijiItem[] = (data.items ?? []).map((item: any) => ({
          id: item.id,
          title: item.title,
          description: item.description,
          image: item.image,
          actualPrice: item.actualPrice ?? 0,
          isFree: item.isFree ?? false,
          listingUrl: item.listingUrl,
          location: item.location ?? 'Canada',
          correctCount: item.correctCount ?? 0,
          totalCount: item.totalCount ?? 0,
        }));

        setItems(fetchedItems);
      } catch (err) {
        if (!cancelled) {
          console.error('[useDailyItems] Failed to fetch daily game:', err);
          setError('fetch-error');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchItems();
    return () => { cancelled = true; };
  }, [gameDate]);

  return { items, gameDate, loading, error };
}
