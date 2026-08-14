import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "ui-button relative inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
  {
    variants: {
      variant: {
        default: "bg-[hsl(var(--accent))] text-white hover:bg-[hsl(var(--accent-hover))]",
        secondary: "border border-border bg-card text-foreground hover:bg-[hsl(var(--surface-hover))]",
        ghost: "text-foreground hover:bg-[hsl(var(--surface-hover))]",
        destructive: "bg-destructive text-destructive-foreground hover:bg-[hsl(var(--destructive-hover))]",
      },
      size: {
        default: "h-9 px-3.5 py-2",
        sm: "h-8 px-3 text-xs",
        lg: "h-10 px-4",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  pending?: boolean;
  pendingLabel?: string;
}

export function Button({
  className,
  variant,
  size,
  asChild = false,
  pending = false,
  pendingLabel = "处理中",
  disabled,
  children,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  if (asChild) {
    return <Comp className={cn(buttonVariants({ variant, size, className }))} {...props}>{children}</Comp>;
  }
  return (
    <Comp
      className={cn(buttonVariants({ variant, size, className }))}
      aria-busy={pending || undefined}
      data-pending={pending || undefined}
      disabled={disabled || pending}
      {...props}
    >
      <span className={cn("button-content", pending && "button-content-hidden")} aria-hidden={pending || undefined}>
        {children}
      </span>
      {pending && (
        <span className="button-pending-content">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>{pendingLabel}</span>
        </span>
      )}
    </Comp>
  );
}
