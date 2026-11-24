import type { APIRoute } from "astro";
import config from "virtual:brim/config";
import { captchaCheck } from "../forms/captcha.ts";
import { type FormsHandler, createFormsHandler } from "../forms/handler.ts";
import { resolveMail } from "../config.ts";
import { siteFormFiles } from "./form-files.ts";
import { Mailer } from "../mail/mailer.ts";
import { clientAddress as visitorAddress } from "../server/http.ts";
import { connect } from "./connect.ts";

/** `/_brim/forms` on the built server: the same handler the dev server uses. */
export const prerender = false;

let handler: Promise<FormsHandler> | undefined;

export const ALL: APIRoute = async ({ request, clientAddress }) => {
  handler ??= connect(config.databaseUrl, config.authToken).then((brim) =>
    createFormsHandler(brim, {
      mailer: new Mailer(resolveMail(config.mail)),
      emails: () => config.emails,
      captcha: captchaCheck(config.captcha),
      files: siteFormFiles(),
      siteName: config.identity.name,
    }),
  );
  return (
    (await (await handler)(request, { clientAddress: visitorAddress(request, clientAddress) })) ??
    new Response("Not found", { status: 404 })
  );
};
