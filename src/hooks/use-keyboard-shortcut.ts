import { useEffect, useRef } from "react";
import logger from "@/utils/logger";
import { generateRandomId, isWindowDefined } from "@/utils/app";

/**
 * A React hook for registering and handling keyboard shortcuts.
 *
 * Features:
 * - Cross-platform support with automatic adaptation between Windows/Mac
 * - Per-shortcut conflict detection and warning
 * - System shortcut detection to avoid browser/OS conflicts
 * - Support for custom DOM elements as event targets
 * - Conflict resolution with customizable strategy
 *
 * Usage notes:
 * - The target element must be able to receive focus for shortcuts to work
 * - If using a custom element, ensure it has tabIndex set (e.g., tabIndex={0})
 * - When a shortcut uses Ctrl on Windows, it will adapt to use Command on Mac
 *
 * @example
 * // Basic usage
 * useKeyboardShortcut([
 *   {
 *     key: "s",
 *     modifiers: ["ctrl"],  // Will use Command on Mac automatically
 *     callback: () => saveDocument(),
 *     description: "Save document"
 *   }
 * ]);
 *
 * // With custom target element
 * const editorRef = useRef(null);
 * useKeyboardShortcut(
 *   [{ key: "b", modifiers: ["ctrl"], callback: () => formatBold() }],
 *   { target: editorRef.current }
 * );
 *
 * // With conflict resolution
 * useKeyboardShortcut(
 *   [{ key: "s", modifiers: ["ctrl"], callback: () => saveDocument() }],
 *   {
 *     conflictStrategy: "block",  // Will prevent registration if conflict exists
 *     // Or use a custom resolver
 *     conflictResolver: (existing, current) => {
 *       // Custom logic to decide which shortcut should win
 *       return current; // Return the shortcut that should be used
 *     }
 *   }
 * );
 */

// Modifier keys
export type ModifierKey = "ctrl" | "alt" | "shift" | "meta";

export type Platform = "mac" | "windows" | "other";

// Common system shortcuts that should be avoided
export type CommonSystemShortcut =
  // Windows/General shortcuts
  | "ctrl+a"
  | "ctrl+c"
  | "ctrl+v"
  | "ctrl+x"
  | "ctrl+z"
  | "ctrl+y" // Selection, clipboard, undo/redo
  | "ctrl+s"
  | "ctrl+o"
  | "ctrl+p"
  | "ctrl+w"
  | "ctrl+n"
  | "ctrl+t" // Save, open, print, close, new
  | "ctrl+f"
  | "ctrl+h"
  | "ctrl+g"
  | "ctrl+r"
  | "ctrl+l"
  | "alt+tab" // Find, replace, refresh, address bar
  | "alt+f4"
  | "f5"
  | "f11" // Close, refresh, fullscreen
  // Mac shortcuts
  | "meta+a"
  | "meta+c"
  | "meta+v"
  | "meta+x"
  | "meta+z"
  | "meta+y" // Selection, clipboard, undo/redo
  | "meta+s"
  | "meta+o"
  | "meta+p"
  | "meta+w"
  | "meta+n"
  | "meta+t" // Save, open, print, close, new
  | "meta+f"
  | "meta+h"
  | "meta+g"
  | "meta+r"
  | "meta+l"; // Find, replace, refresh, address bar

// Strategy for handling shortcut conflicts
export type ConflictStrategy =
  | "block" // Block registration of conflicting shortcuts (throw error)
  | "warn" // Allow with warning (default)
  | "override" // Silently override existing shortcuts
  | "custom"; // Use custom resolver function

// Define valid keyboard keys for better type checking
export type StandardKey =
  | "a"
  | "b"
  | "c"
  | "d"
  | "e"
  | "f"
  | "g"
  | "h"
  | "i"
  | "j"
  | "k"
  | "l"
  | "m"
  | "n"
  | "o"
  | "p"
  | "q"
  | "r"
  | "s"
  | "t"
  | "u"
  | "v"
  | "w"
  | "x"
  | "y"
  | "z"
  | "0"
  | "1"
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "f1"
  | "f2"
  | "f3"
  | "f4"
  | "f5"
  | "f6"
  | "f7"
  | "f8"
  | "f9"
  | "f10"
  | "f11"
  | "f12"
  | "escape"
  | "enter"
  | "tab"
  | "space"
  | "backspace"
  | "delete"
  | "arrowup"
  | "arrowdown"
  | "arrowleft"
  | "arrowright"
  | "home"
  | "end"
  | "pageup"
  | "pagedown"
  | "/"
  | "."
  | ","
  | ";"
  | "'"
  | "["
  | "]"
  | "\\"
  | "`"
  | "-"
  | "="
  | " ";

