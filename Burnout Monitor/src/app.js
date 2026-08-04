/* ──────────────────────────────────────────────────────────────
   Burnout AI Monitor — app.js
   All-new feature set:
   1. Dark Mode toggle (system-aware + localStorage)
   2. Notification Center
   3. Department Bar Chart (clickable)
   4. 12-Month trend range selector
   5. Wellness Badges
   6. Add Employee Modal (dynamic scoring + sessionStorage)
   7. Advanced Sorting & Dept Filter
   8. Prediction History Log
   9. Sentiment Word Cloud
   10. Count-up metric animations + view transitions
────────────────────────────────────────────────────────────── */

/* ─── Constants ────────────────────────────────────────── */
const MONTHS_ALL = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const RISK_COLORS = {
  Low:      "#16a34a",
  Medium:   "#d97706",
  High:     "#dc2626",
  Critical: "#9333ea"
};

const RISK_ORDER = { Low: 0, Medium: 1, High: 2, Critical: 3 };

const POSITIVE_WORDS = new Set([
  "balanced","manageable","improved","support","helpful","steady","clear",
  "enough","recharge","collaboration","exciting","great","good","fine",
  "productive","happy","motivated","positive","enjoy","efficient"
]);

const NEGATIVE_WORDS = new Set([
  "overwhelmed","exhausted","tired","intense","pressure","stressful","anxiety",
  "disconnect","drained","severe","escalations","deadlines","heavy","burnout",
  "struggle","difficult","terrible","impossible","overloaded","frustrated","miserable"
]);

/* ─── Utility ──────────────────────────────────────────── */
const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Number(v) || 0));
const round = v => Math.round(Number(v) || 0);
const normalize = (v, max) => clamp((Number(v) / max) * 100);

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getBadgeHTML(badge) {
  if (badge === "healthy")   return `<span class="badge badge--healthy">🌟 Healthy</span>`;
  if (badge === "resilient") return `<span class="badge badge--resilient">💪 Resilient</span>`;
  return `<span style="color:var(--muted);font-size:.8rem">—</span>`;
}

/* ─── Sentiment ────────────────────────────────────────── */
function analyzeSentiment(text = "") {
  const words = String(text).toLowerCase().match(/[a-z]+/g) || [];
  if (!words.length) return { positive: 50, negative: 50, label: "Neutral", words };
  const pos = words.filter(w => POSITIVE_WORDS.has(w)).length;
  const neg = words.filter(w => NEGATIVE_WORDS.has(w)).length;
  const rawNeg = clamp(50 + neg * 14 - pos * 10);
  const negative = round(rawNeg);
  const positive = 100 - negative;
  const label = negative >= 65 ? "Negative" : negative <= 38 ? "Positive" : "Neutral";
  return { positive, negative, label, words };
}

function buildWordCloud(words) {
  const seen = new Set();
  return words
    .filter(w => { if (seen.has(w) || w.length < 4) return false; seen.add(w); return true; })
    .slice(0, 18)
    .map(w => {
      let cls = "wc-word--neutral";
      if (NEGATIVE_WORDS.has(w)) cls = "wc-word--negative";
      else if (POSITIVE_WORDS.has(w)) cls = "wc-word--positive";
      return `<span class="wc-word ${cls}">${escapeHtml(w)}</span>`;
    }).join("");
}

/* ─── Prediction Engine ────────────────────────────────── */
function getRiskLevel(score) {
  if (score <= 30) return "Low";
  if (score <= 60) return "Medium";
  if (score <= 80) return "High";
  return "Critical";
}

function buildDrivers(input, sentiment) {
  return [
    ["Work hours",        normalize(input.work_hours, 12),     0.25],
    ["Overtime",          normalize(input.overtime_hours, 5),  0.20],
    ["Task load",         clamp(input.task_load),               0.20],
    ["Meeting hours",     normalize(input.meeting_hours, 24),  0.15],
    ["Neg. sentiment",    sentiment.negative,                  0.20]
  ].map(([name, normalized, weight]) => ({
    name,
    normalized: round(normalized),
    weighted: normalized * weight
  }));
}

function buildRecommendations(result) {
  const recs = [];
  if (["Critical","High"].includes(result.risk)) {
    recs.push(["Manager check-in",   "Schedule a private workload review within 24 hours."]);
    recs.push(["Workload rebalance",  "Move urgent but non-critical tasks to another team member."]);
  }
  if (result.overtime_hours >= 2 || result.work_hours >= 9.5)
    recs.push(["Overtime control",   "Cap overtime for the next sprint and protect recovery time."]);
  if (result.meeting_hours >= 14)
    recs.push(["Meeting audit",      "Cancel low-value recurring meetings and create focus blocks."]);
  if ((result.sentiment && result.sentiment.negative >= 65) || result.stress_level >= 75)
    recs.push(["Wellness support",   "Offer counseling, wellness session, or mental health resources."]);
  if (result.leave_days <= 1)
    recs.push(["Time off",           "Encourage leave or a flexible schedule before stress becomes chronic."]);
  if (!recs.length) {
    recs.push(["Maintain rhythm",    "Keep current workload levels and continue monthly check-ins."]);
    recs.push(["Recognition",        "Share positive feedback to reinforce healthy team behavior."]);
  }
  return recs.slice(0, 4);
}

function predictBurnout(input) {
  const sentiment = input.sentiment_score == null
    ? analyzeSentiment(input.feedback)
    : {
        positive: round(input.sentiment_score),
        negative: 100 - round(input.sentiment_score),
        label: input.sentiment_score >= 60 ? "Positive" : "Negative",
        words: (input.feedback || "").toLowerCase().match(/[a-z]+/g) || []
      };

  const drivers = buildDrivers(input, sentiment);
  let base = drivers.reduce((t, d) => t + d.weighted, 0);

  const stressAdj     = (clamp(input.stress_level     || 50) - 50) * 0.08;
  const satisAdj      = (50 - clamp(input.job_satisfaction || 50)) * 0.06;
  const completionAdj = (70 - clamp(input.completion_rate  || 70)) * 0.05;
  const leaveAdj      = input.leave_days <= 1 ? 2 : input.leave_days >= 5 ? -3 : 0;

  const score = clamp(base + stressAdj + satisAdj + completionAdj + leaveAdj);
  const risk  = getRiskLevel(score);
  const topDriver = [...drivers].sort((a, b) => b.weighted - a.weighted)[0];

  return {
    score: round(score),
    risk,
    sentiment,
    drivers,
    topDriver,
    recommendations: buildRecommendations({ ...input, score, risk, sentiment, topDriver })
  };
}

/* ─── Data Bootstrap ───────────────────────────────────── */
let baseEmployees = (window.BURNOUT_SAMPLE_EMPLOYEES || []).map(e => ({
  ...e,
  prediction: predictBurnout(e)
}));

const sessionKey = "burnout_added_employees";
const localEmployeeKey = "burnout_local_employees";
function loadSessionEmployees() {
  try { return JSON.parse(sessionStorage.getItem(sessionKey) || "[]"); } catch { return []; }
}
function saveSessionEmployees(list) {
  sessionStorage.setItem(sessionKey, JSON.stringify(list));
  try { localStorage.setItem(localEmployeeKey, JSON.stringify(list)); } catch {}
}
function loadLocalEmployees() {
  try { return JSON.parse(localStorage.getItem(localEmployeeKey) || "[]"); } catch { return []; }
}
function saveLocalEmployees(list) {
  try { localStorage.setItem(localEmployeeKey, JSON.stringify(list)); } catch {}
}

function getApiUrl(path) {
  if (window.location.protocol === "file:" || window.location.port !== "8001") {
    return "http://localhost:8001" + path;
  }
  return path;
}

function getStoredRefreshToken() {
  try { return localStorage.getItem("burnout_refresh_token") || ""; } catch { return ""; }
}

function saveStoredRefreshToken(token) {
  try { localStorage.setItem("burnout_refresh_token", token); } catch {}
}

function clearStoredRefreshToken() {
  try { localStorage.removeItem("burnout_refresh_token"); } catch {}
}

function getStoredAuthToken() {
  try { return localStorage.getItem("burnout_access_token") || ""; } catch { return ""; }
}

function saveStoredAuthToken(token) {
  try { localStorage.setItem("burnout_access_token", token); } catch {}
}

function clearStoredAuthToken() {
  try { localStorage.removeItem("burnout_access_token"); } catch {}
}


function getStoredUser() {
  try { return JSON.parse(localStorage.getItem("burnout_user") || "null"); } catch { return null; }
}

function saveStoredUser(user) {
  try { localStorage.setItem("burnout_user", JSON.stringify(user)); } catch {}
}

function clearStoredUser() {
  try { localStorage.removeItem("burnout_user"); } catch {}
}

let isRefreshing = false;
let refreshSubscribers = [];

function onTokenRefreshed(newToken) {
  refreshSubscribers.forEach(callback => callback(newToken));
  refreshSubscribers = [];
}

function handleLogout() {
  clearStoredAuthToken();
  clearStoredRefreshToken();
  clearStoredUser();
  addedEmployees = [];
  allEmployees = [...baseEmployees];
  document.getElementById("auth-overlay").style.display = "flex";
  document.querySelector(".app-shell").style.display = "none";
  document.getElementById("user-profile-block").style.display = "none";
  const pwdOverlay = document.getElementById("password-change-overlay");
  if (pwdOverlay) {
    pwdOverlay.classList.remove("open");
    pwdOverlay.setAttribute("aria-hidden", "true");
  }
}

