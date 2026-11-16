// Three-way merge of plan texts, used when the worker says someone else saved
// first (409). `base` is the last version this device saw on the server,
// `local` is what this device has now, `remote` is what the server has now.
// Rule: start from remote, then replay this device's own changes on top —
// lines it deleted since base are removed, lines it added are inserted after
// the line that preceded them locally. Edits are a delete + an add.
// Nothing the other device added is ever dropped.

const HEADING = /^#{1,3}\s/;

function counts(lines) {
  const m = new Map();
  for (const l of lines) m.set(l, (m.get(l) || 0) + 1);
  return m;
}

export function merge3(base, local, remote) {
  if (local === remote || local === base) return remote;
  if (remote === base) return local;

  const B = base.split('\n');
  const L = local.split('\n');
  const out = remote.split('\n');
  const inBase = counts(B);
  const inLocal = counts(L);

  // Day headings whose remote section gained lines must survive a local delete
  // (e.g. this device archived the day while another device added to it).
  const keep = new Set();
  let heading = null;
  for (const l of out) {
    if (HEADING.test(l.trim())) heading = l;
    else if (heading && l.trim() && !inBase.has(l)) keep.add(heading);
  }

  // 1. lines this device deleted since base (blank lines are left alone)
  for (const [line, n] of inBase) {
    if (!line.trim() || keep.has(line)) continue;
    let del = n - (inLocal.get(line) || 0);
    while (del-- > 0) {
      const i = out.indexOf(line);
      if (i < 0) break; // remote already removed it
      out.splice(i, 1);
    }
  }

  // 2. lines this device added since base, placed after their local predecessor
  const unused = new Map(inBase);
  let prev = -1; // position in `out` of the last line we walked past
  for (const line of L) {
    const left = unused.get(line) || 0;
    if (left > 0) {
      unused.set(line, left - 1);
      let i = out.indexOf(line, prev + 1);
      if (i < 0) i = out.indexOf(line);
      if (i >= 0 && line.trim()) prev = i;
      continue;
    }
    if (line.trim()) {
      const i = out.indexOf(line);
      if (i >= 0) { prev = i; continue; } // both sides added the same line
    }
    if (HEADING.test(line.trim()) && prev >= 0 && out[prev].trim()) {
      out.splice(prev + 1, 0, ''); // keep a blank line before a new day heading
      prev += 1;
    }
    out.splice(prev + 1, 0, line);
    prev += 1;
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}
