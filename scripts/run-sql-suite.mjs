// Runs a UniHaat SQL regression suite against a PostgreSQL database.
//
// The suites are written for psql — they use `:'name'` variables and the
// `\gset` meta-command — but they should not need psql to be installed.
// This runner understands the small subset those suites use, so the same
// file runs in CI, in a container or on a laptop.
//
//   node scripts/run-sql-suite.mjs supabase/tests/unireserve_regression.sql
//   DATABASE_URL=postgres://... node scripts/run-sql-suite.mjs <file>
//
// The database URL may also be given as the first argument.

import { readFileSync } from "node:fs";
import { Client } from "pg";

const file = process.argv[2] && !process.argv[2].includes("://")
  ? process.argv[2]
  : "supabase/tests/security_regression.sql";
const url =
  process.env.DATABASE_URL ||
  (process.argv[2] && process.argv[2].includes("://") ? process.argv[2] : null);

if (!url) {
  console.error("Give a database URL, or set DATABASE_URL.");
  process.exit(2);
}

const source = readFileSync(file, "utf8");

/**
 * Split a SQL file into the steps it is made of.
 *
 * A naive split on `;` would cut a function body in half, so the splitter
 * tracks the dollar-quote tags and the single-quote strings. A `\gset`
 * meta-command ends the query it follows, so that pair is kept together.
 */
function splitStatements(sql) {
  const out = [];
  let buf = "";
  let i = 0;
  let tag = null;
  while (i < sql.length) {
    const rest = sql.slice(i);
    if (tag) {
      if (rest.startsWith(tag)) {
        buf += tag;
        i += tag.length;
        tag = null;
        continue;
      }
      buf += sql[i];
      i += 1;
      continue;
    }
    const dollar = rest.match(/^\$[A-Za-z_]*\$/);
    if (dollar) {
      tag = dollar[0];
      buf += tag;
      i += tag.length;
      continue;
    }
    if (sql[i] === "'") {
      buf += sql[i];
      i += 1;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          buf += "''";
          i += 2;
          continue;
        }
        buf += sql[i];
        if (sql[i] === "'") {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (sql[i] === "-" && sql[i + 1] === "-") {
      const nl = sql.indexOf("\n", i);
      i = nl === -1 ? sql.length : nl;
      continue;
    }
    // A psql meta-command ends the statement it follows.
    if (sql[i] === "\\" && /[A-Za-z]/.test(sql[i + 1] || "")) {
      let name = "";
      let j = i + 1;
      while (j < sql.length && /[A-Za-z]/.test(sql[j])) {
        name += sql[j];
        j += 1;
      }
      if (name.toLowerCase() === "gset") {
        buf += "\\gset";
        out.push(buf.trim());
        buf = "";
        i = j;
        continue;
      }
      // Every other meta-command runs to the end of its line.
      const nl = sql.indexOf("\n", j);
      out.push((buf + "\\" + name).trim());
      buf = "";
      i = nl === -1 ? sql.length : nl;
      continue;
    }
    if (sql[i] === ";") {
      out.push(buf.trim());
      buf = "";
      i += 1;
      continue;
    }
    buf += sql[i];
    i += 1;
  }
  if (buf.trim()) out.push(buf.trim());
  return out.filter(Boolean);
}

/** Substitute `:'name'` with the value psql would have substituted. */
function substitute(statement, vars) {
  return statement.replace(/:'([A-Za-z_][A-Za-z0-9_]*)'/g, (_, name) => {
    if (!(name in vars)) throw new Error(`the suite used an unset variable :${name}`);
    return `'${String(vars[name]).replace(/'/g, "''")}'`;
  });
}

const client = new Client({ connectionString: url });
await client.connect();

const vars = {};
let count = 0;

try {
  // The steps run in the order they are written, because a `\gset` often
  // reads what the step before it wrote.
  for (const step of splitStatements(source)) {
    if (/^\\(set|quit|pset|timing|on_error_stop)/i.test(step)) continue;

    if (/\\gset\s*$/i.test(step)) {
      const query = substitute(step.replace(/\\gset\s*$/i, ""), vars);
      const res = await client.query(query);
      const row = res.rows[0] || {};
      for (const [name, value] of Object.entries(row)) vars[name] = value;
      count += 1;
      continue;
    }

    const text = substitute(step, vars);
    if (/^\\echo/i.test(text)) {
      console.log(text.replace(/^\\echo\s*/i, "").replace(/^'(.*)'$/, "$1"));
      continue;
    }
    await client.query(text);
    count += 1;
  }
  console.log(`\n✓ ${file}: ${count} statements, all checks passed.`);
} catch (err) {
  console.error(`\n✗ ${file} failed: ${err.message}`);
  if (err.position) {
    console.error(err.stderr || err.detail || "");
  }
  // The suites run inside a transaction and roll it back at the end. A
  // failure must not leave the transaction open: roll it back here so the
  // database is exactly as it was.
  try {
    await client.query("rollback");
  } catch {
    /* the connection may already be unusable */
  }
  process.exitCode = 1;
} finally {
  await client.end();
}
