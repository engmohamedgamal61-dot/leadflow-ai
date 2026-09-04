import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseLeadListParams,
  sanitizeSearch,
  buildLeadsQuery,
  totalPages,
  LEADS_PAGE_SIZE,
  LEADS_MAX_PAGE,
} from "./list-params.ts";

test("sanitizeSearch strips characters that could break an or(...) filter", () => {
  assert.equal(sanitizeSearch("john,name.ilike.*"), "john name.ilike.");
  assert.equal(sanitizeSearch("  a) or (1=1  "), "a or 1 1");
  assert.equal(sanitizeSearch("O'Brien+jane@x.com"), "O Brien+jane@x.com");
  assert.equal(sanitizeSearch("%%%"), "");
  assert.equal(sanitizeSearch(123), "");
  assert.equal(sanitizeSearch("x".repeat(200)).length, 80);
  // keeps unicode letters (Arabic name search)
  assert.equal(sanitizeSearch("محمد"), "محمد");
});

test("parseLeadListParams drops unknown filters and clamps the page", () => {
  const p = parseLeadListParams({
    q: "  Sara  ",
    temp: "SCALDING",
    status: "definitely-not-a-status",
    page: "-4",
  });
  assert.equal(p.search, "Sara");
  assert.equal(p.temperature, null);
  assert.equal(p.status, null);
  assert.equal(p.page, 1);
  assert.equal(p.isFiltered, true); // search alone counts
});

test("parseLeadListParams accepts known filters and computes the range", () => {
  const p = parseLeadListParams({ temp: "hot", status: "qualified", page: "3" });
  assert.equal(p.temperature, "hot");
  assert.equal(p.status, "qualified");
  assert.equal(p.page, 3);
  assert.equal(p.pageSize, LEADS_PAGE_SIZE);
  assert.equal(p.rangeFrom, 2 * LEADS_PAGE_SIZE);
  assert.equal(p.rangeTo, 3 * LEADS_PAGE_SIZE - 1);
  assert.equal(p.isFiltered, true);
});

test("parseLeadListParams caps the page at LEADS_MAX_PAGE and handles arrays", () => {
  assert.equal(parseLeadListParams({ page: "99999" }).page, LEADS_MAX_PAGE);
  assert.equal(parseLeadListParams({ q: ["first", "second"] }).search, "first");
  assert.equal(parseLeadListParams({}).isFiltered, false);
});

test("buildLeadsQuery resets the page when a filter changes, drops empties", () => {
  const base = parseLeadListParams({ q: "sara", temp: "hot", page: "4" });
  assert.equal(buildLeadsQuery(base, { status: "won" }), "?q=sara&temp=hot&status=won");
  assert.equal(buildLeadsQuery(base, { temperature: null }), "?q=sara");
  assert.equal(buildLeadsQuery(base, { page: 2 }), "?q=sara&temp=hot&page=2");
  assert.equal(buildLeadsQuery(base, { search: "" }), "?temp=hot");
  assert.equal(buildLeadsQuery(parseLeadListParams({}), {}), "");
});

test("totalPages never returns less than 1", () => {
  assert.equal(totalPages(0), 1);
  assert.equal(totalPages(1), 1);
  assert.equal(totalPages(LEADS_PAGE_SIZE + 1), 2);
});
