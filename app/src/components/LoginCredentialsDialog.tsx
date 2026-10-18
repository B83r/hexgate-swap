import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "./ui/dialog";
import { Button } from "./ui/button";

export function LoginCredentialsDialog({ name, onClose }: { name: string; onClose: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [configured, setConfigured] = useState(false);
  const [busy, setBusy] = useState(true);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    api.loginCredentials(name, "status").then(result => {
      if (active) { setConfigured(result.configured); setReady(true); }
    }).catch(() => toast.error("Impossible de lire l’état des identifiants."))
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [name]);
  const close = () => { setPassword(""); setUsername(""); onClose(); };
  const submit = async (action: "save" | "delete") => {
    setBusy(true);
    try {
      await api.loginCredentials(name, action, action === "save" ? username : undefined, action === "save" ? password : undefined);
      toast.success(action === "save" ? "Connexion de secours activée." : "Identifiants supprimés de Windows.");
      close();
    } catch {
      toast.error("Impossible d’enregistrer la modification. Vérifie les champs et la session sauvegardée.");
    } finally { setPassword(""); setBusy(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open && !busy) close(); }}>
    <DialogContent className="border-border bg-panel text-text sm:max-w-[420px]">
      <DialogHeader>
        <DialogTitle className="text-gold">Connexion de secours · {name}</DialogTitle>
        <DialogDescription className="text-muted">
          Facultatif : si la session expire, Hexgate remplit la connexion Riot avec ces identifiants conservés dans Windows. Le 2FA ou captcha reste à compléter dans Riot.
        </DialogDescription>
      </DialogHeader>
      <p className="text-sm text-muted" role="status">{busy && !ready ? "Chargement…" : configured ? "Des identifiants sont enregistrés. Tu peux les remplacer ou les supprimer." : "Aucun identifiant enregistré."}</p>
      <label className="text-sm">Nom d’utilisateur de connexion Riot
        <input autoComplete="off" value={username} maxLength={256} onChange={e => setUsername(e.target.value)} disabled={busy}
          className="mt-1 h-10 w-full rounded-xl border border-border bg-card px-3 text-text" />
      </label>
      <label className="text-sm">Mot de passe
        <input type="password" autoComplete="new-password" value={password} maxLength={512} onChange={e => setPassword(e.target.value)} disabled={busy}
          className="mt-1 h-10 w-full rounded-xl border border-border bg-card px-3 text-text" />
      </label>
      <DialogFooter className="gap-2">
        {configured && <Button variant="outline" disabled={busy || !ready} onClick={() => submit("delete")}>Supprimer</Button>}
        <Button variant="outline" disabled={busy} onClick={close}>Annuler</Button>
        <Button disabled={busy || !ready || !username.trim() || !password} onClick={() => submit("save")}>Enregistrer</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
