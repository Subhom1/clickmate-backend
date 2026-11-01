import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const importModel = async (file) => (await import(pathToFileURL(resolve(process.cwd(), `models/${file}`)))).default;
const [Chat, Explore, Interest, MatchList, UserDetail, UserSearch] = await Promise.all([
  importModel("ChatScema.js"),
  importModel("ExploreSchema.js"),
  importModel("InterestSchema.js"),
  importModel("MatchListSchema.js"),
  importModel("UserDetailSchema.js"),
  importModel("UserSearchSchema.js"),
]);
const id = "0123456789abcdef01234567";

test("user schema normalizes identity fields and applies profile defaults", async () => {
  const user = new UserDetail({ fullname: "  Alice Example  ", email: " ALICE@EXAMPLE.COM " });
  await user.validate();
  assert.equal(user.fullname, "Alice Example");
  assert.equal(user.email, "alice@example.com");
  assert.equal(user.bio, "No Bio");
  assert.equal(user.search_count, 0);
});

test("user schema requires a name and email", async () => {
  const user = new UserDetail({});
  await assert.rejects(user.validate(), (error) => {
    assert.ok(error.errors.fullname);
    assert.ok(error.errors.email);
    return true;
  });
});

test("chat schema validates participants and trims message content", async () => {
  const chat = new Chat({ participants: [id], messages: [{ sender: id, content: "  hello  " }] });
  await chat.validate();
  assert.equal(chat.messages[0].content, "hello");
  assert.equal(chat.messages[0].readBy.length, 0);
  assert.ok(Chat.schema.indexes().some(([fields]) => fields.participants === 1));
});

test("chat schema rejects message content beyond the supported maximum", async () => {
  const chat = new Chat({ participants: [id], messages: [{ sender: id, content: "x".repeat(5001) }] });
  await assert.rejects(chat.validate(), (error) => Boolean(error.errors["messages.0.content"]));
});

test("explore schema trims categories and enforces item text boundaries", async () => {
  const explore = new Explore({ category: "  Outdoors  ", list: [{ text: "  Trail  ", imgUrl: "/uploads/trail.png" }] });
  await explore.validate();
  assert.equal(explore.category, "Outdoors");
  assert.equal(explore.list[0].text, "Trail");
  const invalid = new Explore({ category: "Outdoors", list: [{ text: "x".repeat(501), imgUrl: "/uploads/too-long.png" }] });
  await assert.rejects(invalid.validate(), (error) => Boolean(error.errors["list.0.text"]));
});

test("interest schema requires a unique text value", async () => {
  const interest = new Interest({ text: "Music" });
  await interest.validate();
  assert.equal(Interest.schema.path("text").options.unique, true);
  await assert.rejects(new Interest({}).validate(), (error) => Boolean(error.errors.text));
});

test("search schema has a five-minute TTL index and defaults new searches to unlocked", async () => {
  const search = new UserSearch({ userId: id, query: "weekend walk" });
  await search.validate();
  assert.equal(search.isLocked, false);
  assert.ok(search.created_at instanceof Date);
  assert.ok(UserSearch.schema.indexes().some(([fields, options]) => fields.created_at === 1 && options.expireAfterSeconds === 300));
});

test("match list schema requires both participants and timestamps new matches", async () => {
  const match = new MatchList({ user1: id, user2: "abcdef0123456789abcdef01", similarity: 0.8 });
  await match.validate();
  assert.ok(match.created_at instanceof Date);
  await assert.rejects(new MatchList({ user1: id }).validate(), (error) => Boolean(error.errors.user2));
});