async function apiRequest(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const token = getStoredAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  
  const response = await fetch(getApiUrl(path), { ...options, headers });
  
  if (response.status === 401) {
    const refreshToken = getStoredRefreshToken();
    if (refreshToken) {
      if (!isRefreshing) {
        isRefreshing = true;
        try {
          const refreshRes = await fetch(getApiUrl("/api/auth/refresh"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ refresh_token: refreshToken })
          });
          if (refreshRes.ok) {
            const data = await refreshRes.json();
            saveStoredAuthToken(data.access_token);
            if (data.refresh_token) {
              saveStoredRefreshToken(data.refresh_token);
            }
            isRefreshing = false;
            onTokenRefreshed(data.access_token);
          } else {
            isRefreshing = false;
            handleLogout();
            throw new Error("Session expired. Please log in again.");
          }
        } catch (err) {
          isRefreshing = false;
          handleLogout();
          throw err;
        }
      }
      
      return new Promise(resolve => {
        refreshSubscribers.push(newToken => {
          headers.Authorization = `Bearer ${newToken}`;
          resolve(fetch(getApiUrl(path), { ...options, headers }).then(res => res.json()));
        });
      });
    } else {
      handleLogout();
      throw new Error("Authentication required");
    }
  }
  
  const contentType = response.headers.get("content-type") || "";
  let data;
  if (contentType.includes("application/json")) {
    data = await response.json().catch(() => ({}));
  } else {
    data = await response.text();
  }
  
  if (!response.ok) {
    const message = data && typeof data === "object" ? (data.error || data.message || "Request failed") : String(data || "Request failed");
    throw new Error(message);
  }
  return data;
}

let addedEmployees = loadSessionEmployees().map(e => ({ ...e, prediction: predictBurnout(e) }));
let allEmployees   = [...baseEmployees, ...addedEmployees];

async function syncEmployeesFromApi() {
  const token = getStoredAuthToken();
  if (!token) return;
  try {
    const data = await apiRequest("/api/employees", { cache: "no-store" });
    const serverEmployees = Array.isArray(data?.employees)
      ? data.employees
      : Array.isArray(data)
        ? data
        : [];
    if (Array.isArray(serverEmployees) && serverEmployees.length) {
      addedEmployees = serverEmployees.map(e => ({ ...e, prediction: e.prediction || predictBurnout(e) }));
      saveSessionEmployees(addedEmployees.map(e => {
        const { prediction, ...rest } = e;
        return rest;
      }));
      allEmployees = [...baseEmployees, ...addedEmployees];
      if (!state.selectedEmployeeId || !allEmployees.some(e => e.id === state.selectedEmployeeId)) {
        state.selectedEmployeeId = allEmployees[0]?.id || "";
      }
    }
  } catch (err) {
    console.error("Failed to sync employees:", err);
  }
}
async function persistEmployee(newEmp) {
  const urls = ["/api/employees", "http://localhost:8001/api/employees"];
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newEmp)
      });
      const result = await response.json().catch(() => ({}));
      if (response.ok) {
        return { employee: result.employee || newEmp, source: url };
      }
    } catch {}
  }

  const persisted = { ...newEmp };
  const stored = loadLocalEmployees();
  stored.push(persisted);
  saveLocalEmployees(stored);
  return { employee: persisted, source: "localStorage" };
}

/* ─── App State ────────────────────────────────────────── */
const state = {
  activeFilter:      "All",
  activeDeptFilter:  "All",
  sentimentFilter:   "All",
  selectedEmployeeId: allEmployees[0]?.id || "",
  search:            "",
  sortKey:           "score",
  sortDir:           "desc",
  trendRange:        6,
  empTrendRange:     6
};

/* ─── Prediction History ────────────────────────────────── */
const historyKey = "burnout_prediction_history";
function loadHistory() {
  try { return JSON.parse(sessionStorage.getItem(historyKey) || "[]"); } catch { return []; }
}
function saveHistory(list) { sessionStorage.setItem(historyKey, JSON.stringify(list)); }
let predictionHistory = loadHistory();

/* ─── Theme ────────────────────────────────────────────── */
function applyTheme(dark) {
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  localStorage.setItem("burnout_theme", dark ? "dark" : "light");
}

