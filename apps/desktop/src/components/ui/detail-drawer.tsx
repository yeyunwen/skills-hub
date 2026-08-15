import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils";

export const DetailDrawer = DialogPrimitive.Root;
export const DetailDrawerClose = DialogPrimitive.Close;

export function DetailDrawerContent({ className, children, ...props }: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="drawer-overlay" />
      <DialogPrimitive.Content className={cn("detail-drawer", className)} {...props}>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DetailDrawerTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn("truncate text-lg font-semibold", className)} {...props} />;
}

export function DetailDrawerDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn("muted-path", className)} {...props} />;
}

export function DetailDrawerCloseButton({ className, label = "关闭", ...props }: React.ComponentProps<typeof DialogPrimitive.Close> & { label?: string }) {
  return (
    <DialogPrimitive.Close className={cn("icon-button", className)} aria-label={label} {...props}>
      <X className="h-4 w-4" />
    </DialogPrimitive.Close>
  );
}
