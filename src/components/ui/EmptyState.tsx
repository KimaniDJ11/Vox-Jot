import React from "react";

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description: React.ReactNode;
  example?: React.ReactNode;
  action?: React.ReactNode;
  framed?: boolean;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  example,
  action,
  framed = true,
  className = "",
}) => {
  const wrapperClass = framed
    ? "rounded-2xl border border-dashed border-[var(--border)] bg-[var(--panel-bg)] px-5 py-8 text-center"
    : "px-5 py-8 text-center";

  return (
    <div className={`${wrapperClass} ${className}`}>
      {icon ? (
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-[var(--input)] text-[var(--muted)]">
          {icon}
        </div>
      ) : null}
      <p className="text-sm font-semibold text-[var(--text)]">{title}</p>
      <p className="mx-auto mt-1.5 max-w-md text-sm leading-6 text-[var(--muted)]">
        {description}
      </p>
      {example ? (
        <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-[var(--muted)]">
          {example}
        </p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
};
