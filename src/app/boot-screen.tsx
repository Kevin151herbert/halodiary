// The HaloDiary boot screen: painted with the very first HTML on a full load or reload, then faded out
// once the page has loaded. Client-side navigation never shows it again, because the root layout stays mounted.
const HIDE = `(function(){var t0=Date.now(),d=document.documentElement,done=false;function go(){if(done)return;done=true;setTimeout(function(){d.setAttribute("data-booted","")},Math.max(0,450-(Date.now()-t0)))}if(document.readyState==="complete")go();else window.addEventListener("load",go);setTimeout(go,6000)})();`;

export function BootScreen() {
  return (
    <>
      <div id="boot" aria-hidden>
        <div className="boot-mark">
          <svg width="76" height="76" viewBox="0 0 26 26" className="boot-ring">
            <circle cx="13" cy="13" r="10" fill="none" stroke="#dfe3ea" strokeWidth="3.2" />
            <circle cx="13" cy="13" r="10" fill="none" stroke="#f2b83a" strokeWidth="3.2" strokeLinecap="round" className="boot-arc" transform="rotate(-90 13 13)" />
          </svg>
          <p className="boot-word">HaloDiary</p>
          <p className="boot-tag">Book it once. We handle the rest.</p>
        </div>
      </div>
      <script dangerouslySetInnerHTML={{ __html: HIDE }} />
    </>
  );
}
