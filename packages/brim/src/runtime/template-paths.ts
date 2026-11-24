import config from "virtual:brim/config";
import type { TemplatePageProps } from "../content/page-templates.ts";
import { connect } from "./connect.ts";
import { getItems } from "./content.ts";
import { isEditing } from "./request-state.ts";

/**
 * The pages of a static build's template route: one per page the owner added from a template, and one per item of
 * a content type that has a template, in every language. The server has none: it looks a page up on each request.
 */
export async function templateStaticPaths() {
  const { content } = await connect(config.databaseUrl, config.authToken);
  const pages = await content.templatePages({ publishedOnly: !isEditing() });
  const added = pages.flatMap((page) => {
    const template = config.pageTemplates.find((candidate) => candidate.key === page.template);
    // A page whose template was removed from the code has nothing to draw it; it waits until it is back.
    if (!template) return [];
    const props: TemplatePageProps = { path: page.path, title: page.title ?? "", template: template.key };
    return [
      { params: { page: page.path.slice(1) }, props: { pageProps: { page: props }, component: template.component } },
    ];
  });
  const items = await Promise.all(
    config.contentTypes
      .filter((type) => type.component)
      .map(async (type) =>
        (await getItems(type.key, { locale: "*" })).map((item) => ({
          params: { page: item.url.slice(1) },
          props: { pageProps: { item }, component: type.component },
        })),
      ),
  );
  return [...added, ...items.flat()];
}
