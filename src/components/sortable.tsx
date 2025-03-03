"use client";

import * as React from "react";
import {
  DndContext,
  CollisionDetection,
  SensorDescriptor,
  SensorOptions,
  DragStartEvent,
  DragEndEvent,
  DragCancelEvent,
  DragOverEvent,
  closestCenter,
  DragOverlay,
  useDndContext,
} from "@dnd-kit/core";
import {
  SortableContext,
  SortingStrategy,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { Modifier } from "@dnd-kit/core";
import { Button } from "./ui/button";
import { SyntheticListenerMap } from "@dnd-kit/core/dist/hooks/utilities";

interface SortableContextValue<T> {
  items: T[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SortableContextCtx = React.createContext<SortableContextValue<any>>({
  items: [],
});
SortableContextCtx.displayName = "SortableContextCtx";

interface SortableRootProps<T> {
  items: T[];
  sensors?: SensorDescriptor<SensorOptions>[];
  collisionDetection?: CollisionDetection;
  strategy?: SortingStrategy;
  onDragStart?: (event: DragStartEvent) => void;
  onDragOver?: (event: DragOverEvent) => void;
  onDragEnd?: (event: DragEndEvent) => void;
  onDragCancel?: (event: DragCancelEvent) => void;
  modifiers?: Modifier[];
  children: React.ReactNode;
}

function SortableRoot<T extends { id: string }>({
  items,
  sensors = [],
  collisionDetection = closestCenter,
  strategy = verticalListSortingStrategy,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDragCancel,
  modifiers = [],
  children,
}: SortableRootProps<T>) {
  const contextValue = React.useMemo(() => ({ items }), [items]);

  return (
    <SortableContextCtx.Provider value={contextValue}>
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
        modifiers={modifiers}
      >
        <SortableContext
          items={items.map((item) => item.id)}
          strategy={strategy}
        >
          {children}
        </SortableContext>
      </DndContext>
    </SortableContextCtx.Provider>
  );
}
SortableRoot.displayName = "SortableRoot";

const SortableContent = React.memo(
  React.forwardRef<HTMLDivElement, React.ComponentProps<"div">>(
    function SortableContent({ className, children, ...rest }, ref) {
      return (
        <div
          ref={ref}
          className={cn("flex flex-col gap-2", className)}
          {...rest}
        >
          {children}
        </div>
      );
    }
  )
);
SortableContent.displayName = "SortableContent";

interface SortableItemProps {
  id: string;
  disabled?: boolean;
  asHandle?: boolean;
  children: React.ReactNode;
}

function SortableItem({
  id,
  disabled = false,
  asHandle = true,
  className,
  children,
}: SortableItemProps & React.ComponentPropsWithoutRef<"div">) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...(!asHandle && !disabled ? listeners : {})}
    >
      <div
        className={cn(
          "flex items-center gap-2",
          disabled ? "gap-0 block" : "",
          {
            "border-2 border-dashed border-primary rounded-lg px-2 bg-primary/20 z-500":
              isDragging,
          },
          className
        )}
      >
        {!disabled && asHandle && (
          <SortableHandle ref={setActivatorNodeRef} listeners={listeners} />
        )}
        {children}
      </div>
    </div>
  );
}
SortableItem.displayName = "SortableItem";

interface SortableHandleProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  listeners?: SyntheticListenerMap;
}
const SortableHandle = React.memo(
  React.forwardRef<HTMLButtonElement, SortableHandleProps>(
    function SortableHandle({ listeners, ...rest }, ref) {
      return (
        <Button
          ref={ref}
          variant="ghost"
          size="icon"
          className="cursor-grab p-0 h-6 w-6"
          {...listeners}
          {...rest}
        >
          <GripVertical className="h-4 w-4" />
        </Button>
      );
    }
  )
);
SortableHandle.displayName = "SortableHandle";

interface SortableOverlayProps<T> {
  children: (activeItem: T | null) => React.ReactNode;
}

const SortableOverlay = function SortableOverlay<T>({
  children,
}: SortableOverlayProps<T>) {
  const { items } = React.useContext(SortableContextCtx);
  const { active } = useDndContext();
  const activeItem = active
    ? items.find((item) => item.id === active.id)
    : null;

  if (!activeItem) return null;

  return <DragOverlay>{children(activeItem)}</DragOverlay>;
};
SortableOverlay.displayName = "SortableOverlay";

export {
  SortableRoot,
  SortableContent,
  SortableItem,
  SortableHandle,
  SortableOverlay,
};
