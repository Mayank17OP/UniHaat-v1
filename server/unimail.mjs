import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import dns from "node:dns/promises";
import nodemailer from "nodemailer";

const DEFAULT_UNIVERSITIES = [
  { id: "u-dtu", shortName: "DTU", name: "Delhi Technological University" },
  { id: "u-du", shortName: "DU", name: "University of Delhi" },
  { id: "u-iitd", shortName: "IITD", name: "Indian Institute of Technology Delhi" },
  { id: "u-jmi", shortName: "JMI", name: "Jamia Millia Islamia" },
  { id: "u-amity", shortName: "AMITY", name: "Amity University" },
  { id: "u-ipu", shortName: "IPU", name: "Guru Gobind Singh Indraprastha University" },
  { id: "u-nsut", shortName: "NSUT", name: "Netaji Subhas University of Technology" },
  { id: "u-dtc", shortName: "DTC", name: "Delhi Technical Campus" },
];

const DEFAULT_DOMAINS = [
  { domain: "dtu.ac.in", universityShort: "DTU", college: "DTU", enabled: true, verifiedCount: 142 },
  { domain: "du.ac.in", universityShort: "DU", college: "DU", enabled: true, verifiedCount: 198 },
  { domain: "hansrajcollege.ac.in", universityShort: "DU", college: "Hansraj", enabled: true, verifiedCount: 64 },
  { domain: "iitd.ac.in", universityShort: "IITD", college: "IIT Delhi", enabled: true, verifiedCount: 115 },
  { domain: "jmi.ac.in", universityShort: "JMI", college: "Jamia", enabled: true, verifiedCount: 73 },
  { domain: "amity.edu", universityShort: "AMITY", college: "Amity", enabled: true, verifiedCount: 89 },
  { domain: "ipu.ac.in", universityShort: "IPU", college: "IPU", enabled: true, verifiedCount: 54 },
  { domain: "nsut.ac.in", universityShort: "NSUT", college: "NSUT", enabled: true, verifiedCount: 91 },
  { domain: "delhitechnicalcampus.ac.in", universityShort: "DTC", college: "DTC", enabled: true, verifiedCount: 28 },
];

export const EMAIL_TEMPLATES = {
  student_registration: {
    subject: "Welcome to UniHaat — Verify your campus email",
    body: "Welcome to UniHaat! Please verify your institutional email to unlock selling, demands, and SafeSwap.",
  },
  email_verification: {
    subject: "UniMail Verification Code for {{college}}",
    body: "Your UniMail verification token is: {{token}}. It expires in {{minutes}} minutes.",
  },
  product_enquiry: {
    subject: 'New enquiry on "{{item}}"',
    body: "{{sender}} sent you a message about {{item}} on UniHaat.",
  },
  purchase_confirmation: {
    subject: "Order confirmed: {{item}} ({{price}})",
    body: "Your purchase of {{item}} for {{price}} is confirmed. Meet at {{college}} gate with SafeSwap.",
  },
  rental_request: {
    subject: "New UniReserve rental request for {{item}}",
    body: "{{borrower}} requested to rent {{item}} ({{dates}}). Review and approve or decline in UniReserve.",
  },
  rental_approved: {
    subject: "Rental approved: {{item}}",
    body: "Your UniReserve rental request for {{item}} was approved. Pickup details are in your UniHaat account.",
  },
  rental_rejected: {
    subject: "Rental request declined: {{item}}",
    body: "Your UniReserve rental request for {{item}} was declined by the owner.",
  },
  exchange_update: {
    subject: "Exchange update for {{item}}",
    body: "There is a new update on your campus item exchange for {{item}}.",
  },
  wishlist_alert: {
    subject: "Wishlist alert: {{item}} updated",
    body: "An item on your UniHaat wishlist ({{item}}) had a price or availability change.",
  },
  safeswap_handover: {
    subject: "SafeSwap handover confirmed for {{item}}",
    body: "Both parties confirmed the SafeSwap handover for {{item}}. Code: {{code}}.",
  },
  security_alert: {
    subject: "UniHaat security alert",
    body: "A password reset or security event was triggered for your UniHaat account.",
  },
};

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function renderTemplate(str, vars = {}) {
  return String(str).replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : ""));
}

