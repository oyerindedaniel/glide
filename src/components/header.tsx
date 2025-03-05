import Link from "next/link";
import { Button } from "./ui/button";
import Image from "next/image";

/**
 * Header component with navigation and a hamburger menu.
 */
function Header() {
  return (
    <header className="flex justify-between items-center bg-transparent fixed top-8 w-full z-50 pl-12 pr-16 shadow-none">
      <Link href="/">
        <Image
          className="w-32"
          src="/manga-glide.svg"
          alt="logo"
          width={265}
          height={60}
          unoptimized
          priority
        />
      </Link>

      <div className="flex items-center gap-8">
        <Button variant="link" size="sm" className="p-0 h-fit">
          About
        </Button>
        <Button variant="link" size="sm" className="p-0 h-fit" asChild>
          <Link href="/reader">Reader</Link>
        </Button>
        {/* <button
          onClick={toggleMenu}
          aria-label="Toggle Menu"
          className="md:hidden p-2"
        >
          <span className="block w-6 h-0.5 bg-black mb-1"></span>
          <span className="block w-6 h-0.5 bg-black mb-1"></span>
          <span className="block w-6 h-0.5 bg-black"></span>
        </button> */}
      </div>
    </header>
  );
}

export default Header;
