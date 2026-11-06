"use client";

import { ArrowUp } from "lucide-react";
import { useEffect, useState } from "react";

export function ScrollToTopButton() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 300);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!visible) return null;

  return (
    <button
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      className="fixed bottom-24 right-4 z-40 sm:right-6 rounded-full bg-pink-600 p-3 text-white shadow-lg transition-transform hover:scale-105 hover:bg-pink-700"
      aria-label="Volver arriba"
    >
      <ArrowUp className="h-5 w-5" />
    </button>
  );
}
