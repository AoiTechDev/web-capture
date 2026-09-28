import { describe, expect, test } from "vitest";
import { assertLocalEmbedding, isFetchableUrl, LOCAL_EMBEDDING_DIM } from "../convex/helpers";

describe("isFetchableUrl", () => {
  test.each([
    "http://example.com/",
    "https://example.com/path?q=1",
    "https://sub.domain.co.uk:8443/x",
    "http://8.8.8.8/",
    "http://172.32.0.1/", // just outside 172.16/12
    "http://100.128.0.1/", // just outside CGNAT 100.64/10
    "http://[2606:4700::1111]/",
    "http://[::ffff:8.8.8.8]/", // mapped public IPv4
    "https://news.ycombinator.com./", // trailing root dot on a public host
    "http://[2002:808:808::1]/", // 6to4 of a public IPv4
  ])("allows public http(s): %s", (url) => {
    expect(isFetchableUrl(url)).toBe(true);
  });

  test.each([
    ["not a url", "garbage"],
    ["empty", ""],
    ["file scheme", "file:///etc/passwd"],
    ["ftp scheme", "ftp://example.com/"],
    ["javascript scheme", "javascript:alert(1)"],
    ["data scheme", "data:text/html,hi"],
    ["gopher scheme", "gopher://example.com/"],
    ["credentials in URL", "http://user:pass@example.com/"],
    ["localhost", "http://localhost/"],
    ["localhost with port", "http://localhost:3000/"],
    ["LOCALHOST uppercase", "http://LOCALHOST/"],
    ["*.localhost", "http://api.localhost/"],
    ["*.local mDNS", "http://printer.local/"],
    ["loopback 127.0.0.1", "http://127.0.0.1/"],
    ["loopback 127.1.2.3", "http://127.1.2.3/"],
    ["0.0.0.0", "http://0.0.0.0/"],
    ["10/8", "http://10.0.0.5/"],
    ["172.16/12 low", "http://172.16.0.1/"],
    ["172.16/12 high", "http://172.31.255.255/"],
    ["192.168/16", "http://192.168.1.1/"],
    ["CGNAT 100.64/10", "http://100.64.0.1/"],
    ["link-local 169.254", "http://169.254.169.254/latest/meta-data/"],
    ["multicast", "http://224.0.0.1/"],
    ["broadcast", "http://255.255.255.255/"],
    ["decimal loopback", "http://2130706433/"],
    ["decimal metadata", "http://2852039166/"],
    ["hex loopback", "http://0x7f000001/"],
    ["dotted hex loopback", "http://0x7f.0.0.1/"],
    ["octal loopback", "http://0177.0.0.1/"],
    ["short-form loopback", "http://127.1/"],
    ["IPv6 loopback", "http://[::1]/"],
    ["IPv6 unspecified", "http://[::]/"],
    ["IPv6 unique local fc00", "http://[fc00::1]/"],
    ["IPv6 unique local fd", "http://[fd12:3456::1]/"],
    ["IPv6 link-local", "http://[fe80::1]/"],
    ["IPv4-mapped loopback", "http://[::ffff:127.0.0.1]/"],
    ["IPv4-mapped metadata", "http://[::ffff:169.254.169.254]/"],
    ["IPv4-mapped hex private", "http://[::ffff:c0a8:101]/"],
    ["IPv4-mapped hex 10/8", "http://[::ffff:a00:1]/"],
    ["trailing-dot localhost", "http://localhost./"],
    ["double trailing-dot localhost", "http://localhost../"],
    ["*.internal", "http://metadata.google.internal/"],
    ["*.home.arpa", "http://router.home.arpa/"],
    ["benchmarking 198.18/15", "http://198.19.0.1/"],
    ["IPv4-compatible loopback", "http://[::127.0.0.1]/"],
    ["NAT64 loopback", "http://[64:ff9b::7f00:1]/"],
    ["6to4 loopback", "http://[2002:7f00:1::]/"],
    ["6to4 private", "http://[2002:c0a8:101::1]/"],
  ])("rejects %s", (_label, url) => {
    expect(isFetchableUrl(url)).toBe(false);
  });
});

describe("assertLocalEmbedding", () => {
  test("dimension constant matches the vector index", () => {
    expect(LOCAL_EMBEDDING_DIM).toBe(512);
  });
  test("accepts undefined and exactly 512", () => {
    expect(() => assertLocalEmbedding(undefined)).not.toThrow();
    expect(() => assertLocalEmbedding(new Array(512).fill(0))).not.toThrow();
  });
  test.each([0, 1, 511, 513, 1536])("rejects length %i", (n) => {
    expect(() => assertLocalEmbedding(new Array(n).fill(0))).toThrow(/512/);
  });
});
