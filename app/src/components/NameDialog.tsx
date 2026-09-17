import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

interface Props {
  open: boolean;
  initial: string;
  onCancel: () => void;
  onConfirm: (name: string) => void;
}

export function NameDialog({ open, initial, onCancel, onConfirm }: Props) {
  const { t } = useI18n();
  const [name, setName] = useState(initial);
  useEffect(() => setName(initial), [initial, open]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="border-border bg-panel text-text sm:max-w-[380px]">
        <DialogHeader>
          <DialogTitle className="text-gold">{t("name.title")}</DialogTitle>
          <DialogDescription className="text-muted">
            {t("name.desc")}
          </DialogDescription>
        </DialogHeader>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && name.trim() && onConfirm(name.trim())}
          className="h-10 rounded-xl border border-gold-dim bg-card px-3 text-center text-[13px] text-text outline-none focus:border-gold"
        />
        <DialogFooter className="justify-center gap-2 sm:justify-center">
          <Button variant="outline" className="border-border text-muted" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button
            className="bg-gold font-bold text-[#0a0f14] hover:bg-gold-bright"
            disabled={!name.trim()}
            onClick={() => onConfirm(name.trim())}
          >
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
