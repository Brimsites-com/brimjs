import config from "virtual:brim/config";
import { type FormSpec, encodeSpec, sealAddress, sign } from "../forms/spec.ts";
import { connect } from "./connect.ts";
import { siteFormFiles } from "./form-files.ts";

/** Whether this site can take files from visitors; where it cannot, a form leaves its file fields out. */
export function takesFormFiles(): boolean {
  return siteFormFiles() !== undefined;
}

/** Signs a form as the page renders it, so the server can later recognise it as one of the site's own. */
export async function signForm(spec: FormSpec): Promise<{ spec: string; signature: string }> {
  const { forms } = await connect(config.databaseUrl, config.authToken);
  const secret = await forms.secret();
  // The page is public: the form's notification addresses go in it sealed, never as they are.
  const encoded = encodeSpec(spec.notify ? { ...spec, notify: sealAddress(secret, spec.notify) } : spec);
  return { spec: encoded, signature: sign(secret, encoded) };
}
