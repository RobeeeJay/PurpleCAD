import { useEffect, useRef } from "react";
import "../styles/TooltipLayer.css";

// App-drawn tooltips for every [title] element.  Electron/macOS native title
// tooltips are unreliable (they show for some toolbar buttons and silently
// never appear for others), so hovering any titled element renders our own
// pill after a short dwell.  The title attribute is left UNTOUCHED: parking
// it in data-* while hovered broke every title-based query (tests, a11y)
// whenever the pointer happened to rest on an element.  Where the platform's
// native tooltip does work the two briefly coexist — cosmetic, and far
// better than tooltips that never appear.
const DWELL_MS = 450;

const TooltipLayer = () => {
  const tipRef = useRef(null);

  useEffect(() => {
    const tip = tipRef.current;
    let timer = null;
    let current = null; // element whose title is parked

    const hide = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      tip.classList.remove("visible");
      current = null;
    };

    const show = (el) => {
      const text = el.getAttribute("title") || el.dataset.tooltip;
      if (!text || !el.isConnected) return;
      tip.textContent = text;
      const r = el.getBoundingClientRect();
      tip.style.left = "0px";
      tip.style.top = "0px";
      tip.classList.add("visible");
      // Measure after content set, then clamp to the viewport.
      const tw = tip.offsetWidth;
      const th = tip.offsetHeight;
      let x = r.left + r.width / 2 - tw / 2;
      let y = r.bottom + 8;
      x = Math.max(4, Math.min(x, window.innerWidth - tw - 4));
      if (y + th > window.innerHeight - 4) y = r.top - th - 8;
      tip.style.left = `${Math.round(x)}px`;
      tip.style.top = `${Math.round(y)}px`;
    };

    const onOver = (e) => {
      const el = e.target?.closest?.("[title], [data-tooltip]");
      if (!el) return;
      if (el === current) return;
      hide();
      if (!el.getAttribute("title")?.trim() && !el.dataset.tooltip?.trim())
        return;
      current = el;
      timer = setTimeout(() => show(el), DWELL_MS);
    };

    const onOut = (e) => {
      if (!current) return;
      if (current.contains(e.relatedTarget)) return;
      hide();
    };

    document.addEventListener("mouseover", onOver, true);
    document.addEventListener("mouseout", onOut, true);
    document.addEventListener("mousedown", hide, true);
    document.addEventListener("wheel", hide, {
      capture: true,
      passive: true,
    });
    return () => {
      hide();
      document.removeEventListener("mouseover", onOver, true);
      document.removeEventListener("mouseout", onOut, true);
      document.removeEventListener("mousedown", hide, true);
      document.removeEventListener("wheel", hide, { capture: true });
    };
  }, []);

  return <div ref={tipRef} className="app-tooltip" role="tooltip" />;
};

export default TooltipLayer;