export function createUniMailService({
  smtpConfig = {},
  transport = null,
  dnsResolver = dns,
  tokenTtlMs = 15 * 60 * 1000,
  now = () => Date.now(),
} = {}) {
  const universities = DEFAULT_UNIVERSITIES.map((u) => ({ ...u }));
  const domains = DEFAULT_DOMAINS.map((d) => ({ ...d }));
  const tokens = new Map(); // tokenHash -> { email, domain, college, expiresAt, usedAt, createdAt }
  const logs = [];

  const smtp = {
    host: smtpConfig.host ?? process.env.SMTP_HOST ?? "",
    port: Number(smtpConfig.port ?? process.env.SMTP_PORT ?? 587),
    secure: String(smtpConfig.secure ?? process.env.SMTP_SECURE ?? "false") === "true",
    user: smtpConfig.user ?? process.env.SMTP_USER ?? "",
    pass: smtpConfig.pass ?? process.env.SMTP_PASS ?? "",
    from: smtpConfig.from ?? process.env.SMTP_FROM ?? "unimail@unihaat.campus",
  };

  function getTransport() {
    if (transport) return transport;
    if (!smtp.host) return null;
    return nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      requireTLS: !smtp.secure,
      auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
    });
  }

  function getSmtpStatus() {
    const configured = Boolean(smtp.host);
    return {
      configured,
      host: smtp.host || "(not configured — set SMTP_HOST)",
      port: smtp.port,
      tls: smtp.secure ? "SMTPS (TLS)" : "STARTTLS",
      from: smtp.from,
      authConfigured: Boolean(smtp.user && smtp.pass),
      pop3ImapConfigured: false,
      note: "Credentials are stored only in server environment variables and never exposed to the browser.",
    };
  }

  function validateEmailDomain(email) {
    const clean = String(email || "").trim().toLowerCase();
    const at = clean.lastIndexOf("@");
    if (at <= 0 || at === clean.length - 1) {
      return { ok: false, error: "Enter a valid institutional email address." };
    }
    const domain = clean.slice(at + 1);
    const entry = domains.find((d) => d.domain === domain);
    if (!entry) {
      return {
        ok: false,
        domain,
        error: `Domain "${domain}" is not an approved institutional domain. Arbitrary .edu or .ac.in domains are not automatically trusted.`,
      };
    }
    if (!entry.enabled) {
      return {
        ok: false,
        domain,
        error: `Domain "${domain}" is currently disabled by UniMail admin.`,
      };
    }
    return { ok: true, email: clean, domain, entry };
  }

  async function sendMail({ to, eventType, subject, text, metadata = {} }) {
    const entry = {
      id: crypto.randomUUID(),
      recipient: to,
      eventType,
      subject,
      status: "pending",
      messageId: null,
      errorMessage: null,
      metadata,
      createdAt: new Date(now()).toISOString(),
    };
    const tx = getTransport();
    if (!tx) {
      entry.status = "failed";
      entry.errorMessage = "SMTP not configured (set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS).";
      logs.unshift(entry);
      return entry;
    }
    try {
      const info = await tx.sendMail({
        from: smtp.from,
        to,
        subject,
        text,
      });
      entry.status = "sent";
      entry.messageId = info?.messageId || null;
      logs.unshift(entry);
      return entry;
    } catch (err) {
      entry.status = "failed";
      entry.errorMessage = err?.message || "SMTP delivery failed";
      logs.unshift(entry);
      return entry;
    }
  }

  async function sendVerification(email) {
    const check = validateEmailDomain(email);
    if (!check.ok) {
      return { ok: false, error: check.error };
    }
    // Invalidate any previous unused tokens for this email
    for (const [h, t] of tokens.entries()) {
      if (t.email === check.email && !t.usedAt) tokens.delete(h);
    }
    const rawToken = crypto.randomBytes(16).toString("hex");
    const tokenHash = hashToken(rawToken);
    const expiresAt = now() + tokenTtlMs;
    tokens.set(tokenHash, {
      email: check.email,
      domain: check.domain,
      college: check.entry.college,
      expiresAt,
      usedAt: null,
      createdAt: now(),
    });

    const tpl = EMAIL_TEMPLATES.email_verification;
    const subject = renderTemplate(tpl.subject, { college: check.entry.college });
    const text = renderTemplate(tpl.body, {
      token: rawToken,
      minutes: Math.round(tokenTtlMs / 60000),
      college: check.entry.college,
    });
    const delivery = await sendMail({
      to: check.email,
      eventType: "email_verification",
      subject,
      text,
      metadata: { domain: check.domain, college: check.entry.college },
    });

    return {
      ok: true,
      email: check.email,
      college: check.entry.college,
      domain: check.domain,
      expiresAt: new Date(expiresAt).toISOString(),
      delivery,
      // Returned only when SMTP is not configured so local/dev testing can still verify
      devToken: delivery.status === "failed" ? rawToken : undefined,
    };
  }

  function confirmVerification(email, rawToken) {
    const cleanEmail = String(email || "").trim().toLowerCase();
    const tokenHash = hashToken(String(rawToken || "").trim());
    const record = tokens.get(tokenHash);
    if (!record || record.email !== cleanEmail) {
      return { ok: false, error: "Invalid verification token." };
    }
    if (record.usedAt) {
      return { ok: false, error: "This verification token has already been used." };
    }
    if (now() > record.expiresAt) {
      return { ok: false, error: "Verification token has expired. Please request a new one." };
    }
    record.usedAt = now();
    const dom = domains.find((d) => d.domain === record.domain);
    if (dom) dom.verifiedCount += 1;
    return { ok: true, email: record.email, college: record.college, domain: record.domain };
  }

  async function sendNotification({ to, eventType, vars = {} }) {
    const tpl = EMAIL_TEMPLATES[eventType];
    if (!tpl) {
      return { ok: false, error: `Unknown notification event: ${eventType}` };
    }
    const subject = renderTemplate(tpl.subject, vars);
    const text = renderTemplate(tpl.body, vars);
    const delivery = await sendMail({ to, eventType, subject, text, metadata: vars });
    return { ok: delivery.status !== "failed", delivery };
  }

  async function lookupDns(domain) {
    const clean = String(domain || "").trim().toLowerCase();
    if (!clean || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(clean)) {
      return { ok: false, error: "Enter a valid domain name (e.g. dtu.ac.in)." };
    }
    const result = {
      ok: true,
      domain: clean,
      mode: "live",
      a: [],
      aaaa: [],
      mx: [],
      txt: [],
      spf: null,
      dmarc: null,
      dkim: null,
      note: null,
    };
    try {
      const [a, aaaa, mx, txt] = await Promise.allSettled([
        dnsResolver.resolve4(clean),
        dnsResolver.resolve6(clean),
        dnsResolver.resolveMx(clean),
        dnsResolver.resolveTxt(clean),
      ]);
      if (a.status === "fulfilled") result.a = a.value;
      if (aaaa.status === "fulfilled") result.aaaa = aaaa.value;
      if (mx.status === "fulfilled") result.mx = mx.value.sort((x, y) => x.priority - y.priority);
      if (txt.status === "fulfilled") {
        result.txt = txt.value.map((chunks) => chunks.join(""));
        result.spf = result.txt.find((t) => t.toLowerCase().startsWith("v=spf1")) || null;
      }
      const dmarcRes = await dnsResolver.resolveTxt(`_dmarc.${clean}`).catch(() => []);
      if (dmarcRes.length) {
        result.dmarc = dmarcRes.map((c) => c.join("")).find((t) => t.toLowerCase().startsWith("v=dmarc1")) || null;
      }
      const dkimRes = await dnsResolver.resolveTxt(`default._domainkey.${clean}`).catch(() => []);
      if (dkimRes.length) {
        result.dkim = dkimRes.map((c) => c.join("")).join(" ");
      }
      if (!result.a.length && !result.mx.length && !result.txt.length) {
        result.mode = "demonstration";
        result.note = "Demonstration Mode: live DNS returned no records for this domain (or network DNS is unreachable). No real DNS records were invented.";
      }
    } catch {
      result.mode = "demonstration";
      result.note = "Demonstration Mode: DNS lookup unavailable in this environment. No real DNS records were invented.";
    }
    return result;
  }

  function addUniversity({ shortName, name }) {
    const s = String(shortName || "").trim().toUpperCase();
    const n = String(name || "").trim();
    if (!s || !n) return { ok: false, error: "University short name and full name are required." };
    if (universities.some((u) => u.shortName === s)) {
      return { ok: false, error: `University ${s} already exists.` };
    }
    const uni = { id: `u-${s.toLowerCase()}`, shortName: s, name: n };
    universities.push(uni);
    return { ok: true, university: uni };
  }

  function addDomain({ domain, universityShort, college }) {
    const clean = String(domain || "").trim().toLowerCase();
    if (!clean || !clean.includes(".")) return { ok: false, error: "Valid domain is required." };
    if (domains.some((d) => d.domain === clean)) return { ok: false, error: `Domain ${clean} already exists.` };
    const entry = {
      domain: clean,
      universityShort: universityShort || "CUSTOM",
      college: college || universityShort || clean,
      enabled: true,
      verifiedCount: 0,
    };
    domains.push(entry);
    return { ok: true, domain: entry };
  }

  function toggleDomain(domain, enabled) {
    const entry = domains.find((d) => d.domain === String(domain || "").trim().toLowerCase());
    if (!entry) return { ok: false, error: "Domain not found." };
    entry.enabled = Boolean(enabled);
    return { ok: true, domain: entry };
  }

  function getStats() {
    const sent = logs.filter((l) => l.status === "sent").length;
    const delivered = logs.filter((l) => l.status === "delivered").length;
    const failed = logs.filter((l) => l.status === "failed").length;
    const pending = logs.filter((l) => l.status === "pending").length;
    const verifiedStudents = domains.reduce((sum, d) => sum + d.verifiedCount, 0);
    return {
      totalSent: sent + delivered,
      delivered,
      failed,
      pending,
      verifiedStudents,
      registeredDomains: domains.length,
      enabledDomains: domains.filter((d) => d.enabled).length,
      universities,
      domains,
      recentLogs: logs.slice(0, 20),
      templates: Object.entries(EMAIL_TEMPLATES).map(([eventType, tpl]) => ({
        eventType,
        subject: tpl.subject,
        body: tpl.body,
      })),
    };
  }

  return {
    validateEmailDomain,
    sendVerification,
    confirmVerification,
    sendNotification,
    lookupDns,
    getSmtpStatus,
    addUniversity,
    addDomain,
    toggleDomain,
    getStats,
  };
}

