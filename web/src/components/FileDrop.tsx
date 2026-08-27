import { DragEvent, useState } from "react";

interface FileDropProps {
  accept: string;
  disabled?: boolean;
  label: string;
  hint?: string;
  capture?: boolean;
  onFile: (file: File) => void;
}

export default function FileDrop({
  accept,
  disabled,
  label,
  hint,
  capture,
  onFile,
}: FileDropProps) {
  const [over, setOver] = useState(false);

  function take(file: File | undefined | null) {
    if (file) onFile(file);
  }

  function onDragOver(e: DragEvent) {
    e.preventDefault();
    if (!disabled) setOver(true);
  }

  function onDragLeave() {
    setOver(false);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setOver(false);
    if (disabled) return;
    take(e.dataTransfer.files?.[0]);
  }

  return (
    <label
      className={`file-drop ${over ? "is-over" : ""} ${disabled ? "is-disabled" : ""}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <input
        type="file"
        accept={accept}
        disabled={disabled}
        capture={capture ? "environment" : undefined}
        onChange={(e) => {
          take(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <span className="file-drop-icon" aria-hidden="true">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
          <path
            d="M12 16V4M12 4l-4 4M12 4l4 4"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M4 16.5V19a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </span>
      <span className="file-drop-copy">
        <strong>{label}</strong>
        {hint ? <span className="muted">{hint}</span> : null}
      </span>
    </label>
  );
}
