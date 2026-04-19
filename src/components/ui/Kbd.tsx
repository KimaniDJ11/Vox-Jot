import React from "react";

interface KbdProps extends React.HTMLAttributes<HTMLElement> {
  children: React.ReactNode;
}

export const Kbd: React.FC<KbdProps> = ({
  children,
  className = "",
  ...props
}) => (
  <kbd className={`kbd text-[11px] ${className}`.trim()} {...props}>
    {children}
  </kbd>
);