function initTheme() {
  const saved = localStorage.getItem("burnout_theme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(saved ? saved === "dark" : prefersDark);
}

/* ─── Helpers ──────────────────────────────────────────── */
function formatPercent(v) { return `${round(v)}%`; }

function getTrendSlice(employee, range) {
  const t = employee.trend || [];
  return t.slice(-range);
}

function getTrendLabels(range) {
  return MONTHS_ALL.slice(-range);
}

function getFilteredEmployees() {
  const term = state.search.trim().toLowerCase();
  return allEmployees.filter(e => {
    const matchRisk = state.activeFilter === "All" || e.prediction.risk === state.activeFilter;
    const matchDept = state.activeDeptFilter === "All" || e.department === state.activeDeptFilter;
    const matchSearch = !term || [e.name, e.department, e.designation, e.id]
      .join(" ").toLowerCase().includes(term);
    return matchRisk && matchDept && matchSearch;
  }).sort((a, b) => {
    let av, bv;
    switch (state.sortKey) {
      case "name":       av = a.name; bv = b.name; break;
      case "department": av = a.department; bv = b.department; break;
      case "score":      av = a.prediction.score; bv = b.prediction.score; break;
      case "risk":       av = RISK_ORDER[a.prediction.risk]; bv = RISK_ORDER[b.prediction.risk]; break;
      default:           av = a.prediction.score; bv = b.prediction.score;
    }
    if (typeof av === "string") return state.sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    return state.sortDir === "asc" ? av - bv : bv - av;
  });
}

/* ─── Count-up Animation ─────────────────────────────── */
function animateCounter(el, targetStr) {
  const isPercent = targetStr.includes("%");
  const target = parseInt(targetStr, 10);
  if (isNaN(target)) { el.textContent = targetStr; return; }
  const duration = 900;
  const start = performance.now();
  function step(now) {
    const t = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = `${Math.round(eased * target)}${isPercent ? "%" : ""}`;
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

/* ─── Render: Metrics ──────────────────────────────────── */
function renderMetrics() {
  const total   = allEmployees.length || 1;
  const average = allEmployees.reduce((s, e) => s + e.prediction.score, 0) / total;
  const highCt  = allEmployees.filter(e => ["High","Critical"].includes(e.prediction.risk)).length;
  const wellbeing  = 100 - average;
  const retentionRisk = allEmployees.filter(e => e.prediction.score >= 75 || e.job_satisfaction < 35).length;

  const metrics = [
    ["Average Burnout",  formatPercent(average),    "Across monitored workforce"],
    ["High Risk",        String(highCt),             "Employees requiring attention"],
    ["Well-being Index", formatPercent(wellbeing),   "Higher = healthier workforce"],
    ["Retention Risk",   String(retentionRisk),      "Employees with severe signals"]
  ];

  document.getElementById("metric-grid").innerHTML = metrics.map(([label, value, note]) => `
    <article class="metric">
      <p class="eyebrow">${escapeHtml(label)}</p>
      <strong data-count="${escapeHtml(value)}">${escapeHtml(value)}</strong>
      <span>${escapeHtml(note)}</span>
    </article>
  `).join("");

  // Count-up animation
  document.querySelectorAll(".metric strong[data-count]").forEach(el => {
    animateCounter(el, el.dataset.count);
  });
}

/* ─── Render: Employee Table ───────────────────────────── */
function renderEmployeeTable() {
  const list = getFilteredEmployees();
  document.getElementById("table-count").textContent = `${list.length} employee${list.length !== 1 ? "s" : ""}`;

  const rows = list.map(e => {
    const p   = e.prediction;
    const rec = p.recommendations[0]?.[0] || "Monitor";
    return `
      <tr>
        <td class="employee-cell">
          <strong>${escapeHtml(e.name)}</strong>
          <span>${escapeHtml(e.designation)} · ${escapeHtml(e.id)}</span>
        </td>
        <td>${escapeHtml(e.department)}</td>
        <td><strong>${escapeHtml(p.score)}</strong></td>
        <td><span class="risk-pill" style="background:${RISK_COLORS[p.risk]}">${escapeHtml(p.risk)}</span></td>
        <td>${getBadgeHTML(e.badge || (p.risk === "Low" ? "healthy" : null))}</td>
        <td>${escapeHtml(p.topDriver.name)}</td>
        <td>${escapeHtml(rec)}</td>
      </tr>
    `;
  }).join("");

  document.getElementById("employee-table").innerHTML = rows ||
    `<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:24px">No employees match the current filters.</td></tr>`;

  // Update sort arrows
  document.querySelectorAll("th.sortable").forEach(th => {
    const k = th.dataset.sort;
    th.classList.toggle("sort-asc",  k === state.sortKey && state.sortDir === "asc");
    th.classList.toggle("sort-desc", k === state.sortKey && state.sortDir === "desc");
  });
}

/* ─── Render: Heatmap ──────────────────────────────────── */
function renderHeatmap() {
  const grouped = new Map();
  allEmployees.forEach(e => {
    const g = grouped.get(e.department) || [];
    g.push(e);
    grouped.set(e.department, g);
  });

  document.getElementById("department-heatmap").innerHTML = [...grouped.entries()].map(([dept, group]) => {
    const score = group.reduce((s, e) => s + e.prediction.score, 0) / group.length;
    const risk  = getRiskLevel(score);
    const safeDept = escapeHtml(dept);
    return `
      <article class="heatmap-cell" style="background:${RISK_COLORS[risk]}" data-dept="${safeDept}" role="button" tabindex="0" aria-label="${safeDept}: ${escapeHtml(risk)} average risk">
        <span style="font-weight:600;font-size:.9rem">${safeDept}</span>
        <strong>${round(score)}</strong>
        <small>${escapeHtml(risk)} avg · ${group.length} employees</small>
      </article>
    `;
  }).join("");

  // Heatmap click → dept filter
  document.querySelectorAll(".heatmap-cell").forEach(cell => {
    cell.addEventListener("click", () => {
      const dept = cell.dataset.dept;
      state.activeDeptFilter = dept;
      document.getElementById("dept-filter").value = dept;
      renderEmployeeTable();
    });
  });
}

/* ─── Render: Donut Chart ───────────────────────────────── */
function renderRiskChart() {
  const canvas = document.getElementById("risk-chart");
  if (!canvas) return;
  const ctx    = canvas.getContext("2d");
  const dpr    = window.devicePixelRatio || 1;
  const W = canvas.parentElement.clientWidth || 320;
  const H = 260;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  canvas.style.height = H + "px";
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  const counts = ["Low","Medium","High","Critical"].map(risk => ({
    risk, count: allEmployees.filter(e => e.prediction.risk === risk).length
  }));
  const total   = counts.reduce((s, i) => s + i.count, 0) || 1;
  const cX = W / 2, cY = H / 2;
  const radius = Math.min(W, H) * 0.36;
  let start = -Math.PI / 2;

  counts.forEach(item => {
    const slice = (item.count / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cX, cY);
    ctx.arc(cX, cY, radius, start, start + slice);
    ctx.closePath();
    ctx.fillStyle = RISK_COLORS[item.risk];
    ctx.fill();
    start += slice;
  });

  // Donut hole
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  ctx.beginPath();
  ctx.arc(cX, cY, radius * 0.58, 0, Math.PI * 2);
  ctx.fillStyle = isDark ? "#161b22" : "#ffffff";
  ctx.fill();

  ctx.fillStyle = isDark ? "#e6edf3" : "#0f1923";
  ctx.font = "800 28px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(String(total), cX, cY + 5);
  ctx.font = "600 12px Inter, sans-serif";
  ctx.fillStyle = isDark ? "#8b949e" : "#64748b";
  ctx.fillText("Employees", cX, cY + 24);

  document.getElementById("risk-legend").innerHTML = counts.map(i => `
    <div class="legend-item">
      <span class="dot" style="background:${RISK_COLORS[i.risk]}"></span>
      ${i.risk}: <strong style="margin-left:auto">${i.count}</strong>
    </div>
  `).join("");
}

/* ─── Render: Department Bar Chart ─────────────────────── */
function renderDeptChart() {
  const canvas = document.getElementById("dept-chart");
  if (!canvas) return;

  const grouped = new Map();
  allEmployees.forEach(e => {
    const g = grouped.get(e.department) || [];
    g.push(e.prediction.score);
    grouped.set(e.department, g);
  });

  const depts = [...grouped.entries()].map(([name, scores]) => ({
    name,
    avg: round(scores.reduce((s, v) => s + v, 0) / scores.length)
  })).sort((a, b) => b.avg - a.avg);

  const dpr = window.devicePixelRatio || 1;
  const W   = canvas.parentElement.clientWidth || 600;
  const H   = 200;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  canvas.style.height = H + "px";

  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  ctx.fillStyle = isDark ? "#1c2128" : "#f7fafb";
  ctx.fillRect(0, 0, W, H);

  const padL = 110, padR = 24, padT = 16, padB = 16;
  const chartW = W - padL - padR;
  const barH   = Math.min(26, (H - padT - padB) / depts.length - 4);
  const gap    = (H - padT - padB - depts.length * barH) / (depts.length + 1);

  depts.forEach((dept, i) => {
    const y     = padT + gap + i * (barH + gap);
    const barW  = (dept.avg / 100) * chartW;
    const risk  = getRiskLevel(dept.avg);
    const color = RISK_COLORS[risk];

    // Background track
    ctx.fillStyle = isDark ? "#30363d" : "#e2e8f0";
    ctx.beginPath();
    ctx.roundRect(padL, y, chartW, barH, 4);
    ctx.fill();

    // Filled bar
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(padL, y, barW, barH, 4);
    ctx.fill();

    // Dept label
    ctx.fillStyle = isDark ? "#cdd9e5" : "#2d3748";
    ctx.font = "600 12px Inter, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(dept.name, padL - 8, y + barH / 2 + 4);

    // Score label
    ctx.fillStyle = "#fff";
    ctx.font = "700 11px Inter, sans-serif";
    ctx.textAlign = "left";
    if (barW > 30) ctx.fillText(dept.avg, padL + barW - 28, y + barH / 2 + 4);
    else {
      ctx.fillStyle = isDark ? "#cdd9e5" : "#2d3748";
      ctx.fillText(dept.avg, padL + barW + 6, y + barH / 2 + 4);
    }
  });

  // Store depts for click handling
  canvas._depts = depts.map((d, i) => {
    const y = padT + gap + i * (barH + gap);
    return { ...d, y, h: barH, padL, padR, padT, W, chartW };
  });

  canvas.onclick = (ev) => {
    const rect = canvas.getBoundingClientRect();
    const mx   = (ev.clientX - rect.left);
    const my   = (ev.clientY - rect.top);
    (canvas._depts || []).forEach(d => {
      if (mx >= d.padL && mx <= d.W - d.padR && my >= d.y && my <= d.y + d.h) {
        state.activeDeptFilter = d.name;
        document.getElementById("dept-filter").value = d.name;
        renderEmployeeTable();
        // Scroll to table
        document.getElementById("risk-table").scrollIntoView({ behavior: "smooth" });
      }
    });
  };

  canvas.style.cursor = "pointer";
}

/* ─── Render: Line Chart (generic) ─────────────────────── */
function drawLineChart(canvasId, labels, series, teamAvg, options = {}) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx  = canvas.getContext("2d");
  const dpr  = window.devicePixelRatio || 1;
  const W    = canvas.parentElement.clientWidth || 700;
  const H    = options.height || 280;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  canvas.style.height = H + "px";
  ctx.scale(dpr, dpr);

  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  const pad    = { top: 20, right: 24, bottom: 36, left: 46 };
  const cW     = W - pad.left - pad.right;
  const cH     = H - pad.top - pad.bottom;
  const n      = series.length;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = isDark ? "#1c2128" : "#f7fafb";
  ctx.fillRect(0, 0, W, H);

  // Grid lines
  [0, 25, 50, 75, 100].forEach(v => {
    const y = pad.top + cH - (v / 100) * cH;
    ctx.strokeStyle = isDark ? "#30363d" : "#e2e8f0";
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + cW, y);
    ctx.stroke();
    ctx.fillStyle = isDark ? "#6e7681" : "#94a3b8";
    ctx.font = "600 11px Inter, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(String(v), pad.left - 8, y + 4);
  });

  const px = (i) => pad.left + (cW / (n - 1)) * i;
  const py = (v) => pad.top + cH - (clamp(v) / 100) * cH;

  function drawLine(data, color, dash = []) {
    if (data.length < 2) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth   = 3;
    ctx.lineCap     = "round";
    ctx.lineJoin    = "round";
    ctx.setLineDash(dash);
    ctx.beginPath();
    data.forEach((v, i) => i === 0 ? ctx.moveTo(px(i), py(v)) : ctx.lineTo(px(i), py(v)));
    ctx.stroke();
    ctx.restore();
  }

  // Area fill
  if (series.length >= 2) {
    const color = options.color || "#0d9488";
    ctx.save();
    ctx.beginPath();
    series.forEach((v, i) => i === 0 ? ctx.moveTo(px(i), py(v)) : ctx.lineTo(px(i), py(v)));
    ctx.lineTo(px(n - 1), py(0));
    ctx.lineTo(px(0), py(0));
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + cH);
    grad.addColorStop(0, color + "30");
    grad.addColorStop(1, color + "00");
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();
  }

  // Team average overlay
  if (teamAvg && teamAvg.length === n) {
    drawLine(teamAvg, isDark ? "#6e7681" : "#94a3b8", [6, 4]);
  }

  // Main line
  drawLine(series, options.color || "#0d9488");

  // Dots
  series.forEach((v, i) => {
    ctx.beginPath();
    ctx.arc(px(i), py(v), 5, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.strokeStyle = options.color || "#0d9488";
    ctx.lineWidth = 2.5;
    ctx.stroke();
  });

  // X labels
  ctx.fillStyle = isDark ? "#6e7681" : "#94a3b8";
  ctx.font = "600 12px Inter, sans-serif";
  ctx.textAlign = "center";
  labels.forEach((label, i) => {
    ctx.fillText(label, px(i), H - 10);
  });
}

/* ─── Trend selects ─────────────────────────────────────── */
function renderTrendOptions() {
  const sel = document.getElementById("trend-select");
  sel.innerHTML = allEmployees.map(e => `<option value="${escapeHtml(e.id)}">${escapeHtml(e.name)}</option>`).join("");
  sel.value = state.selectedEmployeeId;
}

function getTeamAvg(range) {
  const n = range;
  return MONTHS_ALL.slice(-n).map((_, i) => {
    const vals = allEmployees.map(e => (e.trend || []).slice(-n)[i] || 0);
    return round(vals.reduce((s, v) => s + v, 0) / (vals.length || 1));
  });
}

function renderTrendChart() {
  const emp = allEmployees.find(e => e.id === state.selectedEmployeeId) || allEmployees[0];
  if (!emp) return;
  const range    = state.trendRange;
  const series   = getTrendSlice(emp, range);
  const labels   = getTrendLabels(range);
  const teamAvg  = getTeamAvg(range);
  drawLineChart("trend-chart", labels, series, teamAvg, {
    color:  RISK_COLORS[emp.prediction.risk],
    height: 280
  });
}

/* ─── Employee Select / Profile ─────────────────────────── */
function renderEmployeeSelect() {
  const sel = document.getElementById("employee-select");
  sel.innerHTML = allEmployees.map(e => `<option value="${escapeHtml(e.id)}">${escapeHtml(e.name)} — ${escapeHtml(e.department)}</option>`).join("");
  sel.value = state.selectedEmployeeId;
}

function renderEmployeeProfile() {
  const emp = allEmployees.find(e => e.id === state.selectedEmployeeId) || allEmployees[0];
  if (!emp) return;
  const p = emp.prediction;
  const badge = emp.badge || (p.risk === "Low" ? "healthy" : null);

  document.getElementById("employee-profile").innerHTML = `
    <div class="profile-name">
      <strong>${escapeHtml(emp.name)}</strong>
      <span>${escapeHtml(emp.designation)}</span>
      <span>${escapeHtml(emp.email)}</span>
    </div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <span class="risk-pill" style="background:${RISK_COLORS[p.risk]}">${escapeHtml(p.risk)} Risk</span>
      ${badge ? getBadgeHTML(badge) : ""}
    </div>
    <div class="profile-stats">
      <div class="profile-stat"><span>Burnout Score</span><strong>${escapeHtml(p.score)}</strong></div>
      <div class="profile-stat"><span>Stress Level</span><strong>${escapeHtml(emp.stress_level)}</strong></div>
      <div class="profile-stat"><span>Work Hours/day</span><strong>${escapeHtml(emp.work_hours)}h</strong></div>
      <div class="profile-stat"><span>Meeting Hours/wk</span><strong>${escapeHtml(emp.meeting_hours)}h</strong></div>
    </div>
  `;

  const range   = state.empTrendRange;
  const series  = getTrendSlice(emp, range);
  const labels  = getTrendLabels(range);
  const teamAvg = getTeamAvg(range);
  drawLineChart("employee-chart", labels, series, teamAvg, {
    color:  RISK_COLORS[p.risk],
    height: 240
  });

  document.getElementById("recommendation-list").innerHTML =
    p.recommendations.map(([title, text]) => `
      <article class="recommendation-item">
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(text)}</span>
      </article>
    `).join("");
}

/* ─── Dept Filter Dropdown ──────────────────────────────── */
function populateDeptFilter() {
  const depts = [...new Set(allEmployees.map(e => e.department))].sort();
  const sel   = document.getElementById("dept-filter");
  sel.innerHTML = `<option value="All">All Departments</option>` +
    depts.map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join("");
  sel.value = state.activeDeptFilter;
}

/* ─── Feedback Inbox ────────────────────────────────────── */
function renderFeedback() {
  const filter = state.sentimentFilter;
  const visible = allEmployees.filter(e => {
    const s = analyzeSentiment(e.feedback);
    return filter === "All" || s.label === filter;
  });

  document.getElementById("feedback-list").innerHTML = visible.map(e => {
    const sentiment = analyzeSentiment(e.feedback);
    const cloud = buildWordCloud(sentiment.words || []);
    return `
      <article class="feedback-item">
        <div>
          <strong>${escapeHtml(e.name)}</strong>
          <span>${escapeHtml(e.department)} · <span style="color:${sentiment.label === "Negative" ? "var(--red)" : sentiment.label === "Positive" ? "var(--green)" : "var(--muted)"};font-weight:700">${escapeHtml(sentiment.label)}</span></span>
        </div>
        <p class="feedback-text">"${escapeHtml(e.feedback)}"</p>
        <div class="word-cloud">${cloud}</div>
        <div class="driver">
          <div class="driver-top">
            <span>Negative sentiment</span>
            <strong>${sentiment.negative}%</strong>
          </div>
          <div class="bar">
            <span style="width:${sentiment.negative}%;background:${sentiment.negative >= 65 ? RISK_COLORS.High : sentiment.negative <= 38 ? RISK_COLORS.Low : RISK_COLORS.Medium}"></span>
          </div>
        </div>
      </article>
    `;
  }).join("") || `<p style="color:var(--muted);text-align:center;padding:32px">No feedback matches this filter.</p>`;
}

/* ─── Notifications ─────────────────────────────────────── */
function renderNotifications() {
  const atRisk = allEmployees
    .filter(e => ["High","Critical"].includes(e.prediction.risk))
    .sort((a, b) => b.prediction.score - a.prediction.score);

  const badge = document.getElementById("notif-badge");
  badge.textContent = atRisk.length;
  badge.setAttribute("data-count", atRisk.length > 0 ? "1" : "0");

  // Sidebar chips (top 3)
  document.getElementById("sidebar-alert-chips").innerHTML =
    atRisk.slice(0, 3).map(e => `
      <div class="alert-chip">
        <span>${escapeHtml(e.name)}</span>
        <span class="chip-score">${escapeHtml(e.prediction.score)}</span>
      </div>
    `).join("") || `<span style="font-size:.8rem;color:var(--sidebar-muted)">No critical alerts.</span>`;

  document.getElementById("notif-list").innerHTML = atRisk.map(e => `
    <div class="notif-card">
      <div class="notif-card-header">
        <span class="notif-card-name">${escapeHtml(e.name)}</span>
        <span class="risk-pill" style="background:${RISK_COLORS[e.prediction.risk]};font-size:.72rem">${escapeHtml(e.prediction.risk)}</span>
      </div>
      <div class="notif-card-body">
        ${escapeHtml(e.designation)} · ${escapeHtml(e.department)}<br>
        Score: <strong>${escapeHtml(e.prediction.score)}</strong> · Top driver: ${escapeHtml(e.prediction.topDriver.name)}
      </div>
      <span class="notif-card-action" data-emp-id="${escapeHtml(e.id)}">View employee →</span>
    </div>
  `).join("") || `<p style="color:var(--muted);text-align:center;padding:32px">No at-risk employees. Great job! 🎉</p>`;

  // Notification → employee action
  document.querySelectorAll(".notif-card-action[data-emp-id]").forEach(el => {
    el.addEventListener("click", () => {
      state.selectedEmployeeId = el.dataset.empId;
      switchSection("employee");
      closeNotifPanel();
      renderEmployeeSelect();
      renderEmployeeProfile();
    });
  });
}

/* ─── Prediction Result ─────────────────────────────────── */
function renderPredictionResult(result) {
  const color = RISK_COLORS[result.risk];
  document.getElementById("prediction-result").innerHTML = `
    <div class="score-ring" style="background:conic-gradient(${color} ${result.score * 3.6}deg, var(--line) 0deg)">
      <div class="score-ring-inner">
        <div>
          <strong>${escapeHtml(result.score)}</strong>
          <span>${escapeHtml(result.risk)} Risk</span>
        </div>
      </div>
    </div>
    <div style="text-align:center">
      <span class="risk-pill" style="background:${color}">${escapeHtml(result.sentiment.label)} Feedback</span>
    </div>
    <div class="driver-list">
      ${result.drivers.map(d => `
        <div class="driver">
          <div class="driver-top"><span>${escapeHtml(d.name)}</span><strong>${escapeHtml(d.normalized)}%</strong></div>
          <div class="bar"><span style="width:${d.normalized}%;background:${color}"></span></div>
        </div>
      `).join("")}
    </div>
    <div class="recommendation-grid">
      ${result.recommendations.map(([title, text]) => `
        <article class="recommendation-item">
          <strong>${escapeHtml(title)}</strong>
          <span>${escapeHtml(text)}</span>
        </article>
      `).join("")}
    </div>
  `;
}

/* ─── Prediction History ─────────────────────────────────── */
function addToHistory(result, input) {
  const entry = {
    ts: Date.now(),
    score: result.score,
    risk: result.risk,
    sentiment: result.sentiment.label,
    topDriver: result.topDriver.name,
    workHours: input.work_hours,
    overtime: input.overtime_hours,
    taskLoad: input.task_load,
    stressLevel: input.stress_level
  };
  predictionHistory.unshift(entry);
  if (predictionHistory.length > 20) predictionHistory.length = 20;
  saveHistory(predictionHistory);
  renderHistory();
}

function renderHistory() {
  const list = predictionHistory;
  const el   = document.getElementById("prediction-history");
  if (!list.length) {
    el.innerHTML = `<p class="history-empty">No predictions yet. Run the engine above to start logging.</p>`;
    return;
  }
  el.innerHTML = list.map((entry, i) => `
    <div class="history-item">
      <div style="text-align:center">
        <div class="history-score">${escapeHtml(entry.score)}</div>
        <span class="risk-pill" style="background:${RISK_COLORS[entry.risk]};font-size:.72rem">${escapeHtml(entry.risk)}</span>
      </div>
      <div>
        <div style="font-weight:700;font-size:.9rem">Top driver: ${escapeHtml(entry.topDriver)}</div>
        <div class="history-meta">${escapeHtml(entry.sentiment)} sentiment · ${escapeHtml(entry.workHours)}h work · ${escapeHtml(entry.taskLoad)}% load · stress ${escapeHtml(entry.stressLevel)}</div>
      </div>
      <div class="history-meta" style="text-align:right;min-width:90px">
        #${list.length - i}<br>
        ${escapeHtml(new Date(entry.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))}
      </div>
    </div>
  `).join("");
}

function exportHistoryCsv() {
  if (!predictionHistory.length) { alert("No prediction history to export."); return; }
  const headers = ["#","Timestamp","Score","Risk","Sentiment","TopDriver","WorkHours","Overtime","TaskLoad","StressLevel"];
  const rows    = predictionHistory.map((e, i) => [
    predictionHistory.length - i,
    new Date(e.ts).toLocaleString(),
    e.score, e.risk, e.sentiment, e.topDriver,
    e.workHours, e.overtime, e.taskLoad, e.stressLevel
  ]);
  const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replaceAll('"','""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = "burnout-prediction-history.csv"; a.click();
  URL.revokeObjectURL(url);
}

/* ─── CSV Export ─────────────────────────────────────────── */
function exportCsv() {
  const headers = ["Employee ID","Name","Department","Designation","Burnout Score","Risk Level","Badge","Top Driver"];
  const rows    = getFilteredEmployees().map(e => [
    e.id, e.name, e.department, e.designation,
    e.prediction.score, e.prediction.risk,
    e.badge || (e.prediction.risk === "Low" ? "healthy" : ""),
    e.prediction.topDriver.name
  ]);
  const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replaceAll('"','""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = "burnout-risk-register.csv"; a.click();
  URL.revokeObjectURL(url);
}

/* ─── Form Input ─────────────────────────────────────────── */
function getFormInput(form) {
  const d = new FormData(form);
  return {
    work_hours:      Number(d.get("work_hours")),
    overtime_hours:  Number(d.get("overtime_hours")),
    leave_days:      Number(d.get("leave_days")),
    meeting_hours:   Number(d.get("meeting_hours")),
    task_load:       Number(d.get("task_load")),
    completion_rate: Number(d.get("completion_rate")),
    job_satisfaction: Number(d.get("job_satisfaction")),
    stress_level:    Number(d.get("stress_level")),
    feedback:        d.get("feedback") || ""
  };
}

/* ─── Toast Notification Helper ──────────────────────────── */
function showToast(title, message, type = "success") {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <div class="toast-icon">
      ${type === "success" 
        ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`
        : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`
      }
    </div>
    <div class="toast-body">
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(message)}</span>
    </div>
  `;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add("fade-out");
    toast.addEventListener("animationend", () => toast.remove());
  }, 4000);
}

/* ─── Add/Edit/Weekly Modal Management ───────────────────── */
let modalActiveTab = "add"; // "add" | "edit" | "weekly"

function openModal() {
  const overlay = document.getElementById("modal-overlay");
  overlay.classList.add("open");
  overlay.setAttribute("aria-hidden", "false");
  switchModalTab("add");
}

function closeModal() {
  const overlay = document.getElementById("modal-overlay");
  overlay.classList.remove("open");
  overlay.setAttribute("aria-hidden", "true");
  document.getElementById("add-employee-form").reset();
  clearModalValidation();
}

function switchModalTab(tabId) {
  modalActiveTab = tabId;
  
  // Highlight tab button
  document.querySelectorAll(".modal-tab").forEach(btn => {
    const active = btn.dataset.modalTab === tabId;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });

  const gridContainer = document.getElementById("modal-grid-container");
  const secSelector = document.getElementById("m-sec-selector");
  const secIdentity = document.getElementById("m-sec-identity");
  const secWorkload = document.getElementById("m-sec-workload");
  const secWellness  = document.getElementById("m-sec-wellness");
  const secFeedback  = document.getElementById("m-sec-feedback");
  const previewPanel = document.getElementById("modal-preview");
  const submitBtn    = document.getElementById("modal-submit-btn");
  const modalTitle   = document.getElementById("modal-title");

  // Reset errors
  clearModalValidation();

  // Populate target employee dropdown if switching to Edit/Weekly
  if (tabId === "edit" || tabId === "weekly") {
    populateModalEmployeeSelect();
    secSelector.style.display = "block";
  } else {
    secSelector.style.display = "none";
  }

  if (tabId === "add") {
    modalTitle.textContent = "Add New Employee";
    gridContainer.classList.remove("preview-hidden");
    secIdentity.style.display = "block";
    secWorkload.style.display = "block";
    secWellness.style.display  = "block";
    secFeedback.style.display  = "block";
    previewPanel.style.display = "block";
    submitBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Add &amp; Score Employee`;
    
    // Reset form values to default
    document.getElementById("add-employee-form").reset();
    resetModalSliders();
    updateModalLivePreview();
  } 
  else if (tabId === "edit") {
    modalTitle.textContent = "Edit Employee Profile";
    gridContainer.classList.add("preview-hidden");
    secIdentity.style.display = "block";
    secWorkload.style.display = "none";
    secWellness.style.display  = "none";
    secFeedback.style.display  = "none";
    previewPanel.style.display = "none";
    submitBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Save Profile Changes`;
    
    loadEmployeeToModalFields();
  } 
  else if (tabId === "weekly") {
    modalTitle.textContent = "Weekly Update Entry";
    gridContainer.classList.remove("preview-hidden");
    secIdentity.style.display = "none";
    secWorkload.style.display = "block";
    secWellness.style.display  = "block";
    secFeedback.style.display  = "block";
    previewPanel.style.display = "block";
    submitBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Apply Weekly Update`;
    
    loadEmployeeToModalFields();
  }
}

function resetModalSliders() {
  document.querySelectorAll(".modal-range").forEach(range => {
    const val = range.value;
    const badge = document.getElementById(`rv-${range.name.replaceAll('_', '-')}`);
    if (badge) badge.textContent = val;
  });
}

function populateModalEmployeeSelect() {
  const sel = document.getElementById("m-select-emp");
  if (!sel) return;
  sel.innerHTML = allEmployees.map(e => `<option value="${escapeHtml(e.id)}">${escapeHtml(e.name)} (${escapeHtml(e.designation)} · ${escapeHtml(e.department)})</option>`).join("");
}

function loadEmployeeToModalFields() {
  const sel = document.getElementById("m-select-emp");
  if (!sel || !sel.value) return;
  const emp = allEmployees.find(e => e.id === sel.value);
  if (!emp) return;

  if (modalActiveTab === "edit") {
    document.getElementById("m-name").value = emp.name;
    document.getElementById("m-department").value = emp.department;
    document.getElementById("m-designation").value = emp.designation;
    document.getElementById("m-email").value = emp.email;
    document.getElementById("m-age").value = emp.age || 28;
    document.getElementById("m-experience").value = emp.experience || 3;
  } 
  else if (modalActiveTab === "weekly") {
    document.getElementById("m-work-hours").value = emp.work_hours;
    document.getElementById("m-overtime").value = emp.overtime_hours;
    document.getElementById("m-leave").value = emp.leave_days;
    document.getElementById("m-meetings").value = emp.meeting_hours;
    
    // Sliders
    const sliders = ["task_load", "completion_rate", "job_satisfaction", "stress_level"];
    sliders.forEach(key => {
      const input = document.getElementById(`m-${key.replaceAll('_', '-')}`);
      if (input) {
        input.value = emp[key] != null ? emp[key] : 50;
        const badge = document.getElementById(`rv-${key.replaceAll('_', '-')}`);
        if (badge) badge.textContent = input.value;
      }
    });

    document.getElementById("m-feedback").value = emp.feedback || "";
    updateModalLivePreview();
  }
}

function clearModalValidation() {
  document.querySelectorAll(".field-label.has-error").forEach(el => el.classList.remove("has-error"));
  document.querySelectorAll(".field-error").forEach(el => el.textContent = "");
  const errZone = document.getElementById("form-error-zone");
  if (errZone) {
    errZone.textContent = "";
    errZone.classList.remove("visible");
  }
}

function getModalInputValues() {
  return {
    name:             document.getElementById("m-name") ? document.getElementById("m-name").value.trim() : "",
    department:       document.getElementById("m-department") ? document.getElementById("m-department").value : "Engineering",
    designation:      document.getElementById("m-designation") ? document.getElementById("m-designation").value.trim() : "",
    email:            document.getElementById("m-email") ? document.getElementById("m-email").value.trim() : "",
    age:              document.getElementById("m-age") ? (Number(document.getElementById("m-age").value) || 28) : 28,
    experience:       document.getElementById("m-experience") ? (Number(document.getElementById("m-experience").value) || 3) : 3,
    work_hours:       document.getElementById("m-work-hours") ? Number(document.getElementById("m-work-hours").value) : 8,
    overtime_hours:   document.getElementById("m-overtime") ? Number(document.getElementById("m-overtime").value) : 0,
    leave_days:       document.getElementById("m-leave") ? Number(document.getElementById("m-leave").value) : 2,
    meeting_hours:    document.getElementById("m-meetings") ? Number(document.getElementById("m-meetings").value) : 8,
    task_load:        document.getElementById("m-task-load") ? Number(document.getElementById("m-task-load").value) : 60,
    completion_rate:  document.getElementById("m-completion-rate") ? Number(document.getElementById("m-completion-rate").value) : 75,
    job_satisfaction: document.getElementById("m-job-satisfaction") ? Number(document.getElementById("m-job-satisfaction").value) : 60,
    stress_level:     document.getElementById("m-stress-level") ? Number(document.getElementById("m-stress-level").value) : 50,
    feedback:         document.getElementById("m-feedback") ? document.getElementById("m-feedback").value.trim() : ""
  };
}

function updateModalLivePreview() {
  if (modalActiveTab === "edit") return;

  const vals = getModalInputValues();
  const res  = predictBurnout(vals);
  
  const scoreEl = document.getElementById("msp-score");
  const riskEl  = document.getElementById("msp-risk-pill");
  const ringEl  = document.getElementById("msp-ring");
  const driversEl = document.getElementById("msp-drivers");
  const recsEl    = document.getElementById("msp-recs");
  const sentEl    = document.getElementById("msp-sentiment");

  if (!scoreEl || !riskEl) return;

  const color = RISK_COLORS[res.risk];
  scoreEl.textContent = res.score;
  ringEl.style.background = `conic-gradient(${color} ${res.score * 3.6}deg, var(--line) 0deg)`;
  
  riskEl.textContent = `${res.risk} Risk`;
  riskEl.style.background = color;

  // Drivers
  driversEl.innerHTML = res.drivers.map(d => `
    <div class="msp-driver-row">
      <div class="msp-driver-label">
        <span>${d.name}</span>
        <strong>${d.normalized}%</strong>
      </div>
      <div class="bar"><span style="width:${d.normalized}%;background:${color}"></span></div>
    </div>
  `).join("");

  // Recommendations (top 2)
  recsEl.innerHTML = res.recommendations.slice(0, 2).map(([title, text]) => `
    <div class="msp-rec-item">
      <strong>${title}</strong>: ${text}
    </div>
  `).join("");

  // Sentiment label
  const sColor = res.sentiment.label === "Negative" ? "var(--red)" : res.sentiment.label === "Positive" ? "var(--green)" : "var(--muted)";
  sentEl.textContent = `${res.sentiment.label} Sentiment Feedback`;
  sentEl.style.background = sColor + "15";
  sentEl.style.color = sColor;
  sentEl.style.border = `1px solid ${sColor}30`;
}

function validateModalForm() {
  clearModalValidation();
  const vals = getModalInputValues();
  let errors = [];

  if (modalActiveTab === "add" || modalActiveTab === "edit") {
    if (!vals.name) {
      document.getElementById("err-name").textContent = "Full Name is required.";
      document.getElementById("m-name").parentElement.classList.add("has-error");
      errors.push("Full Name is required.");
    }
    if (!vals.designation) {
      document.getElementById("err-designation").textContent = "Designation is required.";
      document.getElementById("m-designation").parentElement.classList.add("has-error");
      errors.push("Designation is required.");
    }
    if (!vals.email) {
      document.getElementById("err-email").textContent = "Email is required.";
      document.getElementById("m-email").parentElement.classList.add("has-error");
      errors.push("Email is required.");
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(vals.email)) {
      document.getElementById("err-email").textContent = "Please enter a valid email address.";
      document.getElementById("m-email").parentElement.classList.add("has-error");
      errors.push("Invalid email format.");
    }
  }

  if (errors.length > 0) {
    const zone = document.getElementById("form-error-zone");
    zone.innerHTML = `Please fix the highlighted errors before submitting.`;
    zone.classList.add("visible");
    return false;
  }
  return true;
}

async function handleModalSubmit(form) {
  if (!validateModalForm()) {
    return;
  }

  const vals = getModalInputValues();

  if (modalActiveTab === "add") {
    const nextId = `EMP-${1013 + addedEmployees.length}`;
    const newEmp = {
      id: nextId,
      name: vals.name,
      department: vals.department,
      designation: vals.designation,
      email: vals.email,
      age: vals.age,
      gender: "—",
      experience: vals.experience,
      salary_level: Math.max(3, Math.min(10, Math.round(vals.experience * 1.5))),
      work_hours: vals.work_hours,
      overtime_hours: vals.overtime_hours,
      leave_days: vals.leave_days,
      meeting_hours: vals.meeting_hours,
      task_load: vals.task_load,
      completion_rate: vals.completion_rate,
      job_satisfaction: vals.job_satisfaction,
      stress_level: vals.stress_level,
      sentiment_score: null,
      feedback: vals.feedback,
      trend: Array.from({ length: 12 }, () => 30 + Math.round(Math.random() * 20)),
      badge: null
    };

    try {
      const response = await apiRequest("/api/employees", {
        method: "POST",
        body: JSON.stringify(newEmp)
      });
      if (response.success) {
        await syncEmployeesFromApi();
        showToast("Employee Added", `${newEmp.name} has been successfully added.`);
        refreshAllDashboards();
        state.selectedEmployeeId = response.employee?.id || newEmp.id;
        renderEmployeeSelect();
        renderEmployeeProfile();
        closeModal();
      }
    } catch (error) {
      console.error(error);
      showToast("Save Failed", error.message || "Unable to save employee.");
    }
  } 
  else if (modalActiveTab === "edit") {
    const sel = document.getElementById("m-select-emp");
    const empId = sel.value;
    const editPayload = {
      id: empId,
      name: vals.name,
      department: vals.department,
      designation: vals.designation,
      email: vals.email,
      age: vals.age,
      experience: vals.experience
    };

    try {
      const response = await apiRequest("/api/employees/update", {
        method: "POST",
        body: JSON.stringify(editPayload)
      });
      if (response.success) {
        await syncEmployeesFromApi();
        showToast("Profile Updated", `Profile saved successfully for ${vals.name}.`);
        refreshAllDashboards();
        state.selectedEmployeeId = empId;
        renderEmployeeSelect();
        renderEmployeeProfile();
        closeModal();
      }
    } catch (error) {
      console.error(error);
      showToast("Update Failed", error.message || "Unable to update employee profile.");
    }
  } 
  else if (modalActiveTab === "weekly") {
    const sel = document.getElementById("m-select-emp");
    const empId = sel.value;
    const weeklyPayload = {
      id: empId,
      work_hours: vals.work_hours,
      overtime_hours: vals.overtime_hours,
      leave_days: vals.leave_days,
      meeting_hours: vals.meeting_hours,
      task_load: vals.task_load,
      completion_rate: vals.completion_rate,
      job_satisfaction: vals.job_satisfaction,
      stress_level: vals.stress_level,
      feedback: vals.feedback
    };

    try {
      const response = await apiRequest("/api/employees/weekly-update", {
        method: "POST",
        body: JSON.stringify(weeklyPayload)
      });
      if (response.success) {
        await syncEmployeesFromApi();
        showToast("Weekly Update Saved", `Weekly well-being metrics updated successfully.`);
        refreshAllDashboards();
        state.selectedEmployeeId = empId;
        renderEmployeeSelect();
        renderEmployeeProfile();
        closeModal();
      }
    } catch (error) {
      console.error(error);
      showToast("Save Failed", error.message || "Unable to apply weekly metrics.");
    }
  }
}

function refreshAllDashboards() {
  renderMetrics();
  renderEmployeeTable();
  renderHeatmap();
  renderRiskChart();
  renderDeptChart();
  renderTrendOptions();
  renderTrendChart();
  renderEmployeeSelect();
  renderNotifications();
  populateDeptFilter();
  updateMonitoringSummary();
}

/* ─── Section Switch ─────────────────────────────────────── */
function switchSection(id) {
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === id));
  document.querySelectorAll(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.section === id));
  const titles = { overview: "HR Dashboard", employee: "Employee View", predictor: "Prediction Lab", feedback: "Feedback Inbox" };
  document.getElementById("page-title").textContent = titles[id] || "Dashboard";

  // Show Add Employee & Export CSV only on HR Dashboard
  const isOverview = id === "overview";
  document.getElementById("add-employee-btn").style.display = isOverview ? "" : "none";
  document.getElementById("export-btn").style.display        = isOverview ? "" : "none";
}

