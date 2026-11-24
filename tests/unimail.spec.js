// UniMail — the browser suite.
//
// The service itself is covered by `tests/unimail.test.mjs` (10/10). What
// that suite cannot see is the half a student actually touches: the four
// tabs in the page, the forms, and the messages the page prints when
// something goes wrong.
//
// The part worth being careful about is the fallback. The deployed site is
// static — there is no `/api/unimail/*` behind it — so every call comes
// back as "no JSON" and the page has to fall back on its own. A page that
// cannot reach a mail server must say so. It must not print a verification
// token it never sent, and it must not print DNS records it never looked
// up. Those two claims are the whole difference between a demo and a
// working tool, so they are what this suite pins down.

import { test, expect } from "@playwright/test";
import { COLLEGES } from "../src/data.js";

const BASE = process.env.BASE_URL || "http://localhost:5173";

/* ------------------------------------------------------------------ mocks */

/**
 * Stand in for the UniMail backend.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ stats?: object, smtp?: object, dns?: object,
 *           send?: object, confirm?: object, testMail?: object }} [opts]
 */
async function mockBackend(page, opts = {}) {
  const calls = { send: [], confirm: [], dns: [], domains: [], toggle: [], testMail: [] };

  const stats = {
    totalSent: 12,
    delivered: 9,
    failed: 2,
    pending: 1,
    verifiedStudents: 854,
    registeredDomains: 2,
    enabledDomains: 2,
    domains: [
      { domain: "dtu.ac.in", college: "DTU", enabled: true, verifiedCount: 142 },
      { domain: "du.ac.in", college: "DU", enabled: true, verifiedCount: 198 },
    ],
    recentLogs: [
      {
        id: "log-1",
        recipient: "aarav@dtu.ac.in",
        eventType: "email_verification",
        subject: "UniMail Verification Code for DTU",
        status: "failed",
        errorMessage: "SMTP not configured (set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS).",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    templates: [
      { eventType: "student_registration", subject: "Welcome to UniHaat — Verify your campus email" },
      { eventType: "email_verification", subject: "UniMail Verification Code for {{college}}" },
    ],
  };

  const smtp = {
    configured: true,
    host: "smtp.dtu.ac.in",
    port: 587,
    tls: "STARTTLS",
    from: "unimail@unihaat.campus",
    authConfigured: true,
    pop3ImapConfigured: false,
    note: "Credentials are stored only in server environment variables and never exposed to the browser.",
  };

  await page.route(/\/api\/unimail\//, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const p = url.pathname;
    const body = request.postDataJSON?.() ?? {};
    const json = (payload, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(payload),
      });

    if (p === "/api/unimail/stats") return json(opts.stats ?? stats);
    if (p === "/api/unimail/smtp/status") return json(opts.smtp ?? smtp);

    if (p === "/api/unimail/verify/send") {
      calls.send.push(body);
      return json(opts.send ?? { ok: true, email: body.email, college: "DTU", domain: "dtu.ac.in", devToken: "a".repeat(32) });
    }

    if (p === "/api/unimail/verify/confirm") {
      calls.confirm.push(body);
      return json(opts.confirm ?? { ok: true, email: body.email, college: "DTU", domain: "dtu.ac.in" });
    }

    if (p === "/api/unimail/dns") {
      calls.dns.push(url.searchParams.get("domain"));
      return json(
        opts.dns ?? {
          ok: true,
          domain: url.searchParams.get("domain"),
          mode: "live",
          a: ["10.0.0.1"],
          aaaa: ["2001:db8::1"],
          mx: [{ exchange: "mail.dtu.ac.in", priority: 10 }],
          txt: [],
          spf: "v=spf1 include:_spf.dtu.ac.in ~all",
          dmarc: "v=DMARC1; p=reject",
          dkim: "v=DKIM1; k=rsa; h=sha256",
          note: null,
        },
      );
    }

    if (p === "/api/unimail/domains" && request.method() === "POST") {
      calls.domains.push(body);
      return json({ ok: true, domain: { domain: body.domain, college: body.college, enabled: true, verifiedCount: 0 } });
    }

    if (p.startsWith("/api/unimail/domains/") && request.method() === "PATCH") {
      calls.toggle.push({ domain: decodeURIComponent(p.replace("/api/unimail/domains/", "")), ...body });
      return json({ ok: true });
    }

    if (p === "/api/unimail/smtp/test") {
      calls.testMail.push(body);
      return json(opts.testMail ?? { ok: true });
    }

    return json({ error: "Not found" }, 404);
  });

  return calls;
}

