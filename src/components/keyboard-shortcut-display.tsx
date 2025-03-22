"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import {
  getPlatform,
  ModifierKey,
  Platform,
} from "@/hooks/use-keyboard-shortcut";

// Define platform-specific symbols for modifier keys
const MODIFIER_SYMBOLS = {
  mac: {
    meta: "⌘", // Command
    ctrl: "⌃", // Control
    alt: "⌥", // Option
    shift: "⇧", // Shift
  },
  windows: {
    meta: "Win",
    ctrl: "Ctrl",
    alt: "Alt",
    shift: "Shift",
  },
  other: {
    meta: "Meta",
    ctrl: "Ctrl",
    alt: "Alt",
    shift: "Shift",
  },
};

// Special key symbols
const SPECIAL_KEY_SYMBOLS: Record<string, string> = {
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  enter: "↵",
  tab: "⇥",
  escape: "Esc",
  space: "Space",
  backspace: "⌫",
  delete: "⌦",
  home: "Home",
  end: "End",
  pageup: "PgUp",
  pagedown: "PgDn",
};

// Context for keyboard shortcut display
type KeyboardContextType = {
  platform: "mac" | "windows" | "other";
  setPlatform: (platform: "mac" | "windows" | "other") => void;
  adaptModifierToPlatform: boolean;
};

const KeyboardContext = React.createContext<KeyboardContextType>({
  platform: "windows",
  setPlatform: () => {},
  adaptModifierToPlatform: false,
});

// Hook to use keyboard context
const useKeyboardContext = () => {
  const context = React.useContext(KeyboardContext);
  if (!context) {
    throw new Error(
      "Keyboard components must be used within a KeyboardRoot component"
    );
  }
  return context;
};

// Function to map a key based on platform adaptation settings
function mapKeyForPlatform(
  keyName: string,
  platform: Platform,
  adaptToPlatform: boolean
): string {
  // If adaptation is disabled, return the original key
  if (!adaptToPlatform) {
    return keyName;
  }

  // On Mac with adaptation enabled
  if (platform === "mac") {
    // Map ctrl to meta (Command) on Mac
    if (keyName === "ctrl") {
      return "meta";
    }
  }
  // On Windows/Other with adaptation enabled
  else {
    // Map meta to ctrl on Windows/Other
    if (keyName === "meta") {
      return "ctrl";
    }
  }

  return keyName;
}

// Types
export interface ShortcutItem {
  shortcut: string;
  description?: string;
}

export interface ShortcutGroup {
  title?: string;
  shortcuts: ShortcutItem[];
}

// --------------------------------
// Component Implementation
// --------------------------------

// Root component
const KeyboardRoot = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    initialPlatform?: "mac" | "windows" | "other";
    adaptModifierToPlatform?: boolean;
  }
>(
  (
    {
      className,
      children,
      initialPlatform = "windows",
      adaptModifierToPlatform = false,
      ...props
    },
    ref
  ) => {
    const [platform, setPlatform] = React.useState<"mac" | "windows" | "other">(
      initialPlatform
    );

    // Detect OS on mount
    React.useEffect(() => {
      setPlatform(getPlatform());
    }, []);

    return (
      <KeyboardContext.Provider
        value={{ platform, setPlatform, adaptModifierToPlatform }}
      >
        <div
          ref={ref}
          className={cn(
            "p-4 rounded-lg border bg-black border-gray-200 shadow-sm",
            className
          )}
          {...props}
        >
          {children}
        </div>
      </KeyboardContext.Provider>
    );
  }
);
KeyboardRoot.displayName = "KeyboardRoot";

// Platform toggle component
const KeyboardPlatformToggle = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => {
  const { platform, setPlatform } = useKeyboardContext();

  const togglePlatform = () => {
    setPlatform(platform === "mac" ? "windows" : "mac");
  };

  return (
    <div
      ref={ref}
      className={cn("mb-4 flex justify-end", className)}
      {...props}
    >
      <button
        onClick={togglePlatform}
        className="text-sm bg-gray-100 hover:bg-gray-200 px-3 py-1 rounded-full text-gray-700 transition-colors"
      >
        Show {platform === "mac" ? "Windows" : "Mac"} shortcuts
      </button>
    </div>
  );
});
KeyboardPlatformToggle.displayName = "KeyboardPlatformToggle";

// Individual key component
const KeyboardKey = React.forwardRef<
  HTMLElement,
  React.HTMLAttributes<HTMLElement> & {
    keyName: string;
    isModifier?: boolean;
    adaptToPlatform?: boolean; // Override the context default
  }