/* ─── Notification Panel ─────────────────────────────────── */
function openNotifPanel() {
  document.getElementById("notif-panel").classList.add("open");
  document.getElementById("notif-panel").setAttribute("aria-hidden","false");
  document.getElementById("notif-overlay").classList.add("open");
  document.getElementById("notif-overlay").setAttribute("aria-hidden","false");
}
function closeNotifPanel() {
  document.getElementById("notif-panel").classList.remove("open");
  document.getElementById("notif-panel").setAttribute("aria-hidden","true");
  document.getElementById("notif-overlay").classList.remove("open");
  document.getElementById("notif-overlay").setAttribute("aria-hidden","true");
}

/* ─── Monitoring Summary ─────────────────────────────────── */
function updateMonitoringSummary() {
  const depts = new Set(allEmployees.map(e => e.department)).size;
  document.getElementById("monitoring-summary").textContent =
    `${allEmployees.length} employees across ${depts} departments`;
  const now = new Date();
  document.getElementById("monitoring-month").textContent =
    now.toLocaleString("default", { month: "long", year: "numeric" });
}

/* ─── Bind Events ────────────────────────────────────────── */
function safeOn(id, event, fn) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(event, fn);
}

function bindEvents() {
  // Navigation
  document.querySelectorAll(".nav-item").forEach(btn =>
    btn.addEventListener("click", () => switchSection(btn.dataset.section)));

  // Theme
  safeOn("theme-toggle", "click", () => {
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    applyTheme(!isDark);
    setTimeout(() => { renderRiskChart(); renderTrendChart(); renderDeptChart(); renderEmployeeProfile(); }, 50);
  });

  // Notification panel
  safeOn("notification-btn", "click", openNotifPanel);
  safeOn("close-notif-btn",  "click", closeNotifPanel);
  safeOn("notif-overlay",    "click", closeNotifPanel);

  // Modal Buttons
  safeOn("add-employee-btn", "click", openModal);
  safeOn("close-modal-btn",  "click", closeModal);
  safeOn("cancel-modal-btn", "click", closeModal);
  safeOn("modal-overlay", "click", e => {
    if (e.target === document.getElementById("modal-overlay")) closeModal();
  });

  // Tab switching inside the modal
  document.querySelectorAll(".modal-tab").forEach(tab => {
    tab.addEventListener("click", () => switchModalTab(tab.dataset.modalTab));
  });

  // Select employee listener in modal
  safeOn("m-select-emp", "change", loadEmployeeToModalFields);

  // Modal form submit
  const addEmployeeForm = document.getElementById("add-employee-form");
  if (addEmployeeForm) {
    addEmployeeForm.addEventListener("submit", e => {
      console.log("[modal] form submit event fired");
      e.preventDefault();
      handleModalSubmit(e.currentTarget);
    });
  }

  // Modal range inputs & live preview update
  document.querySelectorAll(".modal-range").forEach(r => {
    r.addEventListener("input", () => {
      const badgeId = `rv-${r.name.replaceAll('_', '-')}`;
      const badge = document.getElementById(badgeId);
      if (badge) badge.textContent = r.value;
      updateModalLivePreview();
    });
  });

  // Update live preview when number inputs, select or feedback are changed
  document.querySelectorAll("#add-employee-form input:not([type='range']), #add-employee-form select, #add-employee-form textarea").forEach(input => {
    input.addEventListener("input", updateModalLivePreview);
    input.addEventListener("change", updateModalLivePreview);
  });

  // Risk filter (segmented control for table)
  document.querySelectorAll(".segment[data-filter]").forEach(btn => {
    btn.addEventListener("click", () => {
      state.activeFilter = btn.dataset.filter;
      document.querySelectorAll(".segment[data-filter]").forEach(s =>
        s.classList.toggle("active", s === btn));
      renderEmployeeTable();
    });
  });

  // Dept filter dropdown
  document.getElementById("dept-filter").addEventListener("change", e => {
    state.activeDeptFilter = e.target.value;
    renderEmployeeTable();
  });

  // Sentiment filter (feedback inbox)
  document.querySelectorAll(".segment[data-sentiment-filter]").forEach(btn => {
    btn.addEventListener("click", () => {
      state.sentimentFilter = btn.dataset.sentimentFilter;
      document.querySelectorAll(".segment[data-sentiment-filter]").forEach(s =>
        s.classList.toggle("active", s === btn));
      renderFeedback();
    });
  });

  // Search
  document.getElementById("employee-search").addEventListener("input", e => {
    state.search = e.target.value;
    renderEmployeeTable();
  });

  // Trend range (HR dashboard)
  document.querySelectorAll(".segment[data-trend-range]").forEach(btn => {
    btn.addEventListener("click", () => {
      state.trendRange = Number(btn.dataset.trendRange);
      document.querySelectorAll(".segment[data-trend-range]").forEach(s =>
        s.classList.toggle("active", s === btn));
      renderTrendChart();
    });
  });

  // Trend range (Employee view)
  document.querySelectorAll(".segment[data-emp-trend-range]").forEach(btn => {
    btn.addEventListener("click", () => {
      state.empTrendRange = Number(btn.dataset.empTrendRange);
      document.querySelectorAll(".segment[data-emp-trend-range]").forEach(s =>
        s.classList.toggle("active", s === btn));
      renderEmployeeProfile();
    });
  });

  // Trend employee select (HR dashboard)
  document.getElementById("trend-select").addEventListener("change", e => {
    state.selectedEmployeeId = e.target.value;
    document.getElementById("employee-select").value = state.selectedEmployeeId;
    renderTrendChart();
    renderEmployeeProfile();
  });

  // Employee select (Employee view)
  document.getElementById("employee-select").addEventListener("change", e => {
    state.selectedEmployeeId = e.target.value;
    document.getElementById("trend-select").value = state.selectedEmployeeId;
    renderTrendChart();
    renderEmployeeProfile();
  });

  // Table sort
  document.querySelectorAll("th.sortable").forEach(th => {
    th.addEventListener("click", () => {
      const k = th.dataset.sort;
      if (state.sortKey === k) {
        state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
      } else {
        state.sortKey = k;
        state.sortDir = k === "score" ? "desc" : "asc";
      }
      renderEmployeeTable();
    });
  });

  // Prediction form
  document.getElementById("prediction-form").addEventListener("submit", async e => {
    e.preventDefault();
    const input = getFormInput(e.currentTarget);
    try {
      const data = await apiRequest("/api/predict", {
        method: "POST",
        body: JSON.stringify(input)
      });
      if (data.success && data.prediction) {
        renderPredictionResult(data.prediction);
        addToHistory(data.prediction, input);
        return;
      }
    } catch (err) {
      console.warn("Prediction API failed, using fallback heuristic:", err);
    }
    const result = predictBurnout(input);
    renderPredictionResult(result);
    addToHistory(result, input);
  });

  // Range inputs (prediction form)
  document.querySelectorAll("#prediction-form input[type='range']").forEach(r => {
    r.addEventListener("input", () => {
      const span = document.querySelector(`[data-range-value="${r.name}"]`);
      if (span) span.textContent = r.value;
    });
  });

  // Export CSV
  document.getElementById("export-btn").addEventListener("click", exportCsv);

  // History
  document.getElementById("export-history-btn").addEventListener("click", exportHistoryCsv);
  document.getElementById("clear-history-btn").addEventListener("click", () => {
    predictionHistory = [];
    saveHistory([]);
    renderHistory();
  });

  // Keyboard close
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") { closeModal(); closeNotifPanel(); }
  });

  // Resize: redraw canvas
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      renderRiskChart();
      renderTrendChart();
      renderDeptChart();
      renderEmployeeProfile();
    }, 150);
  });
}

