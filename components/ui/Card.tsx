import { cn } from "@/lib/utils";

export function Card({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-gray-200 bg-white shadow-sm",
        className
      )}
    >
      {children}
    </div>
  );
}

const tones: Record<string, string> = {
  green: "bg-green-100 text-green-600",
  blue: "bg-blue-100 text-blue-600",
  purple: "bg-purple-100 text-purple-600",
  amber: "bg-amber-100 text-amber-600",
  pink: "bg-pink-100 text-pink-600",
  red: "bg-red-100 text-red-600",
  gray: "bg-gray-100 text-gray-600",
  indigo: "bg-indigo-100 text-indigo-600",
  teal: "bg-teal-100 text-teal-600",
  orange: "bg-orange-100 text-orange-600",
};

export function CardHeader({
  title,
  icon: Icon,
  tone = "blue",
  right,
  subtitle,
}: {
  title: string;
  icon?: React.ElementType;
  tone?: keyof typeof tones;
  right?: React.ReactNode;
  subtitle?: string;
}) {
  return (
    <div className="flex items-center justify-between border-b border-gray-100 px-4 py-4 sm:px-5">
      <div className="flex items-center gap-3">
        {Icon && (
          <div className={cn("rounded-lg p-2", tones[tone])}>
            <Icon className="h-5 w-5" />
          </div>
        )}
        <div>
          <h2 className="text-base font-bold text-gray-900 sm:text-lg">
            {title}
          </h2>
          {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
        </div>
      </div>
      {right}
    </div>
  );
}
