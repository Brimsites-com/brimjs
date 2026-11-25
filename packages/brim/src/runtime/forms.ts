import config from "virtual:brim/config";
import { type FormSpec, encodeSpec, sealAddress, sign } from "../forms/spec.ts";
import { connect } from "./connect.ts";
import { siteFormFiles } from "./form-files.ts";

/** Whether this site can take files from visitors; where it cannot, a form leaves its file fields out. */
export function takesFormFiles(): boolean {
  return siteFormFiles() !== undefined;
}

/**
 * Signs a form as the page renders it, so the server can later recognise it as one of the site's own.
 *
 * A signature never expires, so only what was saved is signed to send email. `preview` says the form was drawn with
 * the drafts nobody saved yet (`BrimContext.preview`): what is signed then carries no confirmation and no
 * notification address, or a draft thrown away a moment later would leave behind a form that emails its words for
 * good. The dev server draws every page with its drafts and is its developer's alone: there the form is signed
 * whole, so its emails can be tried.
 */
export async function signForm(spec: FormSpec, preview: boolean): Promise<{ spec: string; signature: string }> {
  const { forms } = await connect(config.databaseUrl, config.authToken);
  const secret = await forms.secret();
  const { notify: _notify, confirm: _confirm, ...silent } = spec;
  // The page is public: the form's notification addresses go in it sealed, never as they are.
  const whole = spec.notify ? { ...spec, notify: sealAddress(secret, spec.notify) } : spec;
  const encoded = encodeSpec(preview && config.mode !== "dev" ? silent : whole);
  return { spec: encoded, signature: sign(secret, encoded) };
}