async function loadModelMetrics() {
  try {
    const data = await apiRequest("/api/model/metrics");
    if (data && data.success && data.metrics) {
      const m = data.metrics;
      const resultPanel = document.getElementById("history-panel");
      if (resultPanel) {
        let metricsContainer = document.getElementById("model-perf-metrics");
        if (!metricsContainer) {
          metricsContainer = document.createElement("div");
          metricsContainer.id = "model-perf-metrics";
          metricsContainer.className = "panel";
          metricsContainer.style.marginBottom = "24px";
          resultPanel.parentNode.insertBefore(metricsContainer, resultPanel);
        }
        metricsContainer.innerHTML = `
          <div class="panel-heading">
            <div>
              <p class="eyebrow">Scikit-Learn Random Forest Classifier</p>
              <h3>Model Training Performance Metrics</h3>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(120px, 1fr));gap:16px;margin-top:16px">
            <div style="background:var(--surface-soft);padding:16px;border-radius:10px;border:1px solid var(--line);text-align:center">
              <span style="font-size:0.8rem;color:var(--muted);font-weight:600">ACCURACY</span>
              <h2 style="margin-top:6px;color:var(--teal)">${(m.accuracy * 100).toFixed(1)}%</h2>
            </div>
            <div style="background:var(--surface-soft);padding:16px;border-radius:10px;border:1px solid var(--line);text-align:center">
              <span style="font-size:0.8rem;color:var(--muted);font-weight:600">PRECISION</span>
              <h2 style="margin-top:6px;color:var(--teal)">${(m.precision * 100).toFixed(1)}%</h2>
            </div>
            <div style="background:var(--surface-soft);padding:16px;border-radius:10px;border:1px solid var(--line);text-align:center">
              <span style="font-size:0.8rem;color:var(--muted);font-weight:600">RECALL</span>
              <h2 style="margin-top:6px;color:var(--teal)">${(m.recall * 100).toFixed(1)}%</h2>
            </div>
            <div style="background:var(--surface-soft);padding:16px;border-radius:10px;border:1px solid var(--line);text-align:center">
              <span style="font-size:0.8rem;color:var(--muted);font-weight:600">F1 SCORE</span>
              <h2 style="margin-top:6px;color:var(--teal)">${(m.f1_score * 100).toFixed(1)}%</h2>
            </div>
          </div>
        `;
      }
    }
  } catch (err) {
    console.error("Failed to load model metrics:", err);
  }
}

