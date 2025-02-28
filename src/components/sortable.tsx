"use client";

import React, { createContext, useMemo } from "react";
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
} from "@dnd-kit/core";
import {
  SortableContext,
  SortingStrategy,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";

interface SortableContextType<T> {
  items: T[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SortableContextCtx = createContext<SortableContextType<any> | null>(null);

interface SortableRootProps<T> {
  items: T[]; // The list of items to sort
  sensors?: SensorDescriptor<SensorOptions>[]; // Array of sensors (e.g., PointerSensor, TouchSensor)
  collisionDetection?: CollisionDetection; // Custom collision detection strategy
  strategy?: SortingStrategy; // Custom sorting strategy (e.g., vertical, horizontal)
  onDragStart?: (event: DragStartEvent) => void; // Called when drag starts
  onDragOver?: (event: DragOverEvent) => void; // Called when dragging over an item
  onDragEnd?: (event: DragEndEvent) => void; // Called when drag ends
  onDragCancel?: (event: DragCancelEvent) => void; // Called when drag is canceled
  children: React.ReactNode;
}

export function SortableRoot<T extends { id: string }>({
  items,
  sensors = [],
  collisionDetection = closestCenter,
  strategy = verticalListSortingStrategy,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDragCancel,
  children,
}: SortableRootProps<T>) {
  const contextValue = useMemo(() => ({ items }), [items]);

  return (
    <SortableContextCtx.Provider value={contextValue}>
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
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

interface SortableItemProps {
  id: string;
  children: React.ReactNode;
}

export function SortableItem({ id, children }: SortableItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <div className="flex items-center">
        <GripVertical className="cursor-grab w-4 h-4" />
        {children}
      </div>
    </div>
  );
}
