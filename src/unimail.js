import { COLLEGES } from "./data.js";

/**
 * Escape text for the page.
 *
 * Most of what this module prints is ours. Some of it is not: a DNS TXT
 * record is arbitrary text chosen by whoever controls that zone, and it
 * was being dropped into `innerHTML` unescaped. A zone owner could put
 * a tag in a TXT record and have it run on the page of every student
 * who looked the domain up.
 *
 * @param {unknown} s
 * @returns {string}
 */
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );

const LOCAL_DOMAINS = COLLEGES.map((c) => ({
  domain: c.domain,
  universityShort: c.short,
  college: c.short,
  enabled: true,
  verifiedCount: c.short === "DTU" ? 142 : c.short === "DU" ? 198 : c.short === "DTC" ? 28 : 65,
}));

const LOCAL_LOGS = [];

async function api(path, opts = {}) {
  try {
    const res = await fetch(path, {
      headers: { "Content-Type": "application/json" },
      ...opts,
    });
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function triggerUniMailNotification(eventType, vars = {}, to = "student@dtu.ac.in") {
  const res = await api("/api/unimail/notify", {
    method: "POST",
    body: JSON.stringify({ to, eventType, vars }),
  });
  if (res) return res;
  LOCAL_LOGS.unshift({
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    recipient: to,
    eventType,
    subject: `[Local Preview] ${eventType.replace(/_/g, " ")}`,
    status: "pending",
    errorMessage: "Static server mode — start `npm run dev:unimail` for live SMTP.",
    createdAt: new Date().toISOString(),
  });
  return { ok: true, local: true };
}

export function initUniMail({ toast } = {}) {
  const root = document.getElementById("unimailRoot");
  if (!root) return;

  let activeTab = "verify";
  let lastEmail = "";
  let devTokenHint = "";
  // The messages the forms print live here rather than in the DOM, because
  // `render()` replaces the whole panel. A message written straight into the
  // DOM was wiped the moment anything triggered a re-render — so the one
  // message that mattered most ("Token generated for ...") usually vanished
  // before anyone could read it.
  let sendMsg = "";
  let confirmMsg = "";
  let dnsMsg = "";
  let smtpMsg = "";
  // The inputs are re-rendered too, so what the student typed has to be
  // remembered here or it is cleared out from under them.
  let lastToken = "";
  let lastDnsDomain = "dtu.ac.in";
  let lastSmtpTo = "";

  async function render() {
    const stats = (await api("/api/unimail/stats")) || {
      totalSent: LOCAL_LOGS.length,
      delivered: 0,
      failed: 0,
      pending: LOCAL_LOGS.length,
      verifiedStudents: LOCAL_DOMAINS.reduce((s, d) => s + d.verifiedCount, 0),
      registeredDomains: LOCAL_DOMAINS.length,
      enabledDomains: LOCAL_DOMAINS.filter((d) => d.enabled).length,
      domains: LOCAL_DOMAINS,
      recentLogs: LOCAL_LOGS.slice(0, 12),
      templates: [
        { eventType: "student_registration", subject: "Welcome to UniHaat — Verify your campus email" },
        { eventType: "email_verification", subject: "UniMail Verification Code for {{college}}" },
        { eventType: "product_enquiry", subject: 'New enquiry on "{{item}}"' },
        { eventType: "purchase_confirmation", subject: "Order confirmed: {{item}} ({{price}})" },
        { eventType: "rental_request", subject: "New UniReserve rental request for {{item}}" },
        { eventType: "rental_approved", subject: "Rental approved: {{item}}" },
        { eventType: "rental_rejected", subject: "Rental request declined: {{item}}" },
        { eventType: "safeswap_handover", subject: "SafeSwap handover confirmed for {{item}}" },
      ],
    };

    const smtp = (await api("/api/unimail/smtp/status")) || {
      configured: false,
      host: "(static mode — run `npm run dev:unimail`)",
      port: 587,
      tls: "STARTTLS",
      from: "unimail@unihaat.campus",
      authConfigured: false,
      pop3ImapConfigured: false,
      note: "SMTP credentials are never exposed in frontend code.",
    };

    root.innerHTML = `
      <div class="unimail-tabs" role="tablist">
        <button class="pill ${activeTab === "verify" ? "active" : ""}" data-utab="verify" role="tab">1. Student Verification</button>
        <button class="pill ${activeTab === "admin" ? "active" : ""}" data-utab="admin" role="tab">2. Admin &amp; Domains</button>
        <button class="pill ${activeTab === "dns" ? "active" : ""}" data-utab="dns" role="tab">3. DNS &amp; MX Lookup</button>
        <button class="pill ${activeTab === "network" ? "active" : ""}" data-utab="network" role="tab">4. SMTP &amp; Network Flow</button>
      </div>

      ${activeTab === "verify" ? `
        <div class="unimail-panel">
          <div class="unimail-two">
            <form id="umSendForm" class="unimail-card">
              <h3>Verify institutional email</h3>
              <p class="fine">Only approved university domains are accepted. Arbitrary <code>.edu</code> or <code>.ac.in</code> domains are rejected.</p>
              <label>Campus Email
                <input name="email" type="email" required placeholder="you@dtu.ac.in or you@delhitechnicalcampus.ac.in" value="${esc(lastEmail)}" />
              </label>
              <button class="btn btn-primary" type="submit">Send verification token</button>
              <p class="fine" id="umSendMsg">${esc(sendMsg)}</p>
            </form>
            <form id="umConfirmForm" class="unimail-card">
              <h3>Confirm verification token</h3>
              <p class="fine">Tokens expire after 15 minutes and are single-use.${devTokenHint ? ` Dev token: <code>${esc(devTokenHint)}</code>` : ""}</p>
              <label>Campus Email
                <input name="email" type="email" required placeholder="you@dtu.ac.in" value="${esc(lastEmail)}" />
              </label>
              <label>Verification Token
                <input name="token" required placeholder="Paste 32-char token" value="${esc(lastToken || devTokenHint)}" />
              </label>
              <div class="unimail-row">
                <button class="btn btn-primary" type="submit">Verify token</button>
                <button class="btn btn-ghost" type="button" id="umResendBtn">Resend token</button>
              </div>
              <p class="fine" id="umConfirmMsg">${esc(confirmMsg)}</p>
            </form>
          </div>
        </div>
      ` : ""}

      ${activeTab === "admin" ? `
        <div class="unimail-panel">
          <div class="unimail-kpis">
            <div class="unimail-kpi"><strong>${stats.totalSent}</strong><span>Emails Sent</span></div>
            <div class="unimail-kpi"><strong>${stats.delivered}</strong><span>Delivered</span></div>
            <div class="unimail-kpi"><strong>${stats.failed}</strong><span>Failed</span></div>
            <div class="unimail-kpi"><strong>${stats.pending}</strong><span>Pending</span></div>
            <div class="unimail-kpi"><strong>${stats.verifiedStudents}</strong><span>Verified Students</span></div>
            <div class="unimail-kpi"><strong>${stats.enabledDomains}/${stats.registeredDomains}</strong><span>Active Domains</span></div>
          </div>
          <div class="unimail-two">
            <div class="unimail-card">
              <h3>Approved University Domains</h3>
              <form id="umAddDomainForm" class="unimail-row" style="margin-bottom:12px">
                <input name="domain" required placeholder="newcollege.ac.in" />
                <input name="college" required placeholder="Short name (e.g. DTC)" />
                <button class="btn btn-primary" type="submit">Add domain</button>
              </form>
              <div class="unimail-table-wrap">
                <table class="unimail-table">
                  <thead><tr><th>Domain</th><th>College</th><th>Verified</th><th>Status</th></tr></thead>
                  <tbody>
                    ${stats.domains.map((d) => `
                      <tr>
                        <td><code>${esc(d.domain)}</code></td>
                        <td>${esc(d.college)}</td>
                        <td>${esc(d.verifiedCount)}</td>
                        <td>
                          <button class="pill ${d.enabled ? "active" : ""}" data-toggle-domain="${esc(d.domain)}" data-enabled="${d.enabled}">
                            ${d.enabled ? "Enabled" : "Disabled"}
                          </button>
                        </td>
                      </tr>
                    `).join("")}
                  </tbody>
                </table>
              </div>
            </div>
            <div class="unimail-card">
              <h3>Recent Email Activity</h3>
              ${stats.recentLogs.length ? `
                <ul class="unimail-log-list">
                  ${stats.recentLogs.slice(0, 6).map((l) => `
                    <li>
                      <strong>${esc(l.eventType)}</strong> → <code>${esc(l.recipient)}</code>
                      <span class="verdict ${l.status === "failed" ? "verdict-high" : "verdict-good"}">${esc(l.status)}</span>
                      ${l.errorMessage ? `<small>${esc(l.errorMessage)}</small>` : ""}
                    </li>
                  `).join("")}
                </ul>
              ` : `<p class="fine">No emails sent yet in this session.</p>`}
              <h4 style="margin-top:16px">Email Templates (${stats.templates.length})</h4>
              <ul class="unimail-log-list">
                ${stats.templates.slice(0, 5).map((t) => `<li><code>${esc(t.eventType)}</code> — ${esc(t.subject)}</li>`).join("")}
              </ul>
            </div>
          </div>
        </div>
      ` : ""}

      ${activeTab === "dns" ? `
        <div class="unimail-panel">
          <div class="unimail-card">
            <h3>DNS &amp; MX Record Inspector</h3>
            <p class="fine">Performs live DNS resolution (A, AAAA, MX, TXT, SPF, DKIM, DMARC) via the UniMail backend. When offline or for unowned domains, clearly enters <strong>Demonstration Mode</strong> without inventing records.</p>
            <form id="umDnsForm" class="unimail-row" style="margin:12px 0">
              <input name="domain" required placeholder="dtu.ac.in" value="${esc(lastDnsDomain)}" />
              <button class="btn btn-primary" type="submit">Lookup DNS</button>
            </form>
            <div id="umDnsResult" class="unimail-dns-box">${dnsMsg || "Enter a domain and click Lookup DNS."}</div>
          </div>
        </div>
      ` : ""}

      ${activeTab === "network" ? `
        <div class="unimail-panel">
          <div class="unimail-card" style="margin-bottom:16px">
            <h3>Computer Networks Delivery Pipeline</h3>
            <div class="unimail-flow">
              <span>1. Student Registration</span><i>→</i>
              <span>2. Domain Validation</span><i>→</i>
              <span>3. DNS / MX Lookup</span><i>→</i>
              <span>4. SMTP Server (${esc(smtp.tls)})</span><i>→</i>
              <span>5. Recipient Mail Server</span><i>→</i>
              <span>6. Email Delivery</span>
            </div>
            <div class="unimail-concepts">
              <div><strong>DNS Resolution:</strong> Translates institutional domains into IPv4 (<code>A</code>) and IPv6 (<code>AAAA</code>) addresses.</div>
              <div><strong>MX Records:</strong> Mail Exchange records specify the recipient's mail server and priority order.</div>
              <div><strong>SMTP Transmission:</strong> Simple Mail Transfer Protocol pushes outbound mail over port ${esc(smtp.port)} with ${esc(smtp.tls)}.</div>
              <div><strong>SPF / DKIM / DMARC:</strong> TXT-based authentication proving sender IP authorization, cryptographic signature, and alignment policy.</div>
              <div><strong>POP3 / IMAP:</strong> Retrieval protocols used by mail clients to fetch/sync inbox messages (not configured on this outbound-only UniMail relay).</div>
            </div>
          </div>
          <div class="unimail-card">
            <h3>SMTP Relay Status</h3>
            <p class="fine">Host: <code>${esc(smtp.host)}</code> · Port: <code>${esc(smtp.port)}</code> · Security: <code>${esc(smtp.tls)}</code> · Sender: <code>${esc(smtp.from)}</code></p>
            <p class="fine">${esc(smtp.note)}</p>
            <form id="umTestSmtpForm" class="unimail-row" style="margin-top:12px">
              <input name="to" type="email" required placeholder="test-recipient@dtu.ac.in" value="${esc(lastSmtpTo)}" />
              <button class="btn btn-primary" type="submit">Send Test Email</button>
            </form>
            <p class="fine" id="umTestSmtpMsg">${esc(smtpMsg)}</p>
          </div>
        </div>
      ` : ""}
    `;

    // Wire tab switches
    root.querySelectorAll("[data-utab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeTab = btn.dataset.utab;
        render();
      });
    });

    // Wire Verification Send
    root.querySelector("#umSendForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = new FormData(e.target).get("email");
      lastEmail = String(email || "");
      const res = await api("/api/unimail/verify/send", { method: "POST", body: JSON.stringify({ email }) });
      if (!res) {
        sendMsg = "Static mode: start `npm run dev:unimail` for live SMTP token delivery.";
        render();
        return;
      }
      if (!res.ok) {
        sendMsg = res.error;
        toast?.(res.error);
        render();
        return;
      }
      devTokenHint = res.devToken || "";
      sendMsg = `Token generated for ${res.college} (${res.domain}).`;
      toast?.(`Verification token sent to ${res.email}`);
      render();
    });

    // Wire Verification Confirm
    root.querySelector("#umConfirmForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      lastToken = String(fd.get("token") || "");
      const res = await api("/api/unimail/verify/confirm", {
        method: "POST",
        body: JSON.stringify({ email: fd.get("email"), token: fd.get("token") }),
      });
      if (!res) {
        confirmMsg = "Static mode: start `npm run dev:unimail` to verify tokens.";
        render();
        return;
      }
      confirmMsg = res.ok ? `Verified! ${res.email} (${res.college})` : res.error;
      toast?.(res.ok ? `Email verified for ${res.college}` : res.error);
      render();
    });

    // Wire Resend
    root.querySelector("#umResendBtn")?.addEventListener("click", async () => {
      if (!lastEmail) return toast?.("Enter your email first.");
      const res = await api("/api/unimail/verify/send", { method: "POST", body: JSON.stringify({ email: lastEmail }) });
      if (res?.ok) {
        devTokenHint = res.devToken || "";
        sendMsg = `Token generated for ${res.college} (${res.domain}).`;
        toast?.("New verification token issued.");
        render();
      } else if (res?.error) {
        sendMsg = res.error;
        toast?.(res.error);
        render();
      }
    });

    // Wire Add Domain
    root.querySelector("#umAddDomainForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const res = await api("/api/unimail/domains", {
        method: "POST",
        body: JSON.stringify({ domain: fd.get("domain"), college: fd.get("college") }),
      });
      if (res?.ok) {
        toast?.(`Added domain ${res.domain.domain}`);
        render();
      } else {
        toast?.(res?.error || "Could not add domain.");
      }
    });

    // Wire Toggle Domain
    root.querySelectorAll("[data-toggle-domain]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const domain = btn.dataset.toggleDomain;
        const next = btn.dataset.enabled !== "true";
        const res = await api(`/api/unimail/domains/${encodeURIComponent(domain)}`, {
          method: "PATCH",
          body: JSON.stringify({ enabled: next }),
        });
        if (res?.ok) render();
      });
    });

    // Wire DNS Lookup
    root.querySelector("#umDnsForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const domain = new FormData(e.target).get("domain");
      lastDnsDomain = String(domain || "");
      dnsMsg = "Resolving DNS records…";
      render();
      const res = await api(`/api/unimail/dns?domain=${encodeURIComponent(domain)}`);
      if (!res) {
        dnsMsg = `<strong>Demonstration Mode:</strong> Live DNS requires the UniMail backend (<code>npm run dev:unimail</code>). No real DNS records were invented.`;
        render();
        return;
      }
      if (!res.ok) {
        dnsMsg = esc(res.error);
        render();
        return;
      }
      // Every record below is text chosen by whoever controls that DNS zone,
      // so it is escaped before it becomes markup.
      dnsMsg = `
        <p><strong>Mode:</strong> ${res.mode === "live" ? "Live DNS Lookup" : "Demonstration Mode"} ${res.note ? `— ${esc(res.note)}` : ""}</p>
        <p><strong>A:</strong> ${res.a.length ? esc(res.a.join(", ")) : "None"}</p>
        <p><strong>AAAA:</strong> ${res.aaaa.length ? esc(res.aaaa.join(", ")) : "None"}</p>
        <p><strong>MX:</strong> ${res.mx.length ? esc(res.mx.map((m) => `${m.exchange} (pri ${m.priority})`).join(", ")) : "None"}</p>
        <p><strong>SPF:</strong> ${res.spf ? esc(res.spf) : "None"}</p>
        <p><strong>DKIM:</strong> ${res.dkim ? esc(res.dkim) : "None"}</p>
        <p><strong>DMARC:</strong> ${res.dmarc ? esc(res.dmarc) : "None"}</p>
      `;
      render();
    });

    // Wire Test SMTP
    root.querySelector("#umTestSmtpForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const to = new FormData(e.target).get("to");
      lastSmtpTo = String(to || "");
      const res = await api("/api/unimail/smtp/test", { method: "POST", body: JSON.stringify({ to }) });
      if (!res) {
        smtpMsg = "Static mode: start `npm run dev:unimail` to test SMTP delivery.";
        render();
        return;
      }
      smtpMsg = res.ok ? `Test email sent to ${to}` : (res.delivery?.errorMessage || res.error || "SMTP delivery failed");
      render();
    });
  }

  render();
}
