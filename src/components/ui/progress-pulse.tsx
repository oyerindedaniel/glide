"use client";

import * as React from "react";
import {
  useState,
  useRef,
  useLayoutEffect,
  createContext,
  useContext,
} from "react";
import { cn } from "@/lib/utils";
import { ProcessingStatus } from "@/store/processed-files";

// Props for the root component
interface ProgressPulseRootProps {
  status: ProcessingStatus;
  className?: string;
  children: React.ReactNode;
}

// Context to share status
const ProgressPulseContext = createContext<{
  status: ProcessingStatus;
}>({
  status: ProcessingStatus.NOT_STARTED,
});

// Root component
const ProgressPulseRoot: React.FC<ProgressPulseRootProps> = ({
  status,
  className,
  children,
}) => {
  return (
    <ProgressPulseContext.Provider value={{ status }}>
      <div className={cn("relative", className)}>{children}</div>
    </ProgressPulseContext.Provider>
  );
};
ProgressPulseRoot.displayName = "ProgressPulseRoot";

// Status configuration
const statusConfig = {
  [ProcessingStatus.NOT_STARTED]: {
    text: "Not Started",
    bgColor: "bg-gray-600",
  },
  [ProcessingStatus.PROCESSING]: {
    text: "Processing",
    bgColor: "bg-blue-600",
  },
  [ProcessingStatus.COMPLETED]: {
    text: "Completed",
    bgColor: "bg-green-600",
  },
  [ProcessingStatus.FAILED]: {
    text: "Failed",
    bgColor: "bg-red-600",
  },
};

interface ProgressPulseContentProps {
  className?: string;
}

const ProgressPulseContent: React.FC<ProgressPulseContentProps> = ({
  className,
}) => {
  const { status } = useContext(ProgressPulseContext);
  const [width, setWidth] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (containerRef.current) {
      const container = containerRef.current;
      const originalWidth = container.style.width;
      container.style.width = "auto"; // Temporarily set to auto to measure
      const newWidth = container.offsetWidth;
      container.style.width = originalWidth; // Restore original
      setWidth(newWidth);
    }
  }, [status]);

  const { text, bgColor } = statusConfig[status];

  return (
    <div
      ref={containerRef}
      role="status"
      aria-live="polite"
      className={cn(
        "px-2 py-1 rounded text-white whitespace-nowrap overflow-hidden transition-[width] duration-300 ease-in-out",
        bgColor,
        "w-[var(--indicator-width)]",
        className
      )}
      style={
        {
          "--indicator-width": `${width}px`,
        } as React.CSSProperties
      }
    >
      <span
        className="inline-block"
        style={{
          transform: `translateX(${width === 0 ? "100%" : "0"})`,
          transition: "transform 0.3s ease-in-out",
        }}
      >
        {text}
      </span>
    </div>
  );
};
ProgressPulseContent.displayName = "ProgressPulseContent";

export { ProgressPulseRoot, ProgressPulseContent };
