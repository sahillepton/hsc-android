import { createPortal } from "react-dom";
import { Button } from "./button";

/**
 * In-app confirmation dialog.
 *
 * Replaces `window.confirm()`. The native dialog renders a browser-chrome heading
 * the app cannot control — in a WebView that reads as
 *     The page at "https://localhost" says
 * which is meaningless to the user and actively wrong once this codebase is
 * embedded in someone else's host app, where "localhost" is our tile server rather
 * than anything the user recognises. It also cannot be styled, is synchronous
 * (blocking the JS thread), and on Android can be suppressed entirely by the host
 * WebView's `onJsConfirm`, which would silently make a Delete button do nothing.
 *
 * Markup deliberately mirrors the existing Delete Session dialog in
 * components/map/zoom-controls.tsx — same portal-to-body, same backdrop, same
 * rounded card, same type scale and button pair — so confirmations look identical
 * wherever they appear.
 */
export type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Renders the confirm action in the destructive style. */
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

const ConfirmDialog = ({
  open,
  title,
  description,
  confirmLabel = "Yes",
  cancelLabel = "No",
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) => {
  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40"
      // Backdrop click cancels, matching the Delete Session dialog.
      onClick={onCancel}
      role="presentation"
    >
      <div
        className="bg-white rounded-lg shadow-xl p-5 max-w-sm mx-4"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <h3 className="text-sm font-semibold text-slate-900 mb-2">{title}</h3>
        {description && (
          <p className="text-xs text-slate-600 mb-4">{description}</p>
        )}
        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            variant="outline"
            className="text-xs"
            onClick={onCancel}
          >
            {cancelLabel}
          </Button>
          <Button
            size="sm"
            variant={destructive ? "destructive" : "default"}
            className="text-xs"
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default ConfirmDialog;