function checkPasswordStrength(password) {
  let score = 0;
  if (password.length >= 8) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  return score;
}

let authMode = "login";
let authEventsBound = false;

function toggleAuthMode() {
  const submitBtn = document.getElementById("auth-submit-btn");
  const toggleBtn = document.getElementById("auth-toggle-btn");
  const toggleText = document.getElementById("auth-toggle-text");
  const roleLabel = document.getElementById("auth-role-label");
  const title = document.getElementById("auth-subtitle");
  const pwdStrength = document.getElementById("pwd-strength");
  
  const errZone = document.getElementById("auth-error-zone");
  if (errZone) {
    errZone.textContent = "";
    errZone.className = "form-error-zone";
  }
  
  if (authMode === "login") {
    authMode = "register";
    title.textContent = "Create a new HR account";
    submitBtn.textContent = "Register";
    toggleText.textContent = "Already have an account?";
    toggleBtn.textContent = "Sign in here";
    roleLabel.style.display = "flex";
    pwdStrength.style.display = "flex";
  } else {
    authMode = "login";
    title.textContent = "Sign in to access HR well-being analytics";
    submitBtn.textContent = "Sign In";
    toggleText.textContent = "Don't have an account?";
    toggleBtn.textContent = "Register here";
    roleLabel.style.display = "none";
    pwdStrength.style.display = "none";
  }
}

