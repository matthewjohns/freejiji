import { useState, useRef, useEffect } from 'react';
import { Header } from './components/Header';
import { CardStack } from './components/CardStack';
import type { CardStackRef } from './components/CardStack';
import { Controls } from './components/Controls';
import { GameOver } from './components/GameOver';
import { useFirebaseStats } from './hooks/useFirebaseStats';
import { useDailyItems } from './hooks/useDailyItems';
import { ShoppingBag, Check, X, MapPin, Loader2, CalendarX, WifiOff } from 'lucide-react';
import type { KijijiItem } from './types';
import { trackGameStarted, trackGameCompleted, trackStreakMilestone } from './utils/analytics';

function App() {
  const { user, stats, loading: statsLoading, saveGameResult, fetchTodayHistory, resetStats } = useFirebaseStats();
  const { items, gameDate, globalScoreDistribution, loading: itemsLoading, error: itemsError } = useDailyItems(!!user);

  const [gameState, setGameState] = useState<'start' | 'playing' | 'game_over'>('start');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [guesses, setGuesses] = useState<(boolean | null)[]>(Array(10).fill(null));
  const [userSwipes, setUserSwipes] = useState<boolean[]>([]);
  const [score, setScore] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [countdown, setCountdown] = useState(10);
  const [feedback, setFeedback] = useState<{
    isCorrect: boolean;
    actualPrice: number;
    isFree: boolean;
    title: string;
    description: string;
    image: string;
    location: string;
  } | null>(null);

  const [localItems, setLocalItems] = useState<KijijiItem[]>([]);
  const [localGlobalDist, setLocalGlobalDist] = useState<{ [key: number]: number } | null>(null);
  const [hasPlayedToday, setHasPlayedToday] = useState(false);
  const [completedGameData, setCompletedGameData] = useState<{
    score: number;
    guesses: (boolean | null)[];
    userSwipes: boolean[];
  } | null>(null);
  const [hasInProgressGame, setHasInProgressGame] = useState(false);

  const cardStackRef = useRef<CardStackRef>(null);

  // Sync loaded daily items to local state
  useEffect(() => {
    if (items && items.length > 0) {
      setLocalItems(items);
    }
    if (globalScoreDistribution) {
      setLocalGlobalDist(globalScoreDistribution);
    }
  }, [items, globalScoreDistribution]);

  // Check today's history to see if the user has already played
  useEffect(() => {
    if (!user || !gameDate) return;

    let cancelled = false;
    async function checkHistory() {
      const historyData = await fetchTodayHistory(gameDate);
      if (cancelled) return;
      if (historyData) {
        setHasPlayedToday(true);
        setCompletedGameData(historyData);
        // Clean up progress since game is already complete
        localStorage.removeItem(`freejiji_progress_${gameDate}`);
        setHasInProgressGame(false);
        
        // Sync completed game states for today and show game_over
        setScore(historyData.score);
        setGuesses(historyData.guesses);
        setUserSwipes(historyData.userSwipes);
        setGameState('game_over');
      } else {
        setHasPlayedToday(false);
        setCompletedGameData(null);
        // If a new day loaded and they haven't played today, reset to start screen only if they were previously looking at the game over screen
        setGameState((prev) => (prev === 'game_over' ? 'start' : prev));
      }
    }
    checkHistory();
    return () => {
      cancelled = true;
    };
  }, [user, gameDate, fetchTodayHistory]);

  // Check for in-progress game progress on mount/gameDate change
  useEffect(() => {
    if (!gameDate || items.length === 0) return;

    const progressKey = `freejiji_progress_${gameDate}`;
    const saved = localStorage.getItem(progressKey);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (
          typeof parsed.currentIndex === 'number' &&
          parsed.currentIndex < items.length &&
          Array.isArray(parsed.guesses) &&
          Array.isArray(parsed.userSwipes) &&
          typeof parsed.score === 'number'
        ) {
          setCurrentIndex(parsed.currentIndex);
          setGuesses(parsed.guesses);
          setUserSwipes(parsed.userSwipes);
          setScore(parsed.score);
          setHasInProgressGame(true);
          return;
        }
      } catch (e) {
        console.error('Error parsing saved progress:', e);
      }
    }
    setHasInProgressGame(false);
  }, [gameDate, items]);

  // Track when the game starts (first card renders)
  useEffect(() => {
    if (gameState === 'playing' && currentIndex === 0 && !hasInProgressGame && gameDate) {
      trackGameStarted(gameDate);
    }
  }, [gameState, currentIndex, hasInProgressGame, gameDate]);

  // Track streak milestone on initialization or game completion
  useEffect(() => {
    if (stats && gameDate && stats.lastPlayedDate === gameDate && stats.currentStreak > 0) {
      trackStreakMilestone(stats.currentStreak, gameDate);
    }
  }, [stats, gameDate]);

  const startGame = () => {
    if (hasPlayedToday) return; // Prevent playing again if already played
    setGameState('playing');
    if (!hasInProgressGame) {
      setCurrentIndex(0);
      setGuesses(Array(items.length).fill(null));
      setUserSwipes([]);
      setScore(0);
      setFeedback(null);
      setIsTransitioning(false);
    }
  };

  const showResults = () => {
    if (!completedGameData) return;
    setScore(completedGameData.score);
    setGuesses(completedGameData.guesses);
    setUserSwipes(completedGameData.userSwipes);
    setGameState('game_over');
  };

  const handleGuess = (isCorrect: boolean, index: number) => {
    if (index !== currentIndex) return;

    setIsTransitioning(true);

    const item = items[index];
    const swipedFree = isCorrect ? item.isFree : !item.isFree;

    const nextSwipes = [...userSwipes];
    nextSwipes[index] = swipedFree;

    const nextGuesses = [...guesses];
    nextGuesses[index] = isCorrect;

    const nextScore = isCorrect ? score + 1 : score;

    setUserSwipes(nextSwipes);
    setGuesses(nextGuesses);
    if (isCorrect) setScore(nextScore);

    setCountdown(10);
    setFeedback({
      isCorrect,
      actualPrice: item.actualPrice,
      isFree: item.isFree,
      title: item.title,
      description: item.description,
      image: item.image,
      location: item.location,
    });

    // Save progress to local storage (only if it's not the last card, which is handled on dismiss/game_over)
    if (gameDate) {
      const nextIndex = index + 1;
      if (nextIndex < items.length) {
        const progressData = {
          currentIndex: nextIndex,
          score: nextScore,
          guesses: nextGuesses,
          userSwipes: nextSwipes,
        };
        localStorage.setItem(`freejiji_progress_${gameDate}`, JSON.stringify(progressData));
        setHasInProgressGame(true);
      }
    }
  };

  const handleFeedbackDismiss = async () => {
    if (!feedback) return;

    setFeedback(null);
    const nextIndex = currentIndex + 1;
    setCurrentIndex(nextIndex);
    setIsTransitioning(false);

    if (nextIndex >= items.length) {
      if (gameDate) {
        localStorage.removeItem(`freejiji_progress_${gameDate}`);
      }
      setHasInProgressGame(false);
      const result = await saveGameResult(score, guesses, userSwipes, localItems, gameDate);
      if (result) {
        setLocalItems(result.items);
        setLocalGlobalDist(result.scoreDistribution);
      }
      trackGameCompleted(score);
      setHasPlayedToday(true);
      setCompletedGameData({ score, guesses, userSwipes });
      setGameState('game_over');
    }
  };

  // Handle countdown timer decrement and auto-dismiss
  useEffect(() => {
    if (!feedback) return;

    if (countdown <= 0) {
      handleFeedbackDismiss();
      return;
    }

    const timer = setTimeout(() => {
      setCountdown((prev) => prev - 1);
    }, 1000);

    return () => clearTimeout(timer);
  }, [feedback, countdown]);

  const handleSwipeLeftButton = () => {
    if (isTransitioning || currentIndex >= items.length) return;
    cardStackRef.current?.swipe('left');
  };

  const handleSwipeRightButton = () => {
    if (isTransitioning || currentIndex >= items.length) return;
    cardStackRef.current?.swipe('right');
  };

  // ── Loading state while items or auth load ──
  const isLoading = itemsLoading || statsLoading;

  return (
    <>
      {/* Ambient background decoration */}
      <div className="bg-ambient">
        <div className="blob blob-1" />
        <div className="blob blob-2" />
        <div className="blob blob-3" />
      </div>

      <main className="game-container">
        {/* ── Start screen ── */}
        {gameState === 'start' && (
          <div className="flex-1 flex flex-col justify-center items-center w-full h-full text-center glass-card p-8 border-white/10 bg-black/30 backdrop-blur-2xl">
            <div className="flex flex-col justify-center items-center gap-6 w-full max-w-sm">
              {/* Animated Logo */}
              <div className="relative flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-to-tr from-[#00ff87] via-[#00d2ff] to-[#8e2de2] shadow-2xl shadow-[#00ff87]/20 animate-bounce">
                <ShoppingBag className="w-10 h-10 text-white" />
              </div>

              <div>
                <h1 className="text-6xl font-black tracking-tight leading-none brand-gradient pb-2">
                  Freejiji
                </h1>
                <p className="text-sm tracking-[2px] uppercase text-white/40 font-bold">
                  ONLINE CLASSIFIED SWIPING GAME
                </p>
              </div>

              <div className="flex flex-col gap-3 w-full px-2">
                <p className="text-base text-white/80 leading-relaxed bg-white/5 border border-white/5 p-4 rounded-2xl">
                  We show you 10 online classified listings. Swipe <span className="text-[#00ff87] font-bold">Right</span> if you think they are listed for <span className="text-[#00ff87] font-bold">FREE</span>, or swipe <span className="text-[#ff007f] font-bold">Left</span> if they are <span className="text-[#ff007f] font-bold">PAID</span>.
                </p>
              </div>

              {/* CTA — changes based on load state */}
              <div className="w-full px-2">
                {isLoading ? (
                  <div className="w-full py-4 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center gap-2 text-white/40 text-sm font-semibold">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading today's listings...
                  </div>
                ) : itemsError === 'no-content' || itemsError === 'not-ready' ? (
                  <div className="w-full flex flex-col items-center gap-3">
                    <div className="flex items-center gap-2 text-amber-400 text-sm font-semibold">
                      <CalendarX className="w-4 h-4" />
                      No game available yet today — check back soon!
                    </div>
                  </div>
                ) : itemsError === 'fetch-error' ? (
                  <div className="w-full flex flex-col items-center gap-3">
                    <div className="flex items-center gap-2 text-[#ff007f] text-sm font-semibold">
                      <WifiOff className="w-4 h-4" />
                      Couldn't load today's game — check your connection
                    </div>
                  </div>
                ) : hasPlayedToday ? (
                  <button
                    onClick={showResults}
                    className="w-full py-4.5 rounded-2xl bg-[#00ff87] text-black font-extrabold text-lg tracking-widest uppercase transition-all duration-300 hover:shadow-[0_0_30px_rgba(0,255,135,0.6)] hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
                  >
                    Show Results
                  </button>
                ) : hasInProgressGame ? (
                  <button
                    onClick={startGame}
                    className="w-full py-4.5 rounded-2xl bg-[#00ff87] text-black font-extrabold text-lg tracking-widest uppercase transition-all duration-300 hover:shadow-[0_0_30px_rgba(0,255,135,0.6)] hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
                  >
                    RESUME
                  </button>
                ) : (
                  <button
                    onClick={startGame}
                    className="w-full py-4.5 rounded-2xl bg-[#00ff87] text-black font-extrabold text-lg tracking-widest uppercase transition-all duration-300 hover:shadow-[0_0_30px_rgba(0,255,135,0.6)] hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
                  >
                    START
                  </button>
                )}
              </div>

              {gameDate && (
                <p className="text-sm tracking-[2px] uppercase text-white/40 font-bold">
                  {(() => {
                    const [year, month, day] = gameDate.split('-');
                    const date = new Date(Number(year), Number(month) - 1, Number(day));
                    return date.toLocaleDateString('en-US', {
                      month: 'long',
                      day: 'numeric',
                      year: 'numeric',
                    }).toUpperCase();
                  })()}
                </p>
              )}
            </div>
          </div>
        )}

        {/* ── Playing state ── */}
        {gameState === 'playing' && (
          <>
            <Header
              totalItems={items.length}
              currentIndex={currentIndex}
              guesses={guesses}
              score={score}
            />

            <div className="relative flex-grow w-full h-full flex justify-center items-center">
              <CardStack
                ref={cardStackRef}
                items={items}
                currentIndex={currentIndex}
                onGuess={handleGuess}
              />
            </div>

            <Controls
              onSwipeLeft={handleSwipeLeftButton}
              onSwipeRight={handleSwipeRightButton}
              disabled={isTransitioning || currentIndex >= items.length}
            />
          </>
        )}

        {/* ── Game over state ── */}
        {gameState === 'game_over' && (
          <GameOver
            items={localItems}
            score={score}
            guesses={guesses}
            userSwipes={userSwipes}
            stats={stats}
            statsLoading={statsLoading}
            globalScoreDistribution={localGlobalDist}
            onRestart={startGame}
            gameDate={gameDate}
            onResetStats={async () => {
              const ok = await resetStats(gameDate);
              if (ok) {
                if (gameDate) {
                  localStorage.removeItem(`freejiji_progress_${gameDate}`);
                }
                setHasInProgressGame(false);
                setHasPlayedToday(false);
                setCompletedGameData(null);
                setGameState('start');
              }
            }}
          />
        )}

        {/* ── Feedback overlay (sits at root so it's never clipped by transforms) ── */}
        {feedback && (
          <div
            onClick={handleFeedbackDismiss}
            className="fixed inset-0 flex justify-center items-center z-50 animate-fade-in cursor-pointer bg-black/60 backdrop-blur-2xl"
          >
            <div
              className={`p-6 flex flex-col items-center justify-center text-center gap-3 border-2 ${
                feedback.isCorrect
                  ? 'feedback-card-correct shadow-[0_0_35px_rgba(0,255,135,0.25)]'
                  : 'feedback-card-incorrect shadow-[0_0_35px_rgba(255,0,127,0.25)]'
              } rounded-3xl w-[85%] max-w-[320px] animate-scale-up`}
            >
              {/* Visual reference thumbnail */}
              <img
                src={feedback.image}
                alt={feedback.title}
                className="w-32 h-20 rounded-xl object-cover border border-white/10 mb-1"
              />

              {/* Verdict Row */}
              <div className="flex items-center gap-2 select-none">
                {feedback.isCorrect ? (
                  <Check className="w-6 h-6" style={{ color: '#22c55e', filter: 'drop-shadow(0 0 8px rgba(34, 197, 94, 0.6))' }} />
                ) : (
                  <X className="w-6 h-6" style={{ color: '#ef4444', filter: 'drop-shadow(0 0 8px rgba(239, 68, 68, 0.6))' }} />
                )}
                <h3
                  className={`text-lg font-black uppercase tracking-wider ${
                    feedback.isCorrect ? 'text-[#00ff87]' : 'text-[#ff007f]'
                  }`}
                >
                  {feedback.isCorrect ? 'Correct!' : 'Incorrect!'}
                </h3>
              </div>

              {/* Item details */}
              <div className="flex flex-col gap-1 border-y border-white/10 py-3 my-1 w-full">
                <div className="flex items-center justify-center gap-1 text-[11px] font-semibold tracking-wider text-white/50 mb-1 select-none">
                  <MapPin className="w-3.5 h-3.5 text-[#00d2ff]" />
                  <span>{feedback.location}</span>
                </div>
                <h4 className="text-sm font-extrabold text-white leading-snug">
                  {feedback.title}
                </h4>
                <p className="text-[11px] text-white/70 leading-relaxed max-h-16 overflow-y-auto pr-1">
                  {feedback.description}
                </p>
              </div>

              {/* Actual price */}
              <p className="text-xs font-semibold text-white/90">
                Actual Price:{' '}
                <span className="font-bold text-sm text-white">
                  {feedback.isFree ? 'FREE' : `$${feedback.actualPrice.toFixed(0)}`}
                </span>
              </p>

              <div className="text-xs uppercase tracking-[2px] text-white font-extrabold animate-pulse mt-3">
                Tap anywhere to continue
              </div>
              <div className="text-[10px] text-white/60 font-semibold mt-1.5 select-none">
                Auto-continuing in {countdown}s...
              </div>
            </div>
          </div>
        )}
      </main>
    </>
  );
}

export default App;
