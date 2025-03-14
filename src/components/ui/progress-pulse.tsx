"use client";

import * as React from "react";
import { useRef, useLayoutEffect, createContext, useContext } from "react";
import { cn } from "@/lib/utils";
import { ProcessingStatus } from "@/store/processed-files";

interface ProgressPulseRootProps {
  status: ProcessingStatus;
  className?: string;
  children: React.ReactNode;
}

const ProgressPulseContext = createContext<{
  status: ProcessingStatus;
}>({
  status: ProcessingStatus.NOT_STARTED,
});

const ProgressPulseRoot: React.FC<ProgressPulseRootProps> = ({
  status,
  className,
  children,
}) => {
  return (
    <ProgressPulseContext.Provider value={{ status }}>
      <div className={cn("", className)}>{children}</div>
    </ProgressPulseContext.Provider>
  );
};
ProgressPulseRoot.displayName = "ProgressPulseRoot";

const statusConfig = {
  [ProcessingStatus.NOT_STARTED]: {
    text: "Not Started",
    bgColor: "bg-gray-600",
    textColor: "text-white",
    animatePulse: false,
  },
  [ProcessingStatus.PROCESSING]: {
    text: "Pending",
    bgColor: "bg-blue-600",
    textColor: "text-white",
    animatePulse: true,
  },
  [ProcessingStatus.COMPLETED]: {
    text: "Completed",
    bgColor: "bg-green-600",
    textColor: "text-white",
    animatePulse: false,
  },
  [ProcessingStatus.FAILED]: {
    text: "Failed",
    bgColor: "bg-red-600",
    textColor: "text-white",
    animatePulse: false,
  },
} as const;

interface ProgressPulseContentProps {
  className?: string;
}

const widthCache = new Map<string, number>();

const ProgressPulseContent = React.memo<ProgressPulseContentProps>(
  ({ className }) => {
    const { status } = useContext(ProgressPulseContext);
    const containerRef = useRef<HTMLDivElement>(null);
    const prevStatusRef = useRef<ProcessingStatus | null>(null);

    useLayoutEffect(() => {
      const container = containerRef?.current;
      if (!container) return;

      if (prevStatusRef.current === status) return;

      let newWidth: number;

      if (widthCache.has(status)) {
        newWidth = widthCache.get(status)!;
      } else {
        container.style.transition = "none";
        container.style.width = "auto";
        container.style.opacity = "1";
        container.style.position = "absolute";
        container.style.visibility = "hidden";
        newWidth = container.offsetWidth;
        widthCache.set(status, newWidth);

        container.style.position = "";
        container.style.visibility = "";
      }

      container.style.width = "0px";
      container.style.opacity = "0";

      void container.offsetWidth;

      container.style.transition = "width 0.5s ease, opacity 0.6s ease-in";
      container.style.width = `${newWidth}px`;
      container.style.opacity = "1";

      prevStatusRef.current = status;
    }, [status]);

    const { text, bgColor, textColor, animatePulse } = statusConfig[status];

    return (
      <div
        ref={containerRef}
        role="status"
        aria-live="polite"
        className={cn(
          "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 text-white whitespace-nowrap overflow-hidden",
          bgColor,
          textColor,
          animatePulse && "animate-pulse",
          className
        )}
      >
        <span
          className="inline-block"
          style={{
            transform: "translateX(0)",
            opacity: 1,
            transition: "transform 0.5s ease-in-out, opacity 0.7s ease-in-out",
          }}
        >
          {text}
        </span>
      </div>
    );
  }
);
ProgressPulseContent.displayName = "ProgressPulseContent";

export { ProgressPulseRoot, ProgressPulseContent };
