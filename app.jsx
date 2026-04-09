const { useState, useEffect, useCallback, useRef } = React;

// ─── API BASE ─────────────────────────────────────────────────────────────────
const API_BASE = "https://countmein-api.dcism.org";

async function apiCall(endpoint, body = {}, sessionId = null) {
  const headers = { "Content-Type": "application/json" };
  if (sessionId) headers["Authorization"] = `Bearer ${sessionId}`;
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method: "POST", headers, body: JSON.stringify(body),
  });
  let data = {};
  try { data = await res.json(); } catch(e) {}
  if (!res.ok) throw new Error(data.message || data.error || `Server error (${res.status})`);
  return data;
}

// ─── CALENDAR API HELPERS ─────────────────────────────────────────────────────
const CAL_BASE = "/calendars.v1.CalendarService";
const calApi = (endpoint, body, sid) => apiCall(`${CAL_BASE}/${endpoint}`, body, sid);

// ─── ICAL HELPERS ─────────────────────────────────────────────────────────────
// Build a minimal iCal string from an array of event objects
function eventsToIcal(events) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//USCCalendar//EN",
  ];
  for (const e of events) {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${e.id}`);
    lines.push(`SUMMARY:${icalEscape(e.title)}`);
    lines.push(`DTSTART:${toIcalDate(e.startTime)}`);
    lines.push(`DTEND:${toIcalDate(e.endTime)}`);
    if (e.location)    lines.push(`LOCATION:${icalEscape(e.location)}`);
    if (e.description) lines.push(`DESCRIPTION:${icalEscape(e.description)}`);
    if (e.isImportant) lines.push("PRIORITY:1");
    lines.push(`CREATED:${toIcalDate(e.createdAt || new Date().toISOString())}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

// Parse iCal bytes (base64 string from API) into event objects
function icalToEvents(icalBase64, calendarId) {
  if (!icalBase64) return [];
  let text = "";
  try {
    text = atob(icalBase64);
  } catch(e) {
    // Maybe it's already a plain string
    text = icalBase64;
  }
  const events = [];
  const vevents = text.split("BEGIN:VEVENT").slice(1);
  for (const block of vevents) {
    const get = (key) => {
      const match = block.match(new RegExp(`${key}[^:]*:([^\r\n]*)`, "i"));
      return match ? icalUnescape(match[1].trim()) : "";
    };
    const uid = get("UID") || uid_gen();
    const summary = get("SUMMARY");
    if (!summary) continue;
    const startRaw = get("DTSTART");
    const endRaw   = get("DTEND");
    events.push({
      id:          uid,
      calendarId,
      title:       summary,
      startTime:   fromIcalDate(startRaw),
      endTime:     fromIcalDate(endRaw),
      location:    get("LOCATION"),
      description: get("DESCRIPTION"),
      isImportant: get("PRIORITY") === "1",
      createdBy:   null,
      createdAt:   fromIcalDate(get("CREATED")) || new Date().toISOString(),
    });
  }
  return events;
}

function toIcalDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function fromIcalDate(s) {
  if (!s) return new Date().toISOString();
  // 20250409T120000Z or 20250409T120000
  const m = s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!m) return new Date().toISOString();
  return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7]||"Z"}`).toISOString();
}

function icalEscape(s)   { return (s||"").replace(/\n/g,"\\n").replace(/,/g,"\\,").replace(/;/g,"\\;"); }
function icalUnescape(s) { return (s||"").replace(/\\n/g,"\n").replace(/\\,/g,",").replace(/\\;/g,";"); }

// Convert events array to base64 iCal (what the API expects in the `ical` field)
function eventsToIcalB64(events) {
  return btoa(unescape(encodeURIComponent(eventsToIcal(events))));
}

// ─── SESSION PERSISTENCE ──────────────────────────────────────────────────────
const SESSION_KEY = "usc_session_id";
function saveSession(sid) { try { localStorage.setItem(SESSION_KEY, sid); } catch(e){} }
function loadSession()    { try { return localStorage.getItem(SESSION_KEY); } catch(e){ return null; } }
function clearSession()   { try { localStorage.removeItem(SESSION_KEY); } catch(e){} }

// ─── LOCAL CACHE (notifications + UI prefs only — not calendar data) ──────────
function userKey(uid, k)    { return `usc_${uid}_${k}`; }
function loadUD(uid, k, fb) { try { const r=localStorage.getItem(userKey(uid,k)); return r?JSON.parse(r):fb; } catch(e){ return fb; } }
function saveUD(uid, k, v)  { try { localStorage.setItem(userKey(uid,k), JSON.stringify(v)); } catch(e){} }

// ─── CAL COLOR/TYPE LOCAL PREFS ───────────────────────────────────────────────
// Colors and types are UI-only (not in API), store per-calendar
function loadCalPrefs(userId)      { return loadUD(userId, "cal_prefs", {}); }
function saveCalPrefs(userId, obj) { saveUD(userId, "cal_prefs", obj); }

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function uid_gen()    { return Math.random().toString(36).slice(2,10); }
function fmtTime(iso) { return new Date(iso).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}); }
function fmtDate(iso) { return new Date(iso).toLocaleDateString("en-PH",{month:"short",day:"numeric",year:"numeric"}); }
function sameDay(a,b) { const da=new Date(a),db=new Date(b); return da.getFullYear()===db.getFullYear()&&da.getMonth()===db.getMonth()&&da.getDate()===db.getDate(); }
function overlaps(e1,e2){ const s1=new Date(e1.startTime),x1=new Date(e1.endTime),s2=new Date(e2.startTime),x2=new Date(e2.endTime); return s1<x2&&s2<x1; }
function isUscEmail(email){ return email.endsWith("@usc.edu.ph"); }
function calTypeLabel(t)   { return {personal:"Personal",org:"Organization",subject:"Subject/Block",shared:"Shared Group"}[t]||"Shared"; }
function calColorClass(t)  { return {personal:"color-personal",org:"color-org",subject:"color-subject",shared:"color-shared"}[t]||"color-shared"; }
function avatarColor(name) { const c=["#6c63ff","#34d399","#fbbf24","#f472b6","#60a5fa","#fb923c"]; let h=0; for(const ch of (name||"?")) h=(h+ch.charCodeAt(0))%c.length; return c[h]; }
function timeAgo(iso)      { const d=Date.now()-new Date(iso).getTime(); if(d<60000) return "just now"; if(d<3600000) return `${Math.floor(d/60000)}m ago`; if(d<86400000) return `${Math.floor(d/3600000)}h ago`; return `${Math.floor(d/86400000)}d ago`; }

const PALETTE = ["#6c63ff","#34d399","#fbbf24","#f472b6","#60a5fa","#fb923c","#f87171","#2dd4bf"];
function pickColor(id) { return PALETTE[Math.abs(id||0) % PALETTE.length]; }

function buildUser(profile, sid) {
  const p = profile.user || profile;
  const email = p.email || "";
  const fullName = [p.first_name, p.middle_name, p.last_name].filter(Boolean).join(" ");
  return {
    id: sid,
    email,
    name: fullName || email,
    first_name:  p.first_name  || "",
    last_name:   p.last_name   || "",
    middle_name: p.middle_name || "",
    userType: isUscEmail(email) ? "usc" : "regular",
  };
}

// ─── CALENDAR LOADING ─────────────────────────────────────────────────────────
// Fetches all calendars (owned + subscribed), their events, and codes
async function fetchAllCalendars(sid, calPrefs) {
  const [ownedRes, subRes] = await Promise.all([
    calApi("GetOwned", {}, sid),
    calApi("GetSubscribed", {}, sid),
  ]);
  const ownedIds = ownedRes.ids || [];
  const subIds   = (subRes.ids || []).filter(id => !ownedIds.includes(id));
  const allIds   = [...ownedIds, ...subIds];

  const calendars = [];
  const events    = [];

  await Promise.all(allIds.map(async (id) => {
    try {
      const calRes = await calApi("Get", { id }, sid);
      const prefs  = calPrefs[id] || {};
      const isOwner = ownedIds.includes(id);

      // Fetch codes for owned calendars
      let codes = [];
      if (isOwner) {
        try {
          const codesRes = await calApi("GetCodes", { id }, sid);
          const codeIds  = codesRes.code_ids || [];
          codes = await Promise.all(codeIds.map(async (cid) => {
            try {
              const meta = await calApi("GetCodeMetadata", { code_id: cid }, sid);
              return { codeId: cid, code: meta.code, expiresAt: meta.expires_at || null };
            } catch(e) { return null; }
          }));
          codes = codes.filter(Boolean);
        } catch(e) {}
      }

      const cal = {
        id,
        name:        calRes.name,
        description: calRes.description || "",
        membersOnly: calRes.members_only || false,
        isOwner,
        color:       prefs.color || pickColor(id),
        type:        prefs.type  || (isOwner ? "personal" : "shared"),
        codes,       // [{codeId, code, expiresAt}]
      };
      calendars.push(cal);

      // Parse events from iCal
      const calEvents = icalToEvents(calRes.ical, id);
      calEvents.forEach(e => { e.calendarId = id; });
      events.push(...calEvents);
    } catch(e) {}
  }));

  return { calendars, events };
}

// ─── APP ──────────────────────────────────────────────────────────────────────
function App() {
  const [currentUser,   setCurrentUser]  = useState(null);
  const [sessionId,     setSessionId]    = useState(null);
  const [authLoading,   setAuthLoading]  = useState(true);
  const [dataLoading,   setDataLoading]  = useState(false);
  const [calendars,     setCalendars]    = useState([]);
  const [events,        setEvents]       = useState([]);
  const [notifications, setNotifsRaw]    = useState([]);
  const [page,          setPage]         = useState("dashboard");
  const [modal,         setModal]        = useState(null);
  const [toast,         setToast]        = useState(null);
  const [sidebarOpen,   setSidebarOpen]  = useState(false);

  const setNotifications = useCallback((u) => setNotifsRaw(p => {
    const n = typeof u === "function" ? u(p) : u;
    if (currentUser) saveUD(currentUser.id, "notifs", n);
    return n;
  }), [currentUser]);

  const showToast  = useCallback((msg, type="success") => { setToast({msg,type}); setTimeout(()=>setToast(null),3500); }, []);
  const closeModal = useCallback(() => setModal(null), []);

  const myCalendars     = useCallback(() => calendars, [calendars]);
  const myEvents        = useCallback(() => events,    [events]);
  const detectConflicts = useCallback(() => {
    const r=[]; for(let i=0;i<events.length;i++) for(let j=i+1;j<events.length;j++) if(overlaps(events[i],events[j])) r.push([events[i],events[j]]); return r;
  }, [events]);

  async function loadAllData(sid, userId) {
    setDataLoading(true);
    try {
      const prefs = loadCalPrefs(userId);
      const { calendars: cals, events: evts } = await fetchAllCalendars(sid, prefs);
      setCalendars(cals);
      setEvents(evts);
    } catch(e) {
      showToast("Failed to load calendars.", "error");
    } finally {
      setDataLoading(false);
    }
  }

  // Restore session on boot
  useEffect(() => {
    const saved = loadSession();
    if (!saved) { setAuthLoading(false); return; }
    apiCall("/users.v1.UserService/Get", {}, saved)
      .then(profile => {
        const u = buildUser(profile, saved);
        setCurrentUser(u);
        setSessionId(saved);
        setNotifsRaw(loadUD(saved, "notifs", []));
        loadAllData(saved, saved);
      })
      .catch(() => clearSession())
      .finally(() => setAuthLoading(false));
  }, []);

  const handleLogin = useCallback((user, sid) => {
    saveSession(sid);
    setCurrentUser(user);
    setSessionId(sid);
    setNotifsRaw(loadUD(sid, "notifs", []));
    loadAllData(sid, sid);
  }, []);

  const handleLogout = useCallback(async (revokeAll=false) => {
    if (sessionId) {
      try { await apiCall(revokeAll ? "/users.v1.UserService/RevokeAll" : "/users.v1.UserService/Revoke", {}, sessionId); } catch(e) {}
    }
    clearSession();
    setCurrentUser(null); setSessionId(null);
    setCalendars([]); setEvents([]); setNotifsRaw([]);
    setPage("dashboard");
  }, [sessionId]);

  const refreshCalendars = useCallback(() => {
    if (sessionId && currentUser) loadAllData(sessionId, currentUser.id);
  }, [sessionId, currentUser]);

  const navigateTo = (p) => { setPage(p); setSidebarOpen(false); };

  if (authLoading) return <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:"var(--bg)",color:"var(--text2)",fontFamily:"DM Sans,sans-serif",fontSize:14}}>Loading…</div>;
  if (!currentUser) return <AuthPage onLogin={handleLogin} />;

  const unreadCount = notifications.filter(n=>!n.isRead).length;
  const conflicts   = detectConflicts();

  const ctx = {
    currentUser, setCurrentUser, sessionId,
    calendars, setCalendars, events, setEvents,
    notifications, setNotifications,
    myCalendars, myEvents, conflicts,
    modal, setModal, closeModal, showToast,
    handleLogout, unreadCount,
    refreshCalendars, dataLoading,
    loadCalPrefs: () => loadCalPrefs(currentUser.id),
    saveCalPrefs: (obj) => saveCalPrefs(currentUser.id, obj),
  };

  return (
    <div className="app">
      <Toast toast={toast} />
      <div className={`sidebar-backdrop${sidebarOpen?" open":""}`} onClick={()=>setSidebarOpen(false)} />
      <Sidebar page={page} setPage={navigateTo} ctx={ctx} isOpen={sidebarOpen} />
      <div className="main">
        <Topbar page={page} ctx={ctx} setPage={navigateTo} onMenuClick={()=>setSidebarOpen(true)} />
        <div className="content">
          {page==="dashboard"      && <Dashboard         ctx={ctx} setPage={navigateTo} />}
          {page==="calendar"       && <CalendarPage      ctx={ctx} />}
          {page==="calendars"      && <CalendarsPage     ctx={ctx} />}
          {page==="events"         && <EventsPage        ctx={ctx} />}
          {page==="notifications"  && <NotificationsPage ctx={ctx} />}
          {page==="insights"       && <InsightsPage      ctx={ctx} />}
          {page==="settings"       && <SettingsPage      ctx={ctx} />}
        </div>
        <BottomNav page={page} setPage={navigateTo} unreadCount={unreadCount} conflicts={conflicts} />
      </div>
      {modal && <ModalRouter modal={modal} ctx={ctx} />}
    </div>
  );
}

// ─── BOTTOM NAV ───────────────────────────────────────────────────────────────
function BottomNav({ page, setPage, unreadCount, conflicts }) {
  const items = [
    {id:"dashboard",    icon:"⊞",  label:"Home"},
    {id:"calendar",     icon:"📅", label:"Calendar"},
    {id:"events",       icon:"🗓",  label:"Events"},
    {id:"notifications",icon:"🔔", label:"Alerts",   badge:unreadCount},
    {id:"insights",     icon:"✨", label:"Insights", badge:conflicts.length||null},
  ];
  return (
    <div className="bottom-nav">
      {items.map(item=>(
        <div key={item.id} className={`bottom-nav-item${page===item.id?" active":""}`} onClick={()=>setPage(item.id)}>
          <span className="bnav-icon">{item.icon}</span>
          <span>{item.label}</span>
          {item.badge ? <span className="bottom-nav-badge">{item.badge}</span> : null}
        </div>
      ))}
    </div>
  );
}

// ─── TOAST ────────────────────────────────────────────────────────────────────
function Toast({ toast }) {
  if (!toast) return null;
  const bg=toast.type==="error"?"rgba(248,113,113,0.15)":"rgba(52,211,153,0.15)";
  const border=toast.type==="error"?"rgba(248,113,113,0.4)":"rgba(52,211,153,0.4)";
  const color=toast.type==="error"?"#f87171":"#34d399";
  return <div style={{position:"fixed",bottom:80,right:16,zIndex:999,background:bg,border:`1px solid ${border}`,color,borderRadius:12,padding:"13px 20px",fontSize:14,fontWeight:600,boxShadow:"0 8px 32px rgba(0,0,0,0.4)",maxWidth:300,fontFamily:"DM Sans,sans-serif"}}>{toast.msg}</div>;
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────
function AuthPage({ onLogin }) {
  const [email,setEmail]          = useState("");
  const [password,setPassword]    = useState("");
  const [firstName,setFirstName]  = useState("");
  const [lastName,setLastName]    = useState("");
  const [middleName,setMiddleName]= useState("");
  const [error,setError]          = useState("");
  const [loading,setLoading]      = useState(false);
  const [activeTab,setActiveTab]  = useState("login");

  async function handleLogin() {
    if (!email||!password) { setError("Email and password are required."); return; }
    setError(""); setLoading(true);
    try {
      const r = await apiCall("/users.v1.UserService/Login", {email, password});
      const sid = r.session_id;
      if (!sid) throw new Error("No session returned.");
      const user = buildUser(r, sid);
      const finalUser = user.email ? user : { ...user, email, name: email, userType: isUscEmail(email)?"usc":"regular" };
      onLogin(finalUser, sid);
    } catch(e) { setError(e.message || "Login failed. Check your credentials."); }
    finally { setLoading(false); }
  }

  async function handleRegister() {
    if (!firstName||!lastName||!email||!password) { setError("All fields are required."); return; }
    setError(""); setLoading(true);
    try {
      const body = {email, password, first_name:firstName, last_name:lastName};
      if (middleName) body.middle_name = middleName;
      const r = await apiCall("/users.v1.UserService/Create", body);
      const sid = r.session_id;
      if (!sid) throw new Error("Registration failed.");
      const user = buildUser(r, sid);
      const finalUser = user.email ? user : {
        id:sid, email, name:[firstName,middleName,lastName].filter(Boolean).join(" ")||email,
        first_name:firstName, last_name:lastName, middle_name:middleName,
        userType: isUscEmail(email)?"usc":"regular"
      };
      onLogin(finalUser, sid);
    } catch(e) { setError(e.message || "Registration failed. That email may already be in use."); }
    finally { setLoading(false); }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-bg" />
      <div className="auth-card">
        <div className="auth-logo">USC<span>Calendar</span></div>
        <div className="auth-sub">Your unified scheduling platform</div>
        <div className="auth-tabs">
          <button className={`auth-tab${activeTab==="login"?" active":""}`}    onClick={()=>{setActiveTab("login");setError("");}}>Sign In</button>
          <button className={`auth-tab${activeTab==="register"?" active":""}`} onClick={()=>{setActiveTab("register");setError("");}}>Register</button>
        </div>
        {error && <div className="error-msg">{error}</div>}
        {activeTab==="register" && (<>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <div className="form-group"><label className="form-label">First Name *</label><input className="form-input" value={firstName} onChange={e=>setFirstName(e.target.value)} placeholder="Juan" /></div>
            <div className="form-group"><label className="form-label">Last Name *</label><input className="form-input" value={lastName} onChange={e=>setLastName(e.target.value)} placeholder="dela Cruz" /></div>
          </div>
          <div className="form-group"><label className="form-label">Middle Name <span style={{color:"var(--text3)",fontWeight:400}}>(optional)</span></label><input className="form-input" value={middleName} onChange={e=>setMiddleName(e.target.value)} placeholder="Santos" /></div>
        </>)}
        <div className="form-group"><label className="form-label">Email Address</label><input className="form-input" type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" /></div>
        <div className="form-group"><label className="form-label">Password</label><input className="form-input" type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••" onKeyDown={e=>e.key==="Enter"&&(activeTab==="login"?handleLogin():handleRegister())} /></div>
        {activeTab==="login"
          ? <button className="btn btn-primary" onClick={handleLogin} disabled={loading}>{loading?"Signing in…":"Sign In →"}</button>
          : <button className="btn btn-primary" onClick={handleRegister} disabled={loading}>{loading?"Creating account…":"Create Account →"}</button>}
      </div>
    </div>
  );
}

// ─── SIDEBAR ──────────────────────────────────────────────────────────────────
function Sidebar({ page, setPage, ctx, isOpen }) {
  const { currentUser, unreadCount, conflicts, handleLogout, myCalendars } = ctx;
  const ac = avatarColor(currentUser.name);
  const navItems = [
    {id:"dashboard",     icon:"⊞",  label:"Dashboard"},
    {id:"calendar",      icon:"📅", label:"Calendar View"},
    {id:"events",        icon:"🗓",  label:"My Events"},
    {id:"calendars",     icon:"📚", label:"My Calendars"},
    {id:"notifications", icon:"🔔", label:"Notifications", count:unreadCount},
    {id:"insights",      icon:"✨", label:"Insights",       count:conflicts.length||null},
    {id:"settings",      icon:"⚙️", label:"Settings"},
  ];
  return (
    <div className={`sidebar${isOpen?" open":""}`}>
      <div className="sidebar-logo">USC<span>Cal</span></div>
      <div className="sidebar-user">
        <div className="user-avatar" style={{background:ac}}>{currentUser.name.split(" ").map(w=>w[0]).join("").slice(0,2)}</div>
        <div className="user-info">
          <div className="user-name">{currentUser.name}</div>
          <div className="user-badge">{currentUser.userType==="usc"?"USC User":"Regular"}</div>
        </div>
      </div>
      <div className="sidebar-nav">
        <div className="nav-section">
          {navItems.map(item=>(
            <div key={item.id} className={`nav-item${page===item.id?" active":""}`} onClick={()=>setPage(item.id)}>
              <span style={{fontSize:16}}>{item.icon}</span>
              <span style={{flex:1}}>{item.label}</span>
              {item.count ? <span className="nav-count">{item.count}</span> : null}
            </div>
          ))}
        </div>
        <div className="nav-section">
          <div className="nav-section-title">My Calendars</div>
          {myCalendars().slice(0,6).map(c=>(
            <div key={c.id} className="nav-item" onClick={()=>setPage("calendars")}>
              <span className="nav-dot" style={{background:c.color}} />
              <span style={{fontSize:13,flex:1,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{c.name}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="sidebar-footer">
        <button className="btn btn-ghost btn-sm w-full" onClick={()=>handleLogout()}>← Sign Out</button>
      </div>
    </div>
  );
}

// ─── TOPBAR ───────────────────────────────────────────────────────────────────
function Topbar({ page, ctx, setPage, onMenuClick }) {
  const titles = {dashboard:"Dashboard",calendar:"Calendar View",events:"My Events",calendars:"My Calendars",notifications:"Notifications",insights:"Insights",settings:"Settings"};
  const { setModal, unreadCount, conflicts, dataLoading, refreshCalendars } = ctx;
  return (
    <div className="topbar">
      <button className="hamburger" onClick={onMenuClick}>☰</button>
      <div className="topbar-title font-head">{titles[page]||page}</div>
      {conflicts.length>0 && <div className="chip chip-yellow" style={{cursor:"pointer",fontSize:11}} onClick={()=>setPage("insights")}>⚠️ {conflicts.length}</div>}
      <button className="btn-icon" title="Refresh" onClick={refreshCalendars} style={{fontSize:13}}>{dataLoading?"⟳":"↻"}</button>
      <button className="btn-icon" style={{position:"relative"}} onClick={()=>setPage("notifications")}>
        🔔
        {unreadCount>0 && <span style={{position:"absolute",top:-4,right:-4,background:"#f87171",color:"#fff",borderRadius:"50%",width:16,height:16,fontSize:10,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700}}>{unreadCount}</span>}
      </button>
      <button className="btn btn-primary btn-sm" onClick={()=>setModal({type:"create-event"})}>+ Event</button>
    </div>
  );
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
function Dashboard({ ctx, setPage }) {
  const { currentUser, myCalendars, myEvents, conflicts, setModal, notifications } = ctx;
  const today    = new Date();
  const todayEvts= myEvents().filter(e=>sameDay(e.startTime,today.toISOString())).sort((a,b)=>new Date(a.startTime)-new Date(b.startTime));
  const upcoming = myEvents().filter(e=>new Date(e.startTime)>today).sort((a,b)=>new Date(a.startTime)-new Date(b.startTime)).slice(0,5);
  const cals     = myCalendars();
  const unread   = notifications.filter(n=>!n.isRead);
  return (
    <div>
      <div style={{marginBottom:20}}>
        <div style={{fontFamily:"Syne,sans-serif",fontSize:22,fontWeight:800,marginBottom:4}}>Good {today.getHours()<12?"morning":today.getHours()<17?"afternoon":"evening"}, {currentUser.name.split(" ")[0]}! 👋</div>
        <div style={{color:"var(--text2)",fontSize:13}}>{today.toLocaleDateString("en-PH",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}</div>
      </div>
      <div className="stats-grid" style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14,marginBottom:20}}>
        {[
          {label:"Calendars",value:cals.length,      icon:"📚",color:"var(--accent2)"},
          {label:"Today",    value:todayEvts.length, icon:"📅",color:"var(--green)"},
          {label:"Conflicts",value:conflicts.length, icon:"⚠️",color:conflicts.length?"var(--yellow)":"var(--text3)"},
          {label:"Unread",   value:unread.length,    icon:"🔔",color:unread.length?"var(--red)":"var(--text3)"},
        ].map(s=>(
          <div key={s.label} className="card" style={{cursor:"default",padding:"14px"}}>
            <div style={{fontSize:20,marginBottom:4}}>{s.icon}</div>
            <div style={{fontFamily:"Syne,sans-serif",fontSize:24,fontWeight:800,color:s.color,marginBottom:2}}>{s.value}</div>
            <div style={{fontSize:11,color:"var(--text3)",fontWeight:600,textTransform:"uppercase",letterSpacing:".6px"}}>{s.label}</div>
          </div>
        ))}
      </div>
      <div className="dash-panels" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <div style={{fontFamily:"Syne,sans-serif",fontWeight:700,fontSize:15}}>Today's Schedule</div>
            <button className="btn btn-ghost btn-sm" onClick={()=>setPage("calendar")}>View Cal</button>
          </div>
          {todayEvts.length===0?<div className="empty-state" style={{padding:"24px 10px"}}><div className="empty-icon" style={{fontSize:32}}>✨</div><div style={{fontSize:13,color:"var(--text3)"}}>No events today!</div></div>:todayEvts.map(e=><EventListItem key={e.id} event={e} ctx={ctx} />)}
          <div className="divider" />
          <button className="btn btn-ghost btn-sm w-full" onClick={()=>setModal({type:"create-event"})}>+ Add Event</button>
        </div>
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <div style={{fontFamily:"Syne,sans-serif",fontWeight:700,fontSize:15}}>Upcoming Events</div>
            <button className="btn btn-ghost btn-sm" onClick={()=>setPage("events")}>See All</button>
          </div>
          {upcoming.length===0?<div style={{fontSize:13,color:"var(--text3)",padding:"20px 0",textAlign:"center"}}>No upcoming events</div>:upcoming.map(e=><EventListItem key={e.id} event={e} ctx={ctx} showDate />)}
        </div>
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <div style={{fontFamily:"Syne,sans-serif",fontWeight:700,fontSize:15}}>My Calendars</div>
            <button className="btn btn-ghost btn-sm" onClick={()=>setPage("calendars")}>Manage</button>
          </div>
          {cals.length===0?<div style={{fontSize:13,color:"var(--text3)",padding:"10px 0"}}>No calendars yet.</div>:cals.slice(0,5).map(c=>{
            const cnt=myEvents().filter(e=>e.calendarId===c.id).length;
            return <div key={c.id} className="flex items-center gap-3" style={{padding:"8px 0",borderBottom:"1px solid var(--border)"}}><div style={{width:10,height:10,borderRadius:"50%",background:c.color,flexShrink:0}} /><div style={{flex:1,fontSize:13,fontWeight:500}}>{c.name}</div><div style={{fontSize:12,color:"var(--text3)"}}>{cnt}</div></div>;
          })}
        </div>
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <div style={{fontFamily:"Syne,sans-serif",fontWeight:700,fontSize:15}}>Recent Alerts</div>
            <button className="btn btn-ghost btn-sm" onClick={()=>setPage("notifications")}>All</button>
          </div>
          {unread.length===0?<div style={{fontSize:13,color:"var(--text3)",padding:"20px 0",textAlign:"center"}}>All caught up! 🎉</div>:unread.slice(0,3).map(n=>(
            <div key={n.id} className="notif-item unread" onClick={()=>setPage("notifications")}>
              <div className="notif-icon" style={{background:"rgba(108,99,255,0.15)",fontSize:14}}>{n.type==="conflict"?"⚠️":n.type==="change"?"📝":"🔔"}</div>
              <div className="notif-text"><div className="notif-msg" style={{fontSize:12}}>{n.message}</div><div className="notif-time">{timeAgo(n.createdAt)}</div></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── CALENDAR PAGE (grid view) ────────────────────────────────────────────────
function CalendarPage({ ctx }) {
  const { myEvents, myCalendars, setModal } = ctx;
  const [viewDate,setViewDate]         = useState(new Date());
  const [selectedCals,setSelectedCals] = useState(null);
  const cals        = myCalendars();
  const visibleCals = selectedCals || cals.map(c=>c.id);
  const year=viewDate.getFullYear(), month=viewDate.getMonth();
  const firstDay=new Date(year,month,1).getDay(), daysInMonth=new Date(year,month+1,0).getDate();
  const cells=[];
  for(let i=0;i<firstDay;i++) cells.push({date:new Date(year,month,-firstDay+i+1),isOtherMonth:true});
  for(let d=1;d<=daysInMonth;d++) cells.push({date:new Date(year,month,d),isOtherMonth:false});
  while(cells.length%7!==0) cells.push({date:new Date(year,month+1,cells.length-daysInMonth-firstDay+1),isOtherMonth:true});
  const allEvts=myEvents().filter(e=>visibleCals.includes(e.calendarId));
  const today=new Date();
  const monthNames=["January","February","March","April","May","June","July","August","September","October","November","December"];
  return (
    <div>
      <div className="cal-filter" style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:14}}>
        {cals.map(c=>{const active=visibleCals.includes(c.id); return(<div key={c.id} onClick={()=>{if(selectedCals===null){setSelectedCals(cals.map(x=>x.id).filter(id=>id!==c.id));}else if(active){setSelectedCals(selectedCals.filter(id=>id!==c.id));}else{setSelectedCals([...selectedCals,c.id]);}}} style={{display:"flex",alignItems:"center",gap:5,padding:"4px 10px",borderRadius:20,background:active?"rgba(255,255,255,0.06)":"transparent",border:`1.5px solid ${active?c.color:"var(--border)"}`,cursor:"pointer",flexShrink:0}}><span style={{width:7,height:7,borderRadius:"50%",background:active?c.color:"var(--text3)"}} /><span style={{fontSize:11,fontWeight:500,color:active?"var(--text)":"var(--text3)"}}>{c.name.split(" ")[0]}</span></div>);})}
        {selectedCals&&<button className="btn-icon btn-sm" onClick={()=>setSelectedCals(null)} style={{fontSize:11,padding:"4px 8px"}}>Reset</button>}
      </div>
      <div className="cal-header">
        <button className="btn-icon" onClick={()=>setViewDate(new Date(year,month-1,1))}>←</button>
        <button className="btn-icon" onClick={()=>setViewDate(new Date(year,month+1,1))}>→</button>
        <div className="cal-month">{monthNames[month]} {year}</div>
        <button className="btn btn-ghost btn-sm" onClick={()=>setViewDate(new Date())}>Today</button>
        <div style={{flex:1}} />
        <button className="btn btn-primary btn-sm" onClick={()=>setModal({type:"create-event"})}>+ Event</button>
      </div>
      <div className="cal-grid">
        <div className="cal-days-header">{["Su","Mo","Tu","We","Th","Fr","Sa"].map(d=><div key={d} className="cal-day-name">{d}</div>)}</div>
        <div className="cal-cells">
          {cells.map((cell,i)=>{
            const dayEvts=allEvts.filter(e=>sameDay(e.startTime,cell.date.toISOString())).sort((a,b)=>new Date(a.startTime)-new Date(b.startTime));
            const isToday=sameDay(cell.date.toISOString(),today.toISOString());
            const show=dayEvts.slice(0,2), more=dayEvts.length-2;
            return(
              <div key={i} className={`cal-cell${cell.isOtherMonth?" other-month":""}${isToday?" today":""}`} onClick={()=>setModal({type:"create-event",data:{date:cell.date}})}>
                <div className="cal-date">{cell.date.getDate()}</div>
                {show.map(e=>{const cal=cals.find(c=>c.id===e.calendarId);return(<div key={e.id} className={`cal-event ${calColorClass(cal?.type)}`} style={{borderLeft:`2px solid ${cal?.color||"var(--accent)"}`}} onClick={ev=>{ev.stopPropagation();setModal({type:"event-detail",data:e});}}>{e.isImportant?"⭐ ":""}{e.title}</div>);})}
                {more>0&&<div className="cal-more">+{more}</div>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── CALENDARS PAGE ───────────────────────────────────────────────────────────
function CalendarsPage({ ctx }) {
  const { currentUser, sessionId, myCalendars, myEvents, setModal, setCalendars, setNotifications, showToast, refreshCalendars, dataLoading, loadCalPrefs, saveCalPrefs } = ctx;
  const [tab,setTab]                = useState("all");
  const [joinCode,setJoinCode]      = useState("");
  const [joinError,setJoinError]    = useState("");
  const [joinSuccess,setJoinSuccess]= useState("");
  const [joinLoading,setJoinLoading]= useState(false);
  const cals     = myCalendars();
  const filtered = tab==="all" ? cals : tab==="owned" ? cals.filter(c=>c.isOwner) : cals.filter(c=>!c.isOwner);

  async function handleJoin() {
    setJoinError(""); setJoinSuccess("");
    const code = joinCode.trim();
    if (!code) { setJoinError("Enter a calendar code."); return; }
    setJoinLoading(true);
    try {
      await calApi("Subscribe", { code }, sessionId);
      setJoinSuccess("Joined! Loading calendar…");
      setJoinCode("");
      await refreshCalendars();
      setJoinSuccess("Joined successfully!");
    } catch(e) { setJoinError(e.message || "No calendar found with that code."); }
    finally { setJoinLoading(false); }
  }

  async function handleLeave(cal) {
    if (cal.isOwner) { showToast("You own this. Delete it instead.", "error"); return; }
    try {
      await calApi("Unsubscribe", { id: cal.id }, sessionId);
      showToast(`Left "${cal.name}"`);
      refreshCalendars();
    } catch(e) { showToast(e.message||"Failed to leave calendar.", "error"); }
  }

  async function handleDelete(cal) {
    if (!cal.isOwner) { showToast("You don't own this.", "error"); return; }
    if (!window.confirm(`Delete "${cal.name}"? This cannot be undone.`)) return;
    try {
      await calApi("Delete", { id: cal.id }, sessionId);
      showToast(`Deleted "${cal.name}"`);
      refreshCalendars();
    } catch(e) { showToast(e.message||"Failed to delete.", "error"); }
  }

  return (
    <div className="cals-layout" style={{display:"grid",gridTemplateColumns:"1fr 300px",gap:20}}>
      <div>
        <div className="tabs">
          {[["all","All"],["owned","My Calendars"],["subscribed","Joined"]].map(([t,l])=>(
            <div key={t} className={`tab${tab===t?" active":""}`} onClick={()=>setTab(t)}>{l}</div>
          ))}
        </div>
        {dataLoading && <div style={{textAlign:"center",padding:"30px 0",color:"var(--text3)",fontSize:13}}>Loading calendars…</div>}
        <div className="cards-grid">
          {filtered.map(c=>{
            const evtCount = myEvents().filter(e=>e.calendarId===c.id).length;
            return (
              <div key={c.id} className="cal-card">
                <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:c.color,borderRadius:"14px 14px 0 0"}} />
                <div className="cal-card-name">{c.name}</div>
                <div className="cal-card-type">{c.isOwner ? "Owner" : "Member"} · {c.description||"No description"}</div>
                <div style={{fontSize:13,color:"var(--text2)",marginBottom:10}}>{evtCount} event{evtCount!==1?"s":""}</div>
                {/* Show access codes for owner */}
                {c.isOwner && c.codes && c.codes.length>0 && (
                  <div style={{marginBottom:10}}>
                    {c.codes.map(cd=>(
                      <div key={cd.codeId} className="flex items-center gap-2" style={{marginBottom:4}}>
                        <span style={{fontSize:11,color:"var(--text3)"}}>Code:</span>
                        <span className="code-badge" style={{cursor:"pointer"}} onClick={()=>{navigator.clipboard?.writeText(cd.code);showToast("Code copied!");}}>
                          {cd.code}
                        </span>
                        {cd.expiresAt && <span style={{fontSize:10,color:"var(--text3)"}}>exp. {fmtDate(cd.expiresAt)}</span>}
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex gap-2" style={{flexWrap:"wrap"}}>
                  <button className="btn btn-ghost btn-sm" onClick={()=>setModal({type:"calendar-events",data:c})}>View</button>
                  {c.isOwner && <>
                    <button className="btn btn-ghost btn-sm" onClick={()=>setModal({type:"create-event",data:{calendarId:c.id}})}>+ Event</button>
                    <button className="btn btn-ghost btn-sm" onClick={()=>setModal({type:"manage-calendar",data:c})}>Manage</button>
                    <button className="btn btn-danger btn-sm" onClick={()=>handleDelete(c)}>Delete</button>
                  </>}
                  {!c.isOwner && <button className="btn btn-danger btn-sm" onClick={()=>handleLeave(c)}>Leave</button>}
                </div>
              </div>
            );
          })}
          <div className="cal-card" style={{border:"1.5px dashed var(--border2)",cursor:"pointer",alignItems:"center",display:"flex",flexDirection:"column",justifyContent:"center",minHeight:120}} onClick={()=>setModal({type:"create-calendar"})}>
            <div style={{fontSize:24,marginBottom:6,opacity:.5}}>＋</div>
            <div style={{color:"var(--text3)",fontSize:13,fontWeight:600}}>Create Calendar</div>
          </div>
        </div>
      </div>
      <div>
        <div className="card mb-4">
          <div style={{fontFamily:"Syne,sans-serif",fontWeight:700,fontSize:15,marginBottom:14}}>Join by Code</div>
          {joinError  && <div className="error-msg">{joinError}</div>}
          {joinSuccess && <div className="success-msg">{joinSuccess}</div>}
          <div className="form-group">
            <input className="form-input" value={joinCode} onChange={e=>setJoinCode(e.target.value)} placeholder="Enter calendar code…" style={{fontFamily:"monospace",letterSpacing:2}} onKeyDown={e=>e.key==="Enter"&&handleJoin()} />
          </div>
          <button className="btn btn-primary btn-sm w-full" onClick={handleJoin} disabled={joinLoading}>{joinLoading?"Joining…":"Join Calendar →"}</button>
        </div>
        <div className="card">
          <div style={{fontFamily:"Syne,sans-serif",fontWeight:700,fontSize:15,marginBottom:12}}>Your Codes</div>
          {cals.filter(c=>c.isOwner&&c.codes?.length>0).length===0
            ? <div style={{fontSize:13,color:"var(--text3)"}}>No shareable codes yet. Create a calendar and add a code via Manage.</div>
            : cals.filter(c=>c.isOwner).map(c=>c.codes?.map(cd=>(
                <div key={cd.codeId} className="flex items-center justify-between" style={{padding:"7px 0",borderBottom:"1px solid var(--border)"}}>
                  <div><div style={{fontSize:13,fontWeight:500}}>{c.name}</div><div style={{fontSize:11,color:"var(--text3)"}}>{cd.expiresAt?`Expires ${fmtDate(cd.expiresAt)}`:"No expiry"}</div></div>
                  <span className="code-badge" style={{cursor:"pointer"}} onClick={()=>{navigator.clipboard?.writeText(cd.code);showToast("Copied!");}}>{cd.code}</span>
                </div>
              ))
            )}
        </div>
      </div>
    </div>
  );
}

// ─── EVENTS PAGE ──────────────────────────────────────────────────────────────
function EventsPage({ ctx }) {
  const { myEvents, myCalendars, setModal } = ctx;
  const [search,setSearch]                = useState("");
  const [filterCal,setFilterCal]          = useState("all");
  const [filterImportant,setFilterImportant]=useState(false);
  const cals=myCalendars();
  let evts=myEvents().sort((a,b)=>new Date(a.startTime)-new Date(b.startTime));
  if(search) evts=evts.filter(e=>e.title.toLowerCase().includes(search.toLowerCase())||e.description?.toLowerCase().includes(search.toLowerCase()));
  if(filterCal!=="all") evts=evts.filter(e=>e.calendarId===filterCal);
  if(filterImportant) evts=evts.filter(e=>e.isImportant);
  const now2=new Date(), past=evts.filter(e=>new Date(e.endTime)<now2), upcoming=evts.filter(e=>new Date(e.endTime)>=now2);
  return (
    <div>
      <div className="events-filter" style={{display:"flex",gap:10,marginBottom:20,flexWrap:"wrap"}}>
        <div className="search-wrap" style={{flex:1,minWidth:200}}><span className="search-icon">🔍</span><input className="search-input" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search events…" /></div>
        <select className="select" style={{width:"auto",minWidth:160}} value={filterCal} onChange={e=>setFilterCal(e.target.value)}><option value="all">All Calendars</option>{cals.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <button className={`btn btn-sm ${filterImportant?"btn-primary":"btn-ghost"}`} onClick={()=>setFilterImportant(!filterImportant)}>⭐ Important</button>
        <button className="btn btn-primary btn-sm" onClick={()=>setModal({type:"create-event"})}>+ New</button>
      </div>
      {upcoming.length>0&&<div className="card mb-4"><div style={{fontFamily:"Syne,sans-serif",fontWeight:700,fontSize:15,marginBottom:12}}>Upcoming ({upcoming.length})</div>{upcoming.map(e=><EventListItem key={e.id} event={e} ctx={ctx} showDate full />)}</div>}
      {past.length>0&&<div className="card" style={{opacity:.7}}><div style={{fontFamily:"Syne,sans-serif",fontWeight:700,fontSize:15,marginBottom:12,color:"var(--text2)"}}>Past ({past.length})</div>{past.slice(-10).reverse().map(e=><EventListItem key={e.id} event={e} ctx={ctx} showDate full />)}</div>}
      {evts.length===0&&<div className="empty-state"><div className="empty-icon">🗓</div><div className="empty-title">No events found</div><button className="btn btn-primary btn-sm" onClick={()=>setModal({type:"create-event"})}>+ Create Event</button></div>}
    </div>
  );
}

// ─── NOTIFICATIONS PAGE ───────────────────────────────────────────────────────
function NotificationsPage({ ctx }) {
  const { notifications, setNotifications } = ctx;
  const sorted=[...notifications].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  const markAll=()=>setNotifications(prev=>prev.map(n=>({...n,isRead:true})));
  const markRead=(id)=>setNotifications(prev=>prev.map(n=>n.id===id?{...n,isRead:true}:n));
  const del=(id)=>setNotifications(prev=>prev.filter(n=>n.id!==id));
  const icons={conflict:"⚠️",change:"📝",reminder:"🔔",join:"✅",delete:"🗑️"};
  const bgColors={conflict:"rgba(251,191,36,0.12)",change:"rgba(108,99,255,0.12)",reminder:"rgba(96,165,250,0.12)",join:"rgba(52,211,153,0.12)",delete:"rgba(248,113,113,0.12)"};
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div style={{color:"var(--text2)",fontSize:13}}>{sorted.filter(n=>!n.isRead).length} unread</div>
        <button className="btn btn-ghost btn-sm" onClick={markAll}>Mark all read</button>
      </div>
      {sorted.length===0?<div className="empty-state"><div className="empty-icon">🔔</div><div className="empty-title">No notifications</div></div>:sorted.map(n=>(
        <div key={n.id} className={`notif-item${!n.isRead?" unread":""}`} onClick={()=>markRead(n.id)} style={{marginBottom:4}}>
          <div className="notif-icon" style={{background:bgColors[n.type]||"rgba(108,99,255,0.12)"}}>{icons[n.type]||"📌"}</div>
          <div className="notif-text"><div className="notif-msg">{n.message}</div><div className="notif-time">{timeAgo(n.createdAt)} · {n.type}</div></div>
          {!n.isRead&&<div className="notif-dot" />}
          <button className="btn-icon btn-sm" style={{fontSize:12}} onClick={ev=>{ev.stopPropagation();del(n.id);}}>✕</button>
        </div>
      ))}
    </div>
  );
}

// ─── INSIGHTS PAGE ────────────────────────────────────────────────────────────
function InsightsPage({ ctx }) {
  const { myEvents, myCalendars, conflicts } = ctx;
  const cals=myCalendars(), evts=myEvents(), today=new Date();
  const thisWeek=evts.filter(e=>{const d=new Date(e.startTime),diff=(d-today)/86400000;return diff>=0&&diff<=7;});
  const important=evts.filter(e=>e.isImportant&&new Date(e.startTime)>today).sort((a,b)=>new Date(a.startTime)-new Date(b.startTime));
  const busyDays={};
  evts.forEach(e=>{const k=new Date(e.startTime).toDateString();busyDays[k]=(busyDays[k]||0)+1;});
  const busiestDays=Object.entries(busyDays).sort((a,b)=>b[1]-a[1]).slice(0,3);
  return (
    <div>
      <div style={{background:"linear-gradient(135deg,rgba(108,99,255,0.15),rgba(167,139,250,0.08))",border:"1px solid rgba(108,99,255,0.25)",borderRadius:16,padding:20,marginBottom:20}}>
        <div style={{fontFamily:"Syne,sans-serif",fontSize:18,fontWeight:800,marginBottom:4}}>📊 Schedule Insights</div>
        <div style={{color:"var(--text2)",fontSize:13}}>Analysis of your calendars and events</div>
      </div>
      <div className="card mb-4">
        <div style={{fontFamily:"Syne,sans-serif",fontWeight:700,fontSize:16,marginBottom:14}}>⚠️ Schedule Conflicts ({conflicts.length})</div>
        {conflicts.length===0?<div style={{textAlign:"center",padding:"20px 0",color:"var(--green)"}}><div style={{fontSize:28,marginBottom:8}}>✅</div><div style={{fontWeight:600}}>No conflicts detected!</div></div>:conflicts.map(([e1,e2],i)=>{
          const c1=cals.find(c=>c.id===e1.calendarId),c2=cals.find(c=>c.id===e2.calendarId);
          return(<div key={i} className="conflict-alert"><div className="conflict-icon">⚠️</div><div className="conflict-text"><div className="conflict-title">Time Overlap Detected</div><div style={{marginBottom:6,flexWrap:"wrap",display:"flex",gap:4,alignItems:"center"}}><span style={{background:"rgba(108,99,255,0.2)",color:"var(--accent2)",padding:"2px 8px",borderRadius:4,fontSize:12,fontWeight:600}}>{e1.title}</span><span style={{color:"var(--text3)",fontSize:12}}>overlaps with</span><span style={{background:"rgba(244,114,182,0.2)",color:"var(--pink)",padding:"2px 8px",borderRadius:4,fontSize:12,fontWeight:600}}>{e2.title}</span></div><div style={{fontSize:12,color:"var(--text3)"}}>{fmtDate(e1.startTime)} · {fmtTime(e1.startTime)}–{fmtTime(e1.endTime)} ({c1?.name||"?"}) vs {fmtTime(e2.startTime)}–{fmtTime(e2.endTime)} ({c2?.name||"?"})</div></div></div>);
        })}
      </div>
      <div className="ai-grid" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
        <div className="card"><div style={{fontFamily:"Syne,sans-serif",fontWeight:700,fontSize:14,marginBottom:12}}>⭐ Important Upcoming</div>{important.length===0?<div style={{fontSize:13,color:"var(--text3)"}}>None upcoming</div>:important.slice(0,5).map(e=>{const cal=cals.find(c=>c.id===e.calendarId);return<div key={e.id} style={{padding:"8px 0",borderBottom:"1px solid var(--border)"}}><div style={{fontSize:13,fontWeight:600}}>{e.title}</div><div style={{fontSize:11,color:"var(--text3)"}}>{fmtDate(e.startTime)} · {cal?.name}</div></div>;})}</div>
        <div className="card"><div style={{fontFamily:"Syne,sans-serif",fontWeight:700,fontSize:14,marginBottom:12}}>📅 This Week ({thisWeek.length})</div>{thisWeek.length===0?<div style={{fontSize:13,color:"var(--text3)"}}>Nothing this week!</div>:thisWeek.slice(0,5).map(e=>{const cal=cals.find(c=>c.id===e.calendarId);return<div key={e.id} style={{padding:"8px 0",borderBottom:"1px solid var(--border)"}}><div style={{fontSize:13,fontWeight:600}}>{e.title}</div><div style={{fontSize:11,color:"var(--text3)"}}>{fmtDate(e.startTime)} · {cal?.name}</div></div>;})}</div>
        <div className="card"><div style={{fontFamily:"Syne,sans-serif",fontWeight:700,fontSize:14,marginBottom:12}}>📊 Busiest Days</div>{busiestDays.length===0?<div style={{fontSize:13,color:"var(--text3)"}}>No data yet</div>:busiestDays.map(([day,count])=><div key={day} style={{padding:"8px 0",borderBottom:"1px solid var(--border)"}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><div style={{fontSize:13}}>{new Date(day).toLocaleDateString("en-PH",{weekday:"short",month:"short",day:"numeric"})}</div><div style={{fontSize:12,color:"var(--accent2)",fontWeight:700}}>{count}</div></div><div style={{marginTop:4,height:4,background:"var(--surface3)",borderRadius:2}}><div style={{height:"100%",background:"var(--accent)",borderRadius:2,width:`${Math.min(100,(count/5)*100)}%`}} /></div></div>)}</div>
        <div className="card"><div style={{fontFamily:"Syne,sans-serif",fontWeight:700,fontSize:14,marginBottom:12}}>📚 Calendar Breakdown</div>{cals.length===0?<div style={{fontSize:13,color:"var(--text3)"}}>No calendars yet</div>:cals.map(c=>{const cnt=evts.filter(e=>e.calendarId===c.id).length,pct=evts.length?Math.round((cnt/evts.length)*100):0;return<div key={c.id} style={{padding:"7px 0",borderBottom:"1px solid var(--border)"}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:3}}><div style={{display:"flex",alignItems:"center",gap:6}}><span style={{width:8,height:8,borderRadius:"50%",background:c.color,display:"inline-block"}} /><span style={{fontSize:12,fontWeight:500}}>{c.name.split(" ").slice(0,2).join(" ")}</span></div><span style={{fontSize:11,color:"var(--text3)"}}>{cnt} ({pct}%)</span></div><div style={{height:3,background:"var(--surface3)",borderRadius:2}}><div style={{height:"100%",background:c.color,borderRadius:2,width:`${pct}%`,opacity:.7}} /></div></div>;})}</div>
      </div>
    </div>
  );
}

// ─── SETTINGS PAGE ────────────────────────────────────────────────────────────
function SettingsPage({ ctx }) {
  const { currentUser, setCurrentUser, sessionId, showToast, handleLogout } = ctx;
  const [firstName,setFirstName]        = useState(currentUser.first_name||"");
  const [lastName,setLastName]          = useState(currentUser.last_name||"");
  const [middleName,setMiddleName]      = useState(currentUser.middle_name||"");
  const [newEmail,setNewEmail]          = useState("");
  const [newPassword,setNewPassword]    = useState("");
  const [profileLoading,setProfileLoading]=useState(false);
  const [loginLoading,setLoginLoading]    =useState(false);
  const [deleteLoading,setDeleteLoading]  =useState(false);
  const [profileError,setProfileError]    =useState("");
  const [loginError,setLoginError]        =useState("");

  async function saveProfile() {
    setProfileError(""); setProfileLoading(true);
    try {
      const body={};
      if(firstName) body.first_name=firstName;
      if(lastName)  body.last_name=lastName;
      body.middle_name=middleName||"";
      await apiCall("/users.v1.UserService/Update",body,sessionId);
      const fullName=[firstName,middleName,lastName].filter(Boolean).join(" ");
      setCurrentUser(p=>({...p,name:fullName||p.email,first_name:firstName,last_name:lastName,middle_name:middleName}));
      showToast("Profile updated!");
    } catch(e) { setProfileError(e.message||"Failed to update profile."); }
    finally { setProfileLoading(false); }
  }

  async function saveLoginInfo() {
    setLoginError(""); setLoginLoading(true);
    try {
      const body={};
      if(newEmail)    body.email=newEmail;
      if(newPassword) body.password=newPassword;
      if(!body.email&&!body.password){setLoginError("Enter a new email or password.");setLoginLoading(false);return;}
      await apiCall("/users.v1.UserService/UpdateLogin",body,sessionId);
      if(newEmail) setCurrentUser(p=>({...p,email:newEmail}));
      setNewEmail(""); setNewPassword(""); showToast("Login info updated!");
    } catch(e) { setLoginError(e.message||"Failed to update login info."); }
    finally { setLoginLoading(false); }
  }

  async function deleteAccount() {
    if(!window.confirm("Permanently delete your account? This cannot be undone.")) return;
    setDeleteLoading(true);
    try { await apiCall("/users.v1.UserService/Delete",{},sessionId); clearSession(); handleLogout(); }
    catch(e) { showToast(e.message||"Failed to delete account.","error"); }
    finally { setDeleteLoading(false); }
  }

  const ac=avatarColor(currentUser.name);
  return (
    <div style={{maxWidth:560}}>
      <div className="card mb-4">
        <div style={{fontFamily:"Syne,sans-serif",fontWeight:700,fontSize:16,marginBottom:18}}>Profile</div>
        <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:24}}>
          <div className="user-avatar" style={{background:ac,width:56,height:56,fontSize:20}}>{currentUser.name.split(" ").map(w=>w[0]).join("").slice(0,2)}</div>
          <div><div style={{fontWeight:700,fontSize:16}}>{currentUser.name}</div><div style={{fontSize:13,color:"var(--text3)"}}>{currentUser.email}</div><div className="user-badge" style={{marginTop:4}}>{currentUser.userType==="usc"?"🎓 USC User":"👤 Regular"}</div></div>
        </div>
        {profileError&&<div className="error-msg">{profileError}</div>}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          <div className="form-group"><label className="form-label">First Name</label><input className="form-input" value={firstName} onChange={e=>setFirstName(e.target.value)} /></div>
          <div className="form-group"><label className="form-label">Last Name</label><input className="form-input" value={lastName} onChange={e=>setLastName(e.target.value)} /></div>
        </div>
        <div className="form-group"><label className="form-label">Middle Name <span style={{color:"var(--text3)",fontWeight:400}}>(optional)</span></label><input className="form-input" value={middleName} onChange={e=>setMiddleName(e.target.value)} /></div>
        <button className="btn btn-primary btn-sm" onClick={saveProfile} disabled={profileLoading}>{profileLoading?"Saving…":"Save Profile"}</button>
      </div>
      <div className="card mb-4">
        <div style={{fontFamily:"Syne,sans-serif",fontWeight:700,fontSize:16,marginBottom:14}}>Update Login Info</div>
        {loginError&&<div className="error-msg">{loginError}</div>}
        <div className="form-group"><label className="form-label">New Email <span style={{color:"var(--text3)",fontWeight:400}}>(optional)</span></label><input className="form-input" type="email" value={newEmail} onChange={e=>setNewEmail(e.target.value)} placeholder="Leave blank to keep current" /></div>
        <div className="form-group"><label className="form-label">New Password <span style={{color:"var(--text3)",fontWeight:400}}>(optional)</span></label><input className="form-input" type="password" value={newPassword} onChange={e=>setNewPassword(e.target.value)} placeholder="Leave blank to keep current" /></div>
        <button className="btn btn-primary btn-sm" onClick={saveLoginInfo} disabled={loginLoading}>{loginLoading?"Saving…":"Update Login Info"}</button>
      </div>
      <div className="card mb-4">
        <div style={{fontFamily:"Syne,sans-serif",fontWeight:700,fontSize:16,marginBottom:14}}>Account Info</div>
        <div className="info-row"><div className="info-label">Email</div><div className="info-val">{currentUser.email}</div></div>
        <div className="info-row"><div className="info-label">User Type</div><div className="info-val">{currentUser.userType==="usc"?"USC User":"Regular User"}</div></div>
      </div>
      <div className="card">
        <div style={{fontFamily:"Syne,sans-serif",fontWeight:700,fontSize:16,marginBottom:14,color:"var(--red)"}}>Danger Zone</div>
        <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
          <button className="btn btn-ghost btn-sm" onClick={()=>handleLogout()}>Sign Out</button>
          <button className="btn btn-ghost btn-sm" onClick={()=>handleLogout(true)}>Sign Out Everywhere</button>
          <button className="btn btn-danger btn-sm" onClick={deleteAccount} disabled={deleteLoading}>{deleteLoading?"Deleting…":"Delete Account"}</button>
        </div>
      </div>
    </div>
  );
}

// ─── EVENT LIST ITEM ──────────────────────────────────────────────────────────
function EventListItem({ event, ctx, showDate, full }) {
  const { myCalendars, setModal } = ctx;
  const cal=myCalendars().find(c=>c.id===event.calendarId);
  return (
    <div className="event-item" onClick={()=>setModal({type:"event-detail",data:event})}>
      <div className="event-dot" style={{background:cal?.color||"var(--accent)"}} />
      <div className="event-info">
        <div className="event-title">{event.isImportant&&<span className="event-important">⭐</span>}{event.title}</div>
        <div className="event-meta">{showDate?`${fmtDate(event.startTime)} · `:""}{fmtTime(event.startTime)}–{fmtTime(event.endTime)}{full&&cal?` · ${cal.name}`:""}{full&&event.location?` · 📍 ${event.location}`:""}</div>
      </div>
      {event.isImportant&&<div className="chip chip-yellow" style={{fontSize:10}}>Important</div>}
    </div>
  );
}

// ─── MODAL ROUTER ─────────────────────────────────────────────────────────────
function ModalRouter({ modal, ctx }) {
  const {type,data}=modal;
  if(type==="create-event")     return <CreateEventModal     ctx={ctx} initial={data} />;
  if(type==="event-detail")     return <EventDetailModal     ctx={ctx} event={data} />;
  if(type==="create-calendar")  return <CreateCalendarModal  ctx={ctx} />;
  if(type==="calendar-events")  return <CalendarEventsModal  ctx={ctx} calendar={data} />;
  if(type==="manage-calendar")  return <ManageCalendarModal  ctx={ctx} calendar={data} />;
  return null;
}

// ─── CREATE EVENT MODAL ───────────────────────────────────────────────────────
function CreateEventModal({ ctx, initial }) {
  const { sessionId, myCalendars, events, setEvents, setNotifications, closeModal, showToast, calendars, refreshCalendars } = ctx;
  const cals=myCalendars();
  const defaultCal=initial?.calendarId||cals[0]?.id||"";
  const todayStr=initial?.date?`${initial.date.getFullYear()}-${String(initial.date.getMonth()+1).padStart(2,"0")}-${String(initial.date.getDate()).padStart(2,"0")}`:new Date().toISOString().slice(0,10);
  const [form,setForm]=useState({title:"",description:"",date:todayStr,startTime:"09:00",endTime:"10:00",location:"",calendarId:defaultCal,isImportant:false});
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(false);
  function up(k,v){setForm(f=>({...f,[k]:v}));}

  async function submit() {
    if(!form.title){setError("Title is required.");return;}
    if(!form.calendarId){setError("Please select a calendar.");return;}
    const st=new Date(`${form.date}T${form.startTime}`).toISOString();
    const en=new Date(`${form.date}T${form.endTime}`).toISOString();
    if(new Date(st)>=new Date(en)){setError("End time must be after start time.");return;}
    setLoading(true);
    try {
      const calId = Number(form.calendarId);
      const newEvent = {
        id: uid_gen(), calendarId: calId,
        title: form.title, description: form.description,
        startTime: st, endTime: en,
        location: form.location, isImportant: form.isImportant,
        createdAt: new Date().toISOString(),
      };
      // Get current events for this calendar, add new one, push via Merge
      const calEvents = events.filter(e => e.calendarId === calId);
      calEvents.push(newEvent);
      const icalB64 = eventsToIcalB64(calEvents);
      await calApi("Merge", { id: calId, ical: icalB64 }, sessionId);
      // Update local state immediately
      setEvents(prev => [...prev, newEvent]);
      showToast(`"${form.title}" created!`);
      closeModal();
    } catch(e) { setError(e.message||"Failed to create event."); }
    finally { setLoading(false); }
  }

  return (
    <div className="modal-overlay" onClick={closeModal}>
      <div className="modal" onClick={e=>e.stopPropagation()}>
        <div className="modal-header"><div className="modal-title">New Event</div><button className="close-btn" onClick={closeModal}>✕</button></div>
        <div className="modal-body">
          {error&&<div className="error-msg">{error}</div>}
          <div className="form-group"><label className="form-label">Title *</label><input className="form-input" value={form.title} onChange={e=>up("title",e.target.value)} placeholder="Event title…" /></div>
          <div className="form-group"><label className="form-label">Calendar</label>
            <select className="select" value={form.calendarId} onChange={e=>up("calendarId",e.target.value)}>
              {cals.filter(c=>c.isOwner).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="event-dt-grid" style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
            <div className="form-group"><label className="form-label">Date</label><input className="form-input" type="date" value={form.date} onChange={e=>up("date",e.target.value)} /></div>
            <div className="form-group"><label className="form-label">Start</label><input className="form-input" type="time" value={form.startTime} onChange={e=>up("startTime",e.target.value)} /></div>
            <div className="form-group"><label className="form-label">End</label><input className="form-input" type="time" value={form.endTime} onChange={e=>up("endTime",e.target.value)} /></div>
          </div>
          <div className="form-group"><label className="form-label">Location</label><input className="form-input" value={form.location} onChange={e=>up("location",e.target.value)} placeholder="Room, building, or online…" /></div>
          <div className="form-group"><label className="form-label">Description</label><textarea className="textarea" value={form.description} onChange={e=>up("description",e.target.value)} placeholder="Add details…" /></div>
          <div className="toggle-row"><span style={{fontSize:13,fontWeight:500}}>⭐ Mark as Important</span><label className="toggle"><input type="checkbox" checked={form.isImportant} onChange={e=>up("isImportant",e.target.checked)} /><span className="toggle-slider" /></label></div>
        </div>
        <div className="modal-footer"><button className="btn btn-ghost" onClick={closeModal}>Cancel</button><button className="btn btn-primary" onClick={submit} disabled={loading}>{loading?"Saving…":"Create Event"}</button></div>
      </div>
    </div>
  );
}

// ─── EVENT DETAIL MODAL ───────────────────────────────────────────────────────
function EventDetailModal({ ctx, event }) {
  const { sessionId, myCalendars, events, setEvents, closeModal, showToast } = ctx;
  const cal=myCalendars().find(c=>c.id===event.calendarId);
  const canEdit=cal?.isOwner;
  const [editing,setEditing]=useState(false);
  const [form,setForm]=useState({title:event.title,description:event.description||"",location:event.location||"",isImportant:event.isImportant});
  const [loading,setLoading]=useState(false);

  async function saveEdit() {
    setLoading(true);
    try {
      const calId = Number(event.calendarId);
      const updatedEvent = {...event,...form};
      const calEvents = events.map(e=>e.id===event.id?updatedEvent:e).filter(e=>e.calendarId===calId);
      await calApi("Replace", { id: calId, ical: eventsToIcalB64(calEvents) }, sessionId);
      setEvents(prev=>prev.map(e=>e.id===event.id?updatedEvent:e));
      showToast("Event updated!"); closeModal();
    } catch(e) { showToast(e.message||"Failed to update event.","error"); }
    finally { setLoading(false); }
  }

  async function deleteEvent() {
    setLoading(true);
    try {
      const calId = Number(event.calendarId);
      const remaining = events.filter(e=>e.calendarId===calId&&e.id!==event.id);
      await calApi("Replace", { id: calId, ical: eventsToIcalB64(remaining) }, sessionId);
      setEvents(prev=>prev.filter(e=>e.id!==event.id));
      showToast(`"${event.title}" deleted`); closeModal();
    } catch(e) { showToast(e.message||"Failed to delete event.","error"); }
    finally { setLoading(false); }
  }

  return (
    <div className="modal-overlay" onClick={closeModal}>
      <div className="modal" onClick={e=>e.stopPropagation()}>
        <div className="modal-header">
          <div style={{display:"flex",alignItems:"center",gap:10,flex:1}}><div style={{width:10,height:10,borderRadius:"50%",background:cal?.color||"var(--accent)"}} /><div className="modal-title">{event.title}</div>{event.isImportant&&<span className="chip chip-yellow" style={{fontSize:10}}>⭐</span>}</div>
          <button className="close-btn" onClick={closeModal}>✕</button>
        </div>
        <div className="modal-body">
          {!editing?(<>
            <div className="info-row"><div className="info-label">Calendar</div><div className="info-val">{cal?.name||"—"}</div></div>
            <div className="info-row"><div className="info-label">Date</div><div className="info-val">{fmtDate(event.startTime)}</div></div>
            <div className="info-row"><div className="info-label">Time</div><div className="info-val">{fmtTime(event.startTime)} – {fmtTime(event.endTime)}</div></div>
            {event.location&&<div className="info-row"><div className="info-label">Location</div><div className="info-val">📍 {event.location}</div></div>}
            {event.description&&<div className="info-row"><div className="info-label">Notes</div><div className="info-val" style={{whiteSpace:"pre-wrap"}}>{event.description}</div></div>}
          </>):(<>
            <div className="form-group"><label className="form-label">Title</label><input className="form-input" value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))} /></div>
            <div className="form-group"><label className="form-label">Location</label><input className="form-input" value={form.location} onChange={e=>setForm(f=>({...f,location:e.target.value}))} /></div>
            <div className="form-group"><label className="form-label">Description</label><textarea className="textarea" value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} /></div>
            <div className="toggle-row"><span style={{fontSize:13,fontWeight:500}}>⭐ Important</span><label className="toggle"><input type="checkbox" checked={form.isImportant} onChange={e=>setForm(f=>({...f,isImportant:e.target.checked}))} /><span className="toggle-slider" /></label></div>
          </>)}
        </div>
        <div className="modal-footer">
          {canEdit&&!editing&&(<><button className="btn btn-danger btn-sm" onClick={deleteEvent} disabled={loading}>Delete</button><button className="btn btn-secondary btn-sm" onClick={()=>setEditing(true)}>Edit</button></>)}
          {editing&&(<><button className="btn btn-ghost btn-sm" onClick={()=>setEditing(false)}>Cancel</button><button className="btn btn-primary btn-sm" onClick={saveEdit} disabled={loading}>{loading?"Saving…":"Save"}</button></>)}
          {!editing&&<button className="btn btn-primary btn-sm" onClick={closeModal}>Close</button>}
        </div>
      </div>
    </div>
  );
}

// ─── CREATE CALENDAR MODAL ────────────────────────────────────────────────────
function CreateCalendarModal({ ctx }) {
  const { sessionId, closeModal, showToast, refreshCalendars, saveCalPrefs, loadCalPrefs } = ctx;
  const [form,setForm]=useState({name:"",description:"",membersOnly:false,color:"#6c63ff",type:"shared"});
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(false);
  const colors=["#6c63ff","#34d399","#fbbf24","#f472b6","#60a5fa","#fb923c","#f87171","#2dd4bf"];

  async function submit() {
    if(!form.name){setError("Calendar name is required.");return;}
    setLoading(true);
    try {
      await calApi("Create", {
        name: form.name,
        description: form.description || undefined,
        members_only: form.membersOnly,
        ical: btoa("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//USCCalendar//EN\r\nEND:VCALENDAR"),
      }, sessionId);
      showToast(`"${form.name}" created!`);
      // After creating, refresh to get the real ID from server
      await refreshCalendars();
      // Note: color/type prefs will be set after we know the ID from server
      closeModal();
    } catch(e) { setError(e.message||"Failed to create calendar."); }
    finally { setLoading(false); }
  }

  return (
    <div className="modal-overlay" onClick={closeModal}>
      <div className="modal" onClick={e=>e.stopPropagation()}>
        <div className="modal-header"><div className="modal-title">Create Calendar</div><button className="close-btn" onClick={closeModal}>✕</button></div>
        <div className="modal-body">
          {error&&<div className="error-msg">{error}</div>}
          <div className="form-group"><label className="form-label">Calendar Name *</label><input className="form-input" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="e.g. Study Group Alpha" /></div>
          <div className="form-group"><label className="form-label">Description <span style={{color:"var(--text3)",fontWeight:400}}>(optional)</span></label><input className="form-input" value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} placeholder="What is this calendar for?" /></div>
          <div className="toggle-row"><span style={{fontSize:13,fontWeight:500}}>🔒 Members Only</span><label className="toggle"><input type="checkbox" checked={form.membersOnly} onChange={e=>setForm(f=>({...f,membersOnly:e.target.checked}))} /><span className="toggle-slider" /></label></div>
          <div className="form-group" style={{marginTop:16}}><label className="form-label">Color</label>
            <div className="pill-row">{colors.map(c=><div key={c} onClick={()=>setForm(f=>({...f,color:c}))} style={{width:28,height:28,borderRadius:"50%",background:c,cursor:"pointer",border:form.color===c?"3px solid #fff":"3px solid transparent",transition:"border-color .15s"}} />)}</div>
          </div>
        </div>
        <div className="modal-footer"><button className="btn btn-ghost" onClick={closeModal}>Cancel</button><button className="btn btn-primary" onClick={submit} disabled={loading}>{loading?"Creating…":"Create Calendar"}</button></div>
      </div>
    </div>
  );
}

// ─── MANAGE CALENDAR MODAL (codes, members, metadata) ────────────────────────
function ManageCalendarModal({ ctx, calendar }) {
  const { sessionId, closeModal, showToast, refreshCalendars, saveCalPrefs, loadCalPrefs } = ctx;
  const [tab,setTab]           = useState("codes");
  const [newCode,setNewCode]   = useState("");
  const [ttlDays,setTtlDays]   = useState("");
  const [codeLoading,setCodeLoading]=useState(false);
  const [members,setMembers]   = useState([]);
  const [membLoading,setMembLoading]=useState(false);
  const [metaName,setMetaName] = useState(calendar.name);
  const [metaDesc,setMetaDesc] = useState(calendar.description||"");
  const [metaOnly,setMetaOnly] = useState(calendar.membersOnly||false);
  const [metaLoading,setMetaLoading]=useState(false);
  const [error,setError]       = useState("");
  const prefs = loadCalPrefs();
  const [color,setColor]       = useState(prefs[calendar.id]?.color||calendar.color||"#6c63ff");
  const colors=["#6c63ff","#34d399","#fbbf24","#f472b6","#60a5fa","#fb923c","#f87171","#2dd4bf"];

  useEffect(()=>{
    if(tab==="members") loadMembers();
  },[tab]);

  async function loadMembers() {
    setMembLoading(true);
    try {
      const r = await calApi("GetMembers", {id: calendar.id}, sessionId);
      setMembers(r.user_ids||[]);
    } catch(e) { setError("Failed to load members."); }
    finally { setMembLoading(false); }
  }

  async function createCode() {
    if(!newCode.trim()){setError("Enter a code string.");return;}
    setCodeLoading(true); setError("");
    try {
      const body = {id: calendar.id, code: newCode.trim()};
      if(ttlDays) body.ttl = {seconds: parseInt(ttlDays)*86400, nanos: 0};
      await calApi("CreateCode", body, sessionId);
      showToast("Code created!");
      setNewCode(""); setTtlDays("");
      await refreshCalendars();
    } catch(e) { setError(e.message||"Failed to create code."); }
    finally { setCodeLoading(false); }
  }

  async function deleteCode(codeId) {
    try {
      await calApi("DeleteCode", {code_id: codeId}, sessionId);
      showToast("Code deleted.");
      await refreshCalendars();
    } catch(e) { showToast(e.message||"Failed to delete code.","error"); }
  }

  async function removeMember(userId) {
    try {
      await calApi("RemoveMember", {id: calendar.id, user_id: userId}, sessionId);
      setMembers(prev=>prev.filter(id=>id!==userId));
      showToast("Member removed.");
    } catch(e) { showToast(e.message||"Failed to remove member.","error"); }
  }

  async function saveMetadata() {
    setMetaLoading(true); setError("");
    try {
      await calApi("UpdateMetadata", {id: calendar.id, name: metaName, description: metaDesc, members_only: metaOnly}, sessionId);
      // Save color pref locally
      const p = loadCalPrefs();
      p[calendar.id] = {...(p[calendar.id]||{}), color};
      saveCalPrefs(p);
      showToast("Calendar updated!");
      await refreshCalendars();
      closeModal();
    } catch(e) { setError(e.message||"Failed to update."); }
    finally { setMetaLoading(false); }
  }

  return (
    <div className="modal-overlay" onClick={closeModal}>
      <div className="modal modal-lg" onClick={e=>e.stopPropagation()}>
        <div className="modal-header">
          <div style={{display:"flex",alignItems:"center",gap:10,flex:1}}><div style={{width:10,height:10,borderRadius:"50%",background:calendar.color}} /><div className="modal-title">Manage: {calendar.name}</div></div>
          <button className="close-btn" onClick={closeModal}>✕</button>
        </div>
        <div style={{padding:"0 28px"}}>
          <div className="tabs">
            {[["codes","Access Codes"],["members","Members"],["settings","Settings"]].map(([t,l])=>(
              <div key={t} className={`tab${tab===t?" active":""}`} onClick={()=>{setTab(t);setError("");}}>{l}</div>
            ))}
          </div>
        </div>
        <div className="modal-body">
          {error && <div className="error-msg">{error}</div>}

          {tab==="codes" && (<>
            <div style={{marginBottom:16}}>
              <div style={{fontWeight:600,fontSize:13,marginBottom:10}}>Existing Codes</div>
              {calendar.codes?.length===0 && <div style={{fontSize:13,color:"var(--text3)",marginBottom:12}}>No codes yet.</div>}
              {calendar.codes?.map(cd=>(
                <div key={cd.codeId} className="flex items-center justify-between" style={{padding:"8px 0",borderBottom:"1px solid var(--border)"}}>
                  <div>
                    <span className="code-badge" style={{cursor:"pointer"}} onClick={()=>{navigator.clipboard?.writeText(cd.code);showToast("Copied!");}}>{cd.code}</span>
                    {cd.expiresAt && <span style={{fontSize:11,color:"var(--text3)",marginLeft:8}}>Expires {fmtDate(cd.expiresAt)}</span>}
                  </div>
                  <button className="btn btn-danger btn-sm" onClick={()=>deleteCode(cd.codeId)}>Delete</button>
                </div>
              ))}
            </div>
            <div style={{fontWeight:600,fontSize:13,marginBottom:10}}>Create New Code</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <div className="form-group"><label className="form-label">Code String *</label><input className="form-input" value={newCode} onChange={e=>setNewCode(e.target.value.toUpperCase())} placeholder="e.g. MYCLASS2026" style={{fontFamily:"monospace",letterSpacing:1}} /></div>
              <div className="form-group"><label className="form-label">Expires in (days, optional)</label><input className="form-input" type="number" value={ttlDays} onChange={e=>setTtlDays(e.target.value)} placeholder="Leave blank = no expiry" /></div>
            </div>
            <button className="btn btn-primary btn-sm" onClick={createCode} disabled={codeLoading}>{codeLoading?"Creating…":"Create Code"}</button>
          </>)}

          {tab==="members" && (<>
            {membLoading ? <div style={{color:"var(--text3)",fontSize:13}}>Loading members…</div> : members.length===0 ? <div style={{color:"var(--text3)",fontSize:13}}>No members found.</div> : members.map(uid=>(
              <div key={uid} className="flex items-center justify-between" style={{padding:"8px 0",borderBottom:"1px solid var(--border)"}}>
                <div style={{fontSize:13}}>User #{uid}</div>
                <button className="btn btn-danger btn-sm" onClick={()=>removeMember(uid)}>Remove</button>
              </div>
            ))}
          </>)}

          {tab==="settings" && (<>
            <div className="form-group"><label className="form-label">Calendar Name</label><input className="form-input" value={metaName} onChange={e=>setMetaName(e.target.value)} /></div>
            <div className="form-group"><label className="form-label">Description</label><input className="form-input" value={metaDesc} onChange={e=>setMetaDesc(e.target.value)} /></div>
            <div className="toggle-row"><span style={{fontSize:13,fontWeight:500}}>🔒 Members Only</span><label className="toggle"><input type="checkbox" checked={metaOnly} onChange={e=>setMetaOnly(e.target.checked)} /><span className="toggle-slider" /></label></div>
            <div className="form-group" style={{marginTop:16}}><label className="form-label">Color (display only)</label>
              <div className="pill-row">{colors.map(c=><div key={c} onClick={()=>setColor(c)} style={{width:28,height:28,borderRadius:"50%",background:c,cursor:"pointer",border:color===c?"3px solid #fff":"3px solid transparent",transition:"border-color .15s"}} />)}</div>
            </div>
            <button className="btn btn-primary btn-sm" onClick={saveMetadata} disabled={metaLoading}>{metaLoading?"Saving…":"Save Changes"}</button>
          </>)}
        </div>
        <div className="modal-footer"><button className="btn btn-ghost" onClick={closeModal}>Close</button></div>
      </div>
    </div>
  );
}

// ─── CALENDAR EVENTS MODAL ────────────────────────────────────────────────────
function CalendarEventsModal({ ctx, calendar }) {
  const { events, setModal, closeModal } = ctx;
  const calEvts=events.filter(e=>e.calendarId===calendar.id).sort((a,b)=>new Date(a.startTime)-new Date(b.startTime));
  return (
    <div className="modal-overlay" onClick={closeModal}>
      <div className="modal modal-lg" onClick={e=>e.stopPropagation()}>
        <div className="modal-header">
          <div style={{display:"flex",alignItems:"center",gap:10,flex:1}}><div style={{width:10,height:10,borderRadius:"50%",background:calendar.color}} /><div className="modal-title">{calendar.name}</div></div>
          <button className="close-btn" onClick={closeModal}>✕</button>
        </div>
        <div className="modal-body">
          {calEvts.length===0?<div className="empty-state" style={{padding:"30px 0"}}><div className="empty-icon">📅</div><div className="empty-title">No events yet</div></div>:calEvts.map(e=>(
            <div key={e.id} className="event-item" onClick={()=>{closeModal();setTimeout(()=>setModal({type:"event-detail",data:e}),50);}}>
              <div className="event-dot" style={{background:calendar.color}} />
              <div className="event-info"><div className="event-title">{e.isImportant?"⭐ ":""}{e.title}</div><div className="event-meta">{fmtDate(e.startTime)} · {fmtTime(e.startTime)}–{fmtTime(e.endTime)}{e.location?` · 📍 ${e.location}`:""}</div></div>
            </div>
          ))}
        </div>
        <div className="modal-footer">
          {calendar.isOwner&&<button className="btn btn-primary btn-sm" onClick={()=>{closeModal();setTimeout(()=>setModal({type:"create-event",data:{calendarId:calendar.id}}),50);}}>+ Add Event</button>}
          <button className="btn btn-ghost" onClick={closeModal}>Close</button>
        </div>
      </div>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