// Base type - a key without modifiers
export type BaseKey<K extends string> = Exclude<K, ModifierKey>;

// Keyboard shortcut configuration
export interface KeyboardShortcutConfig<T extends string = string> {
  /**
   * The main key for the shortcut.
   * Should not be a modifier key (ctrl, alt, shift, meta).
   */
  key: Exclude<T, ModifierKey>;

  /**
   * Optional modifier keys for the shortcut (ctrl, alt, shift, meta).
   * Will be automatically adapted to the platform based on settings.
   */
  modifiers?: ModifierKey[];

  /**
   * Callback function to execute when the shortcut is triggered.
   */
  callback: (event: KeyboardEvent) => void;

  /**
   * Optional description of what the shortcut does.
   * Useful for documentation and debugging.
   */
  description?: string;

  /**
   * Whether to check for conflicts with shortcuts from other components.
   * Defaults to the value set in hook options.
   */
  enableGlobalConflictCheck?: boolean;

  /**
   * Whether to automatically adapt modifiers for the platform.
   * For example, Ctrl on Windows becomes Command on Mac.
   */
  adaptToPlatform?: boolean;

  /**
   * Strategy for handling conflicts with existing shortcuts.
   * Defaults to the value set in hook options.
   */
  conflictStrategy?: ConflictStrategy;
}

// This extended type is used internally by the hook to add metadata
interface ShortcutWithMetadata<T extends string = string>
  extends KeyboardShortcutConfig<T> {
  /**
   * @internal Component name for debugging and conflict resolution
   */
  _componentName: string;

  /**
   * @internal Unique identifier for the component instance
   */
  _instanceId: string;

  /**
   * Original format of the shortcut as passed to the hook
   */
  originalFormat: string;
}

// Extended shortcut info stored in the registry
interface RegisteredShortcut<T extends string = string> {
  shortcut: ShortcutWithMetadata<T>;
  componentName: string;
  instanceId: string;
  registeredAt: Date;
}

// Global registry to track shortcuts across components
type GlobalShortcutRegistry = Map<string, RegisteredShortcut>;

// Singleton for global shortcut tracking
const globalShortcutRegistry: GlobalShortcutRegistry = new Map();

export const getGlobalShortcuts = (): GlobalShortcutRegistry => {
  return globalShortcutRegistry;
};

export const clearGlobalShortcuts = (): void => {
  globalShortcutRegistry.clear();
};

// Custom resolver type for conflict resolution
export type ConflictResolver<T extends string = string> = (
  existing: RegisteredShortcut<T>,
  current: KeyboardShortcutConfig<T>
) => KeyboardShortcutConfig<T> | null;

// Get the OS platform
export function getPlatform(): Platform {
  if (typeof navigator === "undefined") return "other";

  const userAgent = navigator.userAgent.toLowerCase();

  if (userAgent.includes("mac")) return "mac";
  if (userAgent.includes("win")) return "windows";
  return "other";
}

// Map a modifier key based on platform to ensure cross-platform compatibility
function mapModifierForPlatform(
  modifier: ModifierKey,
  platform: Platform
): ModifierKey[] {
  if (platform === "mac") {
    // On Mac, Cmd is commonly used where Ctrl would be on Windows
    if (modifier === "ctrl") return ["meta"]; // Allow Cmd
    if (modifier === "meta") return ["meta"]; // Keep meta as-is
  } else {
    // On Windows/Linux, Ctrl is used where Mac would use Cmd
    if (modifier === "meta") return ["ctrl"]; // Map Cmd to Ctrl
    if (modifier === "ctrl") return ["ctrl"]; // Keep ctrl as-is
  }

  // For other modifiers (alt, shift), keep them the same on all platforms
  return [modifier];
}