/* ------------------------------------------------------------------ tests */

test.describe("UniMail tabs", () => {
  test("all four tabs render and switch", async ({ page }) => {
    await page.goto(BASE, { waitUntil: "domcontentloaded" });

    const root = page.locator("#unimailRoot");
    await expect(root.locator("[data-utab]")).toHaveCount(4);

    // The verification tab is the one that opens.
    await expect(root.locator("#umSendForm")).toBeVisible();
    await expect(root.locator("#umConfirmForm")).toBeVisible();

    await root.locator('[data-utab="admin"]').click();
    await expect(root.locator(".unimail-kpi")).toHaveCount(6);
    await expect(root.locator("#umAddDomainForm")).toBeVisible();

    await root.locator('[data-utab="dns"]').click();
    await expect(root.locator("#umDnsForm")).toBeVisible();

    await root.locator('[data-utab="network"]').click();
    await expect(root.locator("#umTestSmtpForm")).toBeVisible();
    await expect(root.locator(".unimail-flow")).toBeVisible();
  });

  test("the network tab explains the delivery pipeline without leaking secrets", async ({ page }) => {
    await mockBackend(page);
    await page.goto(BASE, { waitUntil: "domcontentloaded" });

    await page.locator('#unimailRoot [data-utab="network"]').click();

    const flow = page.locator(".unimail-flow");
    await expect(flow).toContainText("Student Registration");
    await expect(flow).toContainText("Domain Validation");
    await expect(flow).toContainText("SMTP Server");
    await expect(flow).toContainText("Email Delivery");

    // The relay is described, but the credential is never in the page.
    await expect(page.locator("#unimailRoot")).toContainText("smtp.dtu.ac.in");
    await expect(page.locator("#unimailRoot")).not.toContainText("SMTP_PASS");
    await expect(page.locator("#unimailRoot")).not.toContainText("SMTP_USER");
  });
});

test.describe("UniMail admin view", () => {
  test("the domain table lists every approved college", async ({ page }) => {
    await mockBackend(page);
    await page.goto(BASE, { waitUntil: "domcontentloaded" });

    await page.locator('#unimailRoot [data-utab="admin"]').click();

    const rows = page.locator("#unimailRoot .unimail-table tbody tr");
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText("dtu.ac.in");
    await expect(rows.first()).toContainText("DTU");

    // The recent-activity list is shown, including why a send failed.
    await expect(page.locator("#unimailRoot .unimail-log-list").first()).toContainText("email_verification");
    await expect(page.locator("#unimailRoot")).toContainText("SMTP not configured");
  });

  test("a domain can be added and toggled", async ({ page }) => {
    const calls = await mockBackend(page);
    await page.goto(BASE, { waitUntil: "domcontentloaded" });

    await page.locator('#unimailRoot [data-utab="admin"]').click();

    await page.locator('#umAddDomainForm input[name="domain"]').fill("nsut.ac.in");
    await page.locator('#umAddDomainForm input[name="college"]').fill("NSUT");
    await page.locator("#umAddDomainForm button[type=submit]").click();

    expect(calls.domains).toEqual([{ domain: "nsut.ac.in", college: "NSUT" }]);

    // Toggling sends the state it is switching *to*, not the state it is in.
    await page.locator('[data-toggle-domain="dtu.ac.in"]').click();
    expect(calls.toggle).toEqual([{ domain: "dtu.ac.in", enabled: false }]);
  });
});

