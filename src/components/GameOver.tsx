import React, { useEffect, useState } from 'react';
import { RefreshCw, ExternalLink, CheckCircle2, XCircle, Medal, Frown, Share2 } from 'lucide-react';
import confetti from 'canvas-confetti';
import type { KijijiItem } from '../types';
import type { UserStats } from '../hooks/useFirebaseStats';

interface GameOverProps {
  items: KijijiItem[];
  score: number;
  guesses: (boolean | null)[];
  userSwipes: boolean[]; // Array representing whether the user guessed Free (true) or Paid (false) for each item
  stats: UserStats | null;
  statsLoading: boolean;
  onRestart: () => void;
}

export const GameOver: React.FC<GameOverProps> = ({
  items,
  score,
  guesses,
  userSwipes,
  stats,
  statsLoading,
  onRestart,
}) => {
  const totalItems = items.length;
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Only fire confetti on a perfect score
    if (score === totalItems) {
      const duration = 2.5 * 1000;
      const end = Date.now() + duration;

      const frame = () => {
        confetti({
          particleCount: 4,
          angle: 60,
          spread: 55,
          origin: { x: 0 },
          colors: ['#89cff0', '#4169e1', '#ffffff'],
        });
        confetti({
          particleCount: 4,
          angle: 120,
          spread: 55,
          origin: { x: 1 },
          colors: ['#89cff0', '#4169e1', '#ffffff'],
        });

        if (Date.now() < end) {
          requestAnimationFrame(frame);
        }
      };

      frame();
    }
  }, [score, totalItems]);

  const percentage = (score / totalItems) * 100;

  const shareScore = () => {
    let performanceText = '';
    if (score === totalItems) {
      performanceText = "I'm Freejiji Elite! 🥇";
    } else if (percentage >= 75) {
      performanceText = "I Freejiji'd good. 🥈";
    } else if (percentage >= 50) {
      performanceText = "Ok Frijiji today 🥉";
    } else {
      performanceText = "I participated in today's Freejiji 😞";
    }

    const emojiSequence = guesses
      .map((guess) => (guess === true ? '✅' : '❌'))
      .join(' ');

    let streakText = '';
    if (stats && stats.currentStreak > 0) {
      streakText = `\nStreak: 🔥 ${stats.currentStreak} Days (Max: ⚡️ ${stats.maxStreak})`;
    }

    const shareMessage = `${performanceText}\nScore: ${score}/${totalItems}${streakText}\n${emojiSequence}\n\nPlay here: ${window.location.href}`;

    navigator.clipboard.writeText(shareMessage).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(err => {
      console.error('Failed to copy text: ', err);
    });
  };

  // Determine feedback message, rank, rank color, and icon
  let rank = '';
  let message = '';
  let rankColor = '';
  let displayIcon = null;

  if (score === totalItems) {
    rank = 'Freejiji Deity';
    message = 'Perfect! You know the true value of trash and treasure!';
    rankColor = 'text-gold';
    displayIcon = <Medal className="w-9 h-9 text-gold" style={{ filter: 'drop-shadow(0 0 8px rgba(251, 191, 36, 0.4))' }} />;
  } else if (percentage >= 75) {
    rank = 'Thrift Store Expert';
    message = 'So close! You have a great eye for bargain hunting.';
    rankColor = 'text-silver';
    displayIcon = <Medal className="w-9 h-9 text-silver" style={{ filter: 'drop-shadow(0 0 6px rgba(203, 213, 225, 0.3))' }} />;
  } else if (percentage >= 50) {
    rank = 'Garage Sale Regular';
    message = 'Not bad! You could spot a deal, but missed a couple.';
    rankColor = 'text-bronze';
    displayIcon = <Medal className="w-9 h-9 text-bronze" style={{ filter: 'drop-shadow(0 0 6px rgba(205, 127, 50, 0.3))' }} />;
  } else {
    rank = 'Retail Price Victim';
    message = 'Ouch! You might be giving away gold for free.';
    rankColor = 'text-disappointed';
    displayIcon = <Frown className="w-9 h-9 text-disappointed" style={{ filter: 'drop-shadow(0 0 6px rgba(244, 63, 94, 0.3))' }} />;
  }

  return (
    <div className="flex-1 flex flex-col justify-between w-full h-full select-none glass-card p-6 overflow-hidden border-white/10 bg-black/30 backdrop-blur-2xl">
      {/* Header Summary */}
      <div className="flex flex-col items-center text-center gap-2 pt-2">
        <div className="relative flex items-center justify-center w-16 h-16 rounded-2xl bg-white/5 border border-white/10 shadow-inner mb-2">
          {displayIcon}
        </div>

        <h2 className={`text-2xl font-extrabold uppercase tracking-wider ${rankColor}`}>
          {rank}
        </h2>

        {/* Giant Score Circle */}
        <div className="relative my-3 flex items-center justify-center w-28 h-28 rounded-full bg-gradient-to-tr from-[#0b090f] to-white/5 border border-white/15 shadow-xl">
          <span className="text-4xl font-black text-white">
            {score}
            <span className="text-lg text-white/40 font-bold">/{totalItems}</span>
          </span>
        </div>

        <p className="text-xs text-white/60 px-4 max-w-sm">
          {message}
        </p>
      </div>

      {/* Recap List */}
      <div className="flex-1 flex flex-col gap-3 my-4 overflow-hidden">
        <h4 className="text-xs font-bold uppercase tracking-[2.5px] text-white/30 px-1">
          Today's Items Recap
        </h4>
        
        <div className="flex-1 overflow-y-auto custom-scroll pr-1 flex flex-col gap-2">
          {items.map((item, index) => {
            const isCorrect = guesses[index] === true;
            const guessedFree = userSwipes[index];

            return (
              <div
                key={item.id}
                className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-white/5 border border-white/5 hover:border-white/10 transition-all duration-200"
              >
                {/* Thumbnail */}
                <img
                  src={item.image}
                  alt={item.title}
                  className="w-12 h-12 rounded-xl object-cover border border-white/10 flex-shrink-0"
                />

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <h5 className="text-xs font-bold text-white truncate leading-tight">
                    {item.title}
                  </h5>
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${
                      item.isFree ? 'bg-[#00ff87]/20 text-[#00ff87]' : 'bg-white/10 text-white/70'
                    }`}>
                      Actual: {item.isFree ? 'FREE' : `$${item.actualPrice.toFixed(0)}`}
                    </span>
                    <span className="text-[10px] text-white/40">
                      Guess: {guessedFree ? 'Free' : 'Paid'}
                    </span>
                    <span className="text-[10px] text-white/30">•</span>
                    <span className="text-[10px] text-white/40">
                      {item.location}
                    </span>
                  </div>
                </div>

                {/* Score Status & External Link */}
                <div className="flex items-center gap-3">
                  {isCorrect ? (
                    <CheckCircle2 className="w-5 h-5 text-[#00ff87] flex-shrink-0" />
                  ) : (
                    <XCircle className="w-5 h-5 text-[#ff007f] flex-shrink-0" />
                  )}
                  
                  <a
                    href={item.listingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`View ${item.title} listing on Kijiji`}
                    className="p-2 rounded-xl bg-white/5 border border-white/10 text-white/70 hover:text-white hover:bg-white/10 transition-all duration-200"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Stats Panel */}
      <div className="w-full flex flex-col gap-2 mt-1 select-none">
        <h4 className="text-[10px] font-bold uppercase tracking-[2.5px] text-white/30 px-1">
          Your Lifetime Stats
        </h4>
        {statsLoading ? (
          <div className="flex justify-center items-center py-4 text-xs text-white/40">
            Loading Stats...
          </div>
        ) : stats ? (
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-0.5 p-3 rounded-2xl bg-white/5 border border-white/5">
              <span className="text-[10px] text-white/40 uppercase tracking-wider font-semibold">Streak</span>
              <span className="text-sm font-bold text-[#00ff87]">🔥 {stats.currentStreak} Days</span>
            </div>
            <div className="flex flex-col gap-0.5 p-3 rounded-2xl bg-white/5 border border-white/5">
              <span className="text-[10px] text-white/40 uppercase tracking-wider font-semibold">Max Streak</span>
              <span className="text-sm font-bold text-[#00d2ff]">⚡️ {stats.maxStreak} Days</span>
            </div>
            <div className="flex flex-col gap-0.5 p-3 rounded-2xl bg-white/5 border border-white/5">
              <span className="text-[10px] text-white/40 uppercase tracking-wider font-semibold">All Time Score</span>
              <span className="text-sm font-bold text-white">🏆 {stats.allTimeScore} pts</span>
            </div>
            <div className="flex flex-col gap-0.5 p-3 rounded-2xl bg-white/5 border border-white/5">
              <span className="text-[10px] text-white/40 uppercase tracking-wider font-semibold">Played</span>
              <span className="text-sm font-bold text-white/80">🎮 {stats.gamesPlayed} games</span>
            </div>
          </div>
        ) : (
          <div className="flex justify-center items-center py-4 text-xs text-white/40">
            Could not load stats.
          </div>
        )}
      </div>

      {/* Action Footer */}
      <div className="flex flex-col gap-2 w-full mt-2 flex-shrink-0">
        <button
          onClick={shareScore}
          className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl bg-white/10 border border-white/10 text-white font-extrabold text-sm tracking-wider uppercase transition-all duration-300 hover:bg-white/15 active:scale-[0.98] cursor-pointer"
        >
          <Share2 className="w-4 h-4" />
          {copied ? 'Copied!' : 'Share Score'}
        </button>

        <button
          onClick={onRestart}
          className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl bg-gradient-to-r from-[#00ff87] via-[#00d2ff] to-[#8e2de2] text-white font-extrabold text-sm tracking-wider uppercase transition-all duration-300 hover:shadow-[0_0_30px_rgba(0,255,135,0.4)] active:scale-[0.98] cursor-pointer"
        >
          <RefreshCw className="w-4 h-4" />
          Play Again
        </button>
      </div>
    </div>
  );
};
