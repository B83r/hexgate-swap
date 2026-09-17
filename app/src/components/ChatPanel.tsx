import { useState, useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Send, ArrowLeft, Users, RefreshCw, Eye, UserPlus, Check, X } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";

interface Friend {
  id: string; // JID
  puuid?: string; // PUUID
  name: string;
  gameName?: string;
  gameTag?: string;
  availability: "chat" | "away" | "dnd" | "offline" | string;
  lol?: {
    gameStatus?: "outOfGame" | "inQueue" | "champSelect" | "inGame" | string;
    level?: string;
  };
  statusMessage?: string;
}

interface Message {
  body: string;
  isMe: boolean;
  ts: Date;
}

interface FriendRequest {
  id: string;
  name?: string;
  gameName?: string;
  gameTag?: string;
}

function formatRequestName(r: FriendRequest): string {
  if (r.gameName) return r.gameTag ? `${r.gameName}#${r.gameTag}` : r.gameName;
  return r.name || "Invocateur";
}

interface Props {
  open: boolean;
  onClose: () => void;
}

function formatFriendName(f: Friend): string {
  if (f.gameName) {
    return f.gameTag ? `${f.gameName}#${f.gameTag}` : f.gameName;
  }
  return f.name || "Invocateur";
}

export function ChatPanel({ open, onClose }: Props) {
  const { t } = useI18n();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [friendRequests, setFriendRequests] = useState<FriendRequest[]>([]);
  const [selectedFriend, setSelectedFriend] = useState<Friend | null>(null);
  const [chats, setChats] = useState<Record<string, Message[]>>({});
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [statusAvail, setStatusAvail] = useState("online");
  const [statusMsg, setStatusMsg] = useState("");

  const savePresence = async () => {
    try {
      const res = await api.updatePresence(statusMsg, statusAvail);
      if (res.ok) {
        toast.success(t("chat.statusSaved"));
      } else {
        toast.error(t("chat.statusError"));
      }
    } catch (e) {
      toast.error(String(e));
    }
  };

  const loadFriends = async () => {
    setLoading(true);
    try {
      const list = await api.getFriends();
      setFriends(list || []);
    } catch {
      // client LCU non actif
    } finally {
      setLoading(false);
    }
    try {
      const reqs = await api.getFriendRequests();
      setFriendRequests(reqs || []);
    } catch {
      setFriendRequests([]);
    }
  };

  const respondToRequest = async (req: FriendRequest, accept: boolean) => {
    setFriendRequests((prev) => prev.filter((r) => r.id !== req.id));
    try {
      const res = accept ? await api.acceptFriendRequest(req.id) : await api.declineFriendRequest(req.id);
      if (res.ok) {
        toast.success(accept ? t("chat.friendAdded", { name: formatRequestName(req) }) : t("chat.requestDeclined"));
        if (accept) loadFriends();
      } else {
        toast.error(t("chat.opFailed"));
      }
    } catch {
      toast.error(t("chat.lcuRequired"));
    }
  };

  useEffect(() => {
    if (open) {
      loadFriends();
      const id = setInterval(loadFriends, 12000);
      return () => clearInterval(id);
    }
  }, [open]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [selectedFriend, chats]);

  const handleSend = async () => {
    if (!selectedFriend || !text.trim()) return;
    const msgText = text.trim();
    setText("");
    const isSuccess = await api.sendChatMessage(selectedFriend.id, msgText);
    if (isSuccess.ok) {
      const newMsg: Message = { body: msgText, isMe: true, ts: new Date() };
      setChats(prev => ({
        ...prev,
        [selectedFriend.id]: [...(prev[selectedFriend.id] || []), newMsg]
      }));
    } else {
      toast.error(t("chat.sendFailed"));
    }
  };

  if (!open) return null;

  // Sorting: Online (InGame first, then chat), Offline last
  const sortedFriends = [...friends].sort((a, b) => {
    const aOnline = a.availability !== "offline";
    const bOnline = b.availability !== "offline";
    if (aOnline !== bOnline) return aOnline ? -1 : 1;

    const aInGame = a.lol?.gameStatus === "inGame";
    const bInGame = b.lol?.gameStatus === "inGame";
    if (aInGame !== bInGame) return aInGame ? -1 : 1;

    const nameA = formatFriendName(a);
    const nameB = formatFriendName(b);
    return nameA.localeCompare(nameB);
  });

  return (
    <div className="absolute top-[104px] right-0 bottom-0 w-80 bg-[#060c16]/98 border-l border-border/80 shadow-2xl backdrop-blur-lg z-40 flex flex-col transition-all duration-300 animate-in slide-in-from-right-4">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border/30 flex items-center justify-between bg-[#0a1424]/40">
        {selectedFriend ? (
          <button 
            onClick={() => setSelectedFriend(null)} 
            className="flex items-center gap-1.5 text-xs text-gold hover:text-gold-bright font-bold uppercase transition-colors"
          >
            <ArrowLeft className="h-4.5 w-4.5" />
            {t("chat.return")}
          </button>
        ) : (
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gold">
            <Users className="h-4.5 w-4.5 text-gold-dim" />
            {t("chat.title")}
          </div>
        )}
        <div className="flex items-center gap-2">
          {!selectedFriend && (
            <button 
              onClick={loadFriends} 
              disabled={loading} 
              className={cn("text-muted hover:text-text transition-colors p-1", loading && "animate-spin")}
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          )}
          <button onClick={onClose} className="text-muted hover:text-text text-xs font-bold px-1.5 transition-colors">
            {t("chat.close")}
          </button>
        </div>
      </div>

      {/* Friends list or chat history */}
      {selectedFriend ? (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Active Friend info */}
          <div className="px-4 py-2 border-b border-border/10 bg-[#0c1628]/35 flex items-center gap-2">
            <span className={cn(
              "h-2 w-2 rounded-full",
              selectedFriend.availability === "chat" ? "bg-green" : selectedFriend.availability === "offline" ? "bg-muted" : "bg-gold"
            )} />
            <div className="min-w-0">
              <h5 className="text-[11px] font-bold text-text truncate">{formatFriendName(selectedFriend)}</h5>
              {selectedFriend.statusMessage && (
                <p className="text-[9px] text-muted italic truncate">{selectedFriend.statusMessage}</p>
              )}
            </div>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 flex flex-col gap-2">
            {(chats[selectedFriend.id] || []).length === 0 ? (
              <div className="text-center text-[10px] text-muted italic mt-12 whitespace-pre-line">
                {t("chat.noMessages")}
              </div>
            ) : (
              (chats[selectedFriend.id] || []).map((msg, i) => (
                <div 
                  key={i} 
                  className={cn(
                    "flex flex-col max-w-[80%] rounded-xl px-3 py-1.5 text-xs text-text",
                    msg.isMe 
                      ? "bg-gold/10 border border-gold/30 rounded-tr-none ml-auto"
                      : "bg-card border border-border rounded-tl-none mr-auto"
                  )}
                >
                  <p className="leading-relaxed break-words">{msg.body}</p>
                  <span className="text-[8px] text-muted text-right mt-0.5">
                    {msg.ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))
            )}
          </div>

          {/* Input block */}
          <div className="p-3 border-t border-border/30 bg-[#0a1424]/40 flex gap-2">
            <input
              type="text"
              placeholder={t("chat.placeholder")}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              className="flex-1 bg-[#050b14] border border-border rounded-lg px-3 py-1.5 text-xs text-text placeholder-muted outline-none focus:border-gold"
            />
            <button 
              onClick={handleSend}
              className="bg-gold hover:bg-gold-bright text-black rounded-lg p-2 transition-colors flex items-center justify-center shrink-0"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {friendRequests.length > 0 && (
            <div className="p-3 border-b border-border/30 bg-[#0e1a12]/60 flex flex-col gap-1.5">
              <span className="flex items-center gap-1.5 text-[9px] font-extrabold uppercase tracking-wider text-green">
                <UserPlus className="h-3 w-3" /> Demandes d'amis
              </span>
              {friendRequests.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-2 bg-[#050b14]/60 rounded-lg px-2.5 py-1.5">
                  <span className="text-[11px] font-semibold text-text truncate">{formatRequestName(r)}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => respondToRequest(r, true)}
                      className="rounded p-1 bg-green/10 border border-green/30 text-green hover:bg-green hover:text-black transition-colors"
                      title={t("chat.accept")}
                    >
                      <Check className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => respondToRequest(r, false)}
                      className="rounded p-1 bg-red/10 border border-red/30 text-red hover:bg-red hover:text-black transition-colors"
                      title={t("chat.decline")}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {friends.length > 0 && (
            <div className="p-3 border-b border-border/30 bg-[#09111c]/80 flex flex-col gap-2">
              <span className="text-[9px] font-extrabold uppercase tracking-wider text-gold-dim">{t("chat.myStatus")}</span>
              <div className="flex gap-1.5">
                <select
                  value={statusAvail}
                  onChange={(e) => setStatusAvail(e.target.value)}
                  className="bg-[#050b14] border border-border/80 rounded px-1 py-1 text-[10px] text-text outline-none focus:border-gold cursor-pointer"
                >
                  <option value="online">{t("chat.online")}</option>
                  <option value="away">{t("chat.away")}</option>
                  <option value="offline">{t("chat.invisible")}</option>
                </select>
                <input
                  type="text"
                  placeholder={t("chat.moodPlaceholder")}
                  value={statusMsg}
                  onChange={(e) => setStatusMsg(e.target.value)}
                  className="flex-1 bg-[#050b14] border border-border/80 rounded px-2 py-1 text-[10px] text-text outline-none focus:border-gold placeholder:text-muted/50"
                  onKeyDown={(e) => e.key === "Enter" && savePresence()}
                />
                <button
                  onClick={savePresence}
                  className="bg-gold hover:bg-gold-bright text-black text-[9.5px] font-bold px-2 rounded transition-colors"
                >
                  Valider
                </button>
              </div>
            </div>
          )}
          {friends.length === 0 ? (
            <div className="text-center text-muted text-[11px] pt-14 px-4">
              {t("chat.empty")}<br />
              <span className="text-[9px] italic mt-1 block">{t("chat.hint")}</span>
            </div>
          ) : (
            <div className="flex flex-col">
              {sortedFriends.map((f) => {
                const isOnline = f.availability !== "offline";
                const isGame = f.lol?.gameStatus === "inGame";
                return (
                  <button
                    key={f.id}
                    onClick={() => setSelectedFriend(f)}
                    className="w-full px-4 py-3 border-b border-border/10 hover:bg-[#0c1628]/45 flex items-center justify-between text-left transition-colors"
                  >
                    <div className="min-w-0 flex items-center gap-2">
                      <span className={cn(
                        "h-2 w-2 rounded-full shrink-0",
                        f.availability === "chat" ? "bg-green" : f.availability === "offline" ? "bg-muted" : "bg-gold"
                      )} />
                      <div className="min-w-0">
                        <span className="block text-[11px] font-bold text-text truncate">{formatFriendName(f)}</span>
                        {f.statusMessage && (
                          <span className="block text-[9.5px] text-muted truncate italic leading-tight mt-0.5">{f.statusMessage}</span>
                        )}
                      </div>
                    </div>
                    {isOnline && (
                      <div className="flex items-center gap-1.5 shrink-0">
                        {isGame && f.puuid && (
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              try {
                                const res = await api.spectateFriend(f.puuid!);
                                if (res.ok) {
                                  toast.success(t("chat.spectateStarted", { name: formatFriendName(f) }));
                                } else {
                                  toast.error(t("chat.spectateFailed"));
                                }
                              } catch {
                                toast.error(t("chat.lcuRequired"));
                              }
                            }}
                            className="bg-gold-dim/10 border border-gold-dim/30 hover:bg-gold-dim hover:text-black text-gold rounded p-1 transition-all cursor-pointer flex items-center justify-center"
                            title={t("chat.spectate")}
                          >
                            <Eye className="h-3 w-3" />
                          </button>
                        )}
                        <span className={cn(
                          "text-[8px] font-extrabold px-1.5 py-0.5 rounded border uppercase",
                          isGame 
                            ? "bg-red/10 border-red/30 text-red animate-pulse" 
                            : "bg-green/10 border-green/30 text-green"
                        )}>
                          {isGame ? "En jeu" : "En Ligne"}
                        </span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
