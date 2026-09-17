import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

interface Props {
  open: boolean;
  accountName: string | null;
  initial: string;
  onCancel: () => void;
  onConfirm: (note: string) => void;
}

/** Petite note libre par compte (ex: "smurf ADC") — max 60 caractères. */
export function NoteDialog({ open, accountName, initial, onCancel, onConfirm }: Props) {
  const { t } = useI18n();
  const [note, setNote] = useState(initial);
  useEffect(() => setNote(initial), [initial, open]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="border-border bg-panel text-text sm:max-w-[380px]">
        <DialogHeader>
          <DialogTitle className="text-gold">{t("note.title")}</DialogTitle>
          <DialogDescription className="text-muted">
            {t("note.desc", { name: accountName ?? "" })}
          </DialogDescription>
        </DialogHeader>
        <input
          autoFocus
          value={note}
          maxLength={60}
          placeholder={t("note.placeholder")}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onConfirm(note.trim())}
          className="h-10 rounded-xl border border-gold-dim bg-card px-3 text-center text-[13px] text-text outline-none focus:border-gold"
        />
        <DialogFooter className="justify-center gap-2 sm:justify-center">
          <Button variant="outline" className="border-border text-muted" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button
            className="bg-gold font-bold text-[#0a0f14] hover:bg-gold-bright"
            onClick={() => onConfirm(note.trim())}
          >
            {t("common.saveNote")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
