import { track } from '@vercel/analytics';

/**
 * Track when a game starts today.
 * Triggered when the first card renders on the screen.
 * Ensures it only fires ONCE per day, and not on refreshes or resuming mid-game.
 */
export function trackGameStarted(gameDate: string) {
  if (!gameDate) return;
  const startedKey = `freejiji_game_started_${gameDate}`;
  if (!localStorage.getItem(startedKey)) {
    try {
      track('game_started');
      localStorage.setItem(startedKey, 'true');
    } catch (err) {
      console.error('[Analytics] Failed to track game_started:', err);
    }
  }
}

/**
 * Track when the game is completed today.
 * Triggered when the final card is swiped and game transitions to Game Over.
 */
export function trackGameCompleted(score: number) {
  try {
    track('game_completed', { score });
  } catch (err) {
    console.error('[Analytics] Failed to track game_completed:', err);
  }
}

/**
 * Track when the user clicks the copy-to-clipboard share button.
 */
export function trackShareClicked() {
  try {
    track('share_clicked');
  } catch (err) {
    console.error('[Analytics] Failed to track share_clicked:', err);
  }
}

/**
 * Track when the user hits a new streak milestone.
 * Ensures it only fires once per day when the streak increases, avoiding duplications on refreshes.
 */
export function trackStreakMilestone(length: number, gameDate: string) {
  if (!gameDate || length <= 0) return;
  const streakKey = `freejiji_streak_tracked_${gameDate}`;
  if (!localStorage.getItem(streakKey)) {
    try {
      track('streak_milestone', { length });
      localStorage.setItem(streakKey, 'true');
    } catch (err) {
      console.error('[Analytics] Failed to track streak_milestone:', err);
    }
  }
}

/**
 * Track when the user clicks on an external listing link on the GameOver screen.
 */
export function trackListingClicked(itemId: string) {
  if (!itemId) return;
  try {
    track('listing_clicked', { item_id: itemId });
  } catch (err) {
    console.error('[Analytics] Failed to track listing_clicked:', err);
  }
}
