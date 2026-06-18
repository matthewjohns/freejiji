import React, { useState, useRef, useEffect, useImperativeHandle, forwardRef } from 'react';

interface SwipeCardProps {
  onSwipe: (dir: 'left' | 'right') => void;
  isCurrent: boolean;
  children: React.ReactNode;
}

export interface SwipeCardRef {
  swipe: (dir: 'left' | 'right') => Promise<void>;
}

export const SwipeCard = forwardRef<SwipeCardRef, SwipeCardProps>(({
  onSwipe,
  isCurrent,
  children,
}, ref) => {
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [rotation, setRotation] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [flyOut, setFlyOut] = useState(false);
  
  const startX = useRef(0);
  const startY = useRef(0);
  const elementRef = useRef<HTMLDivElement>(null);

  // Reset positioning state when the card is no longer active or is reset
  useEffect(() => {
    if (!isCurrent) {
      setPosition({ x: 0, y: 0 });
      setRotation(0);
      setIsDragging(false);
      setFlyOut(false);
    }
  }, [isCurrent]);

  // Expose programmatic swipe animation triggers to the parent
  useImperativeHandle(ref, () => ({
    swipe: async (dir: 'left' | 'right') => {
      setFlyOut(true);
      const targetX = dir === 'right' ? 700 : -700;
      setPosition({ x: targetX, y: 0 });
      setRotation(dir === 'right' ? 25 : -25);
      
      // Let the CSS fly-out transition complete before notifying the parent
      setTimeout(() => {
        onSwipe(dir);
      }, 250);
    }
  }));

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!isCurrent || flyOut) return;
    setIsDragging(true);
    startX.current = e.clientX;
    startY.current = e.clientY;
    if (elementRef.current) {
      elementRef.current.setPointerCapture(e.pointerId);
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging || !isCurrent || flyOut) return;
    const deltaX = e.clientX - startX.current;
    const deltaY = e.clientY - startY.current;
    setPosition({ x: deltaX, y: deltaY });
    setRotation(deltaX * 0.07); // Subtle rotational tilt as the card drifts
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isCurrent || flyOut) return;
    setIsDragging(false);
    
    if (elementRef.current) {
      try {
        elementRef.current.releasePointerCapture(e.pointerId);
      } catch (err) {
        // Ignore capture release errors
      }
    }

    const threshold = 120; // Distance required to register a swipe
    if (position.x > threshold) {
      // Fly out right (FREE guess)
      setFlyOut(true);
      setPosition({ x: 700, y: position.y });
      setRotation(25);
      setTimeout(() => {
        onSwipe('right');
      }, 250);
    } else if (position.x < -threshold) {
      // Fly out left (PAID guess)
      setFlyOut(true);
      setPosition({ x: -700, y: position.y });
      setRotation(-25);
      setTimeout(() => {
        onSwipe('left');
      }, 250);
    } else {
      // Snap card back to the center of the stack
      setPosition({ x: 0, y: 0 });
      setRotation(0);
    }
  };

  // Badge opacities based on absolute horizontal displacement (fade in much faster for mobile)
  const freeOpacity = position.x > 8 ? Math.min((position.x - 8) / 32, 1) : 0;
  const paidOpacity = position.x < -8 ? Math.min((Math.abs(position.x) - 8) / 32, 1) : 0;

  // Determine active transform rules
  const transformStyle = flyOut || isDragging
    ? `translate3d(${position.x}px, ${position.y}px, 0) rotate(${rotation}deg)`
    : 'translate3d(0, 0, 0) rotate(0deg)';

  const transitionStyle = isDragging
    ? 'none'
    : 'transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.15), opacity 0.3s ease';

  return (
    <div
      ref={elementRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      className="relative w-full h-full"
      style={{
        transform: transformStyle,
        transition: transitionStyle,
        touchAction: 'none',
        cursor: isCurrent && !flyOut ? (isDragging ? 'grabbing' : 'grab') : 'default',
      }}
    >
      {/* Swipe Badges Overlay */}
      {isCurrent && (
        <>
          <div
            className="swipe-badge swipe-badge-free"
            style={{
              opacity: freeOpacity,
              transform: `rotate(${Math.max(-position.x * 0.12, -15)}deg) scale(${1 + Math.min(position.x * 0.001, 0.15)})`,
            }}
          >
            Free
          </div>
          <div
            className="swipe-badge swipe-badge-paid"
            style={{
              opacity: paidOpacity,
              transform: `rotate(${Math.min(Math.abs(position.x) * 0.12, 15)}deg) scale(${1 + Math.min(Math.abs(position.x) * 0.001, 0.15)})`,
            }}
          >
            Paid
          </div>
        </>
      )}

      {children}
    </div>
  );
});

SwipeCard.displayName = 'SwipeCard';