>(
  (
    {
      keyName,
      isModifier = false,
      adaptToPlatform,
      className,
      children,
      ...props
    },
    ref
  ) => {
    const { platform, adaptModifierToPlatform: contextAdaptToPlatform } =
      useKeyboardContext();

    // Use provided adaptToPlatform if specified, otherwise use context value
    const shouldAdaptToPlatform =
      adaptToPlatform !== undefined ? adaptToPlatform : contextAdaptToPlatform;

    // Format the key name
    let displayName = keyName.toLowerCase();

    // If this is a modifier key, check if we need to adapt it to the platform
    if (isModifier) {
      // Apply platform-specific mapping if adaptation is enabled
      const mappedKey = mapKeyForPlatform(
        displayName,
        platform,
        shouldAdaptToPlatform
      );

      // Get the display symbol from MODIFIER_SYMBOLS
      if (mappedKey in MODIFIER_SYMBOLS[platform]) {
        displayName = MODIFIER_SYMBOLS[platform][mappedKey as ModifierKey];
      }
    }
    // Check if it's a special key
    else if (displayName in SPECIAL_KEY_SYMBOLS) {
      displayName = SPECIAL_KEY_SYMBOLS[displayName];
    }
    // Capitalize first letter for regular keys
    else if (displayName.length > 1) {
      displayName = displayName.charAt(0).toUpperCase() + displayName.slice(1);
    }

    return (
      <kbd
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center",
          isModifier ? "min-w-8" : "min-w-6",
          "px-2 py-0.5 text-sm font-medium rounded-md border",
          "bg-gray-50 border-gray-300 text-gray-700",
          "shadow-sm group-hover:bg-gray-100",
          "transition-all duration-200 relative overflow-hidden",
          isModifier ? "font-semibold" : "",
          className
        )}
        {...props}
      >
        {/* Shimmer effect overlay */}
        <span
          className="absolute inset-0 w-full h-full bg-gradient-to-r from-transparent via-white to-transparent opacity-0 group-hover:opacity-20 group-hover:animate-shimmer"
          style={{ backgroundSize: "200% 100%" }}
        />
        {children || displayName}
      </kbd>
    );
  }
);
KeyboardKey.displayName = "KeyboardKey";

// Keyboard separator (like +)
const KeyboardSeparator = React.forwardRef<
  HTMLSpanElement,
  React.HTMLAttributes<HTMLSpanElement>
>(({ className, children, ...props }, ref) => {
  return (
    <span ref={ref} className={cn("text-gray-400", className)} {...props}>
      {children || "+"}
    </span>
  );
});
KeyboardSeparator.displayName = "KeyboardSeparator";

// Shortcut component container
const KeyboardShortcut = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, children, ...props }, ref) => {
  return (
    <div
      ref={ref}
      className={cn("inline-flex items-center group", className)}
      {...props}
    >
      {children}
    </div>
  );
});
KeyboardShortcut.displayName = "KeyboardShortcut";

// Shortcut keys container
const KeyboardShortcutKeys = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, children, ...props }, ref) => {
  return (
    <div
      ref={ref}
      className={cn("flex items-center space-x-1", className)}
      {...props}
    >
      {children}
    </div>
  );
});
KeyboardShortcutKeys.displayName = "KeyboardShortcutKeys";

// Shortcut description
const KeyboardShortcutDescription = React.forwardRef<
  HTMLSpanElement,
  React.HTMLAttributes<HTMLSpanElement>
>(({ className, children, ...props }, ref) => {
  return (
    <span
      ref={ref}
      className={cn(
        "ml-3 text-sm text-gray-200 group-hover:text-white transition-colors duration-200",
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
});
KeyboardShortcutDescription.displayName = "KeyboardShortcutDescription";

// Group title component
const KeyboardGroupTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, children, ...props }, ref) => {
  return (
    <h3
      ref={ref}
      className={cn(
        "text-sm font-medium text-white uppercase tracking-wider mb-3",
        className
      )}
      {...props}
    >
      {children}
    </h3>
  );
});
KeyboardGroupTitle.displayName = "KeyboardGroupTitle";

// Group component
const KeyboardGroup = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, children, ...props }, ref) => {
  return (
    <div ref={ref} className={cn("space-y-2", className)} {...props}>
      {children}
    </div>
  );
});
KeyboardGroup.displayName = "KeyboardGroup";

// Group content
const KeyboardGroupContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, children, ...props }, ref) => {
  return (
    <div ref={ref} className={cn("space-y-3", className)} {...props}>
      {children}
    </div>
  );
});
KeyboardGroupContent.displayName = "KeyboardGroupContent";

// Helper to parse a shortcut string with platform adaptation
export function parseShortcutWithPlatform(
  shortcut: string,
  platform: "mac" | "windows" | "other",
  adaptToPlatform: boolean
): { modifiers: string[]; mainKey: string } {
  const parts = shortcut.split("+");
  const mainKey = parts[parts.length - 1];
  const modifiers = parts
    .slice(0, parts.length - 1)
    .map((mod) => mapKeyForPlatform(mod, platform, adaptToPlatform));
  return { modifiers, mainKey };
}

// Helper function to parse a shortcut string and render the individual keys
export function parseShortcut(shortcut: string): {
  modifiers: string[];
  mainKey: string;
} {
  const parts = shortcut.split("+");
  const mainKey = parts[parts.length - 1];
  const modifiers = parts.slice(0, parts.length - 1);
  return { modifiers, mainKey };
}

export {
  KeyboardRoot,
  KeyboardPlatformToggle,
  KeyboardKey,
  KeyboardSeparator,
  KeyboardShortcut,
  KeyboardShortcutKeys,
  KeyboardShortcutDescription,
  KeyboardGroup,
  KeyboardGroupTitle,
  KeyboardGroupContent,
};
