"use client";

import React, { useState } from "react";
import useKeyboardShortcut from "@/hooks/use-keyboard-shortcut";
import {
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
  parseShortcut,
} from "@/components/keyboard-shortcut-display";

const KeyboardShortcutExampleUsage: React.FC = () => {
  const [message, setMessage] = useState<string>("");
  const [showShortcuts, setShowShortcuts] = useState<boolean>(true);

  // Define shortcuts for examples
  const shortcuts = [
    { key: "ctrl+s", description: "Save document" },
    { key: "ctrl+z", description: "Undo last action" },
    { key: "alt+f", description: "Open file menu" },
    { key: "escape", description: "Cancel operation" },
  ];

  // Define grouped shortcuts
  const groups = [
    {
      title: "Document Operations",
      items: [
        { key: "ctrl+s", description: "Save document" },
        { key: "ctrl+p", description: "Print document" },
        { key: "ctrl+n", description: "New document" },
      ],
    },
    {
      title: "Editing",
      items: [
        { key: "ctrl+c", description: "Copy selection" },
        { key: "ctrl+v", description: "Paste from clipboard" },
        { key: "ctrl+x", description: "Cut selection" },
      ],
    },
    {
      title: "Navigation",
      items: [
        { key: "ctrl+f", description: "Find in document" },
        { key: "ctrl+home", description: "Go to beginning" },
        { key: "ctrl+end", description: "Go to end" },
      ],
    },
  ];

  // Register keyboard shortcuts
  useKeyboardShortcut(
    [
      {
        key: "t",
        modifiers: ["ctrl"],
        callback: (e) => {
          e.preventDefault();
          setMessage("Document saved successfully!");
          setTimeout(() => setMessage(""), 2000);
        },
        description: "Save document",
      },
      {
        key: "h",
        modifiers: ["ctrl", "shift"],
        callback: () => {
          setShowShortcuts((prev) => !prev);
          setMessage(
            showShortcuts
              ? "Keyboard shortcuts panel hidden"
              : "Keyboard shortcuts panel shown"
          );
          setTimeout(() => setMessage(""), 2000);
        },
        description: "Toggle shortcuts display",
      },
      {
        key: "r",
        modifiers: ["alt"],
        callback: () => {
          setMessage("Refreshing data...");
          setTimeout(() => setMessage("Data refreshed!"), 1000);
          setTimeout(() => setMessage(""), 3000);
        },
        description: "Refresh data",
      },
      {
        key: "Escape",
        modifiers: [],
        callback: () => {
          setMessage("Operation canceled");
          setTimeout(() => setMessage(""), 2000);
        },
        description: "Cancel operation",
      },
    ],
    {
      componentName: "KeyboardShortcutExample",
      adaptToPlatform: true,
    }
  );

  // Helper function to render a keyboard shortcut
  const renderShortcut = (shortcutKey: string, description?: string) => {
    const { modifiers, mainKey } = parseShortcut(shortcutKey);

    return (
      <KeyboardShortcut>
        <KeyboardShortcutKeys>
          {modifiers.map((mod, index) => (
            <React.Fragment key={index}>
              <KeyboardKey keyName={mod} isModifier />
              <KeyboardSeparator />
            </React.Fragment>
          ))}
          <KeyboardKey keyName={mainKey} />
        </KeyboardShortcutKeys>
        {description && (
          <KeyboardShortcutDescription>
            {description}
          </KeyboardShortcutDescription>
        )}
      </KeyboardShortcut>
    );
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">
        Keyboard Shortcut Display Examples
      </h1>

      {/* Status message */}
      {message && (
        <div className="mb-6 p-3 bg-blue-50 border border-blue-200 rounded-md text-blue-700 transition-all">
          {message}
        </div>
      )}

      <p className="mb-6 text-gray-600">
        This component demonstrates a truly composable pattern for keyboard
        shortcuts. Try pressing some of the shortcuts to see them in action!
      </p>

      <div className="flex mb-4 items-center">
        <button
          onClick={() => setShowShortcuts((prev) => !prev)}
          className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 transition-colors"
        >
          {showShortcuts ? "Hide" : "Show"} Keyboard Shortcuts
        </button>
        <span className="ml-3 text-sm text-gray-500">
          Or press {renderShortcut("ctrl+shift+h")}
        </span>
      </div>

      {showShortcuts && (
        <div className="space-y-8">
          {/* Example 1: Basic flat list of shortcuts */}
          <div>
            <h2 className="text-xl font-semibold mb-4">Basic Shortcuts</h2>
            <KeyboardRoot adaptModifierToPlatform>
              <KeyboardPlatformToggle />
              <KeyboardGroupContent>
                {shortcuts.map((shortcut, index) => (
                  <div key={index} className="flex items-center">
                    {renderShortcut(shortcut.key, shortcut.description)}
                  </div>
                ))}
              </KeyboardGroupContent>
            </KeyboardRoot>
          </div>

          {/* Example 2: Grouped shortcuts */}
          <div>
            <h2 className="text-xl font-semibold mb-4">Grouped Shortcuts</h2>
            <KeyboardRoot adaptModifierToPlatform className="border-indigo-100">
              <div className="space-y-6">
                {groups.map((group, groupIndex) => (
                  <KeyboardGroup key={groupIndex}>
                    <KeyboardGroupTitle>{group.title}</KeyboardGroupTitle>
                    <KeyboardGroupContent>
                      {group.items.map((shortcut, shortcutIndex) => (
                        <div key={shortcutIndex} className="flex items-center">
                          {renderShortcut(shortcut.key, shortcut.description)}
                        </div>
                      ))}
                    </KeyboardGroupContent>
                  </KeyboardGroup>
                ))}
              </div>
            </KeyboardRoot>
          </div>

          {/* Example 3: Individual components for custom layouts */}
          <div>
            <h2 className="text-xl font-semibold mb-4">Custom Layout</h2>
            <KeyboardRoot>
              <div className="space-y-6">
                <div>
                  <KeyboardGroupTitle>Individual Keys</KeyboardGroupTitle>
                  <div className="flex space-x-2 mb-4">
                    <KeyboardKey keyName="ctrl" isModifier />
                    <KeyboardKey keyName="alt" isModifier />
                    <KeyboardKey keyName="shift" isModifier />
                    <KeyboardKey keyName="delete" />
                    <KeyboardKey keyName="arrowup" />
                  </div>
                </div>

                <div>
                  <KeyboardGroupTitle>
                    Custom Shortcut Combinations
                  </KeyboardGroupTitle>
                  <div className="grid grid-cols-2 gap-4">
                    {renderShortcut("ctrl+s", "Save document")}
                    {renderShortcut("alt+r", "Refresh data")}
                    {renderShortcut("ctrl+shift+h", "Toggle shortcuts panel")}
                    {renderShortcut("escape", "Cancel operation")}
                  </div>
                </div>
              </div>
            </KeyboardRoot>
          </div>

          {/* Example 4: High composability - omitting descriptions */}
          <div>
            <h2 className="text-xl font-semibold mb-4">Without Descriptions</h2>
            <KeyboardRoot className="border-emerald-100">
              <KeyboardGroupTitle>Keys Only</KeyboardGroupTitle>
              <div className="flex flex-wrap gap-3">
                {shortcuts.map((shortcut, index) => {
                  const { modifiers, mainKey } = parseShortcut(shortcut.key);
                  return (
                    <KeyboardShortcut key={index}>
                      <KeyboardShortcutKeys>
                        {modifiers.map((mod, modIndex) => (
                          <React.Fragment key={modIndex}>
                            <KeyboardKey keyName={mod} isModifier />
                            <KeyboardSeparator />
                          </React.Fragment>
                        ))}
                        <KeyboardKey keyName={mainKey} />
                      </KeyboardShortcutKeys>
                    </KeyboardShortcut>
                  );
                })}
              </div>
            </KeyboardRoot>
          </div>
        </div>
      )}

      <div className="mt-8 text-sm text-gray-500">
        <p>
          Note: The component automatically adapts to your operating system,
          showing the appropriate key symbols for Mac or Windows/Linux.
        </p>
      </div>
    </div>
  );
};

export default KeyboardShortcutExampleUsage;
