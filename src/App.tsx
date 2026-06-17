import { useState, useRef } from 'react';
import { Header } from './components/Header';
import { CardStack } from './components/CardStack';
import type { CardStackRef } from './components/CardStack';
import { Controls } from './components/Controls';
import { GameOver } from './components/GameOver';
import todaysItems from './data/todays_items.json';
import type { KijijiItem } from './types';
import { useFirebaseStats } from './hooks/useFirebaseStats';
import { ShoppingBag, Check, X, MapPin } from 'lucide-react';

const items: KijijiItem[] = todaysItems;

function App() {
  const { stats, loading: statsLoading, saveGameResult } = useFirebaseStats();
  const [gameState, setGameState] = useState<'start' | 'playing' | 'game_over'>('start');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [guesses, setGuesses] = useState<(boolean | null)[]>([null, null, null, null, null]);
  const [userSwipes, setUserSwipes] = useState<boolean[]>([]); // true for Free, false for Paid
  const [score, setScore] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [feedback, setFeedback] = useState<{
    isCorrect: boolean;
    actualPrice: number;
    isFree: boolean;
    title: string;
    description: string;
    image: string;
    location: string;
  } | null>(null);

  const cardStackRef = useRef<CardStackRef>(null);

  const startGame = () => {
    setGameState('playing');
    setCurrentIndex(0);
    setGuesses([null, null, null, null, null]);
    setUserSwipes([]);
    setScore(0);
    setFeedback(null);
    setIsTransitioning(false);
  };

  const handleGuess = (isCorrect: boolean, index: number) => {
    // Prevent double processing
    if (index !== currentIndex) return;
    
    setIsTransitioning(true);

    // Track user's guess (Free vs Paid)
    const item = items[index];
    const swipedFree = isCorrect ? item.isFree : !item.isFree;

    setUserSwipes((prev) => {
      const next = [...prev];
      next[index] = swipedFree;
      return next;
    });

    setGuesses((prev) => {
      const next = [...prev];
      next[index] = isCorrect;
      return next;
    });

    if (isCorrect) {
      setScore((prev) => prev + 1);
    }

    // Set feedback details (including image for reference)
    setFeedback({
      isCorrect,
      actualPrice: item.actualPrice,
      isFree: item.isFree,
      title: item.title,
      description: item.description,
      image: item.image,
      location: item.location,
    });
  };

  const handleFeedbackDismiss = () => {
    if (!feedback) return;

    setFeedback(null);
    const nextIndex = currentIndex + 1;
    setCurrentIndex(nextIndex);
    setIsTransitioning(false);

    if (nextIndex >= items.length) {
      saveGameResult(score);
      setGameState('game_over');
    }
  };

  const handleSwipeLeftButton = () => {
    if (isTransitioning || currentIndex >= items.length) return;
    cardStackRef.current?.swipe('left');
  };

  const handleSwipeRightButton = () => {
    if (isTransitioning || currentIndex >= items.length) return;
    cardStackRef.current?.swipe('right');
  };

  return (
    <>
      {/* Ambient background decoration */}
      <div className="bg-ambient">
        <div className="blob blob-1" />
        <div className="blob blob-2" />
        <div className="blob blob-3" />
      </div>

      <main className="game-container">
        {gameState === 'start' && (
          <div className="flex-1 flex flex-col justify-between items-center w-full h-full text-center glass-card p-8 border-white/10 bg-black/30 backdrop-blur-2xl">
            <div className="flex-1 flex flex-col justify-center items-center gap-6">
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

              <div className="flex flex-col gap-3 max-w-sm px-2">
                <p className="text-base text-white/80 leading-relaxed bg-white/5 border border-white/5 p-4 rounded-2xl">
                  We show you 5 online classified listings. Swipe <span className="text-[#00ff87] font-bold">Right</span> if you think they are listed for <span className="text-[#00ff87] font-bold">FREE</span>, or swipe <span className="text-[#ff007f] font-bold">Left</span> if they are <span className="text-[#ff007f] font-bold">PAID</span>.
                </p>
              </div>
            </div>

            {/* CTA Button */}
            <button
              onClick={startGame}
              className="w-full py-4.5 rounded-2xl bg-gradient-to-r from-[#00ff87] via-[#00d2ff] to-[#8e2de2] text-white font-extrabold text-lg tracking-widest uppercase transition-all duration-300 hover:shadow-[0_0_30px_rgba(0,255,135,0.4)] hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
            >
              Start Swiping
            </button>
          </div>
        )}

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

              {/* Tap anywhere to Continue Guess Feedback Overlay */}
              {feedback && (
                <div 
                  onClick={handleFeedbackDismiss}
                  className="fixed inset-0 flex justify-center items-center z-30 animate-fade-in cursor-pointer"
                >
                  <div
                    className={`glass-card p-6 flex flex-col items-center justify-center text-center gap-3 border-2 ${
                      feedback.isCorrect
                        ? 'feedback-card-correct shadow-[0_0_35px_rgba(0,255,135,0.25)]'
                        : 'feedback-card-incorrect shadow-[0_0_35px_rgba(255,0,127,0.25)]'
                    } backdrop-blur-2xl rounded-3xl w-[85%] max-w-[320px] animate-scale-up`}
                  >
                    {/* Visual reference thumbnail */}
                    <img
                      src={feedback.image}
                      alt={feedback.title}
                      className="w-32 h-20 rounded-xl object-cover border border-white/10 mb-1"
                    />

                    {/* Verdict Row (Icon & Text) */}
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

                    {/* Item Reveals (Title & Description) */}
                    <div className="flex flex-col gap-1 border-y border-white/10 py-3 my-1 w-full">
                      {/* Location Badge */}
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

                    {/* Actual Price */}
                    <p className="text-xs font-semibold text-white/90">
                      Actual Price: <span className="font-bold text-sm text-white">{feedback.isFree ? 'FREE' : `$${feedback.actualPrice.toFixed(0)}`}</span>
                    </p>

                    {/* Tap to continue indicator */}
                    <div className="text-[9px] uppercase tracking-[2px] text-white/30 font-bold animate-pulse mt-2">
                      Tap anywhere to continue
                    </div>
                  </div>
                </div>
              )}
            </div>

            <Controls
              onSwipeLeft={handleSwipeLeftButton}
              onSwipeRight={handleSwipeRightButton}
              disabled={isTransitioning || currentIndex >= items.length}
            />
          </>
        )}

        {gameState === 'game_over' && (
          <GameOver
            items={items}
            score={score}
            guesses={guesses}
            userSwipes={userSwipes}
            stats={stats}
            statsLoading={statsLoading}
            onRestart={startGame}
          />
        )}
      </main>
    </>
  );
}

// Live deployment trigger
export default App;
