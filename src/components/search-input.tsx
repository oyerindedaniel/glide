"use client";

import * as React from "react";
import { Button } from "./ui/button";
import { Globe } from "lucide-react";

/**
 * SearchInput component that displays a search input field.
 *
 * @param props - Component props.
 * @param ref - Forwarded ref for the container div.
 * @returns The SearchInput component.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export const SearchInput = React.forwardRef<HTMLDivElement, {}>(
  function SearchInput(props, ref) {
    return (
      <div
        ref={ref}
        className="left-2/4 -translate-x-2/4 absolute top-[40%] w-full max-w-[30.5rem]"
      >
        <div className="w-full h-14 pl-4 pr-2 bg-white has-[:focus-visible]:border-primary transition border-2 border-transparent rounded-[0.875rem] flex items-center gap-4">
          <input
            type="text"
            placeholder="Search anime ..."
            className="w-full outline-none bg-transparent text-primary text-lg"
          />
          <Button
            className="inline-flex items-center rounded-xl cursor-pointer text-base w-[2.5rem] h-[2.5rem]"
            size="sm"
          >
            <Globe aria-hidden />
            <span className="sr-only">Search</span>
          </Button>
        </div>
      </div>
    );
  }
);
