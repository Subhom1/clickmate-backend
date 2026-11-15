import test from "node:test";
import assert from "node:assert/strict";
import {
  isValidObjectId,
  normalizeEmail,
  normalizeSearchQuery,
  isValidSearchDate,
  isValidSearchTime,
} from "../../../utils/validation.js";

test("isValidObjectId accepts a 24-character hexadecimal id", () => {
  assert.equal(isValidObjectId("507f1f77bcf86cd799439011"), true);
});

test("isValidObjectId rejects missing and malformed ids", () => {
  assert.equal(isValidObjectId(undefined), false);
  assert.equal(isValidObjectId("not-an-id"), false);
});

test("normalizeEmail trims whitespace and lowercases the address", () => {
  assert.equal(normalizeEmail("  USER@Example.COM "), "user@example.com");
});

test("normalizeEmail returns an empty string for non-string input", () => {
  assert.equal(normalizeEmail(null), "");
});

test("normalizeSearchQuery trims and collapses internal whitespace", () => {
  assert.equal(normalizeSearchQuery("  meet   new\npeople  "), "meet new people");
});

test("normalizeSearchQuery returns an empty string for non-string input", () => {
  assert.equal(normalizeSearchQuery(42), "");
});

test("search schedule validation accepts picker values and rejects impossible dates or times", () => {
  assert.equal(isValidSearchDate("2028-02-29"), true);
  assert.equal(isValidSearchDate("2027-02-29"), false);
  assert.equal(isValidSearchDate("2026-13-01"), false);
  assert.equal(isValidSearchDate("2026-1-01"), false);
  assert.equal(isValidSearchTime("00:00"), true);
  assert.equal(isValidSearchTime("23:59"), true);
  assert.equal(isValidSearchTime("24:00"), false);
  assert.equal(isValidSearchTime("9:30"), false);
});
