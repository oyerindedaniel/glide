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
    <main className="h-screen">
      {/* Spacer for scrolling */}
      {/* <div className="h-[150vh] bg-gray-100">Scroll down ⬇️</div> */}

      {/* Target element to observe */}
      <div className="h-screen relative w-[70%] top-0 overflow-y-auto white">
        <div className="h-200 w-full bg-red-500 opacity-20 sticky top-0">
          Oyerinde
        </div>
        <div className="h-auto w-full absolute top-0 -z-1">
          <div className="h-svh w-full bg-yellow-800"></div>
          <div className="h-svh w-full bg-black"></div>
        </div>
      </div>

      {/* More content for scroll */}
      {/* <div className="h-[150vh] bg-gray-100">Scroll up ⬆️</div> */}
    </main>
  );
}
