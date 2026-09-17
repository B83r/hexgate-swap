// Module pointeur partagé : UN seul listener `mousemove` sur window pour toute
// l'app. Avant, Background (parallax) et Particles (repel) ajoutaient chacun leur
// propre listener global — même flux d'événements écouté 2×. Ici on multiplexe :
// un unique addEventListener tant qu'au moins un abonné existe, retiré quand le
// dernier se désabonne. Chaque abonné reçoit les coordonnées clientX/clientY
// brutes et fait sa propre conversion (fenêtre vs rect du canvas).

type PointerCb = (clientX: number, clientY: number) => void;

const subscribers = new Set<PointerCb>();
let listening = false;

function handleMove(e: MouseEvent) {
  for (const cb of subscribers) cb(e.clientX, e.clientY);
}

export function subscribePointer(cb: PointerCb): () => void {
  subscribers.add(cb);
  if (!listening) {
    window.addEventListener("mousemove", handleMove);
    listening = true;
  }
  return () => {
    subscribers.delete(cb);
    if (subscribers.size === 0 && listening) {
      window.removeEventListener("mousemove", handleMove);
      listening = false;
    }
  };
}