test.describe("UniMail verification", () => {
  test("an approved domain gets a token and the page confirms it", async ({ page }) => {
    const calls = await mockBackend(page);
    await page.goto(BASE, { waitUntil: "domcontentloaded" });

    await page.locator('#umSendForm input[name="email"]').fill("aarav@dtu.ac.in");
    await page.locator("#umSendForm button[type=submit]").click();

    expect(calls.send).toEqual([{ email: "aarav@dtu.ac.in" }]);
    await expect(page.locator("#umSendMsg")).toContainText("Token generated for DTU");
    await expect(page.locator("#unimailRoot")).toContainText("a".repeat(32));

    await page.locator('#umConfirmForm input[name="email"]').fill("aarav@dtu.ac.in");
    await page.locator("#umConfirmForm button[type=submit]").click();

    expect(calls.confirm).toEqual([{ email: "aarav@dtu.ac.in", token: "a".repeat(32) }]);
    await expect(page.locator("#umConfirmMsg")).toContainText("Verified!");
    await expect(page.locator("#umConfirmMsg")).toContainText("DTU");
  });

  test("an unapproved domain is refused and no token is issued", async ({ page }) => {
    await mockBackend(page, {
      send: {
        ok: false,
        error: 'Domain "gmail.com" is not an approved institutional domain. Arbitrary .edu or .ac.in domains are not automatically trusted.',
      },
    });
    await page.goto(BASE, { waitUntil: "domcontentloaded" });

    await page.locator('#umSendForm input[name="email"]').fill("someone@gmail.com");
    await page.locator("#umSendForm button[type=submit]").click();

    await expect(page.locator("#umSendMsg")).toContainText("not an approved institutional domain");
    // Nothing that looks like a token may appear.
    await expect(page.locator("#umConfirmForm input[name=token]")).toHaveValue("");
  });

  test("a bad token is reported rather than accepted", async ({ page }) => {
    await mockBackend(page, { confirm: { ok: false, error: "Invalid verification token." } });
    await page.goto(BASE, { waitUntil: "domcontentloaded" });

    await page.locator('#umConfirmForm input[name="email"]').fill("aarav@dtu.ac.in");
    await page.locator('#umConfirmForm input[name="token"]').fill("deadbeef");
    await page.locator("#umConfirmForm button[type=submit]").click();

    await expect(page.locator("#umConfirmMsg")).toContainText("Invalid verification token");
    await expect(page.locator("#umConfirmMsg")).not.toContainText("Verified!");
  });

  test("resending asks the backend again", async ({ page }) => {
    const calls = await mockBackend(page);
    await page.goto(BASE, { waitUntil: "domcontentloaded" });

    await page.locator('#umSendForm input[name="email"]').fill("aarav@dtu.ac.in");
    await page.locator("#umSendForm button[type=submit]").click();
    await page.locator("#umResendBtn").click();

    expect(calls.send).toHaveLength(2);
    expect(calls.send[1]).toEqual({ email: "aarav@dtu.ac.in" });
  });

  test("the confirmation message survives the re-render", async ({ page }) => {
    // The message used to be written straight into the DOM, and the panel
    // was then re-rendered — which wiped it. The one message that mattered
    // most was the one most likely to vanish.
    await mockBackend(page);
    await page.goto(BASE, { waitUntil: "domcontentloaded" });

    await page.locator('#umSendForm input[name="email"]').fill("aarav@dtu.ac.in");
    await page.locator("#umSendForm button[type=submit]").click();

    await expect(page.locator("#umSendMsg")).toContainText("Token generated for DTU");

    // It has to still be there a moment later, not just at the instant the
    // panel was rebuilt.
    await page.waitForTimeout(500);
    await expect(page.locator("#umSendMsg")).toContainText("Token generated for DTU");
  });

  test("what the student typed is not cleared by the re-render", async ({ page }) => {
    await mockBackend(page);
    await page.goto(BASE, { waitUntil: "domcontentloaded" });

    await page.locator('#umConfirmForm input[name="email"]').fill("aarav@dtu.ac.in");
    await page.locator('#umConfirmForm input[name="token"]').fill("a".repeat(32));
    await page.locator("#umConfirmForm button[type=submit]").click();

    await expect(page.locator('#umConfirmForm input[name="email"]')).toHaveValue("aarav@dtu.ac.in");
    await expect(page.locator('#umConfirmForm input[name="token"]')).toHaveValue("a".repeat(32));
  });
});

