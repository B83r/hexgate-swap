import type { ReactNode } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

export interface ConfirmRequest {
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  secondaryLabel?: string;
  onSecondary?: () => void;
  onConfirm: () => void;
}

interface Props {
  request: ConfirmRequest | null;
  onCancel: () => void;
}

/** Dialogue de confirmation Hextech réutilisable — remplace window.confirm(). */
export function ConfirmDialog({ request, onCancel }: Props) {
  const { t } = useI18n();
  return (
    <Dialog open={request !== null} onOpenChange={(o) => !o && onCancel()}>
      {request && (
        <DialogContent className="border-border bg-panel text-text sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle className={request.danger ? "text-red" : "text-gold"}>
              {request.title}
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2.5 text-left text-[12.5px] leading-relaxed text-muted">
                {request.description}
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="justify-center gap-2 sm:justify-center">
            <Button variant="outline" className="border-border text-muted" onClick={onCancel}>
              {request.cancelLabel ?? t("common.cancel")}
            </Button>
            {request.secondaryLabel && request.onSecondary && (
              <Button variant="outline" className="border-[#ff4655]/60 text-[#ff8290]" onClick={() => {
                onCancel(); request.onSecondary?.();
              }}>
                {request.secondaryLabel}
              </Button>
            )}
            <Button
              className={
                request.danger
                  ? "bg-red font-bold text-white hover:bg-[#c94a4a]"
                  : "bg-gold font-bold text-[#0a0f14] hover:bg-gold-bright"
              }
              onClick={() => {
                onCancel();
                request.onConfirm();
              }}
            >
              {request.confirmLabel ?? t("common.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}