// Format shortcut for display and checking, with platform awareness
function formatShortcut(
  config: KeyboardShortcutConfig,
  platform: Platform = "other"
): string[] {
  const modifiers = config.modifiers || [];

  // If no platform adaptation needed, just return a single format
  if (!config.adaptToPlatform) {
    const sortedModifiers = [...modifiers].sort();
    return [[...sortedModifiers, config.key].join("+").toLowerCase()];
  }

  // For platform adaptation, generate all possible combinations
  const platformAdaptedModifiers: ModifierKey[][] = [];

  // For each modifier, get its platform-specific mappings
  modifiers.forEach((modifier) => {
    platformAdaptedModifiers.push(mapModifierForPlatform(modifier, platform));
  });

  // Generate all possible combinations of mapped modifiers
  if (platformAdaptedModifiers.length === 0) {
    return [config.key.toLowerCase()];
  }

  // Generate cartesian product of modifier combinations
  const allCombinations: string[] = [];

  // Start with first set of mapped modifiers
  let combinations = platformAdaptedModifiers[0].map((m) => [m]);

  // Add each additional set of modifiers
  for (let i = 1; i < platformAdaptedModifiers.length; i++) {
    const newCombinations: ModifierKey[][] = [];

    // For each existing combination
    combinations.forEach((combo) => {
      // Add each new modifier mapping
      platformAdaptedModifiers[i].forEach((newMod) => {
        newCombinations.push([...combo, newMod]);
      });
    });

    combinations = newCombinations;
  }

  // Format each combination as a string shortcut
  combinations.forEach((combo) => {
    const sortedModifiers = [...combo].sort();
    allCombinations.push(
      [...sortedModifiers, config.key].join("+").toLowerCase()
    );
  });
  return allCombinations;
}

// Format a shortcut key combination for display in debug messages
function formatShortcutForDisplay(shortcut: string): string {
  return shortcut
    .split("+")
    .map((part) => {
      if (part === "meta") return "Cmd/Meta";
      if (part === "ctrl") return "Ctrl";
      if (part === "alt") return "Alt";
      if (part === "shift") return "Shift";
      return part.charAt(0).toUpperCase() + part.slice(1); // Capitalize other keys
    })
    .join("+");
}

// Check if element is focusable
function isFocusable(element: HTMLElement): boolean {
  // Elements that are naturally focusable
  const focusableTags = ["a", "button", "input", "textarea", "select"];

  // Check if element has one of the naturally focusable tags
  if (focusableTags.includes(element.tagName.toLowerCase())) return true;

  // Check if element has tabIndex set
  return element.tabIndex >= 0;
}

function isCommonSystemShortcut(
  shortcut: string
): shortcut is CommonSystemShortcut {
  const commonShortcuts: CommonSystemShortcut[] = [
    // Windows/General shortcuts
    "ctrl+a",
    "ctrl+c",
    "ctrl+v",
    "ctrl+x",
    "ctrl+z",
    "ctrl+y",
    "ctrl+s",
    "ctrl+o",
    "ctrl+p",
    "ctrl+w",
    "ctrl+n",
    "ctrl+t",
    "ctrl+f",
    "ctrl+h",
    "ctrl+g",
    "ctrl+r",
    "ctrl+l",
    "alt+tab",
    "alt+f4",
    "f5",
    "f11",
    // Mac shortcuts
    "meta+a",
    "meta+c",
    "meta+v",
    "meta+x",
    "meta+z",
    "meta+y",
    "meta+s",
    "meta+o",
    "meta+p",
    "meta+w",
    "meta+n",
    "meta+t",
    "meta+f",
    "meta+h",
    "meta+g",
    "meta+r",
    "meta+l",
  ];

  return commonShortcuts.includes(shortcut as CommonSystemShortcut);
}