test.describe("UniMail DNS inspector", () => {
  test("live records are shown as the backend reported them", async ({ page }) => {
    const calls = await mockBackend(page);
    await page.goto(BASE, { waitUntil: "domcontentloaded" });

    await page.locator('#unimailRoot [data-utab="dns"]').click();
    await page.locator('#umDnsForm input[name="domain"]').fill("dtu.ac.in");
    await page.locator("#umDnsForm button[type=submit]").click();

    expect(calls.dns).toEqual(["dtu.ac.in"]);

    const box = page.locator("#umDnsResult");
    await expect(box).toContainText("Live DNS Lookup");
    await expect(box).toContainText("10.0.0.1");
    await expect(box).toContainText("2001:db8::1");
    await expect(box).toContainText("mail.dtu.ac.in (pri 10)");
    await expect(box).toContainText("v=spf1 include:_spf.dtu.ac.in ~all");
    await expect(box).toContainText("v=DMARC1; p=reject");
  });

  test("a domain with no records says so instead of inventing them", async ({ page }) => {
    await mockBackend(page, {
      dns: {
        ok: true,
        domain: "nowhere.ac.in",
        mode: "demonstration",
        a: [],
        aaaa: [],
        mx: [],
        txt: [],
        spf: null,
        dmarc: null,
        dkim: null,
        note: "Demonstration Mode: live DNS returned no records for this domain (or network DNS is unreachable). No real DNS records were invented.",
      },
    });
    await page.goto(BASE, { waitUntil: "domcontentloaded" });

    await page.locator('#unimailRoot [data-utab="dns"]').click();
    await page.locator('#umDnsForm input[name="domain"]').fill("nowhere.ac.in");
    await page.locator("#umDnsForm button[type=submit]").click();

    const box = page.locator("#umDnsResult");
    await expect(box).toContainText("Demonstration Mode");
    await expect(box).toContainText("No real DNS records were invented");
    // Every record type reads "None" — nothing was made up.
    await expect(box).toContainText("None");
  });

  test("a DNS record containing markup is shown as text, not run", async ({ page }) => {
    // A TXT record is arbitrary text chosen by whoever controls that zone.
    // It was being dropped into `innerHTML` unescaped, so a zone owner could
    // have had a tag run on the page of every student who looked the domain
    // up.
    await mockBackend(page, {
      dns: {
        ok: true,
        domain: "evil.ac.in",
        mode: "live",
        a: [],
        aaaa: [],
        mx: [],
        txt: [],
        spf: '<img src=x onerror="window.__pwned = 1">',
        dmarc: "<script>window.__pwned = 2</script>",
        dkim: null,
        note: null,
      },
    });
    await page.goto(BASE, { waitUntil: "domcontentloaded" });

    await page.locator('#unimailRoot [data-utab="dns"]').click();
    await page.locator('#umDnsForm input[name="domain"]').fill("evil.ac.in");
    await page.locator("#umDnsForm button[type=submit]").click();

    // The record is visible — as text.
    await expect(page.locator("#umDnsResult")).toContainText("<img src=x");
    // And it did not become an element.
    expect(await page.locator("#umDnsResult img").count()).toBe(0);
    expect(await page.locator("#umDnsResult script").count()).toBe(0);
    expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  });

  test("a hostile domain name in the admin table is not markup either", async ({ page }) => {
    await mockBackend(page, {
      stats: {
        totalSent: 0,
        delivered: 0,
        failed: 0,
        pending: 0,
        verifiedStudents: 0,
        registeredDomains: 1,
        enabledDomains: 1,
        domains: [{ domain: '"><img src=x onerror="window.__pwned=1">', college: "<b>Fake</b>", enabled: true, verifiedCount: 0 }],
        recentLogs: [],
        templates: [],
      },
    });
    await page.goto(BASE, { waitUntil: "domcontentloaded" });

    await page.locator('#unimailRoot [data-utab="admin"]').click();

    expect(await page.locator("#unimailRoot .unimail-table img").count()).toBe(0);
    expect(await page.locator("#unimailRoot .unimail-table b").count()).toBe(0);
    expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  });
});

