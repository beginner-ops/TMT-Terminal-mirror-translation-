import { app as E, ipcMain as h, dialog as K, BrowserWindow as ke } from "electron";
import { fileURLToPath as Ue } from "node:url";
import v from "node:path";
import pe from "node:os";
import x from "node:fs";
import De from "node:net";
import { randomUUID as Oe, createHash as He, createHmac as Le } from "node:crypto";
import Ge from "node-pty";
const X = v.dirname(Ue(import.meta.url)), We = x.existsSync(v.join(X, "preload.mjs")) ? v.join(X, "preload.mjs") : v.join(X, "preload.js");
let w = null;
const S = /* @__PURE__ */ new Map(), j = /* @__PURE__ */ new Map(), V = (e) => {
  const t = j.get(e);
  return t ? (t.socket.destroy(), j.delete(e), !0) : !1;
}, ye = (e, t) => {
  if (t.length === 0)
    return;
  const n = S.get(e);
  if (n) {
    n.write(t);
    return;
  }
  const o = j.get(e);
  if (o)
    try {
      o.socket.write(t);
    } catch {
    }
}, he = "glossary.json", me = "contexts.json", we = "translation.config.json", ve = "translation.config.local", g = {
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
}, J = {
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
}, ee = (e, t = "exact") => e === "exact" || e === "caseInsensitive" || e === "pattern" ? e : t, te = (e) => e === "network-cisco" || e === "network-huawei" || e === "network-h3c" || e === "network-ruijie" || e === "common" ? e : "common", xe = (e, t) => {
  if (typeof e != "string")
    return t;
  const n = e.trim();
  if (n.length === 0)
    return t;
  const o = Date.parse(n);
  return Number.isNaN(o) ? t : new Date(o).toISOString();
}, Y = (e) => {
  const t = e.source.trim(), n = ee(e.matchType, "exact"), o = typeof e.caseInsensitive == "boolean" ? e.caseInsensitive : n === "caseInsensitive", r = o ? t.toLocaleLowerCase() : t;
  return `${te(e.domain)}:${n}:${o ? "i" : "s"}:${r}`;
}, ne = (e, t = {}) => {
  const n = /* @__PURE__ */ new Map(), o = t.legacyDefaultCaseInsensitive ? "caseInsensitive" : "exact";
  for (const r of e) {
    const s = r.source.trim(), i = r.target.trim();
    if (s.length < 2 || i.length === 0)
      continue;
    const c = (/* @__PURE__ */ new Date()).toISOString(), l = ee(r.matchType, o), a = typeof r.caseInsensitive == "boolean" ? r.caseInsensitive : l === "caseInsensitive", d = typeof r.note == "string" ? r.note.trim() : "", T = typeof r.id == "string" && r.id.trim().length > 0 ? r.id.trim() : Oe(), y = xe(r.createdAt, c), p = xe(r.updatedAt, c), u = te(r.domain), m = {
      id: T,
      source: s,
      target: i,
      matchType: l,
      caseInsensitive: a,
      note: d,
      domain: u,
      createdAt: y,
      updatedAt: p,
      uiOnly: typeof r.uiOnly == "boolean" ? r.uiOnly : void 0,
      wholeWord: typeof r.wholeWord == "boolean" ? r.wholeWord : void 0
    };
    n.set(Y(m), m);
  }
  return Array.from(n.values());
}, Te = (e) => {
  const t = [];
  for (const n of e) {
    if (typeof n != "object" || !n)
      continue;
    const o = n.source, r = n.target;
    typeof o != "string" || typeof r != "string" || t.push({
      id: typeof n.id == "string" ? n.id : void 0,
      source: o,
      target: r,
      matchType: ee(n.matchType, "caseInsensitive"),
      caseInsensitive: typeof n.caseInsensitive == "boolean" ? n.caseInsensitive : void 0,
      note: typeof n.note == "string" ? n.note : void 0,
      domain: te(n.domain),
      createdAt: typeof n.createdAt == "string" ? n.createdAt : void 0,
      updatedAt: typeof n.updatedAt == "string" ? n.updatedAt : void 0,
      uiOnly: typeof n.uiOnly == "boolean" ? n.uiOnly : void 0,
      wholeWord: typeof n.wholeWord == "boolean" ? n.wholeWord : void 0
    });
  }
  return ne(t, { legacyDefaultCaseInsensitive: !0 });
}, je = (e) => {
  const t = JSON.parse(e);
  if (Array.isArray(t))
    return Te(t);
  if (typeof t == "object" && t !== null && Array.isArray(t.entries))
    return Te(t.entries);
  if (typeof t == "object" && t !== null) {
    const n = [];
    for (const [o, r] of Object.entries(t))
      typeof r == "string" && n.push({ source: o, target: r, matchType: "caseInsensitive", caseInsensitive: !0 });
    return ne(n, { legacyDefaultCaseInsensitive: !0 });
  }
  return [];
}, Ze = () => E.isPackaged ? v.join(E.getPath("userData"), he) : v.join(process.cwd(), he), z = (e, t) => {
  const o = {
    version: 2,
    entries: ne(t)
  };
  x.writeFileSync(e, `${JSON.stringify(o, null, 2)}
`, "utf8");
}, oe = () => {
  const e = Ze();
  return x.existsSync(e) || z(e, []), e;
}, B = () => {
  const e = oe();
  try {
    const t = x.readFileSync(e, "utf8"), n = je(t);
    return z(e, n), {
      path: e,
      entries: n
    };
  } catch {
    return z(e, []), {
      path: e,
      entries: []
    };
  }
}, Je = (e) => {
  try {
    const t = x.readFileSync(e, "utf8"), n = je(t), o = oe();
    return z(o, n), {
      path: o,
      entries: n
    };
  } catch {
    return null;
  }
}, Be = (e) => {
  if (typeof e != "object" || e === null)
    throw new Error("Invalid glossary payload");
  const t = e.source, n = e.target;
  if (typeof t != "string" || typeof n != "string")
    throw new Error("Invalid glossary source or target");
  const o = t.trim(), r = n.trim();
  if (o.length < 2 || r.length === 0)
    throw new Error("Glossary source or target is empty");
  const s = (/* @__PURE__ */ new Date()).toISOString(), i = e.id, c = typeof i == "string" && i.trim().length > 0 ? i.trim() : "", l = ee(e.matchType, "exact"), a = e.caseInsensitive, d = typeof a == "boolean" ? a : l === "caseInsensitive", T = e.note, y = typeof T == "string" ? T.trim() : "", p = te(e.domain), u = {
    id: c.length > 0 ? c : Oe(),
    source: o,
    target: r,
    matchType: l,
    caseInsensitive: d,
    note: y,
    domain: p,
    createdAt: s,
    updatedAt: s,
    uiOnly: typeof e.uiOnly == "boolean" ? e.uiOnly : void 0,
    wholeWord: typeof e.wholeWord == "boolean" ? e.wholeWord : void 0
  }, m = oe(), I = B(), b = Y(u), k = c.length > 0 ? I.entries.find((C) => C.id === c) ?? null : null, O = I.entries.find((C) => Y(C) === b) ?? null, L = k ?? O, $ = {
    ...u,
    id: L?.id ?? u.id,
    createdAt: L?.createdAt ?? s,
    updatedAt: s
  }, R = I.entries.filter((C) => L && C.id === L.id ? !1 : Y(C) !== b), N = ne([...R, $]);
  return z(m, N), {
    path: m,
    entries: N
  };
}, Ve = (e) => {
  if (typeof e != "object" || e === null)
    throw new Error("Invalid glossary delete payload");
  const t = e.id;
  if (typeof t != "string" || t.trim().length === 0)
    throw new Error("Invalid glossary entry id");
  const n = t.trim(), o = oe(), r = B(), s = r.entries.filter((i) => i.id !== n);
  return s.length === r.entries.length ? {
    path: o,
    entries: r.entries
  } : (z(o, s), {
    path: o,
    entries: s
  });
}, fe = (e) => {
  const t = e.trim().toLocaleLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  return t.length > 0 ? t : "shell";
}, Xe = (e) => {
  const t = /* @__PURE__ */ new Set();
  for (const n of e) {
    const o = n.trim().toLocaleLowerCase();
    o.length < 2 || t.add(o);
  }
  return Array.from(t);
}, be = (e) => e === "shell" ? ["zsh", "bash", "shell", "$ ", "% ", "# ", "pwd", "ls -"] : e === "opencode" ? ["opencode", "ask anything", "tip press", "/plan", "/task", "/help"] : e === "codex" ? ["codex", "gpt-5.3-codex", "/apply_patch", "/check", "/help"] : [], Ye = (e) => {
  const t = /* @__PURE__ */ new Map();
  for (const n of e) {
    const o = fe(n.id), r = n.label.trim();
    r.length !== 0 && t.set(o, {
      id: o,
      label: r,
      detectHints: Xe([...be(o), ...n.detectHints])
    });
  }
  return t.has("shell") || t.set("shell", {
    id: "shell",
    label: "Shell",
    detectHints: be("shell")
  }), Array.from(t.values());
}, $e = (e) => e === "sendKey" || e === "sendAnsi" || e === "sendText" ? e : "sendText", ze = (e) => e === "caution" || e === "destructive" || e === "safe" ? e : "safe", qe = (e, t) => {
  const n = [], o = /* @__PURE__ */ new Set();
  for (const i of e) {
    const c = fe(i.contextId);
    if (!t.has(c))
      continue;
    const l = i.labelZh.trim(), a = i.payload;
    if (l.length === 0 || a.length === 0)
      continue;
    let d = i.id.trim();
    (d.length === 0 || o.has(d)) && (d = `${c}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`), o.add(d), n.push({
      id: d,
      labelZh: l,
      actionType: $e(i.actionType),
      payload: a,
      contextId: c,
      risk: ze(i.risk),
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
    c.sort((l, a) => l.order !== a.order ? l.order - a.order : l.labelZh.localeCompare(a.labelZh)).forEach((l, a) => {
      s.push({
        ...l,
        contextId: i,
        order: a + 1
      });
    });
  return s;
}, q = (e) => {
  if (typeof e != "object" || e === null)
    return { ...J };
  const t = e, n = Array.isArray(t.contexts) ? t.contexts : J.contexts, o = Ye(
    n.map((a) => {
      if (typeof a != "object" || a === null)
        return null;
      const d = a.id, T = a.label, y = a.detectHints;
      if (typeof d != "string" || typeof T != "string")
        return null;
      const p = Array.isArray(y) ? y.filter((u) => typeof u == "string") : [];
      return { id: d, label: T, detectHints: p };
    }).filter((a) => a !== null)
  ), r = new Set(o.map((a) => a.id)), s = Array.isArray(t.buttons) ? t.buttons : J.buttons, i = qe(
    s.map((a) => {
      if (typeof a != "object" || a === null)
        return null;
      const d = a;
      return typeof d.labelZh != "string" || typeof d.payload != "string" || typeof d.contextId != "string" ? null : {
        id: typeof d.id == "string" ? d.id : "",
        labelZh: d.labelZh,
        actionType: $e(d.actionType),
        payload: d.payload,
        contextId: d.contextId,
        risk: ze(d.risk),
        order: typeof d.order == "number" ? d.order : 0
      };
    }).filter((a) => a !== null),
    r
  ), c = typeof t.defaultContextId == "string" ? fe(t.defaultContextId) : "shell";
  return {
    version: 1,
    defaultContextId: r.has(c) ? c : "shell",
    contexts: o,
    buttons: i
  };
}, Qe = () => E.isPackaged ? v.join(E.getPath("userData"), me) : v.join(process.cwd(), me), ue = (e, t) => {
  x.writeFileSync(e, `${JSON.stringify(q(t), null, 2)}
`, "utf8");
}, Re = () => {
  const e = Qe();
  return x.existsSync(e) || ue(e, J), e;
}, Ce = () => {
  const e = Re();
  try {
    const t = x.readFileSync(e, "utf8"), n = JSON.parse(t), o = q(n);
    return { path: e, config: o };
  } catch {
    const t = q(J);
    return ue(e, t), { path: e, config: t };
  }
}, et = (e) => {
  const t = Re(), n = q(e);
  return ue(t, n), {
    path: t,
    config: n
  };
}, f = (e) => typeof e != "object" || e === null ? null : e, Ne = (e, t = g.defaultProvider) => e === "google-free" || e === "openai-compatible" || e === "tencent-tmt" ? e : t, tt = (e) => Array.isArray(e) ? e.map((n) => n === "google-free" || n === "openai-compatible" || n === "tencent-tmt" ? n : null).filter((n) => n !== null).filter((n, o, r) => r.indexOf(n) === o) : [], F = (e, t) => {
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
}, nt = (e, t) => {
  const n = Array.isArray(e) ? e.filter((s) => typeof s == "string") : [], r = (n.length > 0 ? n : t).map((s) => F(s, "")).filter((s) => s.length > 0);
  return r.length === 0 ? t : Array.from(new Set(r));
}, Ke = (e, t) => {
  if (typeof e != "number" || !Number.isFinite(e))
    return t;
  const n = Math.floor(e);
  return n < 1500 ? 1500 : n > 6e4 ? 6e4 : n;
}, Me = (e, t) => {
  if (typeof e != "number" || !Number.isFinite(e))
    return t;
  const n = Math.floor(e);
  return n < 0 ? t : n;
}, M = (e) => {
  const t = f(e), n = f(t?.providers), o = f(n?.googleFree), r = f(n?.openaiCompatible), s = f(n?.tencentTmt), i = Ne(t?.defaultProvider), c = tt(t?.fallbackProviders).filter(
    (P) => P !== i
  ), l = Ke(t?.timeoutMs, g.timeoutMs), a = f(t?.mirror), d = f(a?.skipRules), T = Array.isArray(a?.localMatchPriority) ? a?.localMatchPriority : [], y = [];
  for (const P of T)
    P !== "exact" && P !== "caseInsensitive" && P !== "pattern" || y.includes(P) || y.push(P);
  for (const P of g.mirror.localMatchPriority)
    y.includes(P) || y.push(P);
  const p = {
    skipRules: {
      stackLike: typeof d?.stackLike == "boolean" ? d.stackLike : g.mirror.skipRules.stackLike,
      symbolOnly: typeof d?.symbolOnly == "boolean" ? d.symbolOnly : g.mirror.skipRules.symbolOnly,
      protectedOnly: typeof d?.protectedOnly == "boolean" ? d.protectedOnly : g.mirror.skipRules.protectedOnly,
      outOfViewport: typeof d?.outOfViewport == "boolean" ? d.outOfViewport : g.mirror.skipRules.outOfViewport
    },
    localMatchPriority: y,
    fallbackUiOnly: typeof a?.fallbackUiOnly == "boolean" ? a.fallbackUiOnly : g.mirror.fallbackUiOnly
  }, u = F(o?.endpoint, g.providers.googleFree.endpoint), m = nt(
    o?.endpoints,
    g.providers.googleFree.endpoints
  );
  m.includes(u) || m.unshift(u);
  const I = F(
    r?.baseUrl,
    g.providers.openaiCompatible.baseUrl
  ), b = r?.model, k = typeof b == "string" && b.trim().length > 0 ? b.trim() : g.providers.openaiCompatible.model, O = r?.apiKeyEnv, L = typeof O == "string" && O.trim().length > 0 ? O.trim() : g.providers.openaiCompatible.apiKeyEnv, $ = r?.apiKey, R = typeof $ == "string" && $.trim().length > 0 ? $.trim() : void 0, N = F(
    s?.endpoint,
    g.providers.tencentTmt.endpoint
  ), C = s?.region, re = typeof C == "string" && C.trim().length > 0 ? C.trim() : g.providers.tencentTmt.region, _ = s?.source, se = typeof _ == "string" && _.trim().length > 0 ? _.trim() : g.providers.tencentTmt.source, U = s?.target, ie = typeof U == "string" && U.trim().length > 0 ? U.trim() : g.providers.tencentTmt.target, ae = Me(
    s?.projectId,
    g.providers.tencentTmt.projectId
  ), D = s?.secretIdEnv, ce = typeof D == "string" && D.trim().length > 0 ? D.trim() : g.providers.tencentTmt.secretIdEnv, H = s?.secretKeyEnv, G = typeof H == "string" && H.trim().length > 0 ? H.trim() : g.providers.tencentTmt.secretKeyEnv, A = s?.secretId, W = typeof A == "string" && A.trim().length > 0 ? A.trim() : void 0, Z = s?.secretKey, le = typeof Z == "string" && Z.trim().length > 0 ? Z.trim() : void 0;
  return {
    version: 1,
    defaultProvider: i,
    fallbackProviders: c,
    timeoutMs: l,
    mirror: p,
    providers: {
      googleFree: {
        endpoint: u,
        endpoints: m
      },
      openaiCompatible: {
        baseUrl: I,
        model: k,
        apiKeyEnv: L,
        apiKey: R
      },
      tencentTmt: {
        endpoint: N,
        region: re,
        source: se,
        target: ie,
        projectId: ae,
        secretIdEnv: ce,
        secretKeyEnv: G,
        secretId: W,
        secretKey: le
      }
    }
  };
}, ot = () => E.isPackaged ? v.join(E.getPath("userData"), we) : v.join(process.cwd(), we), rt = () => E.isPackaged ? v.join(E.getPath("userData"), ve) : v.join(process.cwd(), ve), Se = (e, t) => {
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
  const e = rt();
  if (!x.existsSync(e))
    return null;
  try {
    const t = x.readFileSync(e, "utf8");
    return JSON.parse(t);
  } catch {
    return null;
  }
}, Q = (e, t) => {
  const n = M(t);
  x.writeFileSync(e, `${JSON.stringify(n, null, 2)}
`, "utf8");
}, Fe = () => {
  const e = ot();
  return x.existsSync(e) || Q(e, g), e;
}, _e = () => {
  const e = Fe();
  try {
    const t = x.readFileSync(e, "utf8"), n = JSON.parse(t), o = M(n);
    Q(e, o);
    const r = Ee(), s = r ? M(Se(o, r)) : o;
    return { path: e, config: s };
  } catch {
    const t = M(g);
    Q(e, t);
    const n = Ee(), o = n ? M(Se(t, n)) : t;
    return { path: e, config: o };
  }
}, st = (e) => {
  const t = Fe(), n = M(e);
  return Q(t, n), {
    path: t,
    config: n
  };
}, it = (e) => {
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
}, at = (e) => {
  const n = f(e)?.choices;
  if (!Array.isArray(n) || n.length === 0)
    throw new Error("OpenAI response missing choices");
  const o = f(n[0]), s = f(o?.message)?.content;
  if (typeof s == "string" && s.trim().length > 0)
    return s.trim();
  if (Array.isArray(s)) {
    const i = s.map((c) => {
      const l = f(c), a = l?.type, d = l?.text;
      return a === "text" && typeof d == "string" ? d : "";
    }).join("").trim();
    if (i.length > 0)
      return i;
  }
  throw new Error("OpenAI response missing translated content");
}, Ie = (e, t) => {
  const n = e.trim().toLocaleLowerCase();
  return n.length === 0 ? t : n === "zh" || n === "zh-cn" || n === "zh-hans" ? "zh" : n === "zh-tw" || n === "zh-hant" ? "zh-TW" : n === "en" || n === "en-us" || n === "en-gb" ? "en" : e;
}, Pe = (e) => He("sha256").update(e, "utf8").digest("hex"), de = (e, t) => Le("sha256", e).update(t, "utf8").digest(), ct = (e, t) => Le("sha256", e).update(t, "utf8").digest("hex"), ge = async (e, t, n) => {
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
      let l = c;
      try {
        l = (await s.text()).trim() || c;
      } catch {
        l = c;
      }
      throw new Error(l);
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
        const l = c.slice(0, 160).replace(/\s+/g, " ");
        throw new Error(`Invalid JSON response: ${l}`);
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
}, lt = async (e, t, n, o, r) => {
  const s = Array.from(
    /* @__PURE__ */ new Set([o.providers.googleFree.endpoint, ...o.providers.googleFree.endpoints])
  ), i = [];
  for (const c of s)
    try {
      const l = new URL(c);
      l.searchParams.set("client", "gtx"), l.searchParams.set("sl", t), l.searchParams.set("tl", n), l.searchParams.set("dt", "t"), l.searchParams.set("q", e);
      const a = await ge(l.toString(), { method: "GET" }, r);
      return it(a);
    } catch (l) {
      const a = l.message, d = typeof a == "string" && a.trim().length > 0 ? a.trim() : "unknown error";
      i.push(`${c} -> ${d}`);
    }
  throw new Error(`Google free translation failed: ${i.join(" | ")}`);
}, dt = async (e, t, n, o, r) => {
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
  }, d = await ge(
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
  return at(d);
}, pt = async (e, t, n, o, r) => {
  const s = o.providers.tencentTmt, i = F(e.baseUrl, s.endpoint), l = new URL(i).host, a = typeof e.region == "string" && e.region.trim().length > 0 ? e.region.trim() : s.region, d = Ie(t, s.source), T = Ie(n, s.target), y = Me(e.projectId, s.projectId), p = typeof e.secretId == "string" && e.secretId.trim().length > 0 ? e.secretId.trim() : s.secretId ?? process.env[s.secretIdEnv] ?? "", u = typeof e.secretKey == "string" && e.secretKey.trim().length > 0 ? e.secretKey.trim() : s.secretKey ?? process.env[s.secretKeyEnv] ?? "";
  if (p.length === 0 || u.length === 0)
    throw new Error(
      `Missing Tencent credentials: tencentTmt.secretId/secretKey or env ${s.secretIdEnv}/${s.secretKeyEnv}`
    );
  const m = "TextTranslate", I = "2018-03-21", b = Math.floor(Date.now() / 1e3), k = new Date(b * 1e3).toISOString().slice(0, 10), O = JSON.stringify({
    SourceText: e.text,
    Source: d,
    Target: T,
    ProjectId: y
  }), L = Pe(O), $ = `content-type:application/json; charset=utf-8
host:${l}
x-tc-action:${m.toLocaleLowerCase()}
`, R = "content-type;host;x-tc-action", N = `POST
/

${$}
${R}
${L}`, C = `${k}/tmt/tc3_request`, re = Pe(N), _ = `TC3-HMAC-SHA256
${b}
${C}
${re}`, se = de(`TC3${u}`, k), U = de(se, "tmt"), ie = de(U, "tc3_request"), ae = ct(ie, _), D = `TC3-HMAC-SHA256 Credential=${p}/${C}, SignedHeaders=${R}, Signature=${ae}`, ce = await ge(
    i,
    {
      method: "POST",
      headers: {
        Authorization: D,
        "Content-Type": "application/json; charset=utf-8",
        Host: l,
        "X-TC-Action": m,
        "X-TC-Version": I,
        "X-TC-Region": a,
        "X-TC-Timestamp": String(b)
      },
      body: O
    },
    r
  ), H = f(ce), G = f(H?.Response);
  if (!G)
    throw new Error("Tencent TMT response format invalid");
  const A = f(G.Error);
  if (A) {
    const Z = typeof A.Code == "string" ? A.Code : "UnknownError", le = typeof A.Message == "string" ? A.Message : "Unknown Tencent error";
    throw new Error(`${Z}: ${le}`);
  }
  const W = G.TargetText;
  if (typeof W != "string" || W.trim().length === 0)
    throw new Error("Tencent TMT returned empty translation");
  return W;
}, ft = async (e) => {
  const t = f(e);
  if (!t)
    throw new Error("Invalid translate request payload");
  const n = t.text;
  if (typeof n != "string")
    throw new Error("Invalid translate request: text is required");
  if (n.length === 0)
    return {
      translatedText: "",
      provider: g.defaultProvider
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
  }, r = _e().config, i = (o.provider ? Ne(o.provider, r.defaultProvider) : null) ?? r.defaultProvider, c = (r.fallbackProviders ?? []).filter((p) => p !== i), l = [i, ...c].filter(
    (p, u, m) => m.indexOf(p) === u
  ), a = Ke(o.timeoutMs, r.timeoutMs), d = (p) => typeof o.sourceLang == "string" && o.sourceLang.trim().length > 0 ? o.sourceLang.trim() : p === "tencent-tmt" ? r.providers.tencentTmt.source : "en", T = (p) => typeof o.targetLang == "string" && o.targetLang.trim().length > 0 ? o.targetLang.trim() : p === "tencent-tmt" ? r.providers.tencentTmt.target : "zh-CN", y = [];
  for (const p of l) {
    const u = d(p), m = T(p);
    try {
      return {
        translatedText: p === "openai-compatible" ? await dt(o, u, m, r, a) : p === "tencent-tmt" ? await pt(o, u, m, r, a) : await lt(o.text, u, m, r, a),
        provider: p
      };
    } catch (I) {
      const b = I.message, k = typeof b == "string" && b.trim().length > 0 ? b.trim() : "unknown error";
      y.push(`${p} translation failed: ${k}`);
    }
  }
  throw new Error(y.join(" | "));
}, ut = () => {
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
          if (x.existsSync(n))
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
        if (x.existsSync(t))
          return t;
        continue;
      }
      return t;
    }
  return "/bin/zsh";
}, gt = () => process.platform === "win32" ? ["-NoLogo"] : ["-l"], yt = (e, t) => {
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
}, ht = (e, t = 120, n = 40) => {
  V(e), S.get(e)?.kill();
  const o = ut(), r = Ge.spawn(o, gt(), {
    cols: t,
    rows: n,
    cwd: pe.homedir(),
    env: process.env,
    name: (process.platform === "win32", "xterm-256color")
  });
  S.set(e, r), r.onData((s) => {
    w?.webContents.send("pty:data", { tabId: e, data: s });
  }), r.onExit(({ exitCode: s }) => {
    w?.webContents.send("pty:exit", { tabId: e, exitCode: s }), S.get(e) === r && S.delete(e);
  });
}, mt = async (e, t, n, o) => {
  if (t.trim().length === 0 || !Number.isFinite(n))
    return !1;
  S.get(e)?.kill(), S.delete(e), V(e);
  const r = new De.Socket();
  return r.setNoDelay(!0), j.set(e, { protocol: o, socket: r }), await new Promise((i) => {
    let c = !1;
    const l = (a) => {
      c || (c = !0, i(a));
    };
    r.once("connect", () => {
      w?.webContents.send("pty:data", {
        tabId: e,
        data: `\r
[local ${o} connected ${t}:${n}]\r
`
      }), l(!0);
    }), r.once("error", (a) => {
      w?.webContents.send("pty:data", {
        tabId: e,
        data: `\r
[local ${o} connect failed: ${a.message}]\r
`
      }), l(!1);
    }), r.connect(n, t);
  }) ? (r.on("data", (i) => {
    const c = o === "telnet" ? yt(i, r) : i;
    c.length !== 0 && w?.webContents.send("pty:data", { tabId: e, data: c.toString("utf8") });
  }), r.on("error", (i) => {
    w?.webContents.send("pty:data", {
      tabId: e,
      data: `\r
[local ${o} error: ${i.message}]\r
`
    });
  }), r.on("close", () => {
    const i = j.get(e);
    i && i.socket === r && j.delete(e), w?.webContents.send("pty:exit", { tabId: e, exitCode: 0 });
  }), !0) : (V(e), !1);
}, wt = (e) => {
  const t = V(e), n = S.get(e);
  return n ? (n.kill(), S.delete(e), !0) : t;
}, vt = () => {
  for (const e of S.values())
    e.kill();
  S.clear();
  for (const [e] of j)
    V(e);
}, Ae = async () => {
  w = new ke({
    width: 1500,
    height: 900,
    title: "termbridge-v2",
    webPreferences: {
      preload: We,
      contextIsolation: !0,
      nodeIntegration: !1
    }
  });
  const e = process.env.VITE_DEV_SERVER_URL;
  e ? (await w.loadURL(e), w.webContents.openDevTools({ mode: "detach" })) : await w.loadFile(v.join(X, "../dist/index.html"));
};
E.whenReady().then(() => {
  h.on("pty:write", (e, t) => {
    if (!t || typeof t != "object")
      return;
    const n = t;
    typeof n.tabId != "string" || typeof n.data != "string" || ye(n.tabId, n.data);
  }), h.handle("pty:spawn", (e, t, n, o) => {
    if (typeof t != "string" || t.length === 0)
      return !1;
    try {
      return ht(t, n, o), !0;
    } catch (r) {
      return w?.webContents.send("pty:data", {
        tabId: t,
        data: `\r
[pty spawn failed: ${r.message}]\r
`
      }), !1;
    }
  }), h.handle("pty:write", (e, t, n) => typeof t != "string" || t.length === 0 || typeof n != "string" ? !1 : (ye(t, n), !0)), h.handle("session:connectLocal", async (e, t, n, o, r) => typeof t != "string" || t.length === 0 || typeof n != "string" || n.trim().length === 0 || typeof o != "number" || !Number.isFinite(o) || r !== "telnet" && r !== "raw" ? !1 : mt(t, n.trim(), Math.floor(o), r)), h.handle("pty:resize", (e, t, n, o) => {
    if (typeof t != "string" || t.length === 0)
      return !1;
    const r = S.get(t);
    return r ? (r.resize(n, o), !0) : !!j.has(t);
  }), h.handle("pty:kill", (e, t) => typeof t != "string" || t.length === 0 ? !1 : wt(t)), h.handle("glossary:load", () => B()), h.handle("glossary:reload", () => B()), h.handle("glossary:import", async () => {
    const e = {
      title: "Import glossary.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
      properties: ["openFile"]
    }, t = w ? await K.showOpenDialog(w, e) : await K.showOpenDialog(e);
    return t.canceled || t.filePaths.length === 0 ? null : Je(t.filePaths[0]);
  }), h.handle("glossary:export", async () => {
    const e = B(), t = {
      title: "Export glossary.json",
      defaultPath: v.join(v.dirname(e.path), "glossary.export.json"),
      filters: [{ name: "JSON", extensions: ["json"] }]
    }, n = w ? await K.showSaveDialog(w, t) : await K.showSaveDialog(t);
    return n.canceled || !n.filePath ? !1 : (z(n.filePath, e.entries), !0);
  }), h.handle("glossary:upsert", (e, t) => Be(t)), h.handle("glossary:delete", (e, t) => Ve(t)), h.handle("translate:loadConfig", () => _e()), h.handle("translate:saveConfig", (e, t) => st(t)), h.handle("translate:online", async (e, t) => ft(t)), h.handle("contexts:load", () => Ce()), h.handle("contexts:reload", () => Ce()), h.handle("contexts:save", (e, t) => et(t)), h.handle("logs:exportSession", async (e, t) => {
    if (!t || typeof t != "object")
      return null;
    const n = t, o = typeof n.tabId == "string" ? n.tabId.trim() : "", r = typeof n.tabTitle == "string" ? n.tabTitle.trim() : "", s = typeof n.sessionName == "string" ? n.sessionName.trim() : "", i = typeof n.cleanText == "string" ? n.cleanText : "", c = typeof n.jsonl == "string" ? n.jsonl : "";
    if (o.length === 0 || i.length === 0 || c.length === 0)
      return null;
    const l = (s || r || o).toLocaleLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, ""), a = l.length > 0 ? l : o, d = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-"), T = `session-log-${a}-${d}`, y = w ? await K.showSaveDialog(w, {
      title: "Export Session Log",
      defaultPath: v.join(pe.homedir(), `${T}.txt`),
      filters: [{ name: "Text", extensions: ["txt"] }]
    }) : await K.showSaveDialog({
      title: "Export Session Log",
      defaultPath: v.join(pe.homedir(), `${T}.txt`),
      filters: [{ name: "Text", extensions: ["txt"] }]
    });
    if (y.canceled || !y.filePath)
      return null;
    const p = y.filePath, u = p.toLocaleLowerCase().endsWith(".txt") ? `${p.slice(0, -4)}.jsonl` : `${p}.jsonl`;
    return x.writeFileSync(p, i, "utf8"), x.writeFileSync(u, c, "utf8"), {
      txtPath: p,
      jsonlPath: u
    };
  }), Ae(), E.on("activate", () => {
    ke.getAllWindows().length === 0 && Ae();
  });
});
E.on("window-all-closed", () => {
  vt(), process.platform !== "darwin" && E.quit();
});
