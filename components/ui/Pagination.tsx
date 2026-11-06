"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  totalItems?: number;
  itemsPerPage?: number;
}

export function Pagination({
  currentPage,
  totalPages,
  onPageChange,
  totalItems,
  itemsPerPage,
}: PaginationProps) {
  if (totalPages <= 1 && !totalItems) return null;

  const pages = Array.from({ length: totalPages }, (_, i) => i + 1).filter(
    (page) =>
      page === 1 ||
      page === totalPages ||
      Math.abs(page - currentPage) <= 1
  );

  const from = totalItems
    ? (currentPage - 1) * (itemsPerPage || 10) + 1
    : undefined;
  const to = totalItems
    ? Math.min(currentPage * (itemsPerPage || 10), totalItems)
    : undefined;

  return (
    <div className="flex flex-col items-center justify-between gap-3 border-t border-gray-200 px-4 py-3 sm:flex-row">
      {totalItems ? (
        <p className="text-sm text-gray-500">
          Mostrando <span className="font-medium text-gray-700">{from}</span> a{" "}
          <span className="font-medium text-gray-700">{to}</span> de{" "}
          <span className="font-medium text-gray-700">{totalItems}</span>{" "}
          registros
        </p>
      ) : (
        <span />
      )}
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          className="rounded-lg border border-gray-300 p-2 text-gray-600 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        {pages.map((page, index) => {
          const prev = pages[index - 1];
          const gap = prev && page - prev > 1;
          return (
            <span key={page} className="flex items-center gap-1">
              {gap && <span className="px-1 text-gray-400">...</span>}
              <button
                onClick={() => onPageChange(page)}
                className={cn(
                  "min-w-[36px] rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                  page === currentPage
                    ? "border-blue-600 bg-blue-600 text-white"
                    : "border-gray-300 text-gray-700 hover:bg-gray-50"
                )}
              >
                {page}
              </button>
            </span>
          );
        })}
        <button
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          className="rounded-lg border border-gray-300 p-2 text-gray-600 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
