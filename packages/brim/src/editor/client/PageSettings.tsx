import { type FormEvent, useEffect, useId, useState } from "react";
import {
  type ContentType,
  type Item,
  type ItemDraft,
  type SeoSettings,
  type SiteIdentityInfo,
  type SitePage,
  loadSiteInfo,
} from "./api.ts";
import { readFocus } from "../../content/image-focus.ts";
import { imageField, itemPicture } from "../../content/item-image.ts";
import type { ImageFocus } from "../../content/types.ts";
import { CheckboxWidget, TextWidget } from "./fields.tsx";
import { ItemFields } from "./ItemForm.tsx";
import { Fieldset, Sidebar } from "./Sidebar.tsx";
import { ImageUploadWidget, MediaFolderContext } from "./widgets.tsx";

/** What the page's own code gives for its head; shown wherever the owner has set nothing. */
export interface OwnSeo {
  title?: string;
  description?: string;
  image?: string;
}

/** The item whose page is open, which the page settings also let the owner change. */
export interface PageItem {
  type: ContentType;
  item: Item;
  onChange: (draft: ItemDraft) => void;
  /** Each keystroke in one of the item's text fields, before it is saved: the page shows it at once. */
  onDraft?: ((field: string, value: unknown) => void) | undefined;
}

/** Lengths search engines show in full: a longer title or description is cut short in the results. */
const TITLE_LENGTH = 60;
const DESCRIPTION_LENGTH = 155;

/**
 * The current page's own settings: any page of the site, or the page of one content item, whose title, address
 * and fields come first. The page's SEO title, description and preview image are what search engines and link
 * previews show, previewed as they will look. Each change is saved as it is made.
 */
export function PageSettings({
  page,
  own,
  item,
  onChange,
  onMove,
  onClose,
}: {
  page: SitePage;
  /** Absent when the page's layout has no `<Seo>`: then nothing set here reaches the page. */
  own: OwnSeo | undefined;
  item?: PageItem | undefined;
  onChange: (seo: SeoSettings) => void;
  /** Moves a page added from a template to a new address; resolves to false when it could not. */
  onMove: (to: string) => Promise<boolean>;
  onClose?: (() => void) | undefined;
}) {
  const { seo } = page;
  const set = (change: SeoSettings): void => onChange({ ...seo, ...change });
  const [identity, setIdentity] = useState<SiteIdentityInfo | undefined>();
  useEffect(() => {
    void loadSiteInfo().then((info) => setIdentity(info.identity));
  }, []);
  // What is being typed, so the previews follow each keystroke before the field is saved.
  const [draft, setDraft] = useState<SeoSettings>({});
  useEffect(() => setDraft({}), [seo]);
  const live = { ...seo, ...draft };
  const typing = (field: keyof SeoSettings) => (value: string) =>
    setDraft((current) => ({ ...current, [field]: value }));

  const title = titleOf(live.title || own?.title, identity);
  const description = live.description || own?.description || identity?.description || "";
  const image = live.image || own?.image || identity?.image || "";
  const shareTitle = live.shareTitle || title;
  const shareDescription = live.shareDescription || description;
  // On an item's page without a preview image of its own, the item's picture stands in: shown here, and its focus
  // chosen here is the item's, the one its cards and the image field use. Choosing another picture sets the page's.
  const picture = item && !seo.image ? itemPicture(item.type, item.item) : undefined;
  const pictureField = item && imageField(item.type);
  const preview =
    picture && pictureField && item
      ? {
          value: picture.src,
          focus: picture.focus,
          onFocus: (focus: ImageFocus) => {
            const { focus: _old, ...rest } = picture;
            const kept = readFocus(focus);
            item.onChange({
              ...item.item,
              data: { ...item.item.data, [pictureField]: kept ? { ...rest, focus: kept } : rest },
            });
          },
        }
      : {
          value: seo.image ?? "",
          focus: seo.imageFocus,
          onFocus: (focus: ImageFocus) => {
            const { imageFocus: _old, ...rest } = seo;
            const kept = readFocus(focus);
            onChange(kept ? { ...rest, imageFocus: kept } : rest);
          },
        };

  return (
    <Sidebar title="Page Settings" onClose={onClose}>
      {!own && (
        <p className="brim-sidebar-note" role="note">
          This page's layout does not use Brim's Seo component in its head, so what you set here is saved but not shown
          on the page.
        </p>
      )}
      {item && (
        <MediaFolderContext.Provider value={{ key: `${item.type.key}/${item.item.id}`, label: item.item.title }}>
          <Fieldset title={item.type.singular} open>
            <ItemFields type={item.type} draft={item.item} onChange={item.onChange} onDraft={item.onDraft} />
          </Fieldset>
        </MediaFolderContext.Provider>
      )}
      <Fieldset title="Search results" open={!item}>
        <SearchPreview path={page.path} title={title} description={description} hidden={live.noindex === true} />
        <TextWidget
          label="SEO title"
          description="Shown in the browser tab, in search results and on shared links. Empty uses the page's own title."
          placeholder={own?.title}
          value={seo.title ?? ""}
          limit={TITLE_LENGTH}
          onDraft={typing("title")}
          onChange={(value) => set({ title: value })}
        />
        <TextWidget
          label="SEO description"
          description="The short text under the title in search results and on shared links."
          placeholder={own?.description ?? identity?.description ?? undefined}
          value={seo.description ?? ""}
          multiline
          limit={DESCRIPTION_LENGTH}
          onDraft={typing("description")}
          onChange={(value) => set({ description: value })}
        />
      </Fieldset>
      <Fieldset title="Shared links">
        <SharePreview path={page.path} title={shareTitle} description={shareDescription} image={image} />
        <ImageUploadWidget
          label="Preview image"
          description={
            picture
              ? `The ${item?.type.singular.toLowerCase()}'s picture, until you choose another for shared links. Best at 1200 × 630.`
              : "Shown when the page is shared on social networks and in chats. Best at 1200 × 630."
          }
          value={preview.value}
          focus={preview.focus}
          onFocus={preview.onFocus}
          // A new picture starts with its focus in the middle.
          onChange={(value) => {
            const { imageFocus: _old, ...rest } = seo;
            onChange({ ...rest, image: value });
          }}
        />
        <TextWidget
          label="Title on shared links"
          description="When a shared link should say something else than the search result. Empty uses the SEO title."
          placeholder={title}
          value={seo.shareTitle ?? ""}
          onDraft={typing("shareTitle")}
          onChange={(value) => set({ shareTitle: value })}
        />
        <TextWidget
          label="Description on shared links"
          placeholder={description}
          value={seo.shareDescription ?? ""}
          multiline
          onDraft={typing("shareDescription")}
          onChange={(value) => set({ shareDescription: value })}
        />
      </Fieldset>
      <Fieldset title="Settings">
        {!item && page.template && <AddressField path={page.path} onMove={onMove} />}
        {!item && !page.template && (
          <div className="field-group">
            <span className="field-label">Address</span>
            <p className="field-description">Where this page lives on the site. It comes from the site's code.</p>
            <code className="brim-page-address">{page.path}</code>
          </div>
        )}
        <CheckboxWidget
          label="Hide from search engines"
          description="Search engines leave the page out of their results, and it leaves the sitemap."
          checked={seo.noindex ?? false}
          onChange={(noindex) => set({ noindex })}
        />
        <CheckboxWidget
          label="Don't follow this page's links"
          description="Search engines don't follow the links on this page to other pages."
          checked={seo.nofollow ?? false}
          onChange={(nofollow) => set({ nofollow })}
        />
        <TextWidget
          label="Canonical address"
          description="When the same content is at another address, the one search engines should list: a path of this site (/pricing) or a full address. Empty is this page."
          placeholder={page.path}
          value={seo.canonical ?? ""}
          onChange={(value) => set({ canonical: value })}
        />
      </Fieldset>
    </Sidebar>
  );
}

