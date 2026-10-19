/* The sign-in form: email, then the 6-digit code from the email, then
   signed in. Shared by the app's account sheet (js/account.js) and
   admin.html (js/admin.js), so the two can't drift apart. It talks to
   Supabase only through js/auth.js and needs nothing from app.js.

   signInForm(root, {id, onSignedIn}) fills `root`. `id` keeps label/input
   ids unique if two forms ever share a page. */

const SIGNIN_RESEND_S = 60;   // Supabase's default per-address wait between emails

function signInForm(root, opts){
  opts = opts || {};
  const id = opts.id || "si";
  root.innerHTML = `
    <form class="si-step si-email" novalidate>
      <label for="${id}-email">Email</label>
      <input id="${id}-email" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" maxlength="200" placeholder="you@example.com" required>
      <button type="submit" class="si-go">Send code</button>
    </form>
    <form class="si-step si-code" novalidate hidden>
      <p class="si-sent">We sent a 6-digit code to <b class="si-to"></b>. It can take a minute to arrive; check spam too.</p>
      <label for="${id}-code">Code</label>
      <input id="${id}-code" class="si-codein" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="one-time-code" maxlength="6" required>
      <button type="submit" class="si-go">Verify</button>
      <div class="si-links"><button type="button" class="si-other">Use a different email</button><button type="button" class="si-resend">Resend code</button></div>
    </form>
    <p class="si-msg" role="status" aria-live="polite"></p>`;
  const q = s => root.querySelector(s);
  const emailForm = q(".si-email"), codeForm = q(".si-code"), msg = q(".si-msg");
  const emailIn = q(".si-email input"), codeIn = q(".si-codein"), resendBtn = q(".si-resend");
  let email = "", busy = false, timer = null;

  function say(text, ok){ msg.textContent = text || ""; msg.classList.toggle("ok", !!ok); }
  function showEmail(){
    codeForm.hidden = true; emailForm.hidden = false; clearTimeout(timer);
  }
  function showCode(e){
    email = e; q(".si-to").textContent = e;
    emailForm.hidden = true; codeForm.hidden = false;
    tick();
  }
  // The Resend countdown. Stops by itself once this form is gone from the page.
  function tick(){
    clearTimeout(timer);
    if(!resendBtn.isConnected || codeForm.hidden) return;
    const p = Auth.pendingGet(), left = p ? Math.ceil((p.next - Date.now())/1000) : 0;
    if(busy) return;
    resendBtn.disabled = left > 0;
    resendBtn.textContent = left > 0 ? `Resend code (${left} s)` : "Resend code";
    if(left > 0) timer = setTimeout(tick, 1000);
  }
  async function sendTo(addr, btn){
    busy = true; btn.disabled = true;
    const label = btn.textContent; btn.textContent = "Sending…"; say("");
    try{
      await Auth.sendCode(addr);
      Auth.pendingSet(addr, SIGNIN_RESEND_S);
      const again = btn === resendBtn;
      busy = false; showCode(addr.trim().toLowerCase());
      codeIn.value = "";
      say(again ? "New code sent. Use the newest email; the earlier code no longer works." : "", true);
      try{ codeIn.focus({preventScroll:true}); }catch(e){}
    }catch(err){
      busy = false;
      if(err.kind === "rate" && err.wait){
        // Too soon after an earlier code to this address: that code still
        // works, so go to the code step and count down to Resend.
        Auth.pendingSet(addr, err.wait); showCode(addr.trim().toLowerCase());
        say("A code went to this address in the last minute. Use that one, or resend when the timer runs out.");
      } else say(err.message);
    }finally{
      busy = false;
      if(btn === resendBtn) tick(); else { btn.disabled = false; btn.textContent = label; }
    }
  }

  emailForm.addEventListener("submit", e => {
    e.preventDefault(); if(busy) return;
    const v = emailIn.value.trim();
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)){ say("That email address doesn't look right."); return; }
    sendTo(v, q(".si-email .si-go"));
  });
  codeForm.addEventListener("submit", async e => {
    e.preventDefault(); if(busy) return;
    const c = codeIn.value.replace(/\D/g, "");
    if(c.length !== 6){ say("Enter the 6-digit code from the email."); return; }
    const btn = q(".si-code .si-go");
    busy = true; btn.disabled = true; btn.textContent = "Checking…"; say("");
    try{
      await Auth.verify(email, c);
      busy = false;
      if(typeof Metrics !== "undefined") Metrics.track("signin");   // the app's form only: admin.html loads no metrics.js
      if(opts.onSignedIn) opts.onSignedIn();
    }catch(err){
      busy = false; say(err.message);
      try{ codeIn.select(); }catch(_){}
    }finally{
      busy = false;
      if(btn.isConnected){ btn.disabled = false; btn.textContent = "Verify"; tick(); }
    }
  });
  // Digits only, and verify as soon as six are in: iOS can fill the code
  // straight from the email, so the thumb never has to find the button.
  codeIn.addEventListener("input", () => {
    const c = codeIn.value.replace(/\D/g, "").slice(0, 6);
    if(c !== codeIn.value) codeIn.value = c;
    if(c.length === 6 && !busy) codeForm.requestSubmit ? codeForm.requestSubmit() : codeForm.dispatchEvent(new Event("submit", {cancelable:true}));
  });
  q(".si-other").addEventListener("click", () => {
    Auth.pendingClear(); say(""); showEmail();
    emailIn.value = email;
    try{ emailIn.focus({preventScroll:true}); emailIn.select(); }catch(e){}
  });
  resendBtn.addEventListener("click", () => { if(!busy) sendTo(email, resendBtn); });

  // Back where we were if a code is still outstanding (see Auth.pendingGet).
  const p = Auth.pendingGet();
  if(p) showCode(p.email);
}
