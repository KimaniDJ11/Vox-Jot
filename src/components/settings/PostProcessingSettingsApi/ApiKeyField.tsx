import React, { useState } from "react";
import { Input } from "../../ui/Input";

interface ApiKeyFieldProps {
  onBlur: (value: string) => void;
  disabled: boolean;
  resetKey: string;
  hasSavedValue?: boolean;
  placeholder?: string;
  className?: string;
}

export const ApiKeyField: React.FC<ApiKeyFieldProps> = React.memo(
  ({ onBlur, disabled, resetKey, hasSavedValue = false, placeholder, className = "" }) => {
    const [localValue, setLocalValue] = useState("");

    React.useEffect(() => {
      setLocalValue("");
    }, [resetKey, hasSavedValue]);

    return (
      <Input
        type="password"
        value={localValue}
        onChange={(event) => setLocalValue(event.target.value)}
        onBlur={() => onBlur(localValue)}
        placeholder={placeholder}
        variant="compact"
        disabled={disabled}
        className={`flex-1 min-w-[320px] ${className}`}
      />
    );
  },
);

ApiKeyField.displayName = "ApiKeyField";