function decodeJwt(token) {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(window.atob(base64).split('').map(function(c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    return JSON.parse(jsonPayload);
  } catch (e) {
    return null;
  }
}

let passwordChangeEventsBound = false;
function bindPasswordChangeEvents() {
  if (passwordChangeEventsBound) return;
  passwordChangeEventsBound = true;
  
  const newPasswordInput = document.getElementById("m-new-pwd");
  if (newPasswordInput) {
    newPasswordInput.addEventListener("input", e => {
      const pwdStrength = document.getElementById("m-pwd-strength");
      pwdStrength.style.display = "flex";
      const val = e.target.value;
      const score = checkPasswordStrength(val);
      pwdStrength.setAttribute("data-strength", score.toString());
      
      const pwdText = pwdStrength.querySelector(".pwd-text");
      const strengths = [
        "Strength: Very Weak (need 8+ chars)",
        "Strength: Weak (need uppercase)",
        "Strength: Medium (need digit)",
        "Strength: Strong"
      ];
      pwdText.textContent = strengths[Math.min(score, strengths.length - 1)];
    });
  }
  
  const pwdChangeForm = document.getElementById("password-change-form");
  if (pwdChangeForm) {
    pwdChangeForm.addEventListener("submit", async e => {
      e.preventDefault();
      
      const currentPassword = document.getElementById("m-curr-pwd").value;
      const newPassword = document.getElementById("m-new-pwd").value;
      const confirmPassword = document.getElementById("m-conf-pwd").value;
      const errZone = document.getElementById("pwd-change-error-zone");
      
      if (errZone) {
        errZone.textContent = "";
        errZone.classList.remove("visible");
      }
      
      if (!currentPassword || !newPassword || !confirmPassword) {
        if (errZone) {
          errZone.textContent = "All fields are required.";
          errZone.classList.add("visible");
        }
        return;
      }
      
      if (newPassword !== confirmPassword) {
        if (errZone) {
          errZone.textContent = "New passwords do not match.";
          errZone.classList.add("visible");
        }
        return;
      }
      
      const score = checkPasswordStrength(newPassword);
      if (score < 4) {
        if (errZone) {
          errZone.textContent = "New password must meet strength criteria (8+ characters, uppercase letter, number, and special character).";
          errZone.classList.add("visible");
        }
        return;
      }
      
      try {
        const data = await apiRequest("/api/auth/change-password", {
          method: "POST",
          body: JSON.stringify({ current_password: currentPassword, new_password: newPassword })
        });
        
        saveStoredAuthToken(data.access_token);
        saveStoredRefreshToken(data.refresh_token);
        
        document.getElementById("password-change-overlay").classList.remove("open");
        document.getElementById("password-change-overlay").setAttribute("aria-hidden", "true");
        
        showToast("Password Updated", "Your password has been successfully changed.");
        window.location.reload();
      } catch (err) {
        if (errZone) {
          errZone.textContent = err.message || "Failed to update password.";
          errZone.classList.add("visible");
        }
      }
    });
  }
}


function bindAuthEvents() {
  if (authEventsBound) return;
  authEventsBound = true;
  
  const toggleBtn = document.getElementById("auth-toggle-btn");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", toggleAuthMode);
  }
  
  const passwordField = document.getElementById("auth-password");
  if (passwordField) {
    passwordField.addEventListener("input", e => {
      const pwdStrength = document.getElementById("pwd-strength");
      if (authMode === "login") {
        pwdStrength.style.display = "none";
        return;
      }
      pwdStrength.style.display = "flex";
      const val = e.target.value;
      const score = checkPasswordStrength(val);
      pwdStrength.setAttribute("data-strength", score.toString());
      
      const pwdText = pwdStrength.querySelector(".pwd-text");
      const strengths = [
        "Strength: Very Weak (need 8+ chars)",
        "Strength: Weak (need uppercase)",
        "Strength: Medium (need digit)",
        "Strength: Strong"
      ];
      pwdText.textContent = strengths[Math.min(score, strengths.length - 1)];
    });
  }
  
  const authForm = document.getElementById("auth-form");
  if (authForm) {
    authForm.addEventListener("submit", async e => {
      e.preventDefault();
      
      const email = document.getElementById("auth-email").value.trim();
      const password = document.getElementById("auth-password").value;
      const role = document.getElementById("auth-role").value;
      const errZone = document.getElementById("auth-error-zone");
      
      if (errZone) {
        errZone.textContent = "";
        errZone.classList.remove("visible");
      }
      
      if (!email || !password) {
        if (errZone) {
          errZone.textContent = "Email and password are required.";
          errZone.classList.add("visible");
        }
        return;
      }
      
      if (authMode === "register") {
        const score = checkPasswordStrength(password);
        if (score < 4) {
          if (errZone) {
            errZone.textContent = "Password is too weak. Must contain 8+ characters, uppercase letter, number, and special character.";
            errZone.classList.add("visible");
          }
          return;
        }
        
        try {
          const res = await fetch(getApiUrl("/api/register"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password, role })
          });
          const data = await res.json();
          if (!res.ok) {
            throw new Error(data.error || "Registration failed");
          }
          showToast("Registered Successfully", "You can now log in with your credentials.");
          toggleAuthMode();
        } catch (err) {
          if (errZone) {
            errZone.textContent = err.message || "Registration failed.";
            errZone.classList.add("visible");
          }
        }
      } else {
        try {
          const res = await fetch(getApiUrl("/api/login"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password })
          });
          const data = await res.json();
          if (!res.ok) {
            throw new Error(data.error || "Login failed");
          }
          
          saveStoredAuthToken(data.access_token);
          saveStoredRefreshToken(data.refresh_token);
          saveStoredUser(data.user);
          
          if (data.password_change_required) {
            document.getElementById("auth-overlay").style.display = "none";
            document.getElementById("password-change-overlay").classList.add("open");
            document.getElementById("password-change-overlay").setAttribute("aria-hidden", "false");
            bindPasswordChangeEvents();
            showToast("Password Change Required", "Please change your password to continue.", "error");
            return;
          }
          
          document.getElementById("auth-overlay").style.display = "none";
          document.querySelector(".app-shell").style.display = "grid";
          
          const profileBlock = document.getElementById("user-profile-block");
          profileBlock.style.display = "flex";
          
          const avatarLetter = (data.user.email || "A").substring(0, 1).toUpperCase();
          document.getElementById("user-avatar").textContent = avatarLetter;
          document.getElementById("user-display-email").textContent = data.user.email;
          document.getElementById("user-display-role").textContent = data.user.role === "admin" ? "Administrator" : "HR Staff";
          
          const isAdmin = data.user.role === "admin";
          const addEmpBtn = document.getElementById("add-employee-btn");
          if (addEmpBtn) addEmpBtn.style.display = isAdmin ? "" : "none";
          
          showToast("Welcome Back", "Successfully authenticated.");
          init();
        } catch (err) {
          if (errZone) {
            errZone.textContent = err.message || "Invalid credentials.";
            errZone.classList.add("visible");
          }
        }
      }
    });
  }
  
  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      const refreshToken = getStoredRefreshToken();
      if (refreshToken) {
        try {
          await fetch(getApiUrl("/api/auth/logout"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ refresh_token: refreshToken })
          });
        } catch (e) {
          console.error("API logout failed:", e);
        }
      }
      handleLogout();
      showToast("Signed Out", "You have successfully signed out.");
    });
  }
}

