import { beforeEach, describe, expect, it } from "vitest";
import { Accounts } from "../src/auth/accounts.ts";
import { openDatabase } from "../src/db/libsql.ts";
import { migrate } from "../src/db/schema.ts";

const PASSWORD = "correct horse battery"; // betterleaks:allow
let accounts: Accounts;

beforeEach(async () => {
  const db = openDatabase(":memory:");
  await migrate(db);
  accounts = new Accounts(db);
  await accounts.createUser("owner@example.test", PASSWORD, "owner");
  await accounts.createUser("editor@example.test", PASSWORD, "editor");
});

describe("user management", () => {
  it("lists users with owners first and their token count", async () => {
    await accounts.createToken("editor@example.test", "laptop");
    const users = await accounts.listUsers();
    expect(users.map(({ email, role, tokens }) => ({ email, role, tokens }))).toEqual([
      { email: "owner@example.test", role: "owner", tokens: 0 },
      { email: "editor@example.test", role: "editor", tokens: 1 },
    ]);
  });

  it("always keeps an owner", async () => {
    await expect(accounts.setRole("owner@example.test", "editor")).rejects.toThrow("only owner");
    await expect(accounts.removeUser("owner@example.test")).rejects.toThrow("only owner");
    await accounts.setRole("editor@example.test", "owner");
    await accounts.setRole("owner@example.test", "editor");
    expect((await accounts.listUsers()).find((user) => user.email === "owner@example.test")?.role).toBe("editor");
  });

  it("removing a user ends their sessions and tokens", async () => {
    const editor = (await accounts.authenticate("editor@example.test", PASSWORD))!;
    const session = await accounts.startSession(editor.id);
    const token = await accounts.createToken("editor@example.test", "mcp");
    await accounts.removeUser("editor@example.test");
    expect(await accounts.sessionUser(session.token)).toBeUndefined();
    expect(await accounts.tokenUser(token)).toBeUndefined();
    expect(await accounts.authenticate("editor@example.test", PASSWORD)).toBeUndefined();
  });

  it("a new password signs the user out everywhere: sessions and tokens end", async () => {
    const editor = (await accounts.authenticate("editor@example.test", PASSWORD))!;
    const session = await accounts.startSession(editor.id);
    const token = await accounts.createToken("editor@example.test", "mcp");
    await expect(accounts.setPassword("editor@example.test", "short")).rejects.toThrow("at least");
    await accounts.setPassword("editor@example.test", "a brand new passphrase");
    expect(await accounts.sessionUser(session.token)).toBeUndefined();
    expect(await accounts.tokenUser(token)).toBeUndefined();
    expect(await accounts.authenticate("editor@example.test", "a brand new passphrase")).toBeDefined();
  });

  it("a sign-in token signs its user in once and is never a session itself", async () => {
    const { token } = await accounts.createSignInToken("Owner@Example.test");
    expect(await accounts.sessionUser(token)).toBeUndefined();
    expect(await accounts.redeemSignInToken("not the token")).toBeUndefined();
    expect(await accounts.redeemSignInToken(token)).toMatchObject({ email: "owner@example.test" });
    expect(await accounts.redeemSignInToken(token)).toBeUndefined();
    await expect(accounts.createSignInToken("nobody@example.test")).rejects.toThrow("no user");
  });

  it("names the user that does not exist", async () => {
    await expect(accounts.setRole("nobody@example.test", "editor")).rejects.toThrow("nobody@example.test");
  });
});
