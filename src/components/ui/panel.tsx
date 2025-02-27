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
  setPanelId?: (id: string) => void;
  setTitleId?: (id: string) => void;
  setDescriptionId?: (id: string) => void;
  open: boolean;
  present?: boolean;
  state: "open" | "closed";
  onOpenChange?: (newOpen: boolean) => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  animatedElementRef: React.RefObject<HTMLElement | null>;
  titleId?: string;
  panelId: string;
  descriptionId?: string;
  withOverlay?: boolean;
}>({
  triggerRef: { current: null },
  withOverlay: false,
  open: false,
  present: false,
  state: "closed",
  panelId: "",
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
    withOverlay?: boolean;
  }
>(
  (
    {
      open: controlledOpen,
      onOpenChange,
      defaultOpen = false,
      children,
      withOverlay = false,
    },
    forwardedRef
  ) => {
    const isControlled = controlledOpen !== undefined;
    const [internalOpen, setInternalOpen] = React.useState(defaultOpen);
    const isOpen = isControlled ? controlledOpen : internalOpen;

    const panelRef = React.useRef<HTMLDivElement>(null);
    const animatedElementRef = React.useRef<HTMLElement | null>(null);

    const [panelId, setPanelId] = React.useState<string>(React.useId());
    const [titleId, setTitleId] = React.useState<string | undefined>();
    const [descriptionId, setDescriptionId] = React.useState<
      string | undefined
    >();

    const triggerRef = React.useRef<HTMLButtonElement>(null);

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

    return (
      <PanelContext.Provider
        value={{
          setTitleId,
          setDescriptionId,
          setPanelId,
          panelId,
          open: isOpen,
          present: isPresent,
          state,
          onOpenChange: handleOpenChange,
          titleId,
          descriptionId,
          animatedElementRef,
          triggerRef,
          withOverlay,
        }}
      >
        <div aria-hidden ref={mergeRefs(panelRef, forwardedRef)}>
          {children}
        </div>
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

const PanelTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<typeof Button>
>(({ children, className, onClick, ...props }, ref) => {
  const { onOpenChange, triggerRef, panelId, state } =
    React.useContext(PanelContext);

  const handleClick = React.useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      onClick?.(event);
      onOpenChange?.(true);
    },
    [onClick, onOpenChange]
  );

  return (
    <Button
      data-state={state}
      ref={mergeRefs(ref, triggerRef)}
      onClick={handleClick}
      aria-expanded={state === "open"}
      aria-controls={panelId}
      className={className}
      {...props}
    >
      {children}
    </Button>
  );
});
PanelTrigger.displayName = "PanelTrigger";

const PanelPortal = ({ children }: { children: React.ReactNode }) => {
  return isWindowDefined() ? createPortal(children, document.body) : null;
};
PanelPortal.displayName = "PanelPortal";

const PanelContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ id, className, children, ...props }, forwardedRef) => {
  const {
    open,
    present,
    state,
    titleId,
    panelId,
    descriptionId,
    setPanelId,
    triggerRef,
    animatedElementRef,
    withOverlay,
    onOpenChange,
  } = React.useContext(PanelContext);

  const panelContentRef = React.useRef<HTMLDivElement>(null);

  const finalId = id || panelId;

  React.useEffect(() => {
    setPanelId?.(finalId);
  }, [finalId, setPanelId]);

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

  if (!present) return null;

  return (
    <PanelPortal>
      {withOverlay && <PanelOverlay />}
      <div
        id={finalId}
        data-state={state}
        ref={mergeRefs(panelContentRef, animatedElementRef, forwardedRef)}
        role="region"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className={cn(
          "fixed bg-white p-5 shadow-lg sm:rounded-xl z-1000",
          "data-[state=open]:animate-[panel-slide_250ms_ease-in_forwards]",
          "data-[state=closed]:animate-[panel-slide_125ms_ease-out_reverse_forwards]",
          "",
          className
        )}
        onKeyDown={handleKeyDown}
        tabIndex={-1}
        {...props}
      >
        {children}
      </div>
    </PanelPortal>
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
      className={cn("group/header p-2", className)}
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
      className={cn("group/body p-2", className)}
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
      className={cn("group/footer p-2", className)}
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
  <Button ref={ref} className={cn("", className)} {...props}>
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
    (event: React.MouseEvent<HTMLButtonElement>) => {
      onClick?.(event);
      onOpenChange?.(false);
    },
    [onClick, onOpenChange]
  );
  return (
    <Button
      ref={ref}
      onClick={handleClick}
      className={cn("", className)}
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
  PanelTrigger,
};
