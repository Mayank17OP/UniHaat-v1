import { COLLEGES } from "./data.js";

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
                <input name="email" type="email" required placeholder="you@dtu.ac.in or you@delhitechnicalcampus.ac.in" value="${lastEmail}" />
              </label>
              <button class="btn btn-primary" type="submit">Send verification token</button>
              <p class="fine" id="umSendMsg"></p>
            </form>
            <form id="umConfirmForm" class="unimail-card">
              <h3>Confirm verification token</h3>
              <p class="fine">Tokens expire after 15 minutes and are single-use.${devTokenHint ? ` Dev token: <code>${devTokenHint}</code>` : ""}</p>
              <label>Campus Email
                <input name="email" type="email" required placeholder="you@dtu.ac.in" value="${lastEmail}" />
              </label>
              <label>Verification Token
                <input name="token" required placeholder="Paste 32-char token" value="${devTokenHint}" />
              </label>
              <div class="unimail-row">
                <button class="btn btn-primary" type="submit">Verify token</button>
                <button class="btn btn-ghost" type="button" id="umResendBtn">Resend token</button>
              </div>
              <p class="fine" id="umConfirmMsg"></p>
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
                        <td><code>${d.domain}</code></td>
                        <td>${d.college}</td>
                        <td>${d.verifiedCount}</td>
                        <td>
                          <button class="pill ${d.enabled ? "active" : ""}" data-toggle-domain="${d.domain}" data-enabled="${d.enabled}">
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
                      <strong>${l.eventType}</strong> → <code>${l.recipient}</code>
                      <span class="verdict ${l.status === "failed" ? "verdict-high" : "verdict-good"}">${l.status}</span>
                      ${l.errorMessage ? `<small>${l.errorMessage}</small>` : ""}
                    </li>
                  `).join("")}
                </ul>
              ` : `<p class="fine">No emails sent yet in this session.</p>`}
              <h4 style="margin-top:16px">Email Templates (${stats.templates.length})</h4>
              <ul class="unimail-log-list">
                ${stats.templates.slice(0, 5).map((t) => `<li><code>${t.eventType}</code> — ${t.subject}</li>`).join("")}
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
              <input name="domain" required placeholder="dtu.ac.in" value="dtu.ac.in" />
              <button class="btn btn-primary" type="submit">Lookup DNS</button>
            </form>
            <div id="umDnsResult" class="unimail-dns-box">Enter a domain and click Lookup DNS.</div>
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
              <span>4. SMTP Server (${smtp.tls})</span><i>→</i>
              <span>5. Recipient Mail Server</span><i>→</i>
              <span>6. Email Delivery</span>
            </div>
            <div class="unimail-concepts">
              <div><strong>DNS Resolution:</strong> Translates institutional domains into IPv4 (<code>A</code>) and IPv6 (<code>AAAA</code>) addresses.</div>
              <div><strong>MX Records:</strong> Mail Exchange records specify the recipient's mail server and priority order.</div>
              <div><strong>SMTP Transmission:</strong> Simple Mail Transfer Protocol pushes outbound mail over port ${smtp.port} with ${smtp.tls}.</div>
              <div><strong>SPF / DKIM / DMARC:</strong> TXT-based authentication proving sender IP authorization, cryptographic signature, and alignment policy.</div>
              <div><strong>POP3 / IMAP:</strong> Retrieval protocols used by mail clients to fetch/sync inbox messages (not configured on this outbound-only UniMail relay).</div>
            </div>
          </div>
          <div class="unimail-card">
            <h3>SMTP Relay Status</h3>
            <p class="fine">Host: <code>${smtp.host}</code> · Port: <code>${smtp.port}</code> · Security: <code>${smtp.tls}</code> · Sender: <code>${smtp.from}</code></p>
            <p class="fine">${smtp.note}</p>
            <form id="umTestSmtpForm" class="unimail-row" style="margin-top:12px">
              <input name="to" type="email" required placeholder="test-recipient@dtu.ac.in" />
              <button class="btn btn-primary" type="submit">Send Test Email</button>
            </form>
            <p class="fine" id="umTestSmtpMsg"></p>
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
      const msg = root.querySelector("#umSendMsg");
      const res = await api("/api/unimail/verify/send", { method: "POST", body: JSON.stringify({ email }) });
      if (!res) {
        msg.textContent = "Static mode: start `npm run dev:unimail` for live SMTP token delivery.";
        return;
      }
      if (!res.ok) {
        msg.textContent = res.error;
        toast?.(res.error);
        return;
      }
      devTokenHint = res.devToken || "";
      msg.textContent = `Token generated for ${res.college} (${res.domain}).`;
      toast?.(`Verification token sent to ${res.email}`);
      render();
    });

    // Wire Verification Confirm
    root.querySelector("#umConfirmForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const msg = root.querySelector("#umConfirmMsg");
      const res = await api("/api/unimail/verify/confirm", {
        method: "POST",
        body: JSON.stringify({ email: fd.get("email"), token: fd.get("token") }),
      });
      if (!res) {
        msg.textContent = "Static mode: start `npm run dev:unimail` to verify tokens.";
        return;
      }
      msg.textContent = res.ok ? `Verified! ${res.email} (${res.college})` : res.error;
      toast?.(res.ok ? `Email verified for ${res.college}` : res.error);
    });

    // Wire Resend
    root.querySelector("#umResendBtn")?.addEventListener("click", async () => {
      if (!lastEmail) return toast?.("Enter your email first.");
      const res = await api("/api/unimail/verify/send", { method: "POST", body: JSON.stringify({ email: lastEmail }) });
      if (res?.ok) {
        devTokenHint = res.devToken || "";
        toast?.("New verification token issued.");
        render();
      } else if (res?.error) {
        toast?.(res.error);
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
      const box = root.querySelector("#umDnsResult");
      box.textContent = "Resolving DNS records…";
      const res = await api(`/api/unimail/dns?domain=${encodeURIComponent(domain)}`);
      if (!res) {
        box.innerHTML = `<strong>Demonstration Mode:</strong> Live DNS requires the UniMail backend (<code>npm run dev:unimail</code>). No real DNS records were invented.`;
        return;
      }
      if (!res.ok) {
        box.textContent = res.error;
        return;
      }
      box.innerHTML = `
        <p><strong>Mode:</strong> ${res.mode === "live" ? "Live DNS Lookup" : "Demonstration Mode"} ${res.note ? `— ${res.note}` : ""}</p>
        <p><strong>A:</strong> ${res.a.length ? res.a.join(", ") : "None"}</p>
        <p><strong>AAAA:</strong> ${res.aaaa.length ? res.aaaa.join(", ") : "None"}</p>
        <p><strong>MX:</strong> ${res.mx.length ? res.mx.map((m) => `${m.exchange} (pri ${m.priority})`).join(", ") : "None"}</p>
        <p><strong>SPF:</strong> ${res.spf || "None"}</p>
        <p><strong>DKIM:</strong> ${res.dkim || "None"}</p>
        <p><strong>DMARC:</strong> ${res.dmarc || "None"}</p>
      `;
    });

    // Wire Test SMTP
    root.querySelector("#umTestSmtpForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const to = new FormData(e.target).get("to");
      const msg = root.querySelector("#umTestSmtpMsg");
      const res = await api("/api/unimail/smtp/test", { method: "POST", body: JSON.stringify({ to }) });
      if (!res) {
        msg.textContent = "Static mode: start `npm run dev:unimail` to test SMTP delivery.";
        return;
      }
      msg.textContent = res.ok ? `Test email sent to ${to}` : (res.delivery?.errorMessage || res.error || "SMTP delivery failed");
    });
  }

  render();
}