// Handle conflict detection and resolution
function handleShortcutConflict<T extends string>(
  formattedShortcut: string,
  shortcut: ShortcutWithMetadata<T>,
  existingRegistration: RegisteredShortcut,
  strategy: ConflictStrategy,
  resolver?: ConflictResolver<T>
): boolean {
  // No conflict - registration is allowed
  if (!existingRegistration) return true;

  // Skip if it's the exact same component instance (re-registration)
  if (existingRegistration.instanceId === shortcut._instanceId) {
    return true;
  }

  const existingComponentText = `${existingRegistration.componentName}${
    existingRegistration.instanceId
      ? ` (instance: ${existingRegistration.instanceId})`
      : ""
  }`;

  const currentComponentText = `${shortcut._componentName}${
    shortcut._instanceId ? ` (instance: ${shortcut._instanceId})` : ""
  }`;

  const conflictMessage =
    `Keyboard shortcut conflict: ${formatShortcutForDisplay(
      formattedShortcut
    )}\n` +
    `- Already registered by: ${existingComponentText}\n` +
    `- Being registered by: ${currentComponentText}\n` +
    `- Registered at: ${existingRegistration.registeredAt.toLocaleTimeString()}\n` +
    `- ${
      shortcut.description
        ? `Purpose: ${shortcut.description}`
        : "No description provided"
    }`;

  // Apply conflict strategy
  switch (strategy) {
    case "block":
      logger.error(
        conflictMessage +
          "\nRegistration blocked due to conflict strategy: 'block'"
      );
      throw new Error(
        `Shortcut conflict: ${formattedShortcut} - Registration blocked`
      );

    case "warn":
      logger.warn(
        conflictMessage +
          "\nAllowing registration with warning (strategy: 'warn')"
      );
      return true;

    case "override":
      // Silently override
      return true;

    case "custom":
      if (!resolver) {
        logger.error(
          "Conflict strategy set to 'custom' but no resolver function provided"
        );
        throw new Error(
          "Conflict resolution failed: No resolver function provided"
        );
      }

      // Use custom resolver
      const resolution = resolver(
        existingRegistration as unknown as RegisteredShortcut<T>,
        shortcut
      );
      if (!resolution) {
        // Resolver decided to block
        logger.log(
          conflictMessage + "\nRegistration blocked by custom resolver"
        );
        return false;
      } else if (resolution === shortcut) {
        // Resolver chose current shortcut - override existing
        logger.log(
          conflictMessage +
            "\nCustom resolver chose to override existing shortcut"
        );
        return true;
      } else {
        // Resolver chose existing shortcut - block current
        logger.log(
          conflictMessage + "\nCustom resolver chose to keep existing shortcut"
        );
        return false;
      }

    default:
      logger.warn(
        `Unknown conflict strategy: ${strategy}. Falling back to 'warn'`
      );
      logger.warn(conflictMessage);
      return true;
  }
}

/**
 * Hook for registering and handling keyboard shortcuts
 *
 * @template T - String literal type to constrain key values
 * @param shortcuts - Array of keyboard shortcut configurations
 * @param options - Additional options for the hook behavior
 * @returns Object with active shortcuts and a method to deactivate all shortcuts
 */
