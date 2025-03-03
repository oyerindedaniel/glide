// import { MangaReader } from "@/components/manga/manga-reader";
import Image from "next/image";
import Link from "next/link";

export default async function Reader() {
  return (
    <div className="flex h-svh">
      <div className="grow bg-[#0B0B0B] h-full overflow-hidden">
        {/* <MangaReader /> */}
      </div>
      <div className="w-[25%] bg-black p-6">
        <Link className="" href="/">
          <Image
            className="w-28"
            src="/manga-glide.svg"
            alt="logo"
            width={133}
            height={30}
            unoptimized
            priority
          />
        </Link>
      </div>
    </div>
  );
}
