import { randomBytes, randomUUID } from "node:crypto";
import type { Database, Row } from "../db/database.ts";
import type { FormFile } from "./files.ts";

export interface FormAnswer {
  label: string;
  value: string;
  /**
   * For a question with choices: every choice it offered when it was answered (with its icon or photo), so the
   * answer can be shown as the form showed it, and which of them were picked.
   */
  choices?: { label: string; icon?: string; image?: string }[];
  picked?: string[];
}

export interface FormResponse {
  id: string;
  /** Which form it came from: the page it is on and its node id. */
  form: string;
  title: string;
  answers: FormAnswer[];
  /** The files the visitor attached: what they are, never their bytes. Empty for most messages. */
  files: FormFile[];
  createdAt: string;
}

const SECRET_KEY = "form_secret"; // betterleaks:allow (the name of the setting that holds the secret, not the secret)

/** Responses visitors sent through the site's forms, and the secret the site signs its forms with. */
export class FormStore {
  readonly #db: Database;
  #secret: Promise<string> | undefined;

  constructor(db: Database) {
    this.#db = db;
  }

  /** Made on first use and kept in the database, so the build and the server sign with the same one. */
  secret(): Promise<string> {
    this.#secret ??= (async () => {
      await this.#db.query("INSERT INTO brim_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO NOTHING", [
        SECRET_KEY,
        randomBytes(32).toString("base64url"),
      ]);
      const rows = await this.#db.query("SELECT value FROM brim_meta WHERE key = ?", [SECRET_KEY]);
      return String(rows[0]?.value);
    })();
    return this.#secret;
  }

  /**
   * Keeps a response and answers its id, which the editor opens it by (`/admin/edit?response=<id>`). `id` is given
   * when the message has files, which are stored under it before the message is.
   */
  async save(
    form: string,
    title: string,
    answers: FormAnswer[],
    files: FormFile[] = [],
    id: string = randomUUID(),
  ): Promise<string> {
    await this.#db.query(
      "INSERT INTO brim_form_responses (id, form, title, answers, files, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [id, form, title, JSON.stringify(answers), JSON.stringify(files), new Date().toISOString()],
    );
    return id;
  }

  async list(): Promise<FormResponse[]> {
    const rows = await this.#db.query("SELECT * FROM brim_form_responses ORDER BY created_at DESC LIMIT 1000");
    return rows.map(toResponse);
  }

  async get(id: string): Promise<FormResponse | undefined> {
    const rows = await this.#db.query("SELECT * FROM brim_form_responses WHERE id = ?", [id]);
    return rows[0] && toResponse(rows[0]);
  }

  /** Deletes a message and gives back what it was, so its files can be deleted too. */
  async remove(id: string): Promise<FormResponse | undefined> {
    const response = await this.get(id);
    await this.#db.query("DELETE FROM brim_form_responses WHERE id = ?", [id]);
    return response;
  }
}

function toResponse(row: Row): FormResponse {
  return {
    id: String(row.id),
    form: String(row.form),
    title: String(row.title),
    answers: JSON.parse(String(row.answers)) as FormAnswer[],
    files: JSON.parse(String(row.files ?? "[]")) as FormFile[],
    createdAt: String(row.created_at),
  };
}
