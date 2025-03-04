import Image from "next/image";
import { Button } from "../ui/button";
import Link from "next/link";

export function MangaEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-white bg-transparent p-6">
      <Image
        src="/empty-manga-state-placeholder.svg"
        alt="No pages available"
        width={150}
        height={150}
        className="mb-4 opacity-70 w-42"
        unoptimized
        priority
      />
      <h2 className="text-xl font-semibold mb-2">No Manga Pages Available</h2>
      <p className="text-gray-400 text-center max-w-md">
        It looks like there are no pages to display yet. Try uploading some
        manga files or check back later!
      </p>
      <Button className="mt-4" variant="link" asChild>
        <Link href="/">Back to Home</Link>
      </Button>
    </div>
  );
}
