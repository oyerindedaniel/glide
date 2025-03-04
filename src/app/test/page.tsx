"use client";

import { useEffect, useRef, useState } from "react";

export default function Home() {
  const targetRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const checkVisibility = () => {
      if (!targetRef.current) return;

      const rect = targetRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight;

      // Check if any part of the element is in the viewport
      const isVisible = rect.top < viewportHeight && rect.bottom > 0;
      console.log({ isVisible, rect, viewportHeight });
      setIsVisible(isVisible);
    };

    // Initial check and event listener
    checkVisibility();
    window.addEventListener("scroll", checkVisibility);
    window.addEventListener("resize", checkVisibility);

    return () => {
      window.removeEventListener("scroll", checkVisibility);
      window.removeEventListener("resize", checkVisibility);
    };
  }, []);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center">
      <h1 className="text-3xl font-bold mb-8">Visibility Check</h1>

      {/* Spacer for scrolling */}
      <div className="h-[150vh] bg-gray-100">Scroll down ⬇️</div>

      {/* Target element to observe */}
      <div
        ref={targetRef}
        className="h-40 w-40 bg-blue-500 text-white flex items-center justify-center"
      >
        {isVisible ? "I am visible! ✅" : "I am hidden ❌"}
      </div>

      {/* More content for scroll */}
      <div className="h-[150vh] bg-gray-100">Scroll up ⬆️</div>
    </main>
  );
}
