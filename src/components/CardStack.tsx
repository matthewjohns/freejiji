import React, { useRef, useImperativeHandle, forwardRef } from 'react';
import { SwipeCard } from './SwipeCard';
import { GameCard } from './GameCard';
import type { KijijiItem } from '../types';

interface CardStackProps {
  items: KijijiItem[];
  currentIndex: number;
  onGuess: (isCorrect: boolean, index: number) => void;
}

export interface CardStackRef {
  swipe: (dir: 'left' | 'right') => Promise<void>;
}

export const CardStack = forwardRef<CardStackRef, CardStackProps>(({
  items,
  currentIndex,
  onGuess,
}, ref) => {
  // Array of refs for each SwipeCard to allow programmatic swiping
  const cardRefs = useRef<any[]>([]);

  // Initialize refs for each item
  if (cardRefs.current.length !== items.length) {
    cardRefs.current = Array(items.length)
      .fill(null)
      .map((_, i) => cardRefs.current[i] || React.createRef());
  }

  // Expose the swipe function to parent via ref
  useImperativeHandle(ref, () => ({
    swipe: async (dir: 'left' | 'right') => {
      const currentCard = cardRefs.current[currentIndex]?.current;
      if (currentCard) {
        await currentCard.swipe(dir);
      }
    }
  }));

  const handleSwipe = (dir: 'left' | 'right', index: number) => {
    // Only register swipes for the current active card
    if (index !== currentIndex) return;

    const item = items[index];
    const guessedFree = dir === 'right';
    const isCorrect = guessedFree === item.isFree;

    onGuess(isCorrect, index);
  };

  const getCardStyle = (index: number) => {
    const diff = index - currentIndex;

    // Card has already been swiped
    if (diff < 0) {
      return {
        zIndex: 0,
        pointerEvents: 'none' as const,
        opacity: 0,
        transition: 'opacity 0.4s ease, transform 0.4s ease',
        transform: 'scale(0.8) translateY(-20px)',
      };
    }

    // Card is the current active card
    if (diff === 0) {
      return {
        zIndex: items.length - index,
        pointerEvents: 'auto' as const,
      };
    }

    // Cards below the active card in the stack
    return {
      zIndex: items.length - index,
      transform: `scale(${1 - diff * 0.045}) translateY(${diff * 14}px)`,
      opacity: diff > 2 ? 0 : 1 - diff * 0.15,
      pointerEvents: 'none' as const,
      transition: 'transform 0.35s cubic-bezier(0.175, 0.885, 0.32, 1.15), opacity 0.3s ease',
    };
  };

  return (
    <div className="card-stack select-none">
      {items.map((item, index) => {
        // Only render the card if it is in the active viewable stack (diff between -1 and 3)
        const diff = index - currentIndex;
        if (diff < -1 || diff > 3) return null;

        return (
          <div
            key={item.id}
            className="tinder-card-wrapper"
            style={getCardStyle(index)}
          >
            <SwipeCard
              ref={cardRefs.current[index]}
              onSwipe={(dir) => handleSwipe(dir, index)}
              isCurrent={index === currentIndex}
            >
              <GameCard
                item={item}
                isCurrent={index === currentIndex}
              />
            </SwipeCard>
          </div>
        );
      })}
    </div>
  );
});

CardStack.displayName = 'CardStack';
