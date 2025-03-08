import { useSearchParams, useRouter } from "next/navigation";
import { useEffect } from "react";
import { Mode } from "@/types/app";

export function ModeHandler({
  onModeChange,
}: {
  onModeChange: (mode: Mode) => void;
}) {
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    const mode =
      searchParams.get("mode") === "search" ? Mode.SEARCH : Mode.UPLOAD;
    onModeChange(mode);

    if (!searchParams.has("mode")) {
      router.replace("/?mode=upload", { scroll: false });
    }
  }, [searchParams, onModeChange, router]);

  return null;
}
