import { app as E, ipcMain as v, dialog as M, BrowserWindow as Oe } from "electron";
import { fileURLToPath as De } from "node:url";
import h from "node:path";
import Y from "node:os";
import T from "node:fs";
import He from "node:net";
import { randomUUID as Le, createHash as Ge, createHmac as je } from "node:crypto";
import We from "node-pty";
const q = h.dirname(De(import.meta.url)), Ze = T.existsSync(h.join(q, "preload.mjs")) ? h.join(q, "preload.mjs") : h.join(q, "preload.js");
let x = null;
const fe = "TMT-Terminal-mirror-translation", A = /* @__PURE__ */ new Map(), z = /* @__PURE__ */ new Map(), X = (e) => {
  const t = z.get(e);
  return t ? (t.socket.destroy(), z.delete(e), !0) : !1;
}, ye = (e, t) => {
  if (t.length === 0)
    return;
  const n = A.get(e);
  if (n) {
    n.write(t);
    return;
  }
  const o = z.get(e);
  if (o)
    try {
      const r = o.protocol === "telnet" ? t.replace(/\x7f/g, "\b") : t;
      o.socket.write(r);
    } catch {
    }
}, me = "glossary.json", we = "contexts.json", ve = "translation.config.json", xe = "translation.config.local", u = {
  version: 1,
  defaultProvider: "google-free",
  timeoutMs: 12e3,
  fallbackProviders: [],
  mirror: {
    skipRules: {
      stackLike: !0,
      symbolOnly: !0,
      protectedOnly: !0,
      outOfViewport: !0
    },
    localMatchPriority: ["exact", "caseInsensitive", "pattern"],
    fallbackUiOnly: !0
  },
  providers: {
    googleFree: {
      endpoint: "https://translate.googleapis.com/translate_a/single",
      endpoints: [
        "https://translate.googleapis.com/translate_a/single",
        "https://translate.google.com/translate_a/single"
      ]
    },
    openaiCompatible: {
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      apiKeyEnv: "OPENAI_API_KEY",
      apiKey: void 0
    },
    tencentTmt: {
      endpoint: "https://tmt.tencentcloudapi.com",
      region: "ap-guangzhou",
      source: "en",
      target: "zh",
      projectId: 0,
      secretIdEnv: "TENCENT_SECRET_ID",
      secretKeyEnv: "TENCENT_SECRET_KEY"
    }
  }
}, B = {
  version: 1,
  defaultContextId: "shell",
  contexts: [
    { id: "shell", label: "Shell", detectHints: ["zsh", "bash", "shell", "$ ", "% ", "# "] },
    {
      id: "opencode",
      label: "OpenCode",
      detectHints: ["opencode", "ask anything", "tip press", "/task", "/plan", "/help"]
    },
    {
      id: "codex",
      label: "Codex",
      detectHints: ["codex", "gpt-5.3-codex", "/apply_patch", "/check", "/help"]
    }
  ],
  buttons: [
    {
      id: "shell-ls-la",
      labelZh: "列出目录",
      actionType: "sendText",
      payload: `ls -la
`,
      contextId: "shell",
      risk: "safe",
      order: 1
    },
    {
      id: "shell-pwd",
      labelZh: "当前路径",
      actionType: "sendText",
      payload: `pwd
`,
      contextId: "shell",
      risk: "safe",
      order: 2
    },
    {
      id: "shell-clear",
      labelZh: "清屏",
      actionType: "sendText",
      payload: `clear
`,
      contextId: "shell",
      risk: "safe",
      order: 3
    },
    {
      id: "shell-up",
      labelZh: "上一条",
      actionType: "sendAnsi",
      payload: "\\x1b[A",
      contextId: "shell",
      risk: "safe",
      order: 4
    },
    {
      id: "shell-down",
      labelZh: "下一条",
      actionType: "sendAnsi",
      payload: "\\x1b[B",
      contextId: "shell",
      risk: "safe",
      order: 5
    },
    {
      id: "shell-ctrl-c",
      labelZh: "中断 (Ctrl+C)",
      actionType: "sendKey",
      payload: "Ctrl+C",
      contextId: "shell",
      risk: "caution",
      order: 6
    },
    {
      id: "opencode-help",
      labelZh: "显示帮助",
      actionType: "sendText",
      payload: `/help
`,
      contextId: "opencode",
      risk: "safe",
      order: 1
    },
    {
      id: "opencode-clear",
      labelZh: "清屏",
      actionType: "sendText",
      payload: `clear
`,
      contextId: "opencode",
      risk: "safe",
      order: 2
    },
    {
      id: "opencode-stop",
      labelZh: "停止输出",
      actionType: "sendKey",
      payload: "Ctrl+C",
      contextId: "opencode",
      risk: "caution",
      order: 3
    },
    {
      id: "codex-help",
      labelZh: "查看帮助",
      actionType: "sendText",
      payload: `/help
`,
      contextId: "codex",
      risk: "safe",
      order: 1
    },
    {
      id: "codex-continue",
      labelZh: "继续执行",
      actionType: "sendText",
      payload: `/continue
`,
      contextId: "codex",
      risk: "safe",
      order: 2
    },
    {
      id: "codex-stop",
      labelZh: "终止当前任务",
      actionType: "sendKey",
      payload: "Ctrl+C",
      contextId: "codex",
      risk: "caution",
      order: 3
    }
  ]
}, ne = (e, t = "exact") => e === "exact" || e === "caseInsensitive" || e === "pattern" ? e : t, oe = (e) => e === "network-cisco" || e === "network-huawei" || e === "network-h3c" || e === "network-ruijie" || e === "common" ? e : "common", Te = (e, t) => {
  if (typeof e != "string")
    return t;
  const n = e.trim();
  if (n.length === 0)
    return t;
  const o = Date.parse(n);
  return Number.isNaN(o) ? t : new Date(o).toISOString();
}, Q = (e) => {
  const t = e.source.trim(), n = ne(e.matchType, "exact"), o = typeof e.caseInsensitive == "boolean" ? e.caseInsensitive : n === "caseInsensitive", r = o ? t.toLocaleLowerCase() : t;
  return `${oe(e.domain)}:${n}:${o ? "i" : "s"}:${r}`;
}, re = (e, t = {}) => {
  const n = /* @__PURE__ */ new Map(), o = t.legacyDefaultCaseInsensitive ? "caseInsensitive" : "exact";
  for (const r of e) {
    const s = r.source.trim(), i = r.target.trim();
    if (s.length < 2 || i.length === 0)
      continue;
    const c = (/* @__PURE__ */ new Date()).toISOString(), d = ne(r.matchType, o), a = typeof r.caseInsensitive == "boolean" ? r.caseInsensitive : d === "caseInsensitive", l = typeof r.note == "string" ? r.note.trim() : "", b = typeof r.id == "string" && r.id.trim().length > 0 ? r.id.trim() : Le(), m = Te(r.createdAt, c), p = Te(r.updatedAt, c), g = oe(r.domain), y = {
      id: b,
      source: s,
      target: i,
      matchType: d,
      caseInsensitive: a,
      note: l,
      domain: g,
      createdAt: m,
      updatedAt: p,
      uiOnly: typeof r.uiOnly == "boolean" ? r.uiOnly : void 0,
      wholeWord: typeof r.wholeWord == "boolean" ? r.wholeWord : void 0
    };
    n.set(Q(y), y);
  }
  return Array.from(n.values());
}, be = (e) => {
  const t = [];
  for (const n of e) {
    if (typeof n != "object" || !n)
      continue;
    const o = n.source, r = n.target;
    typeof o != "string" || typeof r != "string" || t.push({
      id: typeof n.id == "string" ? n.id : void 0,
      source: o,
      target: r,
      matchType: ne(n.matchType, "caseInsensitive"),
      caseInsensitive: typeof n.caseInsensitive == "boolean" ? n.caseInsensitive : void 0,
      note: typeof n.note == "string" ? n.note : void 0,
      domain: oe(n.domain),
      createdAt: typeof n.createdAt == "string" ? n.createdAt : void 0,
      updatedAt: typeof n.updatedAt == "string" ? n.updatedAt : void 0,
      uiOnly: typeof n.uiOnly == "boolean" ? n.uiOnly : void 0,
      wholeWord: typeof n.wholeWord == "boolean" ? n.wholeWord : void 0
    });
  }
  return re(t, { legacyDefaultCaseInsensitive: !0 });
}, $e = (e) => {
  const t = JSON.parse(e);
  if (Array.isArray(t))
    return be(t);
  if (typeof t == "object" && t !== null && Array.isArray(t.entries))
    return be(t.entries);
  if (typeof t == "object" && t !== null) {
    const n = [];
    for (const [o, r] of Object.entries(t))
      typeof r == "string" && n.push({ source: o, target: r, matchType: "caseInsensitive", caseInsensitive: !0 });
    return re(n, { legacyDefaultCaseInsensitive: !0 });
  }
  return [];
}, Je = () => E.isPackaged ? h.join(E.getPath("userData"), me) : h.join(process.cwd(), me), N = (e, t) => {
  const o = {
    version: 2,
    entries: re(t)
  };
  T.writeFileSync(e, `${JSON.stringify(o, null, 2)}
`, "utf8");
}, se = () => {
  const e = Je();
  return T.existsSync(e) || N(e, []), e;
}, V = () => {
  const e = se();
  try {
    const t = T.readFileSync(e, "utf8"), n = $e(t);
    return N(e, n), {
      path: e,
      entries: n
    };
  } catch {
    return N(e, []), {
      path: e,
      entries: []
    };
  }
}, Be = (e) => {
  try {
    const t = T.readFileSync(e, "utf8"), n = $e(t), o = se();
    return N(o, n), {
      path: o,
      entries: n
    };
  } catch {
    return null;
  }
}, Ve = (e) => {
  if (typeof e != "object" || e === null)
    throw new Error("Invalid glossary payload");
  const t = e.source, n = e.target;
  if (typeof t != "string" || typeof n != "string")
    throw new Error("Invalid glossary source or target");
  const o = t.trim(), r = n.trim();
  if (o.length < 2 || r.length === 0)
    throw new Error("Glossary source or target is empty");
  const s = (/* @__PURE__ */ new Date()).toISOString(), i = e.id, c = typeof i == "string" && i.trim().length > 0 ? i.trim() : "", d = ne(e.matchType, "exact"), a = e.caseInsensitive, l = typeof a == "boolean" ? a : d === "caseInsensitive", b = e.note, m = typeof b == "string" ? b.trim() : "", p = oe(e.domain), g = {
    id: c.length > 0 ? c : Le(),
    source: o,
    target: r,
    matchType: d,
    caseInsensitive: l,
    note: m,
    domain: p,
    createdAt: s,
    updatedAt: s,
    uiOnly: typeof e.uiOnly == "boolean" ? e.uiOnly : void 0,
    wholeWord: typeof e.wholeWord == "boolean" ? e.wholeWord : void 0
  }, y = se(), w = V(), C = Q(g), k = c.length > 0 ? w.entries.find((I) => I.id === c) ?? null : null, S = w.entries.find((I) => Q(I) === C) ?? null, P = k ?? S, O = {
    ...g,
    id: P?.id ?? g.id,
    createdAt: P?.createdAt ?? s,
    updatedAt: s
  }, L = w.entries.filter((I) => P && I.id === P.id ? !1 : Q(I) !== C), R = re([...L, O]);
  return N(y, R), {
    path: y,
    entries: R
  };
}, Xe = (e) => {
  if (typeof e != "object" || e === null)
    throw new Error("Invalid glossary delete payload");
  const t = e.id;
  if (typeof t != "string" || t.trim().length === 0)
    throw new Error("Invalid glossary entry id");
  const n = t.trim(), o = se(), r = V(), s = r.entries.filter((i) => i.id !== n);
  return s.length === r.entries.length ? {
    path: o,
    entries: r.entries
  } : (N(o, s), {
    path: o,
    entries: s
  });
}, ue = (e) => {
  const t = e.trim().toLocaleLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  return t.length > 0 ? t : "shell";
}, Ye = (e) => {
  const t = /* @__PURE__ */ new Set();
  for (const n of e) {
    const o = n.trim().toLocaleLowerCase();
    o.length < 2 || t.add(o);
  }
  return Array.from(t);
}, Ce = (e) => e === "shell" ? ["zsh", "bash", "shell", "$ ", "% ", "# ", "pwd", "ls -"] : e === "opencode" ? ["opencode", "ask anything", "tip press", "/plan", "/task", "/help"] : e === "codex" ? ["codex", "gpt-5.3-codex", "/apply_patch", "/check", "/help"] : [], qe = (e) => {
  const t = /* @__PURE__ */ new Map();
  for (const n of e) {
    const o = ue(n.id), r = n.label.trim();
    r.length !== 0 && t.set(o, {
      id: o,
      label: r,
      detectHints: Ye([...Ce(o), ...n.detectHints])
    });
  }
  return t.has("shell") || t.set("shell", {
    id: "shell",
    label: "Shell",
    detectHints: Ce("shell")
  }), Array.from(t.values());
}, ze = (e) => e === "sendKey" || e === "sendAnsi" || e === "sendText" ? e : "sendText", Re = (e) => e === "caution" || e === "destructive" || e === "safe" ? e : "safe", Qe = (e, t) => {
  const n = [], o = /* @__PURE__ */ new Set();
  for (const i of e) {
    const c = ue(i.contextId);
    if (!t.has(c))
      continue;
    const d = i.labelZh.trim(), a = i.payload;
    if (d.length === 0 || a.length === 0)
      continue;
    let l = i.id.trim();
    (l.length === 0 || o.has(l)) && (l = `${c}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`), o.add(l), n.push({
      id: l,
      labelZh: d,
      actionType: ze(i.actionType),
      payload: a,
      contextId: c,
      risk: Re(i.risk),
      order: Number.isFinite(i.order) ? Math.max(1, Math.floor(i.order)) : n.length + 1
    });
  }
  const r = /* @__PURE__ */ new Map();
  for (const i of n) {
    const c = r.get(i.contextId);
    if (c) {
      c.push(i);
      continue;
    }
    r.set(i.contextId, [i]);
  }
  const s = [];
  for (const [i, c] of r.entries())
    c.sort((d, a) => d.order !== a.order ? d.order - a.order : d.labelZh.localeCompare(a.labelZh)).forEach((d, a) => {
      s.push({
        ...d,
        contextId: i,
        order: a + 1
      });
    });
  return s;
}, ee = (e) => {
  if (typeof e != "object" || e === null)
    return { ...B };
  const t = e, n = Array.isArray(t.contexts) ? t.contexts : B.contexts, o = qe(
    n.map((a) => {
      if (typeof a != "object" || a === null)
        return null;
      const l = a.id, b = a.label, m = a.detectHints;
      if (typeof l != "string" || typeof b != "string")
        return null;
      const p = Array.isArray(m) ? m.filter((g) => typeof g == "string") : [];
      return { id: l, label: b, detectHints: p };
    }).filter((a) => a !== null)
  ), r = new Set(o.map((a) => a.id)), s = Array.isArray(t.buttons) ? t.buttons : B.buttons, i = Qe(
    s.map((a) => {
      if (typeof a != "object" || a === null)
        return null;
      const l = a;
      return typeof l.labelZh != "string" || typeof l.payload != "string" || typeof l.contextId != "string" ? null : {
        id: typeof l.id == "string" ? l.id : "",
        labelZh: l.labelZh,
        actionType: ze(l.actionType),
        payload: l.payload,
        contextId: l.contextId,
        risk: Re(l.risk),
        order: typeof l.order == "number" ? l.order : 0
      };
    }).filter((a) => a !== null),
    r
  ), c = typeof t.defaultContextId == "string" ? ue(t.defaultContextId) : "shell";
  return {
    version: 1,
    defaultContextId: r.has(c) ? c : "shell",
    contexts: o,
    buttons: i
  };
}, et = () => E.isPackaged ? h.join(E.getPath("userData"), we) : h.join(process.cwd(), we), ge = (e, t) => {
  T.writeFileSync(e, `${JSON.stringify(ee(t), null, 2)}
`, "utf8");
}, Ne = () => {
  const e = et();
  return T.existsSync(e) || ge(e, B), e;
}, Se = () => {
  const e = Ne();
  try {
    const t = T.readFileSync(e, "utf8"), n = JSON.parse(t), o = ee(n);
    return { path: e, config: o };
  } catch {
    const t = ee(B);
    return ge(e, t), { path: e, config: t };
  }
}, tt = (e) => {
  const t = Ne(), n = ee(e);
  return ge(t, n), {
    path: t,
    config: n
  };
}, f = (e) => typeof e != "object" || e === null ? null : e, Ke = (e, t = u.defaultProvider) => e === "google-free" || e === "openai-compatible" || e === "tencent-tmt" ? e : t, nt = (e) => Array.isArray(e) ? e.map((n) => n === "google-free" || n === "openai-compatible" || n === "tencent-tmt" ? n : null).filter((n) => n !== null).filter((n, o, r) => r.indexOf(n) === o) : [], F = (e, t) => {
  if (typeof e != "string")
    return t;
  const n = e.trim();
  if (n.length === 0)
    return t;
  try {
    const o = new URL(n);
    return o.protocol === "http:" && (o.protocol = "https:"), o.toString();
  } catch {
    return t;
  }
}, ot = (e, t) => {
  const n = Array.isArray(e) ? e.filter((s) => typeof s == "string") : [], r = (n.length > 0 ? n : t).map((s) => F(s, "")).filter((s) => s.length > 0);
  return r.length === 0 ? t : Array.from(new Set(r));
}, Me = (e, t) => {
  if (typeof e != "number" || !Number.isFinite(e))
    return t;
  const n = Math.floor(e);
  return n < 1500 ? 1500 : n > 6e4 ? 6e4 : n;
}, _e = (e, t) => {
  if (typeof e != "number" || !Number.isFinite(e))
    return t;
  const n = Math.floor(e);
  return n < 0 ? t : n;
}, _ = (e) => {
  const t = f(e), n = f(t?.providers), o = f(n?.googleFree), r = f(n?.openaiCompatible), s = f(n?.tencentTmt), i = Ke(t?.defaultProvider), c = nt(t?.fallbackProviders).filter(
    (j) => j !== i
  ), d = Me(t?.timeoutMs, u.timeoutMs), a = f(t?.mirror), l = f(a?.skipRules), b = Array.isArray(a?.localMatchPriority) ? a?.localMatchPriority : [], m = [];
  for (const j of b)
    j !== "exact" && j !== "caseInsensitive" && j !== "pattern" || m.includes(j) || m.push(j);
  for (const j of u.mirror.localMatchPriority)
    m.includes(j) || m.push(j);
  const p = {
    skipRules: {
      stackLike: typeof l?.stackLike == "boolean" ? l.stackLike : u.mirror.skipRules.stackLike,
      symbolOnly: typeof l?.symbolOnly == "boolean" ? l.symbolOnly : u.mirror.skipRules.symbolOnly,
      protectedOnly: typeof l?.protectedOnly == "boolean" ? l.protectedOnly : u.mirror.skipRules.protectedOnly,
      outOfViewport: typeof l?.outOfViewport == "boolean" ? l.outOfViewport : u.mirror.skipRules.outOfViewport
    },
    localMatchPriority: m,
    fallbackUiOnly: typeof a?.fallbackUiOnly == "boolean" ? a.fallbackUiOnly : u.mirror.fallbackUiOnly
  }, g = F(o?.endpoint, u.providers.googleFree.endpoint), y = ot(
    o?.endpoints,
    u.providers.googleFree.endpoints
  );
  y.includes(g) || y.unshift(g);
  const w = F(
    r?.baseUrl,
    u.providers.openaiCompatible.baseUrl
  ), C = r?.model, k = typeof C == "string" && C.trim().length > 0 ? C.trim() : u.providers.openaiCompatible.model, S = r?.apiKeyEnv, P = typeof S == "string" && S.trim().length > 0 ? S.trim() : u.providers.openaiCompatible.apiKeyEnv, O = r?.apiKey, L = typeof O == "string" && O.trim().length > 0 ? O.trim() : void 0, R = F(
    s?.endpoint,
    u.providers.tencentTmt.endpoint
  ), I = s?.region, K = typeof I == "string" && I.trim().length > 0 ? I.trim() : u.providers.tencentTmt.region, U = s?.source, ie = typeof U == "string" && U.trim().length > 0 ? U.trim() : u.providers.tencentTmt.source, D = s?.target, ae = typeof D == "string" && D.trim().length > 0 ? D.trim() : u.providers.tencentTmt.target, ce = _e(
    s?.projectId,
    u.providers.tencentTmt.projectId
  ), H = s?.secretIdEnv, le = typeof H == "string" && H.trim().length > 0 ? H.trim() : u.providers.tencentTmt.secretIdEnv, G = s?.secretKeyEnv, W = typeof G == "string" && G.trim().length > 0 ? G.trim() : u.providers.tencentTmt.secretKeyEnv, $ = s?.secretId, Z = typeof $ == "string" && $.trim().length > 0 ? $.trim() : void 0, J = s?.secretKey, de = typeof J == "string" && J.trim().length > 0 ? J.trim() : void 0;
  return {
    version: 1,
    defaultProvider: i,
    fallbackProviders: c,
    timeoutMs: d,
    mirror: p,
    providers: {
      googleFree: {
        endpoint: g,
        endpoints: y
      },
      openaiCompatible: {
        baseUrl: w,
        model: k,
        apiKeyEnv: P,
        apiKey: L
      },
      tencentTmt: {
        endpoint: R,
        region: K,
        source: ie,
        target: ae,
        projectId: ce,
        secretIdEnv: le,
        secretKeyEnv: W,
        secretId: Z,
        secretKey: de
      }
    }
  };
}, rt = () => E.isPackaged ? h.join(E.getPath("userData"), ve) : h.join(process.cwd(), ve), st = () => E.isPackaged ? h.join(E.getPath("userData"), xe) : h.join(process.cwd(), xe), Ie = (e, t) => {
  const n = f(e) ?? {}, o = f(t);
  if (!o)
    return n;
  const r = f(n.providers) ?? {}, s = f(o.providers) ?? {};
  return {
    ...n,
    ...o,
    providers: {
      ...r,
      ...s,
      googleFree: {
        ...f(r.googleFree) ?? {},
        ...f(s.googleFree) ?? {}
      },
      openaiCompatible: {
        ...f(r.openaiCompatible) ?? {},
        ...f(s.openaiCompatible) ?? {}
      },
      tencentTmt: {
        ...f(r.tencentTmt) ?? {},
        ...f(s.tencentTmt) ?? {}
      }
    }
  };
}, Ee = () => {
  const e = st();
  if (!T.existsSync(e))
    return null;
  try {
    const t = T.readFileSync(e, "utf8");
    return JSON.parse(t);
  } catch {
    return null;
  }
}, te = (e, t) => {
  const n = _(t);
  T.writeFileSync(e, `${JSON.stringify(n, null, 2)}
`, "utf8");
}, Fe = () => {
  const e = rt();
  return T.existsSync(e) || te(e, u), e;
}, Ue = () => {
  const e = Fe();
  try {
    const t = T.readFileSync(e, "utf8"), n = JSON.parse(t), o = _(n);
    te(e, o);
    const r = Ee(), s = r ? _(Ie(o, r)) : o;
    return { path: e, config: s };
  } catch {
    const t = _(u);
    te(e, t);
    const n = Ee(), o = n ? _(Ie(t, n)) : t;
    return { path: e, config: o };
  }
}, it = (e) => {
  const t = Fe(), n = _(e);
  return te(t, n), {
    path: t,
    config: n
  };
}, at = (e) => {
  if (!Array.isArray(e) || e.length === 0 || !Array.isArray(e[0]))
    throw new Error("Unexpected Google response format");
  const t = e[0].map((n) => {
    if (!Array.isArray(n) || n.length === 0)
      return "";
    const o = n[0];
    return typeof o == "string" ? o : "";
  }).join("");
  if (t.length === 0)
    throw new Error("Google translation result is empty");
  return t;
}, ct = (e) => {
  const n = f(e)?.choices;
  if (!Array.isArray(n) || n.length === 0)
    throw new Error("OpenAI response missing choices");
  const o = f(n[0]), s = f(o?.message)?.content;
  if (typeof s == "string" && s.trim().length > 0)
    return s.trim();
  if (Array.isArray(s)) {
    const i = s.map((c) => {
      const d = f(c), a = d?.type, l = d?.text;
      return a === "text" && typeof l == "string" ? l : "";
    }).join("").trim();
    if (i.length > 0)
      return i;
  }
  throw new Error("OpenAI response missing translated content");
}, Pe = (e, t) => {
  const n = e.trim().toLocaleLowerCase();
  return n.length === 0 ? t : n === "zh" || n === "zh-cn" || n === "zh-hans" ? "zh" : n === "zh-tw" || n === "zh-hant" ? "zh-TW" : n === "en" || n === "en-us" || n === "en-gb" ? "en" : e;
}, Ae = (e) => Ge("sha256").update(e, "utf8").digest("hex"), pe = (e, t) => je("sha256", e).update(t, "utf8").digest(), lt = (e, t) => je("sha256", e).update(t, "utf8").digest("hex"), he = async (e, t, n) => {
  const o = new AbortController(), r = setTimeout(() => {
    o.abort();
  }, n);
  try {
    const s = await fetch(e, {
      ...t,
      signal: o.signal
    });
    if (!s.ok) {
      const c = `HTTP ${s.status}`;
      let d = c;
      try {
        d = (await s.text()).trim() || c;
      } catch {
        d = c;
      }
      throw new Error(d);
    }
    const i = await s.text();
    if (i.trim().length === 0)
      throw new Error("Empty JSON response body");
    try {
      return JSON.parse(i);
    } catch {
      const c = i.replace(/^\)\]\}'\s*/, "");
      try {
        return JSON.parse(c);
      } catch {
        const d = c.slice(0, 160).replace(/\s+/g, " ");
        throw new Error(`Invalid JSON response: ${d}`);
      }
    }
  } catch (s) {
    if (s.name === "AbortError")
      throw new Error(`Translation request timeout (${n}ms)`);
    const i = s.message;
    throw typeof i == "string" && i.trim().length > 0 ? new Error(i.trim()) : new Error("Unknown translation request error");
  } finally {
    clearTimeout(r);
  }
}, dt = async (e, t, n, o, r) => {
  const s = Array.from(
    /* @__PURE__ */ new Set([o.providers.googleFree.endpoint, ...o.providers.googleFree.endpoints])
  ), i = [];
  for (const c of s)
    try {
      const d = new URL(c);
      d.searchParams.set("client", "gtx"), d.searchParams.set("sl", t), d.searchParams.set("tl", n), d.searchParams.set("dt", "t"), d.searchParams.set("q", e);
      const a = await he(d.toString(), { method: "GET" }, r);
      return at(a);
    } catch (d) {
      const a = d.message, l = typeof a == "string" && a.trim().length > 0 ? a.trim() : "unknown error";
      i.push(`${c} -> ${l}`);
    }
  throw new Error(`Google free translation failed: ${i.join(" | ")}`);
}, pt = async (e, t, n, o, r) => {
  const s = o.providers.openaiCompatible, i = F(e.baseUrl, s.baseUrl).replace(/\/+$/, ""), c = typeof e.apiKey == "string" && e.apiKey.trim().length > 0 ? e.apiKey.trim() : s.apiKey ?? process.env[s.apiKeyEnv] ?? "";
  if (c.length === 0)
    throw new Error(`Missing API key: request.apiKey or env ${s.apiKeyEnv}`);
  const a = {
    model: typeof e.model == "string" && e.model.trim().length > 0 ? e.model.trim() : s.model,
    temperature: 0,
    messages: [
      {
        role: "system",
        content: "You are a translation engine. Translate the user text faithfully and keep code, paths, URLs, flags, prompts, and placeholders unchanged. Return only the translated text."
      },
      {
        role: "user",
        content: `Source language: ${t}
Target language: ${n}

${e.text}`
      }
    ]
  }, l = await he(
    `${i}/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${c}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(a)
    },
    r
  );
  return ct(l);
}, ft = async (e, t, n, o, r) => {
  const s = o.providers.tencentTmt, i = F(e.baseUrl, s.endpoint), d = new URL(i).host, a = typeof e.region == "string" && e.region.trim().length > 0 ? e.region.trim() : s.region, l = Pe(t, s.source), b = Pe(n, s.target), m = _e(e.projectId, s.projectId), p = typeof e.secretId == "string" && e.secretId.trim().length > 0 ? e.secretId.trim() : s.secretId ?? process.env[s.secretIdEnv] ?? "", g = typeof e.secretKey == "string" && e.secretKey.trim().length > 0 ? e.secretKey.trim() : s.secretKey ?? process.env[s.secretKeyEnv] ?? "";
  if (p.length === 0 || g.length === 0)
    throw new Error(
      `Missing Tencent credentials: tencentTmt.secretId/secretKey or env ${s.secretIdEnv}/${s.secretKeyEnv}`
    );
  const y = "TextTranslate", w = "2018-03-21", C = Math.floor(Date.now() / 1e3), k = new Date(C * 1e3).toISOString().slice(0, 10), S = JSON.stringify({
    SourceText: e.text,
    Source: l,
    Target: b,
    ProjectId: m
  }), P = Ae(S), O = `content-type:application/json; charset=utf-8
host:${d}
x-tc-action:${y.toLocaleLowerCase()}
`, L = "content-type;host;x-tc-action", R = `POST
/

${O}
${L}
${P}`, I = `${k}/tmt/tc3_request`, K = Ae(R), U = `TC3-HMAC-SHA256
${C}
${I}
${K}`, ie = pe(`TC3${g}`, k), D = pe(ie, "tmt"), ae = pe(D, "tc3_request"), ce = lt(ae, U), H = `TC3-HMAC-SHA256 Credential=${p}/${I}, SignedHeaders=${L}, Signature=${ce}`, le = await he(
    i,
    {
      method: "POST",
      headers: {
        Authorization: H,
        "Content-Type": "application/json; charset=utf-8",
        Host: d,
        "X-TC-Action": y,
        "X-TC-Version": w,
        "X-TC-Region": a,
        "X-TC-Timestamp": String(C)
      },
      body: S
    },
    r
  ), G = f(le), W = f(G?.Response);
  if (!W)
    throw new Error("Tencent TMT response format invalid");
  const $ = f(W.Error);
  if ($) {
    const J = typeof $.Code == "string" ? $.Code : "UnknownError", de = typeof $.Message == "string" ? $.Message : "Unknown Tencent error";
    throw new Error(`${J}: ${de}`);
  }
  const Z = W.TargetText;
  if (typeof Z != "string" || Z.trim().length === 0)
    throw new Error("Tencent TMT returned empty translation");
  return Z;
}, ut = async (e) => {
  const t = f(e);
  if (!t)
    throw new Error("Invalid translate request payload");
  const n = t.text;
  if (typeof n != "string")
    throw new Error("Invalid translate request: text is required");
  if (n.length === 0)
    return {
      translatedText: "",
      provider: u.defaultProvider
    };
  const o = {
    text: n,
    sourceLang: typeof t.sourceLang == "string" ? t.sourceLang : void 0,
    targetLang: typeof t.targetLang == "string" ? t.targetLang : void 0,
    provider: typeof t.provider == "string" ? t.provider : void 0,
    timeoutMs: typeof t.timeoutMs == "number" ? t.timeoutMs : void 0,
    baseUrl: typeof t.baseUrl == "string" ? t.baseUrl : void 0,
    model: typeof t.model == "string" ? t.model : void 0,
    apiKey: typeof t.apiKey == "string" ? t.apiKey : void 0,
    secretId: typeof t.secretId == "string" ? t.secretId : void 0,
    secretKey: typeof t.secretKey == "string" ? t.secretKey : void 0,
    region: typeof t.region == "string" ? t.region : void 0,
    projectId: typeof t.projectId == "number" ? t.projectId : void 0
  }, r = Ue().config, i = (o.provider ? Ke(o.provider, r.defaultProvider) : null) ?? r.defaultProvider, c = (r.fallbackProviders ?? []).filter((p) => p !== i), d = [i, ...c].filter(
    (p, g, y) => y.indexOf(p) === g
  ), a = Me(o.timeoutMs, r.timeoutMs), l = (p) => typeof o.sourceLang == "string" && o.sourceLang.trim().length > 0 ? o.sourceLang.trim() : p === "tencent-tmt" ? r.providers.tencentTmt.source : "en", b = (p) => typeof o.targetLang == "string" && o.targetLang.trim().length > 0 ? o.targetLang.trim() : p === "tencent-tmt" ? r.providers.tencentTmt.target : "zh-CN", m = [];
  for (const p of d) {
    const g = l(p), y = b(p);
    try {
      return {
        translatedText: p === "openai-compatible" ? await pt(o, g, y, r, a) : p === "tencent-tmt" ? await ft(o, g, y, r, a) : await dt(o.text, g, y, r, a),
        provider: p
      };
    } catch (w) {
      const C = w.message, k = typeof C == "string" && C.trim().length > 0 ? C.trim() : "unknown error";
      m.push(`${p} translation failed: ${k}`);
    }
  }
  throw new Error(m.join(" | "));
}, gt = () => {
  if (process.platform === "win32") {
    const t = [
      process.env.COMSPEC,
      "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
      "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      "pwsh.exe"
    ];
    for (const n of t)
      if (n)
        if (n.endsWith(".exe") && n.includes("\\")) {
          if (T.existsSync(n))
            return n;
        } else
          return n;
    return "pwsh.exe";
  }
  const e = [
    process.env.SHELL,
    "/bin/zsh",
    "/bin/bash",
    "/usr/bin/zsh",
    "/usr/bin/bash",
    "zsh",
    "bash"
  ];
  for (const t of e)
    if (t) {
      if (t.startsWith("/")) {
        if (T.existsSync(t))
          return t;
        continue;
      }
      return t;
    }
  return "/bin/zsh";
}, ht = () => process.platform === "win32" ? ["-NoLogo"] : ["-l"], yt = (e, t) => {
  const n = [];
  let o = 0;
  for (; o < e.length; ) {
    const r = e[o];
    if (r !== 255) {
      n.push(r), o += 1;
      continue;
    }
    if (o + 1 >= e.length)
      break;
    const s = e[o + 1];
    if (s === 255) {
      n.push(255), o += 2;
      continue;
    }
    if (s === 250) {
      for (o += 2; o + 1 < e.length; ) {
        if (e[o] === 255 && e[o + 1] === 240) {
          o += 2;
          break;
        }
        o += 1;
      }
      continue;
    }
    if (o + 2 >= e.length)
      break;
    const i = e[o + 2];
    s === 251 || s === 252 ? t.write(Buffer.from([255, 254, i])) : (s === 253 || s === 254) && t.write(Buffer.from([255, 252, i])), o += 3;
  }
  return Buffer.from(n);
}, mt = (e, t = 120, n = 40) => {
  X(e), A.get(e)?.kill();
  const o = gt(), r = We.spawn(o, ht(), {
    cols: t,
    rows: n,
    cwd: Y.homedir(),
    env: process.env,
    name: (process.platform === "win32", "xterm-256color")
  });
  A.set(e, r), r.onData((s) => {
    x?.webContents.send("pty:data", { tabId: e, data: s });
  }), r.onExit(({ exitCode: s }) => {
    x?.webContents.send("pty:exit", { tabId: e, exitCode: s, source: "pty" }), A.get(e) === r && A.delete(e);
  });
}, wt = async (e, t, n, o) => {
  if (t.trim().length === 0 || !Number.isFinite(n))
    return !1;
  A.get(e)?.kill(), A.delete(e), X(e);
  const r = new He.Socket();
  return r.setNoDelay(!0), r.setKeepAlive(!0, 3e4), z.set(e, { protocol: o, socket: r }), await new Promise((i) => {
    let c = !1;
    const d = (a) => {
      c || (c = !0, i(a));
    };
    r.once("connect", () => {
      x?.webContents.send("pty:data", {
        tabId: e,
        data: `\r
[local ${o} connected ${t}:${n}]\r
`
      }), d(!0);
    }), r.once("error", (a) => {
      x?.webContents.send("pty:data", {
        tabId: e,
        data: `\r
[local ${o} connect failed: ${a.message}]\r
`
      }), d(!1);
    }), r.connect(n, t);
  }) ? (r.on("data", (i) => {
    const c = o === "telnet" ? yt(i, r) : i;
    c.length !== 0 && x?.webContents.send("pty:data", { tabId: e, data: c.toString("utf8") });
  }), r.on("error", (i) => {
    x?.webContents.send("pty:data", {
      tabId: e,
      data: `\r
[local ${o} error: ${i.message}]\r
`
    });
  }), r.on("close", () => {
    const i = z.get(e);
    i && i.socket === r && z.delete(e), x?.webContents.send("pty:exit", { tabId: e, exitCode: 0, source: "local" });
  }), !0) : (X(e), !1);
}, vt = (e) => {
  const t = X(e), n = A.get(e);
  return n ? (n.kill(), A.delete(e), !0) : t;
}, xt = () => {
  for (const e of A.values())
    e.kill();
  A.clear();
  for (const [e] of z)
    X(e);
}, ke = async () => {
  x = new Oe({
    width: 1500,
    height: 900,
    title: fe,
    webPreferences: {
      preload: Ze,
      contextIsolation: !0,
      nodeIntegration: !1
    }
  });
  const e = process.env.VITE_DEV_SERVER_URL;
  e ? (await x.loadURL(e), x.webContents.openDevTools({ mode: "detach" })) : await x.loadFile(h.join(q, "../dist/index.html"));
};
E.whenReady().then(() => {
  E.setName(fe), process.platform === "win32" && E.setAppUserModelId(fe), v.on("pty:write", (e, t) => {
    if (!t || typeof t != "object")
      return;
    const n = t;
    typeof n.tabId != "string" || typeof n.data != "string" || ye(n.tabId, n.data);
  }), v.handle("pty:spawn", (e, t, n, o) => {
    if (typeof t != "string" || t.length === 0)
      return !1;
    try {
      return mt(t, n, o), !0;
    } catch (r) {
      return x?.webContents.send("pty:data", {
        tabId: t,
        data: `\r
[pty spawn failed: ${r.message}]\r
`
      }), !1;
    }
  }), v.handle("pty:write", (e, t, n) => typeof t != "string" || t.length === 0 || typeof n != "string" ? !1 : (ye(t, n), !0)), v.handle("session:connectLocal", async (e, t, n, o, r) => typeof t != "string" || t.length === 0 || typeof n != "string" || n.trim().length === 0 || typeof o != "number" || !Number.isFinite(o) || r !== "telnet" && r !== "raw" ? !1 : wt(t, n.trim(), Math.floor(o), r)), v.handle("pty:resize", (e, t, n, o) => {
    if (typeof t != "string" || t.length === 0)
      return !1;
    const r = A.get(t);
    return r ? (r.resize(n, o), !0) : !!z.has(t);
  }), v.handle("pty:kill", (e, t) => typeof t != "string" || t.length === 0 ? !1 : vt(t)), v.handle("glossary:load", () => V()), v.handle("glossary:reload", () => V()), v.handle("glossary:import", async () => {
    const e = {
      title: "Import glossary.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
      properties: ["openFile"]
    }, t = x ? await M.showOpenDialog(x, e) : await M.showOpenDialog(e);
    return t.canceled || t.filePaths.length === 0 ? null : Be(t.filePaths[0]);
  }), v.handle("glossary:export", async () => {
    const e = V(), t = {
      title: "Export glossary.json",
      defaultPath: h.join(h.dirname(e.path), "glossary.export.json"),
      filters: [{ name: "JSON", extensions: ["json"] }]
    }, n = x ? await M.showSaveDialog(x, t) : await M.showSaveDialog(t);
    return n.canceled || !n.filePath ? !1 : (N(n.filePath, e.entries), !0);
  }), v.handle("glossary:upsert", (e, t) => Ve(t)), v.handle("glossary:delete", (e, t) => Xe(t)), v.handle("translate:loadConfig", () => Ue()), v.handle("translate:saveConfig", (e, t) => it(t)), v.handle("translate:online", async (e, t) => ut(t)), v.handle("contexts:load", () => Se()), v.handle("contexts:reload", () => Se()), v.handle("contexts:save", (e, t) => tt(t)), v.handle("logs:exportSession", async (e, t) => {
    if (!t || typeof t != "object")
      return null;
    const n = t, o = typeof n.tabId == "string" ? n.tabId.trim() : "", r = typeof n.tabTitle == "string" ? n.tabTitle.trim() : "", s = typeof n.sessionName == "string" ? n.sessionName.trim() : "", i = typeof n.cleanText == "string" ? n.cleanText : "", c = typeof n.jsonl == "string" ? n.jsonl : "", d = typeof n.autoPathTemplate == "string" ? n.autoPathTemplate.trim() : "";
    if (o.length === 0 || i.length === 0 || c.length === 0)
      return null;
    const a = (s || r || o).toLocaleLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, ""), l = a.length > 0 ? a : o, b = r.toLocaleLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, ""), m = b.length > 0 ? b : o, p = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-"), g = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10), y = `session-log-${l}-${p}`;
    let w = "";
    if (d.length > 0) {
      const S = {
        tabId: o,
        tabTitle: r.length > 0 ? r : o,
        tabSlug: m,
        sessionName: s.length > 0 ? s : r.length > 0 ? r : o,
        sessionSlug: l,
        ts: p,
        date: g
      }, P = d.replace(/\{([a-zA-Z0-9_]+)\}/g, (I, K) => S[K] !== void 0 ? S[K] : I), O = P.startsWith("~/") ? h.join(Y.homedir(), P.slice(2)) : P, L = h.isAbsolute(O) ? O : h.join(process.cwd(), O);
      w = h.extname(L).toLocaleLowerCase() === ".txt" ? L : `${L}.txt`;
    } else {
      const S = x ? await M.showSaveDialog(x, {
        title: "Export Session Log",
        defaultPath: h.join(Y.homedir(), `${y}.txt`),
        filters: [{ name: "Text", extensions: ["txt"] }]
      }) : await M.showSaveDialog({
        title: "Export Session Log",
        defaultPath: h.join(Y.homedir(), `${y}.txt`),
        filters: [{ name: "Text", extensions: ["txt"] }]
      });
      if (S.canceled || !S.filePath)
        return null;
      w = S.filePath;
    }
    const C = h.dirname(w);
    T.mkdirSync(C, { recursive: !0 });
    const k = w.toLocaleLowerCase().endsWith(".txt") ? `${w.slice(0, -4)}.jsonl` : `${w}.jsonl`;
    return T.writeFileSync(w, i, "utf8"), T.writeFileSync(k, c, "utf8"), {
      txtPath: w,
      jsonlPath: k
    };
  }), ke(), E.on("activate", () => {
    Oe.getAllWindows().length === 0 && ke();
  });
});
E.on("window-all-closed", () => {
  xt(), process.platform !== "darwin" && E.quit();
});
