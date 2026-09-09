/**
 * "Is this IP address safe for the server to connect to?" — the shared core of
 * the SSRF defence. Pure, no I/O.
 *
 * Blocks loopback, private (RFC1918), carrier-grade NAT, link-local, the cloud
 * metadata address, multicast, and reserved ranges — for IPv4, IPv6, and
 * IPv4-mapped / IPv4-compatible IPv6. Handles the obfuscated IPv4 encodings
 * (`2130706433`, `0x7f000001`, `0177.0.0.1`, `127.1`) that `new URL()` leaves
 * verbatim in `hostname`.
 *
 * DNS rebinding still needs the caller to *resolve* the hostname and pass every
 * resolved address through here at connect time — see `safe-fetch.ts`.
 */

/** Canonicalise the many IPv4 spellings into `[a,b,c,d]`, or `null`. */
export function parseIpv4(host: string): [number, number, number, number] | null {
  const parts = host.split(".");
  if (parts.length === 0 || parts.length > 4) return null;

  const nums: number[] = [];
  for (const p of parts) {
    if (p === "") return null;
    let n: number;
    if (/^0x[0-9a-f]+$/i.test(p)) n = parseInt(p, 16);
    else if (/^0[0-7]+$/.test(p)) n = parseInt(p, 8);
    else if (/^\d+$/.test(p)) n = parseInt(p, 10);
    else return null;
    if (!Number.isFinite(n) || n < 0) return null;
    nums.push(n);
  }

  let value: number;
  if (nums.length === 1) value = nums[0];
  else if (nums.length === 2) value = (nums[0] << 24) | (nums[1] & 0xff_ffff);
  else if (nums.length === 3)
    value = (nums[0] << 24) | (nums[1] << 16) | (nums[2] & 0xffff);
  else value = (nums[0] << 24) | (nums[1] << 16) | (nums[2] << 8) | nums[3];

  value = value >>> 0;
  if (nums.length === 4 && nums.some((n) => n > 255)) return null;
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

export function isBlockedIpv4([a, b]: [number, number, number, number]): boolean {
  return (
    a === 0 || // 0.0.0.0/8 "this network"
    a === 10 || // private
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 CGNAT
    (a === 169 && b === 254) || // link-local + cloud metadata 169.254.169.254
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 168) || // private
    (a === 192 && b === 0) || // 192.0.0.0/24 IETF, 192.0.2.0/24 TEST-NET-1
    (a === 198 && (b === 18 || b === 19)) || // 198.18.0.0/15 benchmarking
    (a === 198 && b === 51) || // 198.51.100.0/24 TEST-NET-2
    (a === 203 && b === 0) || // 203.0.113.0/24 TEST-NET-3
    a >= 224 // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved
  );
}

/** Expand an IPv6 literal to its 8 16-bit groups, or `null` if malformed. */
function ipv6Groups(raw: string): number[] | null {
  let addr = raw.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  if (!addr) return null;

  // IPv4-mapped / -compatible tail: "::ffff:1.2.3.4" or "::1.2.3.4"
  const tail = addr.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (tail) {
    const v4 = parseIpv4(tail[1]);
    if (!v4) return null;
    addr = addr.slice(0, addr.length - tail[1].length) +
      ((v4[0] << 8) | v4[1]).toString(16) + ":" +
      ((v4[2] << 8) | v4[3]).toString(16);
  }

  const [head, ...rest] = addr.split("::");
  if (rest.length > 1) return null;
  const left = head ? head.split(":") : [];
  const right = rest.length === 1 ? (rest[0] ? rest[0].split(":") : []) : null;

  let groups: string[];
  if (right === null) {
    groups = left;
  } else {
    const fill = 8 - left.length - right.length;
    if (fill < 0) return null;
    groups = [...left, ...Array(fill).fill("0"), ...right];
  }
  if (groups.length !== 8) return null;
  const out: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    out.push(parseInt(g, 16));
  }
  return out;
}

export function isBlockedIpv6(raw: string): boolean {
  const g = ipv6Groups(raw);
  if (!g) return true; // unparseable → refuse
  const [g0, g1] = g;

  // ::  (unspecified) and ::1 (loopback)
  if (g.every((x) => x === 0)) return true;
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true;

  // ::ffff:0:0/96 and ::/96 — IPv4-mapped / -compatible: judge on the v4.
  if (g0 === 0 && g1 === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0) {
    if (g[5] === 0xffff || g[5] === 0) {
      const v4: [number, number, number, number] = [
        (g[6] >> 8) & 0xff, g[6] & 0xff, (g[7] >> 8) & 0xff, g[7] & 0xff,
      ];
      return isBlockedIpv4(v4);
    }
  }

  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g0 & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (g0 === 0x2001 && g1 === 0x0db8) return true; // 2001:db8::/32 documentation
  if (g0 === 0x2001 && g1 === 0x0000) return true; // 2001::/23 (Teredo etc.)
  if (g0 === 0x0064 && g1 === 0xff9b) return true; // 64:ff9b::/96 NAT64

  return false;
}

/**
 * True when an address (literal or DNS-resolved) must NOT be connected to.
 * An unparseable value is treated as blocked.
 */
export function isBlockedIp(addr: string): boolean {
  const trimmed = addr.trim().replace(/^\[|\]$/g, "").split("%")[0];
  if (!trimmed) return true;
  const v4 = parseIpv4(trimmed);
  if (v4) return isBlockedIpv4(v4);
  if (trimmed.includes(":")) return isBlockedIpv6(trimmed);
  return true; // not an IP → caller should have resolved it first
}
