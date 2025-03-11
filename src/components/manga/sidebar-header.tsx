import { memo } from "react";
import Link from "next/link";
import Image from "next/image";
import { Maximize } from "lucide-react";
import { Button } from "../ui/button";

export const SidebarHeader = memo(function SidebarHeader() {
  return (
    <div className="flex items-center justify-between gap-8">
      <Button size="icon" variant="ghost">
        <Maximize aria-hidden />
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
