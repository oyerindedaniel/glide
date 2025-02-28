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
  },
  [ProcessingStatus.PROCESSING]: {
    text: "Pending",
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

const widthCache = new Map<string, number>();

const ProgressPulseContent: React.FC<ProgressPulseContentProps> = ({
  className,
}) => {
  const { status } = useContext(ProgressPulseContext);
  const [width, setWidth] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const container = containerRef?.current;
    if (container) {
      let newWidth: number;

      if (widthCache.has(status)) {
        newWidth = widthCache.get(status)!;
      } else {
        container.style.transition = "none";
        container.style.width = "auto";
        newWidth = container.offsetWidth;
        widthCache.set(status, newWidth);
      }

      container.style.width = "0px";
      container.style.transition = "width 0.5s ease";
      React.startTransition(() => {
        setWidth(newWidth);
      });
    }
  }, [status]);

  const { text, bgColor } = statusConfig[status];

  return (
    <div
      ref={containerRef}
      role="status"
      aria-live="polite"
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 text-white whitespace-nowrap overflow-hidden",
        bgColor,
        className
      )}
      style={{
        width: `${width}px`,
        transition: "width 0.5s ease",
      }}
    >
      <span
        className="inline-block"
        style={{
          transform: `translateX(${width === 0 ? "100%" : "0"})`,
          transition: "transform 0.5s ease-in-out",
        }}
      >
        {text}
      </span>
    </div>
  );
};
ProgressPulseContent.displayName = "ProgressPulseContent";

export { ProgressPulseRoot, ProgressPulseContent };