/** The address of a page added from a template: changed here, the old one redirects to it. */
function AddressField({ path, onMove }: { path: string; onMove: (to: string) => Promise<boolean> }) {
  const id = useId();
  const [draft, setDraft] = useState(path);
  const [busy, setBusy] = useState(false);
  useEffect(() => setDraft(path), [path]);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    if (!(await onMove(draft.trim()))) setDraft(path);
    setBusy(false);
  }

  return (
    <form className="field-group" onSubmit={(event) => void submit(event)}>
      <label className="field-label" htmlFor={id}>
        Address
      </label>
      <p className="field-description">
        Where this page lives on the site. When it changes, the old address keeps working and leads here.
      </p>
      <div className="brim-inline-form">
        <input id={id} className="field-input" value={draft} onChange={(event) => setDraft(event.target.value)} />
        <button type="submit" className="url-browse-btn" disabled={busy || draft.trim() === path}>
          Change
        </button>
      </div>
    </form>
  );
}

/** The page's title as `<Seo>` writes it: with the site's title template, or the site's name when it has none. */
function titleOf(own: string | undefined, identity: SiteIdentityInfo | undefined): string {
  const title = own?.trim();
  if (!title) return identity?.name ?? "";
  if (!identity?.titleTemplate || title === identity.name) return title;
  return identity.titleTemplate.replace("%s", title);
}

/** How the page shows in a search engine's results: address, title and description, cut where they cut. */
function SearchPreview({
  path,
  title,
  description,
  hidden,
}: {
  path: string;
  title: string;
  description: string;
  hidden: boolean;
}) {
  const crumbs = [location.host, ...path.split("/").filter(Boolean)].join(" › ");
  return (
    <figure className="brim-seo-preview" aria-label="Search result preview">
      {hidden && <p className="brim-seo-preview__note">Hidden from search engines: this result won't show.</p>}
      <div className="brim-search-result" data-hidden={hidden ? "" : undefined}>
        <span className="brim-search-result__url">{crumbs}</span>
        <span className="brim-search-result__title">{title || "Untitled page"}</span>
        <span className="brim-search-result__description">
          {description || "No description: search engines pick a passage of the page."}
        </span>
      </div>
    </figure>
  );
}

/** How a link to the page shows when shared in a chat or on a social network. */
function SharePreview({
  path,
  title,
  description,
  image,
}: {
  path: string;
  title: string;
  description: string;
  image: string;
}) {
  return (
    <figure className="brim-seo-preview" aria-label="Shared link preview">
      <div className="brim-share-card">
        {image ? (
          <img className="brim-share-card__image" src={image} alt="" />
        ) : (
          <div className="brim-share-card__image brim-share-card__image--empty">No preview image</div>
        )}
        <div className="brim-share-card__text">
          <span className="brim-share-card__host">
            {location.host}
            {path === "/" ? "" : path}
          </span>
          <span className="brim-share-card__title">{title || "Untitled page"}</span>
          {description && <span className="brim-share-card__description">{description}</span>}
        </div>
      </div>
    </figure>
  );
}