export default function useKeyboardShortcut<T extends string = string>(
  shortcuts: KeyboardShortcutConfig<T>[],
  options: {
    target?: HTMLElement | Window | null;
    eventType?: "keydown" | "keyup" | "keypress";
    allowRepeatedKeys?: boolean;
    warnOnCommonShortcuts?: boolean;
    componentName?: string;
    separator?: string;
    enableGlobalConflictCheck?: boolean;
    adaptToPlatform?: boolean;
    fallbackToWindow?: boolean;
    conflictStrategy?: ConflictStrategy;
    conflictResolver?: ConflictResolver<T>;
  } = {}
) {
  const {
    target = isWindowDefined() ? window : null,
    eventType = "keydown",
    allowRepeatedKeys = false,
    warnOnCommonShortcuts = true,
    componentName,
    enableGlobalConflictCheck = true,
    adaptToPlatform = false,
    fallbackToWindow = false,
    conflictStrategy = "warn",
    conflictResolver = undefined,
  } = options;

  // Generate a unique ID for this component instance if not provided
  const instanceIdRef = useRef(generateRandomId());

  // Create a ref for component name for debugging
  const componentNameRef = useRef(componentName || "UnnamedComponent");

  // Try to detect component name from call stack if not provided
  useEffect(() => {
    if (!componentName) {
      try {
        const stackTrace = new Error().stack || "";
        const callSiteMatch = stackTrace.match(/at ([A-Z][a-zA-Z0-9_]+) \(/);
        if (callSiteMatch && callSiteMatch[1]) {
          const detectedName = callSiteMatch[1];
          // Only use detected name if it looks like a component name (starts with capital letter)
          if (
            /^[A-Z]/.test(detectedName) &&
            detectedName !== "useKeyboardShortcut"
          ) {
            componentNameRef.current = detectedName;
          }
        }
      } catch {
        // Silently fail if we can't detect the component name
      }
    }
  }, [componentName]);

  // Ref to track pressed keys
  const pressedKeys = useRef<Set<string>>(new Set());

  // Ref to keep track of registered shortcuts
  const registeredShortcuts = useRef<Map<string, ShortcutWithMetadata<T>>>(
    new Map()
  );

  // Ref to track our registered global shortcuts for cleanup
  const ourGlobalShortcuts = useRef<Set<string>>(new Set());

  // Check for duplicate shortcuts and system conflicts
  useEffect(() => {
    const shortcutMap = new Map<string, ShortcutWithMetadata<T>>();
    const currentGlobalShortcutsRef = ourGlobalShortcuts.current;
    const platform = getPlatform();

    // Check if custom target is focusable
    if (target && target !== window && !isFocusable(target as HTMLElement)) {
      logger.warn(
        `Target element in ${componentNameRef.current} might not receive keyboard events because it cannot be focused. ` +
          `Consider adding tabIndex={0} to the element to make it focusable.`
      );
    }

    shortcuts.forEach((shortcut) => {
      const modifiers = shortcut.modifiers || [];

      const originalModifiers = shortcut.modifiers || [];
      const originalFormat = [...originalModifiers, shortcut.key]
        .join("+")
        .toLowerCase();

      const shortcutWithMetadata: ShortcutWithMetadata<T> = {
        ...shortcut,
        modifiers,
        _componentName: componentNameRef.current,
        _instanceId: instanceIdRef.current,
        originalFormat,
        enableGlobalConflictCheck:
          shortcut.enableGlobalConflictCheck !== undefined
            ? shortcut.enableGlobalConflictCheck
            : enableGlobalConflictCheck,
        adaptToPlatform:
          shortcut.adaptToPlatform !== undefined
            ? shortcut.adaptToPlatform
            : adaptToPlatform,
        conflictStrategy:
          shortcut.conflictStrategy !== undefined
            ? shortcut.conflictStrategy
            : conflictStrategy,
      };

      // Validate the key is not a modifier key
      if (modifiers.includes(shortcutWithMetadata.key as ModifierKey)) {
        logger.error(
          `Invalid keyboard shortcut: "${shortcutWithMetadata.key}" cannot be both a modifier and a key.`
        );
        throw new Error(
          `Invalid keyboard shortcut: "${shortcutWithMetadata.key}" cannot be both a modifier and a key.`
        );
      }

      // Get all possible shortcut combinations for this platform
      const formattedShortcuts = formatShortcut(shortcutWithMetadata, platform);

      formattedShortcuts.forEach((formattedShortcut) => {
        // Check if this shortcut was already registered in this component
        if (shortcutMap.has(formattedShortcut)) {
          logger.error(
            `Duplicate keyboard shortcut detected: ${formatShortcutForDisplay(
              formattedShortcut
            )}. ` +
              `Description: ${
                shortcutWithMetadata.description || "No description"
              } ` +
              `in component ${shortcutWithMetadata._componentName}`
          );
          throw new Error(
            `Duplicate keyboard shortcut detected: ${formattedShortcut}`
          );
        }

        // Check for global conflicts across components, only if this shortcut has it enabled
        if (
          shortcutWithMetadata.enableGlobalConflictCheck &&
          globalShortcutRegistry.has(formattedShortcut)
        ) {
          const existing = globalShortcutRegistry.get(formattedShortcut)!;

          // Handle conflict using the specified strategy
          const allowed = handleShortcutConflict(
            formattedShortcut,
            shortcutWithMetadata,
            existing,
            shortcutWithMetadata.conflictStrategy as ConflictStrategy,
            conflictResolver
          );

          if (!allowed) {
            // Skip registration based on conflict resolution
            return;
          }
        }

        // Check if this is a common system shortcut
        if (
          warnOnCommonShortcuts &&
          isCommonSystemShortcut(formattedShortcut)
        ) {
          logger.warn(
            `Common system shortcut detected: ${formatShortcutForDisplay(
              formattedShortcut
            )}. ` +
              `This may conflict with browser or OS behavior. ` +
              `Description: ${
                shortcutWithMetadata.description || "No description"
              } ` +
              `in component ${shortcutWithMetadata._componentName}`
          );
        }

        // Store the original shortcut config for all variations
        shortcutMap.set(formattedShortcut, shortcutWithMetadata);

        // Register globally for cross-component conflict detection, only if enabled for this shortcut
        if (shortcutWithMetadata.enableGlobalConflictCheck) {
          globalShortcutRegistry.set(formattedShortcut, {
            shortcut: shortcutWithMetadata,
            componentName: shortcutWithMetadata._componentName,
            instanceId: shortcutWithMetadata._instanceId,
            registeredAt: new Date(),
          });

          // Keep track of our own global registrations for cleanup
          currentGlobalShortcutsRef.add(formattedShortcut);
        }
      });
    });

    registeredShortcuts.current = shortcutMap;

    return () => {
      if (enableGlobalConflictCheck) {
        // Clean up our global registrations when component unmounts
        currentGlobalShortcutsRef.forEach((shortcut) => {
          globalShortcutRegistry.delete(shortcut);
        });
        currentGlobalShortcutsRef.clear();
      }
    };
  }, [
    shortcuts,
    warnOnCommonShortcuts,
    componentName,
    enableGlobalConflictCheck,
    adaptToPlatform,
    target,
    fallbackToWindow,
    conflictStrategy,
    conflictResolver,
  ]);

  // Handle keyboard events
  useEffect(() => {
    if (!target) return;
    const currentPressedKeysRef = pressedKeys.current;

    const handleKeyEvent = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (event.repeat && !allowRepeatedKeys) return;

      if (eventType === "keydown") currentPressedKeysRef.add(key);
      else if (eventType === "keyup") currentPressedKeysRef.delete(key);

      // Don't trigger if the pressed key is a modifier key
      if (["control", "alt", "shift", "meta"].includes(key)) return;

      const modifiers: ModifierKey[] = [];
      if (event.ctrlKey) modifiers.push("ctrl");
      if (event.altKey) modifiers.push("alt");
      if (event.shiftKey) modifiers.push("shift");
      if (event.metaKey) modifiers.push("meta");

      const sortedModifiers = [...modifiers].sort();
      const shortcut = [...sortedModifiers, key].join("+");

      for (const [
        shortcutKey,
        config,
      ] of registeredShortcuts.current.entries()) {
        if (shortcutKey === shortcut) {
          event.preventDefault();
          config.callback(event);
          break;
        }
      }
    };

    // Setup fallback event listener on window if enabled and target isn't the window itself
    const shouldUseFallback = fallbackToWindow && target !== window;
    let fallbackListener: ((e: Event) => void) | null = null;

    if (shouldUseFallback) {
      fallbackListener = (event: Event) => {
        // Only trigger fallback when target doesn't have focus
        if (
          document.activeElement !== target &&
          !(target as HTMLElement).contains(document.activeElement)
        ) {
          handleKeyEvent(event as KeyboardEvent);
        }
      };
      window.addEventListener(eventType, fallbackListener as EventListener);
    }

    target.addEventListener(eventType, handleKeyEvent as EventListener);

    return () => {
      target.removeEventListener(eventType, handleKeyEvent as EventListener);

      if (shouldUseFallback && fallbackListener) {
        window.removeEventListener(
          eventType,
          fallbackListener as EventListener
        );
      }

      currentPressedKeysRef.clear();
    };
  }, [target, eventType, allowRepeatedKeys, fallbackToWindow]);

  return {
    activeShortcuts: Array.from(registeredShortcuts.current.keys()),
    deactivate: () => {
      registeredShortcuts.current.clear();

      // Clear global registrations
      ourGlobalShortcuts.current.forEach((shortcut) => {
        globalShortcutRegistry.delete(shortcut);
      });
      ourGlobalShortcuts.current.clear();
    },
  };
}
