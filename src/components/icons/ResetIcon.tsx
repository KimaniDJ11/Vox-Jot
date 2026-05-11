import React from "react";
import { Undo2 } from "lucide-react";

interface ResetIconProps {
  width?: number;
  height?: number;
  className?: string;
}

const ResetIcon: React.FC<ResetIconProps> = ({
  width = 16,
  height = 16,
  className = "",
}) => {
  return (
    <Undo2
      width={width}
      height={height}
      className={className}
      strokeWidth={2}
      aria-hidden="true"
    />
  );
};

export default ResetIcon;
