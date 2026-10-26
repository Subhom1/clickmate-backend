import test from "node:test";
import assert from "node:assert/strict";
import {
  isValidObjectId,
  normalizeEmail,
  normalizeSearchQuery,
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
