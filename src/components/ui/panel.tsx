"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { isWindowDefined } from "@/utils/app";
import { createPortal } from "react-dom";
import { mergeRefs } from "@/utils/react";

const PanelContext = React.createContext<{
  setTitleId?: (id: string) => void;
  setDescriptionId?: (id: string) => void;
}>({});

// Selector for focusable elements
const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "textarea:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

const PanelRoot = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => {
  const [titleId, setTitleId] = React.useState<string | undefined>();
  return (
    <PanelContext.Provider value={{ setTitleId, setDescriptionId: () => {} }}>
      <div
        ref={ref}
        role="region"
        aria-labelledby={titleId}
        className={cn(
          "relative w-full max-w-3xl bg-background p-6 shadow-lg sm:rounded-lg",
          className
        )}
        {...props}
      />
    </PanelContext.Provider>
  );
});
PanelRoot.displayName = "PanelRoot";

const PanelHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex items-center justify-between p-4 border-b", className)}
    {...props}
  />
));
PanelHeader.displayName = "PanelHeader";

const PanelBody = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-4", className)} {...props} />
));
PanelBody.displayName = "PanelBody";

const PanelFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("p-4 border-t flex justify-end", className)}
    {...props}
  />
));
PanelFooter.displayName = "PanelFooter";

const PanelTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement> & { id?: string }
>(({ className, id, ...props }, ref) => {
  const generatedId = React.useId();
  const finalId = id || generatedId;
  const { setTitleId } = React.useContext(PanelContext);
  React.useEffect(() => {
    setTitleId?.(finalId);
  }, [finalId, setTitleId]);
  return (
    <h2
      ref={ref}
      id={finalId}
      className={cn("text-lg font-semibold", className)}
      {...props}
    />
  );
});
PanelTitle.displayName = "PanelTitle";

const PanelDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement> & { id?: string }
>(({ className, id, ...props }, ref) => {
  const generatedId = React.useId();
  const finalId = id || generatedId;
  const { setDescriptionId } = React.useContext(PanelContext);
  React.useEffect(() => {
    setDescriptionId?.(finalId);
  }, [finalId, setDescriptionId]);
  return (
    <p
      ref={ref}
      id={finalId}
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
});
PanelDescription.displayName = "PanelDescription";

const PanelOverlay = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { onClose?: () => void }
>(({ className, onClose, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("fixed inset-0 bg-black/50 z-50", className)}
    onClick={(event) => {
      if (event.target === event.currentTarget) {
        onClose?.();
      }
    }}
    {...props}
  />
));
PanelOverlay.displayName = "PanelOverlay";

const PanelPortal = ({ children }: { children: React.ReactNode }) => {
  return isWindowDefined() ? createPortal(children, document.body) : null;
};
PanelPortal.displayName = "PanelPortal";

const PanelContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    onClose?: () => void;
    triggerRef?: React.RefObject<HTMLElement>;
  }
>(({ className, children, onClose, triggerRef, ...props }, forwardedRef) => {
  const [titleId, setTitleId] = React.useState<string | undefined>();
  const [descriptionId, setDescriptionId] = React.useState<
    string | undefined
  >();
  const panelRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const trigger = triggerRef?.current;

    if (panelRef.current) {
      const focusableElements =
        panelRef.current.querySelectorAll(focusableSelector);
      if (focusableElements.length > 0) {
        (focusableElements[0] as HTMLElement).focus();
      } else {
        panelRef.current.focus();
      }
    }

    return () => {
      if (trigger) {
        trigger.focus();
      }
    };
  }, [triggerRef]);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      onClose?.();
    } else if (event.key === "Tab") {
      if (panelRef.current) {
        const focusableElements =
          panelRef.current.querySelectorAll(focusableSelector);
        if (focusableElements.length === 0) return;
        const firstFocusable = focusableElements[0] as HTMLElement;
        const lastFocusable = focusableElements[
          focusableElements.length - 1
        ] as HTMLElement;
        if (event.shiftKey) {
          if (document.activeElement === firstFocusable) {
            lastFocusable.focus();
            event.preventDefault();
          }
        } else {
          if (document.activeElement === lastFocusable) {
            firstFocusable.focus();
            event.preventDefault();
          }
        }
      }
    }
  };

  return (
    <PanelPortal>
      <PanelOverlay onClose={onClose} />
      <PanelContext.Provider value={{ setTitleId, setDescriptionId }}>
        <div
          ref={mergeRefs(panelRef, forwardedRef)}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          className={cn(
            "fixed left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50 bg-white p-6 shadow-lg sm:rounded-lg",
            className
          )}
          onKeyDown={handleKeyDown}
          tabIndex={-1}
          {...props}
        >
          {children}
        </div>
      </PanelContext.Provider>
    </PanelPortal>
  );
});
PanelContent.displayName = "PanelContent";

const PanelAction = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ className, ...props }, ref) => (
  <button
    ref={ref}
    className={cn("px-4 py-2 bg-blue-500 text-white rounded-md", className)}
    {...props}
  />
));
PanelAction.displayName = "PanelAction";

const PanelCancel = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ className, ...props }, ref) => (
  <button
    ref={ref}
    className={cn("px-4 py-2 bg-gray-300 text-black rounded-md", className)}
    {...props}
  />
));
PanelCancel.displayName = "PanelCancel";

export {
  PanelRoot,
  PanelHeader,
  PanelBody,
  PanelFooter,
  PanelTitle,
  PanelDescription,
  PanelOverlay,
  PanelPortal,
  PanelContent,
  PanelAction,
  PanelCancel,
};