/* ─── Init ───────────────────────────────────────────────── */
async function init() {
  console.log("[app] init started");
  initTheme();
  
  const token = getStoredAuthToken();
  const user = getStoredUser();
  
  if (!token || !user) {
    document.getElementById("auth-overlay").style.display = "flex";
    document.querySelector(".app-shell").style.display = "none";
    document.getElementById("user-profile-block").style.display = "none";
    bindAuthEvents();
    return;
  }
  
  const claims = decodeJwt(token);
  if (claims && claims.needs_password_change) {
    document.getElementById("auth-overlay").style.display = "none";
    document.getElementById("password-change-overlay").classList.add("open");
    document.getElementById("password-change-overlay").setAttribute("aria-hidden", "false");
    document.querySelector(".app-shell").style.display = "none";
    document.getElementById("user-profile-block").style.display = "none";
    bindPasswordChangeEvents();
    bindAuthEvents();
    return;
  }
  
  document.getElementById("auth-overlay").style.display = "none";
  document.querySelector(".app-shell").style.display = "grid";
  
  const profileBlock = document.getElementById("user-profile-block");
  profileBlock.style.display = "flex";
  
  const avatarLetter = (user.email || "A").substring(0, 1).toUpperCase();
  document.getElementById("user-avatar").textContent = avatarLetter;
  document.getElementById("user-display-email").textContent = user.email;
  document.getElementById("user-display-role").textContent = user.role === "admin" ? "Administrator" : "HR Staff";
  
  const isAdmin = user.role === "admin";
  const addEmpBtn = document.getElementById("add-employee-btn");
  if (addEmpBtn) addEmpBtn.style.display = isAdmin ? "" : "none";
  
  await syncEmployeesFromApi();
  await loadModelMetrics();
  updateMonitoringSummary();
  renderMetrics();
  renderEmployeeTable();
  renderHeatmap();
  renderRiskChart();
  renderDeptChart();
  renderTrendOptions();
  renderTrendChart();
  renderEmployeeSelect();
  renderEmployeeProfile();
  renderFeedback();
  renderNotifications();
  populateDeptFilter();
  renderHistory();

  // Initial prediction result
  const initInput  = getFormInput(document.getElementById("prediction-form"));
  const initResult = predictBurnout(initInput);
  renderPredictionResult(initResult);

  switchSection("overview");

  console.log("[app] binding events");
  bindEvents();
  bindAuthEvents();
  console.log("[app] events bound");
}

init();

