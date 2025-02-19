import type React from "react";
import { PropsWithChildren } from "react";

export const Background: React.FC<PropsWithChildren> = ({ children }) => (
  <div className="h-full w-full bg-[url(/sasuke.webp)] bg-cover">
    <div className="absolute inset-0 backdrop-blur-sm bg-black/80" />
    <main className="inset-0 absolute z-10">{children}</main>
  </div>
);