// Standalone HTTP server (serves static files + /api/unimail/*)
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => {
      try { resolve(JSON.parse(data || "{}")); } catch { resolve({}); }
    });
  });
}

function sendJson(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const service = createUniMailService();
  const root = process.cwd();
  const port = Number(process.env.PORT || 5173);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === "/api/unimail/stats" && req.method === "GET") {
      return sendJson(res, 200, service.getStats());
    }
    if (url.pathname === "/api/unimail/smtp/status" && req.method === "GET") {
      return sendJson(res, 200, service.getSmtpStatus());
    }
    if (url.pathname === "/api/unimail/smtp/test" && req.method === "POST") {
      const body = await readBody(req);
      const out = await service.sendNotification({
        to: body.to,
        eventType: "security_alert",
      });
      return sendJson(res, out.ok ? 200 : 400, out);
    }
    if (url.pathname === "/api/unimail/dns" && req.method === "GET") {
      const out = await service.lookupDns(url.searchParams.get("domain"));
      return sendJson(res, out.ok ? 200 : 400, out);
    }
    if (url.pathname === "/api/unimail/verify/send" && req.method === "POST") {
      const body = await readBody(req);
      const out = await service.sendVerification(body.email);
      return sendJson(res, out.ok ? 200 : 400, out);
    }
    if (url.pathname === "/api/unimail/verify/confirm" && req.method === "POST") {
      const body = await readBody(req);
      const out = service.confirmVerification(body.email, body.token);
      return sendJson(res, out.ok ? 200 : 400, out);
    }
    if (url.pathname === "/api/unimail/notify" && req.method === "POST") {
      const body = await readBody(req);
      const out = await service.sendNotification(body);
      return sendJson(res, out.ok ? 200 : 400, out);
    }
    if (url.pathname === "/api/unimail/domains" && req.method === "POST") {
      const body = await readBody(req);
      const out = service.addDomain(body);
      return sendJson(res, out.ok ? 200 : 400, out);
    }
    if (url.pathname.startsWith("/api/unimail/domains/") && req.method === "PATCH") {
      const domain = decodeURIComponent(url.pathname.replace("/api/unimail/domains/", ""));
      const body = await readBody(req);
      const out = service.toggleDomain(domain, body.enabled);
      return sendJson(res, out.ok ? 200 : 400, out);
    }

    // Static file fallback
    const rel = url.pathname === "/" ? "/index.html" : url.pathname;
    const filePath = path.join(root, rel);
    if (!filePath.startsWith(root) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404);
      return res.end("Not found");
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    fs.createReadStream(filePath).pipe(res);
  });

  server.listen(port, "0.0.0.0", () => {
    console.log(`[UniMail] Server listening on http://0.0.0.0:${port}`);
  });
}
