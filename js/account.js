/* Account sheet — the person button in the header. Sign in with an email
   code, set a display name, sign out, delete the account. Loads after
   app.js, auth.js and signin.js.

   Signing in changes nothing else in the app: the Field Book stays on this
   phone, and rivers, floats, lake trips and reports work the same signed in
   or out. Accounts are here for what comes next (IDEAS.md, Server roadmap).
   Nothing is fetched until the sheet is opened while signed in.

   The sheet also holds the "Share usage stats" switch (js/metrics.js),
   signed in or out. */

(function(){
  if(typeof Auth === "undefined" || typeof signInForm === "undefined") return;
  const btn = document.getElementById("btn-account"), sheet = document.getElementById("account"),
        body = document.getElementById("account-body");
  if(!btn || !sheet || !body || !Auth.on()) return;      // the button stays hidden
  const esc = s => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  let flash = "";          // one line for the next render: "Signed out", "Your account is deleted"…
  let loadSeq = 0;         // a profile answer for an older render is dropped

  btn.hidden = false;
  function paintButton(){
    const s = Auth.session();
    btn.classList.toggle("signed-in", !!s);
    btn.setAttribute("aria-label", s ? "Account (signed in)" : "Account");
    btn.title = s ? "Account · signed in" : "Account";
  }
  paintButton();

  function flashHTML(){ const h = flash ? `<p class="ac-flash" role="status">${esc(flash)}</p>` : ""; flash = ""; return h; }

  /* The usage-stats switch, the same signed in or out. Off clears whatever
     is waiting to be sent (Metrics.setOff). */
  const hasStats = () => typeof Metrics !== "undefined";
  function statsHTML(){
    if(!hasStats()) return "";
    return `<div class="ac-stats">
        <label class="ac-switch"><input type="checkbox" id="ac-stats"${Metrics.isOff() ? "" : " checked"}><span>Share usage stats</span></label>
        <p class="rp-note">Which rivers, lakes and regions you open and which features you use, with a random ID for this phone, and your account while you're signed in. Turning it off stops it and deletes anything not yet sent.</p>
      </div>`;
  }
  function wireStats(){
    const t = body.querySelector("#ac-stats");
    if(t) t.addEventListener("change", () => Metrics.setOff(!t.checked));
  }

  function render(){
    paintButton();
    const s = Auth.session();
    loadSeq++;
    if(!s){
      body.innerHTML = flashHTML() +
        `<p class="ac-intro">Signing in is optional. It's only needed for features still to come, like sharing access points, and your Field Book stays on this phone either way.</p>
        <div id="ac-signin"></div>` + statsHTML();
      signInForm(body.querySelector("#ac-signin"), {id:"ac"});   // success arrives through Auth.onChange below
      wireStats();
      return;
    }
    body.innerHTML = flashHTML() + `
      <div class="ac-who"><span class="ac-k">Signed in as</span><b class="ac-email">${esc(s.user.email)}</b>
        <span class="ac-note">Only you can see your email address.</span></div>
      <form class="ac-form" id="ac-name-form" novalidate>
        <label for="ac-name">Display name</label>
        <div class="ac-inline"><input id="ac-name" type="text" maxlength="40" autocomplete="nickname" autocapitalize="words" placeholder="Loading…" disabled><button type="submit" id="ac-name-save" disabled>Save</button></div>
        <p class="rp-note">No one else sees it yet. Later it will show beside things you share.</p>
      </form>
      <p class="ac-msg" id="ac-msg" role="status" aria-live="polite"></p>
      <button type="button" class="ac-btn" id="ac-out">Sign out</button>
      ${statsHTML()}
      <div class="ac-danger">
        <button type="button" class="ac-dangerlink" id="ac-del" aria-expanded="false">Delete my account…</button>
        <div class="ac-confirm" id="ac-del-box" hidden>
          <p><b>Delete your account?</b> This permanently removes your account, your profile (your email address and display name) and the usage stats linked to it from our server. It can't be undone.</p>
          <p>It doesn't touch the Field Book on this phone (favorites, trips, notes and lake tracks all stay), and it doesn't delete issue reports you've already sent.</p>
          <p class="ac-msg" id="ac-del-msg" role="status" aria-live="polite"></p>
          <div class="ac-confirm-btns"><button type="button" class="ac-del-yes" id="ac-del-yes">Delete my account</button><button type="button" id="ac-del-no">Cancel</button></div>
        </div>
      </div>`;
    const q = s => body.querySelector(s);
    wireStats();
    q("#ac-name-form").addEventListener("submit", saveName);
    q("#ac-out").addEventListener("click", () => {
      flash = "Signed out. Your Field Book is still on this phone.";
      if(typeof Metrics !== "undefined") Metrics.track("signout");    // sent at once, while the token is still here
      Auth.signOut();                         // fires onChange, which re-renders
    });
    q("#ac-del").addEventListener("click", () => {
      const box = q("#ac-del-box"); box.hidden = !box.hidden;
      q("#ac-del").setAttribute("aria-expanded", String(!box.hidden));
      if(!box.hidden) box.scrollIntoView({block:"nearest"});
    });
    q("#ac-del-no").addEventListener("click", () => { q("#ac-del-box").hidden = true; q("#ac-del").setAttribute("aria-expanded", "false"); });
    q("#ac-del-yes").addEventListener("click", deleteAccount);
  }

  const say = (text, ok) => { const m = body.querySelector("#ac-msg"); if(m){ m.textContent = text || ""; m.classList.toggle("ok", !!ok); } };

  /* The display name, and a check that the session is still alive on the
     server (getUser): an account deleted or signed out everywhere from
     another phone signs out here rather than failing on Save. */
  async function loadProfile(){
    const s = Auth.session(); if(!s) return;
    const seq = ++loadSeq;
    say("");
    Auth.getUser().then(() => {
      const e = body.querySelector(".ac-email"), now = Auth.session();
      if(seq === loadSeq && e && now) e.textContent = now.user.email;
    }).catch(() => {});                       // a dead session signs out by itself; anything else can wait
    try{
      const rows = await Auth.rest(`profiles?id=eq.${encodeURIComponent(s.user.id)}&select=display_name`);
      if(seq !== loadSeq) return;
      const input = body.querySelector("#ac-name");
      input.value = rows && rows[0] && rows[0].display_name || "";
      input.placeholder = "Not set"; input.disabled = false;
      body.querySelector("#ac-name-save").disabled = false;
    }catch(err){
      if(seq !== loadSeq || err.kind === "gone") return;
      say(`Couldn't load your profile. ${err.message}`);
      const input = body.querySelector("#ac-name"); if(input) input.placeholder = "";
      const m = body.querySelector("#ac-msg");
      if(m){
        const again = document.createElement("button");
        again.type = "button"; again.className = "ac-retry"; again.textContent = "Try again";
        again.addEventListener("click", loadProfile);
        m.append(" ", again);
      }
    }
  }

  async function saveName(e){
    e.preventDefault();
    const s = Auth.session(); if(!s) return;
    const input = body.querySelector("#ac-name"), b = body.querySelector("#ac-name-save");
    if(input.disabled) return;
    // One line, single spaces, trimmed: the database refuses anything else.
    const v = input.value.replace(/\s+/g, " ").trim();
    if(v.length > 40){ say("Display names are 40 characters at most."); return; }
    b.disabled = true; b.textContent = "Saving…"; say("");
    try{
      const rows = await Auth.rest(`profiles?id=eq.${encodeURIComponent(s.user.id)}`,
        {method:"PATCH", body:{display_name:v || null}, prefer:"return=representation"});
      if(!rows || !rows.length){ say("Couldn't save: your profile wasn't found. Sign out, sign back in and try again."); return; }
      input.value = rows[0].display_name || "";
      say(v ? "Saved." : "Display name cleared.", true);
    }catch(err){
      if(err.kind !== "gone") say(`Couldn't save. ${err.message}`);
    }finally{
      if(b.isConnected){ b.disabled = false; b.textContent = "Save"; }
    }
  }

  async function deleteAccount(){
    const yes = body.querySelector("#ac-del-yes"), no = body.querySelector("#ac-del-no"), m = body.querySelector("#ac-del-msg");
    yes.disabled = no.disabled = true; yes.textContent = "Deleting…"; m.textContent = "";
    try{
      if(hasStats()) await Metrics.forgetDevice();   // the server erases this phone's stats; it starts again under a new id
      await Auth.rpc("delete_my_account");
      flash = "Your account is deleted. The Field Book on this phone is untouched.";
      Auth.signOut({remote:false});           // its sessions went with it
    }catch(err){
      if(err.kind === "gone") return;
      m.textContent = `Couldn't delete your account. ${err.message}`;
      yes.disabled = no.disabled = false; yes.textContent = "Delete my account";
    }
  }

  function open(){
    if(typeof closeLegend === "function") closeLegend();
    if(typeof closeReport === "function") closeReport();     // same spot on screen
    render();
    sheet.classList.add("show");
    loadProfile();
  }
  function close(){ sheet.classList.remove("show"); }

  btn.addEventListener("click", () => sheet.classList.contains("show") ? close() : open());
  document.getElementById("account-x").addEventListener("click", close);
  window.addEventListener("keydown", e => { if(e.key === "Escape" && sheet.classList.contains("show")) close(); });
  // Signed in or out here, in another tab, or by a refused refresh.
  Auth.onChange(s => {
    if(!flash) flash = s ? "You're signed in." : "You've been signed out.";
    paintButton();
    if(sheet.classList.contains("show")){ render(); loadProfile(); }
    else flash = "";                          // nothing to say to a closed sheet next time
  });
})();
