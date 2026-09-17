import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Download, FileUp, ShieldHalf, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, type Account } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { GroupTitle, Row } from "./primitives";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Onglet « Données & comptes » : sauvegarde cloud, export et import chiffrés. */
export function DataTab({ open, accounts }: { open: boolean; accounts: Account[] }) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(accounts.map((a) => a.name)));
  const [cloudPath, setCloudPath] = useState("");
  const [cloudPwd, setCloudPwd] = useState("");
  const [exportPwd, setExportPwd] = useState("");
  const [exportPwd2, setExportPwd2] = useState("");
  const [exporting, setExporting] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPwd, setImportPwd] = useState("");
  const [importing, setImporting] = useState(false);
  const [henrikKey, setHenrikKey] = useState("");
  const [henrikConfigured, setHenrikConfigured] = useState(false);
  const [savingHenrik, setSavingHenrik] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setSelected(new Set(accounts.map((a) => a.name)));
    api.getCloudBackup()
      .then((res) => {
        setCloudPath(res.path || "");
        setCloudPwd(res.password || "");
      })
      .catch(console.error);
    api.getSettingsAll().then((values) => setHenrikConfigured(values.henrikdev_configured)).catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggleSelected = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  };

  const saveHenrikKey = async () => {
    setSavingHenrik(true);
    try {
      await api.updateSettings({ henrikdev_api_key: henrikKey });
      setHenrikConfigured(Boolean(henrikKey.trim()));
      setHenrikKey("");
      toast.success(t("val.api.saved"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingHenrik(false);
    }
  };

  const saveCloud = async () => {
    try {
      await api.setCloudBackup(cloudPath || null, cloudPwd || undefined);
      toast.success(t("set.cloudSaved"));
    } catch (e) {
      toast.error(String(e));
    }
  };

  const doExport = async () => {
    if (selected.size === 0) return toast.error(t("settings.selectOne"));
    if (exportPwd.length < 4) return toast.error(t("settings.pwdShort"));
    if (exportPwd !== exportPwd2) return toast.error(t("settings.pwdMismatch"));
    setExporting(true);
    try {
      const { filename, data } = await api.exportAccounts([...selected], exportPwd);
      const blob = new Blob([base64ToBytes(data)], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(t(selected.size > 1 ? "settings.exportedMany" : "settings.exportedOne", { n: selected.size }));
      setExportPwd("");
      setExportPwd2("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  };

  const doImport = async () => {
    if (!importFile) return toast.error(t("settings.chooseFileFirst"));
    if (!importPwd) return toast.error(t("settings.pwdRequired"));
    setImporting(true);
    try {
      const buf = new Uint8Array(await importFile.arrayBuffer());
      const { imported } = await api.importAccounts(bytesToBase64(buf), importPwd);
      toast.success(
        imported.length
          ? t(imported.length > 1 ? "settings.importedMany" : "settings.importedOne", {
              n: imported.length,
              names: imported.join(", "),
            })
          : t("settings.importedNone"),
      );
      setImportFile(null);
      setImportPwd("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="flex flex-col gap-2.5">
      <GroupTitle>{t("val.api.title")}</GroupTitle>
      <Row title={t("val.api.key")} desc={t("val.api.desc")} icon={<ShieldHalf className="h-4 w-4 shrink-0 text-[#ef4655]" />}>
        <div className="flex gap-2">
          <input
            type="password"
            autoComplete="off"
            placeholder={t("val.api.placeholder")}
            value={henrikKey}
            onChange={(e) => setHenrikKey(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void saveHenrikKey(); }}
            className="h-9 min-w-0 flex-1 rounded-lg border border-[#6c2832] bg-panel px-2.5 text-[12px] text-text outline-none focus:border-[#ef4655]"
          />
          <Button onClick={saveHenrikKey} disabled={savingHenrik} className="h-9 shrink-0 bg-[#c73447] text-[11px] font-bold text-white hover:bg-[#e14355]">
            {t("val.api.save")}
          </Button>
        </div>
        {henrikConfigured && <span className="text-[10px] font-bold text-green">✓ {t("val.api.configured")}</span>}
      </Row>
      <Row title={t("set.cloud")} desc={t("set.cloudDesc")}>
        <div className="flex flex-col gap-2">
          <input
            type="text"
            placeholder={t("set.cloudPath")}
            value={cloudPath}
            onChange={(e) => setCloudPath(e.target.value)}
            className="h-9 rounded-lg border border-gold-dim bg-panel px-2.5 text-[12px] text-text outline-none focus:border-gold"
          />
          <input
            type="password"
            placeholder={t("set.cloudPwd")}
            value={cloudPwd}
            onChange={(e) => setCloudPwd(e.target.value)}
            className="h-9 rounded-lg border border-gold-dim bg-panel px-2.5 text-[12px] text-text outline-none focus:border-gold"
          />
          <Button onClick={saveCloud} className="h-8 rounded-lg bg-gold text-[11px] font-bold text-black hover:bg-gold-bright">
            {t("set.cloudEnable")}
          </Button>
          {cloudPath && (
            <span className="text-center text-[9.5px] font-bold text-green">✓ {t("set.cloudActive")}</span>
          )}
        </div>
      </Row>

      <GroupTitle>{t("settings.export")}</GroupTitle>
      <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-card px-3.5 py-3">
        <div className="flex max-h-[104px] flex-col gap-1.5 overflow-y-auto pr-1">
          {accounts.length === 0 && <p className="text-[11px] text-muted">{t("settings.noAccounts")}</p>}
          {accounts.map((a) => (
            <label key={a.name} className="flex cursor-pointer items-center gap-2 text-[12px] text-text">
              <input
                type="checkbox"
                checked={selected.has(a.name)}
                onChange={() => toggleSelected(a.name)}
                className="h-3.5 w-3.5 accent-gold"
              />
              <span className="truncate">{a.riot_id || a.name}</span>
            </label>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="password"
            placeholder={t("settings.password")}
            value={exportPwd}
            onChange={(e) => setExportPwd(e.target.value)}
            className="h-9 flex-1 rounded-lg border border-gold-dim bg-panel px-2.5 text-[12px] text-text outline-none focus:border-gold"
          />
          <input
            type="password"
            placeholder={t("settings.confirmPwd")}
            value={exportPwd2}
            onChange={(e) => setExportPwd2(e.target.value)}
            className="h-9 flex-1 rounded-lg border border-gold-dim bg-panel px-2.5 text-[12px] text-text outline-none focus:border-gold"
          />
        </div>
        <Button
          onClick={doExport}
          disabled={exporting}
          className="h-9 gap-1.5 bg-gold text-[12px] font-bold text-[#0a0f14] hover:bg-gold-bright"
        >
          <Download className="h-3.5 w-3.5" /> {t("settings.exportBtn")}
        </Button>
      </div>

      <GroupTitle>{t("settings.import")}</GroupTitle>
      <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-card px-3.5 py-3">
        <input
          ref={fileInputRef}
          type="file"
          accept=".hexgate"
          onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
          className="hidden"
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            "flex h-9 items-center gap-1.5 rounded-lg border border-dashed px-2.5 text-[12px] transition-colors",
            importFile ? "border-hextech-blue text-hextech-blue" : "border-border text-muted hover:border-border-hover",
          )}
        >
          <FileUp className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{importFile ? importFile.name : t("settings.chooseFile")}</span>
        </button>
        <input
          type="password"
          placeholder={t("settings.password")}
          value={importPwd}
          onChange={(e) => setImportPwd(e.target.value)}
          className="h-9 rounded-lg border border-gold-dim bg-panel px-2.5 text-[12px] text-text outline-none focus:border-gold"
        />
        <Button
          onClick={doImport}
          disabled={importing}
          className="h-9 gap-1.5 border border-[#14504a] bg-transparent text-[12px] font-bold text-hextech-blue hover:bg-card-hover"
        >
          <Upload className="h-3.5 w-3.5" /> {t("settings.importBtn")}
        </Button>
      </div>

      <p className="flex items-start gap-1.5 text-[10.5px] text-muted">
        <ShieldHalf className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {t("settings.securityNote")}
      </p>
    </div>
  );
}
