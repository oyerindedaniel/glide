"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { isWindowDefined } from "@/utils/app";
import { createPortal } from "react-dom";
import { mergeRefs } from "@/utils/react";
import { useAnimatePresence } from "@/hooks/use-animate-presence";
import { Button } from "./button";

// Selector for focusable elements
const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "textarea:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

const PanelContext = React.createContext<{
  setTitleId?: (id: string) => void;
  setDescriptionId?: (id: string) => void;
  open: boolean;
  present?: boolean;
  state: "open" | "closed";
  onOpenChange?: (newOpen: boolean) => void;
  triggerRef?: React.RefObject<HTMLElement>;
  animatedElementRef: React.RefObject<HTMLElement | null>;
  titleId?: string;
  descriptionId?: string;
}>({
  open: false,
  present: false,
  state: "closed",
  animatedElementRef: { current: null },
});

const PanelRoot = React.forwardRef<
  HTMLDivElement,
  {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    defaultOpen?: boolean;
    triggerRef?: React.RefObject<HTMLElement>;
    children: React.ReactNode;
  }
>(
  (
    {
      open: controlledOpen,
      onOpenChange,
      defaultOpen = false,
      triggerRef,
      children,
    },
    forwardedRef
  ) => {
    const isControlled = controlledOpen !== undefined;
    const [internalOpen, setInternalOpen] = React.useState(defaultOpen);
    const isOpen = isControlled ? controlledOpen : internalOpen;

    const panelRef = React.useRef<HTMLDivElement>(null);
    const animatedElementRef = React.useRef<HTMLElement | null>(null);

    const [titleId, setTitleId] = React.useState<string | undefined>();
    const [descriptionId, setDescriptionId] = React.useState<
      string | undefined
    >();

    const state = isOpen ? "open" : "closed";

    const handleOpenChange = (newOpen: boolean) => {
      if (isControlled) {
        onOpenChange?.(newOpen);
      } else {
        setInternalOpen(newOpen);
      }
    };

    const isPresent = useAnimatePresence(
      isOpen,
      async () => {
        const animatedElement = animatedElementRef.current;
        return new Promise((resolve) => {
          const handleAnimationEnd = async (e: AnimationEvent) => {
            e.stopPropagation();
            if (e.target === animatedElement) {
              resolve();
              animatedElement?.removeEventListener(
                "animationend",
                handleAnimationEnd
              );
            }
          };

          if (animatedElement) {
            animatedElement.addEventListener(
              "animationend",
              handleAnimationEnd
            );
          }
        });
      },
      { animateOnInitialLoad: false }
    );

    if (!isPresent) return null;

    return (
      <PanelContext.Provider
        value={{
          setTitleId,
          setDescriptionId,
          open: isOpen,
          present: isPresent,
          state,
          onOpenChange: handleOpenChange,
          titleId,
          descriptionId,
          animatedElementRef,
          triggerRef,
        }}
      >
        <PanelPortal>
          <div ref={mergeRefs(panelRef, forwardedRef)}>{children}</div>
        </PanelPortal>
      </PanelContext.Provider>
    );
  }
);
PanelRoot.displayName = "PanelRoot";

const PanelOverlay = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => {
  const { onOpenChange, state } = React.useContext(PanelContext);
  return (
    <div
      data-state={state}
      ref={ref}
      className={cn(
        "fixed inset-0 bg-black/50 z-50 data-[state=open]:fade-in data-[state=closed]:fade-out",
        className
      )}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onOpenChange?.(false);
        }
      }}
      {...props}
    />
  );
});
PanelOverlay.displayName = "PanelOverlay";

const PanelPortal = ({ children }: { children: React.ReactNode }) => {
  return isWindowDefined() ? createPortal(children, document.body) : null;
};
PanelPortal.displayName = "PanelPortal";

const PanelContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, children, ...props }, forwardedRef) => {
  const {
    open,
    present,
    state,
    titleId,
    descriptionId,
    triggerRef,
    animatedElementRef,
    onOpenChange,
  } = React.useContext(PanelContext);

  const panelContentRef = React.useRef<HTMLDivElement>(null);

  console.log(present);

  React.useEffect(() => {
    const trigger = triggerRef?.current;
    if (open && panelContentRef.current) {
      const focusableElements = Array.from(
        panelContentRef.current.querySelectorAll(focusableSelector)
      );

      if (focusableElements.length > 0) {
        // console.log(focusableElements);
        (focusableElements[0] as HTMLElement).focus();
      } else {
        panelContentRef.current.focus();
      }
    }

    return () => {
      if (!open && trigger) {
        trigger.focus();
      }
    };
  }, [open, triggerRef]);

  React.useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "Escape") {
        onOpenChange?.(false);
      } else if (event.key === "Tab" && panelContentRef.current) {
        const focusableElements = Array.from(
          panelContentRef.current.querySelectorAll(focusableSelector)
        );
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
    },
    [onOpenChange]
  );

  return (
    <div
      data-state={state}
      ref={mergeRefs(panelContentRef, animatedElementRef, forwardedRef)}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className={cn(
        "fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[100] bg-white p-6 shadow-lg sm:rounded-lg",
        "data-[state=open]:animate-panel-in",
        "data-[state=closed]:animate-panel-out",
        "duration-700",
        className
      )}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
      {...props}
    >
      {children}
    </div>
  );
});
PanelContent.displayName = "PanelContent";

const PanelHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => {
  const { state } = React.useContext(PanelContext);
  return (
    <div
      data-state={state}
      ref={ref}
      className={cn(
        "group/header flex items-center justify-between p-4 border-b",
        className
      )}
      {...props}
    />
  );
});
PanelHeader.displayName = "PanelHeader";

const PanelBody = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => {
  const { state } = React.useContext(PanelContext);
  return (
    <div
      data-state={state}
      ref={ref}
      className={cn("group/body p-4", className)}
      {...props}
    />
  );
});
PanelBody.displayName = "PanelBody";

const PanelFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => {
  const { state } = React.useContext(PanelContext);
  return (
    <div
      data-state={state}
      ref={ref}
      className={cn("group/footer p-4 border-t flex justify-end", className)}
      {...props}
    />
  );
});
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

const PanelAction = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<typeof Button>
>(({ children, className, ...props }, ref) => (
  <Button
    ref={ref}
    className={cn("px-4 py-2 bg-blue-500 text-white rounded-md", className)}
    {...props}
  >
    {children}
  </Button>
));
PanelAction.displayName = "PanelAction";

const PanelClose = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<typeof Button>
>(({ children, className, onClick, ...props }, ref) => {
  const { onOpenChange } = React.useContext(PanelContext);
  const handleClick = React.useCallback(
    (event: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
      if (onClick) {
        onClick(event);
      } else {
        onOpenChange?.(false);
      }
    },
    [onClick, onOpenChange]
  );
  return (
    <Button
      ref={ref}
      onClick={handleClick}
      className={cn("px-4 py-2 bg-gray-300 text-black rounded-md", className)}
      {...props}
    >
      {children}
    </Button>
  );
});
PanelClose.displayName = "PanelClose";

export {
  PanelRoot as Panel,
  PanelHeader,
  PanelBody,
  PanelFooter,
  PanelTitle,
  PanelDescription,
  PanelOverlay,
  PanelPortal,
  PanelContent,
  PanelAction,
  PanelClose,
};