test.describe("UniMail SMTP test", () => {
  test("a failed delivery shows why", async ({ page }) => {
    await mockBackend(page, {
      testMail: { ok: false, delivery: { errorMessage: "SMTP not configured (set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS)." } },
    });
    await page.goto(BASE, { waitUntil: "domcontentloaded" });

    await page.locator('#unimailRoot [data-utab="network"]').click();
    await page.locator('#umTestSmtpForm input[name="to"]').fill("test@dtu.ac.in");
    await page.locator("#umTestSmtpForm button[type=submit]").click();

    await expect(page.locator("#umTestSmtpMsg")).toContainText("SMTP not configured");
  });
});

/* --------------------------------------------------------- static fallback */

test.describe("UniMail with no backend (the deployed site)", () => {
  test("the page still renders and lists the approved colleges", async ({ page }) => {
    await page.goto(BASE, { waitUntil: "domcontentloaded" });

    const root = page.locator("#unimailRoot");
    await expect(root.locator("[data-utab]")).toHaveCount(4);

    await root.locator('[data-utab="admin"]').click();
    const rows = root.locator(".unimail-table tbody tr");
    await expect(rows).toHaveCount(COLLEGES.length);
    await expect(root).toContainText("dtu.ac.in");
    await expect(root).toContainText("delhitechnicalcampus.ac.in");
  });

  test("asking for a token says the server is unreachable — it does not pretend", async ({ page }) => {
    await page.goto(BASE, { waitUntil: "domcontentloaded" });

    await page.locator('#umSendForm input[name="email"]').fill("aarav@dtu.ac.in");
    await page.locator("#umSendForm button[type=submit]").click();

    const msg = page.locator("#umSendMsg");
    await expect(msg).toContainText("Static mode");
    await expect(msg).toContainText("dev:unimail");

    // No token, and nothing that looks like one.
    await expect(page.locator("#umConfirmForm input[name=token]")).toHaveValue("");
    await expect(page.locator("#unimailRoot")).not.toContainText(/Token generated/);
  });

  test("the DNS inspector enters demonstration mode without inventing records", async ({ page }) => {
    await page.goto(BASE, { waitUntil: "domcontentloaded" });

    await page.locator('#unimailRoot [data-utab="dns"]').click();
    await page.locator("#umDnsForm button[type=submit]").click();

    const box = page.locator("#umDnsResult");
    await expect(box).toContainText("Demonstration Mode");
    await expect(box).toContainText("No real DNS records were invented");
    // Not a single address is printed.
    await expect(box).not.toContainText(/\d{1,3}(\.\d{1,3}){3}/);
  });

  test("the SMTP test says the relay is not configured", async ({ page }) => {
    await page.goto(BASE, { waitUntil: "domcontentloaded" });

    await page.locator('#unimailRoot [data-utab="network"]').click();
    await page.locator('#umTestSmtpForm input[name="to"]').fill("test@dtu.ac.in");
    await page.locator("#umTestSmtpForm button[type=submit]").click();

    await expect(page.locator("#umTestSmtpMsg")).toContainText("Static mode");
  });
});
