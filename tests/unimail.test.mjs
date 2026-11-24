import test from "node:test";
import assert from "node:assert/strict";
import { createUniMailService } from "../server/unimail.mjs";

function makeMockTransport({ shouldFail = false } = {}) {
  const sent = [];
  return {
    sent,
    async sendMail(msg) {
      if (shouldFail) throw new Error("ECONNREFUSED: SMTP server unreachable");
      sent.push(msg);
      return { messageId: `<mock-${sent.length}@unihaat.campus>` };
    },
  };
}

test("1. Approved institutional email is accepted and sends verification token", async () => {
  const tx = makeMockTransport();
  const svc = createUniMailService({ transport: tx });
  const res = await svc.sendVerification("student@dtu.ac.in");
  assert.equal(res.ok, true);
  assert.equal(res.college, "DTU");
  assert.equal(res.delivery.status, "sent");
  assert.equal(tx.sent.length, 1);
  assert.match(tx.sent[0].subject, /UniMail Verification Code/);
});

test("2. Unapproved .edu and .ac.in domains are rejected", async () => {
  const tx = makeMockTransport();
  const svc = createUniMailService({ transport: tx });
  const r1 = await svc.sendVerification("hacker@random-fake.edu");
  const r2 = await svc.sendVerification("user@unknown-college.ac.in");
  assert.equal(r1.ok, false);
  assert.match(r1.error, /not an approved institutional domain/);
  assert.equal(r2.ok, false);
  assert.match(r2.error, /not an approved institutional domain/);
  assert.equal(tx.sent.length, 0);
});

test("3. Successful token verification marks account verified", async () => {
  const tx = makeMockTransport();
  const svc = createUniMailService({ transport: tx });
  await svc.sendVerification("ananya@delhitechnicalcampus.ac.in");
  const tokenMatch = tx.sent[0].text.match(/token is: ([a-f0-9]+)/i);
  assert.ok(tokenMatch, "Token should be in email body");
  const res = svc.confirmVerification("ananya@delhitechnicalcampus.ac.in", tokenMatch[1]);
  assert.equal(res.ok, true);
  assert.equal(res.college, "DTC");
});

test("4. Expired token is rejected", async () => {
  let clock = 1000000;
  const tx = makeMockTransport();
  const svc = createUniMailService({ transport: tx, tokenTtlMs: 60000, now: () => clock });
  await svc.sendVerification("rohan@du.ac.in");
  const token = tx.sent[0].text.match(/token is: ([a-f0-9]+)/i)[1];
  clock += 61000; // advance past 60s TTL
  const res = svc.confirmVerification("rohan@du.ac.in", token);
  assert.equal(res.ok, false);
  assert.match(res.error, /expired/i);
});

test("5. Resend verification invalidates old token and issues a new one", async () => {
  const tx = makeMockTransport();
  const svc = createUniMailService({ transport: tx });
  await svc.sendVerification("meera@iitd.ac.in");
  const oldToken = tx.sent[0].text.match(/token is: ([a-f0-9]+)/i)[1];
  await svc.sendVerification("meera@iitd.ac.in");
  const newToken = tx.sent[1].text.match(/token is: ([a-f0-9]+)/i)[1];
  assert.notEqual(oldToken, newToken);
  assert.equal(svc.confirmVerification("meera@iitd.ac.in", oldToken).ok, false);
  assert.equal(svc.confirmVerification("meera@iitd.ac.in", newToken).ok, true);
});

test("6. Purchase notification sends order confirmation", async () => {
  const tx = makeMockTransport();
  const svc = createUniMailService({ transport: tx });
  const res = await svc.sendNotification({
    to: "buyer@dtu.ac.in",
    eventType: "purchase_confirmation",
    vars: { item: "Study Table", price: "₹2,499", college: "DTU" },
  });
  assert.equal(res.ok, true);
  assert.match(tx.sent[0].subject, /Order confirmed: Study Table/);
});

test("7. Rental notifications (request, approval, rejection)", async () => {
  const tx = makeMockTransport();
  const svc = createUniMailService({ transport: tx });
  const r1 = await svc.sendNotification({ to: "owner@du.ac.in", eventType: "rental_request", vars: { item: "Guitar", borrower: "Aarav", dates: "Dec 1-5" } });
  const r2 = await svc.sendNotification({ to: "borrower@du.ac.in", eventType: "rental_approved", vars: { item: "Guitar" } });
  const r3 = await svc.sendNotification({ to: "borrower@du.ac.in", eventType: "rental_rejected", vars: { item: "Guitar" } });
  assert.equal(r1.ok && r2.ok && r3.ok, true);
  assert.equal(tx.sent.length, 3);
});

test("8. SafeSwap handover notification", async () => {
  const tx = makeMockTransport();
  const svc = createUniMailService({ transport: tx });
  const res = await svc.sendNotification({
    to: "student@nsut.ac.in",
    eventType: "safeswap_handover",
    vars: { item: "Casio fx-991ES", code: "UH-4821" },
  });
  assert.equal(res.ok, true);
  assert.match(tx.sent[0].text, /UH-4821/);
});

test("9. SMTP connection failure is logged and handled gracefully", async () => {
  const tx = makeMockTransport({ shouldFail: true });
  const svc = createUniMailService({ transport: tx });
  const res = await svc.sendNotification({
    to: "student@dtu.ac.in",
    eventType: "security_alert",
  });
  assert.equal(res.ok, false);
  assert.equal(res.delivery.status, "failed");
  assert.match(res.delivery.errorMessage, /ECONNREFUSED/);
  assert.equal(svc.getStats().failed, 1);
});

test("10. DNS/MX lookup returns live records or clearly labelled demonstration mode", async () => {
  const svc = createUniMailService({
    dnsResolver: {
      resolve4: async () => ["14.139.251.10"],
      resolve6: async () => [],
      resolveMx: async () => [{ exchange: "aspmx.l.google.com", priority: 1 }],
      resolveTxt: async (d) => (d.startsWith("_dmarc.") ? [["v=DMARC1; p=none;"]] : [["v=spf1 include:_spf.google.com ~all"]]),
    },
  });
  const live = await svc.lookupDns("dtu.ac.in");
  assert.equal(live.ok, true);
  assert.equal(live.mode, "live");
  assert.equal(live.mx[0].exchange, "aspmx.l.google.com");
  assert.match(live.spf, /v=spf1/);
  assert.match(live.dmarc, /v=DMARC1/);

  const offlineSvc = createUniMailService({
    dnsResolver: {
      resolve4: async () => { throw new Error("ENOTFOUND"); },
      resolve6: async () => { throw new Error("ENOTFOUND"); },
      resolveMx: async () => { throw new Error("ENOTFOUND"); },
      resolveTxt: async () => { throw new Error("ENOTFOUND"); },
    },
  });
  const demo = await offlineSvc.lookupDns("dtu.ac.in");
  assert.equal(demo.ok, true);
  assert.equal(demo.mode, "demonstration");
  assert.match(demo.note, /Demonstration Mode/);
});
