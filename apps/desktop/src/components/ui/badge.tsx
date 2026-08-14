import type * as React from "react";
import { cn } from "@/lib/utils";

export function Badge({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center rounded-[5px] border border-border bg-[hsl(var(--surface-subtle))] px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}
