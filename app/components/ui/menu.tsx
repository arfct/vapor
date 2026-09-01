import * as React from "react";
import { Menu as BaseMenu } from "@base-ui/react/menu";
import { cn } from "~/lib/cn";

interface MenuProps {
  children: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function Menu({ children, open, onOpenChange }: MenuProps) {
  return (
    <BaseMenu.Root open={open} onOpenChange={onOpenChange}>
      {children}
    </BaseMenu.Root>
  );
}

export function MenuTrigger({
  children,
  ...props
}: { children: React.ReactElement } & Record<string, unknown>) {
  return <BaseMenu.Trigger render={children} {...props} />;
}

interface MenuContentProps extends React.ComponentPropsWithoutRef<"div"> {
  align?: "start" | "end";
}

export const MenuContent = React.forwardRef<HTMLDivElement, MenuContentProps>(
  ({ className, align = "start", children, ...props }, ref) => {
    return (
      <BaseMenu.Portal>
        <BaseMenu.Positioner align={align} side="bottom" sideOffset={4} className="z-50">
          <BaseMenu.Popup
            ref={ref}
            className={cn(
              "min-w-32 overflow-hidden squircle-2xl border border-border bg-paper p-1.5 shadow-md outline-none",
              className,
            )}
            {...props}
          >
            {children}
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    );
  },
);

MenuContent.displayName = "MenuContent";

interface MenuItemProps extends React.ComponentPropsWithoutRef<"div"> {
  destructive?: boolean;
  disabled?: boolean;
  onClick?: React.MouseEventHandler;
}

export const MenuItem = React.forwardRef<HTMLDivElement, MenuItemProps>(
  ({ className, destructive, ...props }, ref) => {
    return (
      <BaseMenu.Item
        ref={ref}
        className={cn(
          "relative flex min-h-9 cursor-pointer select-none items-center rounded-xl px-3 text-sm outline-none transition-colors",
          "data-[highlighted]:bg-accent data-[highlighted]:text-ink",
          "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
          destructive && "text-destructive data-[highlighted]:text-destructive",
          className,
        )}
        {...props}
      />
    );
  },
);

MenuItem.displayName = "MenuItem";

export const MenuSeparator = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<"div">
>(({ className, ...props }, ref) => {
  return (
    <BaseMenu.Separator
      ref={ref}
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  );
});

MenuSeparator.displayName = "MenuSeparator";
