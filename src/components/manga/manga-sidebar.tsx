"use client";

import Image from "next/image";
import Link from "next/link";
import { memo } from "react";
import { Maximize } from "lucide-react";
import { Button } from "../ui/button";

export const MangaSidebar = memo(function MangaSidebar() {
  return (
    <div className="flex items-center justify-between gap-8">
      <Button size="icon" variant="ghost">
        <Maximize />
        <span className="sr-only">Maximize screen</span>
      </Button>
      <Link className="cursor-pointer" href="/">
        <Image
          className="w-24"
          src="/manga-glide.svg"
          alt="logo"
          width={133}
          height={30}
          unoptimized
          priority
        />
      </Link>
    </div>
  );
});
